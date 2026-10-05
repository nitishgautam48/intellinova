"""Study AI: students add a lecture link, textbook, slide deck or text and get
notes, concept map, revision sheet, flashcards and an audio brief."""
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse, Response
from fsrs import Card, Rating, Scheduler
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import CardState, ContentFlag, Flashcard, KbSource, StudyMaterial, Topic, User
from app.routers.common import get_or_404, now, rel_time, track, until
from app.security import student_user
from app.services import notes, parsing, storage, tts
from app.workers import tasks

router = APIRouter(prefix="/api/study", tags=["study"])
_sched = Scheduler(desired_retention=0.9, enable_fuzzing=False)
KIND_BY_INPUT = {"link": "video", "file": "textbook", "slides": "slides", "text": "text"}


def _own(db: Session, mid: str, user: User) -> StudyMaterial:
    m = get_or_404(db, StudyMaterial, mid, "material")
    if m.user_id != user.id:
        raise HTTPException(404, "Material not found")
    return m


LABEL = {"link": "Lecture video", "file": "Textbook", "slides": "Slide deck", "text": "Your notes", "pack": "Revision pack"}
ICON = {"link": "smart_display", "file": "menu_book", "slides": "slideshow", "text": "description", "pack": "healing"}


def lib_row(m: StudyMaterial) -> dict:
    return {"id": str(m.id), "t": m.title, "s": m.subject_label or LABEL.get(m.input_kind, ""),
            "when": rel_time(m.created_at), "status": m.status, "fav": m.favorite, "kind": m.input_kind,
            "icon": ICON.get(m.input_kind, "description"), "topic_ids": [str(t) for t in (m.topic_ids or [])]}


@router.get("/materials")
def library(user: User = Depends(student_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(StudyMaterial).where(StudyMaterial.user_id == user.id, StudyMaterial.status != "Disabled")
                      .order_by(StudyMaterial.created_at.desc()).limit(200))
    return [lib_row(m) for m in rows]


@router.post("/materials")
def create(
    input_kind: str = Form(...),
    url: str = Form(""),
    text: str = Form(""),
    title: str = Form(""),
    lang: str = Form("en"),
    file: UploadFile | None = File(None),
    user: User = Depends(student_user),
    db: Session = Depends(get_db),
):
    if input_kind not in KIND_BY_INPUT:
        raise HTTPException(400, "Choose a lecture link, textbook, slide deck or text.")
    src = KbSource(title=title.strip() or "Untitled", kind=KIND_BY_INPUT[input_kind], origin="student", owner_id=user.id,
                   created_by=user.id)
    if input_kind == "link":
        if not parsing.is_youtube(url):
            raise HTTPException(400, "Paste a YouTube video or playlist link.")
        src.url = url.strip()
        src.title = title.strip() or url.strip()
    elif input_kind in ("file", "slides"):
        if not file:
            raise HTTPException(400, "Choose a file to upload.")
        allowed = {".pdf"} if input_kind == "file" else {".pptx", ".pdf"}
        path, mime, _size = storage.save_upload(file, allowed)
        src.file_path, src.mime = path, mime
        src.title = title.strip() or (file.filename or "Untitled").rsplit(".", 1)[0]
    else:
        if len(text.strip()) < 200:
            raise HTTPException(400, "Paste at least a few paragraphs (200+ characters).")
        src.file_path = storage.save_bytes(text.encode("utf-8"), ".txt", "texts")
        src.title = title.strip() or text.strip().split("\n")[0][:80]
    db.add(src)
    db.flush()
    m = StudyMaterial(user_id=user.id, source_id=src.id, title=src.title, input_kind=input_kind,
                      source_label=src.url or (file.filename if file else "Pasted text"), status="Processing", stage=0)
    db.add(m)
    db.flush()
    track(db, user, "study_generate", m.id, "notes")
    db.commit()
    tasks.generate_material.delay(str(m.id), lang if lang in ("en", "hing", "hi") else "en")
    return {"id": str(m.id), "status": m.status}


class PackIn(BaseModel):
    topic_ids: list[uuid.UUID] = Field(default_factory=list, max_length=8)
    lang: str = "en"


@router.post("/revision-pack")
def revision_pack(body: PackIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    """One click: notes, flashcards, audio brief and slides for the student's weak topics, built from class
    material in the knowledge base (6b). Without topic_ids, the weakest topics from the learner model are used."""
    from app.routers.home import attention

    ids = list(dict.fromkeys(body.topic_ids)) or [uuid.UUID(a["topic_id"]) for a in attention(db, user, limit=5)]
    if not ids:
        raise HTTPException(400, "No weak topics yet. Take a quiz first so we know what to focus on.")
    topics = [t for t in (db.get(Topic, i) for i in ids) if t]
    with_material = [t for t in topics if notes.pack_units(db, [t.id])]
    if not with_material:
        raise HTTPException(400, "There's no class material for these topics in the knowledge base yet.")
    names = [t.name for t in with_material]
    title = f"Revision pack: {', '.join(names[:3])}" + (f" +{len(names) - 3}" if len(names) > 3 else "")
    ch = with_material[0].chapter
    m = StudyMaterial(user_id=user.id, title=title[:400], input_kind="pack", source_label="Class material",
                      subject_label=f"{ch.subject.name} · Revision pack", topic_ids=[t.id for t in with_material],
                      status="Processing", stage=0)
    db.add(m)
    db.flush()
    track(db, user, "study_generate", m.id, "pack")
    db.commit()
    tasks.generate_material.delay(str(m.id), body.lang if body.lang in ("en", "hing", "hi") else "en")
    return {"id": str(m.id), "status": m.status, "topics": names, "skipped": [t.name for t in topics if t not in with_material]}


@router.get("/materials/{mid}/slides")
def slide_deck(mid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    from app.services import slides

    m = _own(db, mid, user)
    if m.status not in ("Ready", "Flagged") or not (m.outputs or {}).get("full"):
        raise HTTPException(409, "Slides are available once the notes are ready.")
    data = slides.build(m.title, m.subject_label, m.outputs)
    name = re.sub(r"[^A-Za-z0-9\- ]+", "", m.title)[:60].strip() or "slides"
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    headers={"Content-Disposition": f'attachment; filename="{name}.pptx"'})


@router.get("/materials/{mid}")
def get_material(mid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    m = _own(db, mid, user)
    cards = []
    if m.status == "Ready":
        for fc in db.scalars(select(Flashcard).where(Flashcard.material_id == m.id).order_by(Flashcard.position)):
            st = db.get(CardState, (user.id, fc.id))
            cards.append({"id": str(fc.id), "front": fc.front, "back": fc.back, "topic": fc.topic_label, "src": fc.source_loc,
                          "unit_id": str(fc.unit_id) if fc.unit_id else None,
                          "due": until(st.due_at) if st and st.due_at else "new"})
        m.views += 1
        db.commit()
    src = db.get(KbSource, m.source_id) if m.source_id else None
    return {**lib_row(m), "stage": m.stage, "steps": notes.STEPS, "error": m.error, "outputs": m.outputs or {},
            "flashcards": cards, "source": {"id": str(src.id), "title": src.title, "url": src.url} if src else None,
            "audio_available": tts.available((m.outputs or {}).get("lang", "en"))}


class MaterialPatch(BaseModel):
    favorite: bool | None = None
    revision_checked: list[int] | None = None
    title: str | None = Field(None, max_length=400)


@router.patch("/materials/{mid}")
def patch_material(mid: str, body: MaterialPatch, user: User = Depends(student_user), db: Session = Depends(get_db)):
    m = _own(db, mid, user)
    if body.favorite is not None:
        m.favorite = body.favorite
    if body.title:
        m.title = body.title
    if body.revision_checked is not None:
        m.outputs = {**(m.outputs or {}), "revision_checked": sorted(set(body.revision_checked))}
    db.commit()
    return lib_row(m)


class HighlightIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    section: int | None = None


@router.post("/materials/{mid}/highlights")
def highlight(mid: str, body: HighlightIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    m = _own(db, mid, user)
    hl = list((m.outputs or {}).get("highlights", []))
    hl.append({"text": body.text, "section": body.section, "at": now().isoformat()})
    m.outputs = {**(m.outputs or {}), "highlights": hl[-200:]}
    db.commit()
    return {"highlights": len(hl)}


@router.delete("/materials/{mid}")
def delete_material(mid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    m = _own(db, mid, user)
    src = db.get(KbSource, m.source_id) if m.source_id else None
    db.delete(m)
    if src and src.origin == "student":
        db.delete(src)
    db.commit()
    return {"ok": True}


@router.post("/materials/{mid}/retry")
def retry(mid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    m = _own(db, mid, user)
    if m.status not in ("Failed",):
        raise HTTPException(400, "Only failed material can be retried.")
    m.status, m.stage, m.error = "Processing", 0, ""
    db.commit()
    tasks.generate_material.delay(str(m.id), (m.outputs or {}).get("lang", "en"))
    return lib_row(m)


class FlagIn(BaseModel):
    category: str = Field(min_length=2, max_length=60)
    note: str = Field("", max_length=1000)


@router.post("/materials/{mid}/flag")
def flag(mid: str, body: FlagIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    m = _own(db, mid, user)
    db.add(ContentFlag(material_id=m.id, user_id=user.id, category=body.category, note=body.note))
    if m.status == "Ready":
        m.status = "Flagged"
    db.commit()
    return {"ok": True}


@router.get("/materials/{mid}/export", response_class=PlainTextResponse)
def export(mid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    m = _own(db, mid, user)
    o = m.outputs or {}
    md = [f"# {m.title}", ""]
    for s in o.get("full", []):
        md += [f"## {s['h']}", s["p"]]
        if s.get("def"):
            md.append(f"> **{s['def'][0]}** — {s['def'][1]}")
        if s.get("ex"):
            md.append(f"*Example:* {s['ex']}")
        md += [f"_Source: {s['src']['loc']}_", ""]
    if o.get("formulas"):
        md += ["## Formulas", *[f"- {f['n']}: `{f['f']}` ({f['u']})" for f in o["formulas"]], ""]
    if o.get("short"):
        md += ["## Short notes", *[f"- {x}" for x in o["short"]], ""]
    if o.get("revision"):
        md += ["## Revision checklist", *[f"- [ ] {x}" for x in o["revision"]], ""]
    return PlainTextResponse("\n".join(md), headers={"Content-Disposition": f'attachment; filename="{m.title[:60]}.md"'})


@router.get("/materials/{mid}/audio")
def audio(mid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    m = _own(db, mid, user)
    script = (m.outputs or {}).get("audio_script", "")
    if not script:
        raise HTTPException(404, "No audio brief for this material")
    data = tts.synthesize(script, "hi" if (m.outputs or {}).get("lang") == "hi" else "en")
    if data is None:
        raise HTTPException(501, "No server voice installed")
    return Response(data, media_type="audio/wav")


class ReviewIn(BaseModel):
    rating: str  # Again | Hard | Good | Easy


@router.post("/flashcards/{fid}/review")
def review_card(fid: str, body: ReviewIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    fc = get_or_404(db, Flashcard, fid, "card")
    m = db.get(StudyMaterial, fc.material_id)
    if not m or m.user_id != user.id:
        raise HTTPException(404, "Card not found")
    rating = {"Again": Rating.Again, "Hard": Rating.Hard, "Good": Rating.Good, "Easy": Rating.Easy}.get(body.rating)
    if rating is None:
        raise HTTPException(400, "Unknown rating")
    st = db.get(CardState, (user.id, fc.id)) or CardState(user_id=user.id, flashcard_id=fc.id, fsrs={})
    card = Card.from_dict(st.fsrs) if st.fsrs else Card()
    card, _ = _sched.review_card(card, rating, review_datetime=datetime.now(timezone.utc))
    st.fsrs, st.due_at, st.last_rating = card.to_dict(), card.due, body.rating
    db.merge(st)
    # A flashcard review is also (soft) evidence for the learner model.
    if fc.unit_id:
        from app.models import ContentUnit
        from app.services import learner

        u = db.get(ContentUnit, fc.unit_id)
        if u and u.topic_id:
            credit = {"Again": 0.0, "Hard": 0.5, "Good": 1.0, "Easy": 1.0}[body.rating]
            learner.update(db, user.id, u.topic_id, credit, "revision", "chat", "Flashcards · " + now().strftime("%d %b"), weight=0.3)
    db.commit()
    return {"due": until(card.due), "due_at": card.due.isoformat()}


@router.get("/due")
def due_cards(user: User = Depends(student_user), db: Session = Depends(get_db)):
    n = db.scalar(select(func.count()).select_from(CardState).where(CardState.user_id == user.id, CardState.due_at <= now())) or 0
    return {"due": n}
