"""Ask Tutor: source-grounded chat with citations that open the exact page,
slide or timestamp."""
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ContentUnit, Conversation, KbSource, Message, StudentProfile, Topic, User
from app.routers.common import get_or_404, rel_time, track
from app.security import STAFF_ROLES, current_user, student_user
from app.services import grounding, planner, retrieval, storage, stt, tts
from app.services.llm import LLMError
from app.services.parsing import fmt_ts, youtube_ids
from app.workers import tasks

router = APIRouter(prefix="/api", tags=["tutor"])


def conv_out(c: Conversation) -> dict:
    return {"id": str(c.id), "title": c.title, "lang": c.lang, "source_only": c.source_only,
            "updated": rel_time(c.updated_at), "intake": bool((c.scope or {}).get("intake")),
            "greeting": INTAKE if (c.scope or {}).get("intake") else None}


def msg_out(m: Message) -> dict:
    return {"id": str(m.id), "role": m.role, "content": m.content, "lang": m.lang, "citations": m.citations or [],
            "status": m.status, "support": m.support, "at": m.created_at.isoformat()}


def _own(db: Session, cid: str, user: User) -> Conversation:
    c = get_or_404(db, Conversation, cid, "conversation")
    if c.user_id != user.id:
        raise HTTPException(404, "Conversation not found")
    return c


@router.get("/tutor/conversations")
def list_convs(user: User = Depends(student_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Conversation).where(Conversation.user_id == user.id).order_by(Conversation.updated_at.desc()).limit(50))
    return [conv_out(c) for c in rows]


class ConvIn(BaseModel):
    lang: str = "en"
    source_only: bool = False


@router.post("/tutor/conversations")
def new_conv(body: ConvIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    c = Conversation(user_id=user.id, lang=body.lang if body.lang in ("en", "hing", "hi") else "en",
                     source_only=body.source_only)
    db.add(c)
    db.commit()
    return conv_out(c)


@router.get("/tutor/conversations/{cid}")
def get_conv(cid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    c = _own(db, cid, user)
    return {**conv_out(c), "messages": [msg_out(m) for m in c.messages]}


class ConvPatch(BaseModel):
    lang: str | None = None
    source_only: bool | None = None
    title: str | None = Field(None, max_length=300)


@router.patch("/tutor/conversations/{cid}")
def patch_conv(cid: str, body: ConvPatch, user: User = Depends(student_user), db: Session = Depends(get_db)):
    c = _own(db, cid, user)
    if body.lang in ("en", "hing", "hi"):
        c.lang = body.lang
    if body.source_only is not None:
        c.source_only = body.source_only
    if body.title:
        c.title = body.title
    db.commit()
    return conv_out(c)


@router.delete("/tutor/conversations/{cid}")
def delete_conv(cid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    db.delete(_own(db, cid, user))
    db.commit()
    return {"ok": True}


class AskIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


INTAKE = ("Hi! Before we start, tell me a little about where you are. Which chapters have you covered in class "
          "recently, and which topic feels hardest right now?")


@router.post("/tutor/conversations/{cid}/messages")
def ask(cid: str, body: AskIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    c = _own(db, cid, user)
    history = list(c.messages)
    um = Message(conversation_id=c.id, role="user", content=body.content.strip(), lang=c.lang)
    db.add(um)
    if c.title in ("New conversation", "Getting started") and not history:
        c.title = body.content.strip()[:80]
    db.commit()
    try:
        res = grounding.answer(db, user, body.content.strip(), history, c.lang, c.source_only)
    except LLMError as e:
        raise HTTPException(503, str(e)) from e
    am = Message(conversation_id=c.id, role="assistant", content=res["content"], lang=c.lang,
                 citations=res["citations"], status=res["status"], support=res["support"])
    db.add(am)
    # Remember which topics this conversation touched, for learner-model evidence.
    tids = []
    for ci in res["citations"]:
        u = db.get(ContentUnit, uuid.UUID(ci["unit_id"]))
        if u and u.topic_id:
            tids.append(str(u.topic_id))
    if tids:
        prev = (c.scope or {}).get("recent_topics", [])
        c.scope = {**(c.scope or {}), "recent_topics": list(dict.fromkeys(tids + prev))[:8]}
    track(db, user, "tutor_ask", c.id, "tutor", status=res["status"])
    db.commit()
    if (c.scope or {}).get("recent_topics"):
        try:
            tasks.chat_evidence.delay(str(um.id))
        except Exception:  # noqa: BLE001 - evidence is best-effort
            pass
    return {"user": msg_out(um), "assistant": msg_out(am)}


@router.get("/tutor/suggestions")
def suggestions(user: User = Depends(student_user), db: Session = Depends(get_db)):
    from sqlalchemy import func

    prof = db.get(StudentProfile, user.id)
    kinds = dict(db.execute(select(KbSource.kind, func.count()).where(retrieval.visible_sources_clause(user))
                            .group_by(KbSource.kind)).all())
    units = db.scalar(select(func.count()).select_from(ContentUnit).join(KbSource, ContentUnit.source_id == KbSource.id)
                      .where(retrieval.visible_sources_clause(user))) or 0
    sources = [{"icon": retrieval.SRC_TYPE[k][1], "t": retrieval.SRC_TYPE[k][0], "n": n} for k, n in kinds.items() if k in retrieval.SRC_TYPE]
    ch = planner.current_chapter(db, user.id, prof)
    if not ch:
        return {"chapter": None, "prompts": [], "sources": sources, "units": units}
    topics = [t for t in ch.topics if t.published][:6]
    prompts = []
    if topics:
        prompts.append(f"Explain {topics[0].name.lower()} in simple words")
    if len(topics) > 2:
        prompts.append(f"How is {topics[1].name.lower()} different from {topics[2].name.lower()}?")
    prompts.append(f"Quiz me on {ch.name}")
    return {"chapter": {"id": str(ch.id), "name": ch.name, "subject": ch.subject.name}, "prompts": prompts,
            "sources": sources, "units": units}


# --------------------------------------------------------------------------- citation viewer


def _can_see(user: User, src: KbSource) -> bool:
    return src.origin == "admin" or src.owner_id == user.id or user.role in STAFF_ROLES


@router.get("/units/{uid}")
def unit_context(uid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):  # also the admin KB viewer
    u = get_or_404(db, ContentUnit, uid, "source")
    src = db.get(KbSource, u.source_id)
    if not _can_see(user, src):
        raise HTTPException(404, "Source not found")
    stype, icon = retrieval.SRC_TYPE.get(src.kind, ("Source", "description"))
    out = {"unit_id": str(u.id), "source_id": str(src.id), "title": src.title, "type": stype, "icon": icon,
           "loc": u.location, "kind": {"Transcript": "transcript", "Slide": "slide", "Diagram": "diagram"}.get(u.kind, "page"),
           "excerpt": retrieval._excerpt(u.text, 220), "topic": None, "open_url": None}
    if u.topic_id:
        t = db.get(Topic, u.topic_id)
        out["topic"] = t.name if t else None
    if u.kind == "Slide":
        lines = [x for x in u.text.split("\n") if x.strip()]
        out["head"] = u.heading or (lines[0] if lines else "")
        out["lines"] = [x for x in lines if x != out["head"] and not x.startswith("Notes:")][:10]
    elif u.kind == "Diagram":
        out["labels"] = u.labels or []
        out["desc"] = u.text.split(" Labels:")[0]
        out["image_url"] = f"/api/units/{u.id}/image" if u.image_path else None
    elif u.kind == "Transcript":
        near = list(db.scalars(select(ContentUnit).where(ContentUnit.source_id == src.id, ContentUnit.kind == "Transcript",
                                                         ContentUnit.position.between(u.position - 1, u.position + 1))
                               .order_by(ContentUnit.position)))
        prefix = u.location.rsplit(" · ", 1)[0] + " · " if " · " in u.location else ""
        out["transcript"] = [{"time": (n.location.rsplit(" · ", 1)[-1] if prefix else n.location), "t": n.text[:400],
                              "hi": n.id == u.id} for n in near]
        dur = src.stats.get("videos", []) if src.stats else []
        total = sum(v.get("duration") or 0 for v in dur) if dur else 0
        out["pct"] = f"{round(100 * (u.t_start or 0) / total)}%" if total else None
    else:
        near = list(db.scalars(select(ContentUnit).where(ContentUnit.source_id == src.id, ContentUnit.page == u.page,
                                                         ContentUnit.kind == "Text").order_by(ContentUnit.position).limit(6)))
        out["paras"] = [{"t": n.text[:600], "hi": n.id == u.id} for n in near] or [{"t": u.text[:600], "hi": True}]
    # "Open in the original"
    if src.url and u.t_start is not None:
        vids = (src.stats or {}).get("videos") or []
        idx = 0
        if " · " in u.location and u.location.startswith("Video "):
            try:
                idx = int(u.location.split(" ")[1]) - 1
            except ValueError:
                idx = 0
        vurl = vids[idx]["url"] if idx < len(vids) else src.url
        vid, _ = youtube_ids(vurl)
        out["open_url"] = f"https://www.youtube.com/watch?v={vid}&t={int(u.t_start)}s" if vid else vurl
        out["time"] = fmt_ts(u.t_start)
    elif src.file_path:
        frag = f"#page={u.page}" if u.page else (f"#page={u.slide}" if u.slide and src.file_path.endswith(".pdf") else "")
        out["open_url"] = f"/api/sources/{src.id}/file{frag}"
    return out


@router.get("/units/{uid}/image")
def unit_image(uid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    u = get_or_404(db, ContentUnit, uid, "source")
    src = db.get(KbSource, u.source_id)
    if not _can_see(user, src) or not u.image_path:
        raise HTTPException(404)
    return FileResponse(storage.safe_path(u.image_path))


@router.get("/sources/{sid}/file")
def source_file(sid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    src = get_or_404(db, KbSource, sid, "source")
    if not _can_see(user, src) or not src.file_path:
        raise HTTPException(404)
    p = storage.safe_path(src.file_path)
    return FileResponse(p, media_type=src.mime or None, filename=f"{src.title[:80]}{p.suffix}",
                        content_disposition_type="inline")


class TTSIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    lang: str = "en"


@router.post("/tutor/tts")
def speak(body: TTSIn, user: User = Depends(student_user)):
    lang = "hi" if body.lang == "hi" else "en"
    audio = tts.synthesize(body.text, lang)
    if audio is None:
        raise HTTPException(501, "No server voice installed; the app will use your device's voice.")
    return Response(audio, media_type="audio/wav")


@router.get("/tutor/voice")
def voice_support(lang: str = "en", user: User = Depends(student_user)):
    """What the server can do for voice tutoring; the app falls back to the browser for anything missing."""
    tts.ensure_voices_async()
    return {"stt": stt.available(), "tts": tts.available("hi" if lang == "hi" else "en")}


AUDIO_SUFFIX = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".mp4", "audio/mpeg": ".mp3", "audio/wav": ".wav",
                "audio/x-wav": ".wav", "audio/aac": ".aac"}


@router.post("/tutor/transcribe")
def transcribe(audio: UploadFile = File(...), lang: str = Form("en"), user: User = Depends(student_user)):
    """Spoken question -> text with the local Whisper model (6e)."""
    if not stt.available():
        raise HTTPException(501, "Speech recognition isn't installed on the server.")
    mime = (audio.content_type or "").split(";")[0].strip().lower()
    if mime not in AUDIO_SUFFIX:
        raise HTTPException(415, "Send the recording as webm, ogg, mp4, mp3 or wav audio.")
    data = audio.file.read(stt.MAX_BYTES + 1)
    if len(data) > stt.MAX_BYTES:
        raise HTTPException(413, "That recording is too long. Keep questions under a minute.")
    if len(data) < 800:
        return {"text": "", "language": lang, "duration": 0}
    try:
        return stt.transcribe(data, lang if lang in ("en", "hing", "hi") else "en", AUDIO_SUFFIX[mime])
    except Exception as e:  # noqa: BLE001
        import logging

        logging.getLogger(__name__).warning("transcription failed: %s", e)
        raise HTTPException(422, "We couldn't make out that recording. Try again a little closer to the mic.") from e
