"""Admin console: Knowledge base (multimodal ingest, content units) and
Evaluation (RAG metrics + simulated students)."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Chapter, ContentUnit, EvalCase, EvalRun, KbSource, Subject, Topic, TopicProposal, User
from app.routers.common import fmt_date, get_or_404, rel_time
from app.security import require_admin, require_staff
from app.services import evaluation, ingestion, parsing, questions, retrieval, storage
from app.workers import tasks

router = APIRouter(prefix="/api/admin", tags=["admin"])

KIND_LABEL = {"textbook": "Textbook PDF", "slides": "Slide deck", "video": "Lecture video", "text": "Text"}


def source_row(s: KbSource) -> dict:
    stype, icon = retrieval.SRC_TYPE.get(s.kind, ("Source", "description"))
    st = s.stats or {}
    return {"id": str(s.id), "t": s.title, "type": KIND_LABEL.get(s.kind, s.kind), "icon": icon, "size": s.size_label or "—",
            "units": st.get("units"), "figs": st.get("figures"), "low": st.get("low_confidence", 0), "s": s.status,
            "proposals": st.get("proposals", 0),
            "stage": s.stage, "error": s.error, "when": rel_time(s.created_at), "url": s.url,
            "subject_id": str(s.subject_id) if s.subject_id else None, "chapter_id": str(s.chapter_id) if s.chapter_id else None}


@router.get("/kb")
def kb_overview(_: User = Depends(require_staff), db: Session = Depends(get_db)):
    srcs = list(db.scalars(select(KbSource).where(KbSource.origin == "admin").order_by(KbSource.created_at.desc())))
    ids = [s.id for s in srcs]
    units = db.scalar(select(func.count()).select_from(ContentUnit).where(ContentUnit.source_id.in_(ids))) if ids else 0
    figs = db.scalar(select(func.count()).select_from(ContentUnit).where(ContentUnit.source_id.in_(ids), ContentUnit.kind == "Diagram")) if ids else 0
    low = db.scalar(select(func.count()).select_from(ContentUnit).where(ContentUnit.source_id.in_(ids), ContentUnit.approved.is_(False))) if ids else 0
    kinds = {s.kind for s in srcs}
    pending = db.scalar(select(func.count()).select_from(TopicProposal).where(TopicProposal.status == "pending")) or 0
    return {
        "pending_proposals": pending,
        "stats": [
            {"l": "Sources", "v": str(len(srcs)), "d": f"{len(kinds)} type{'s' if len(kinds) != 1 else ''}", "icon": "folder_open"},
            {"l": "Content units", "v": f"{units or 0:,}", "d": "linked to page, slide or timestamp", "icon": "view_agenda"},
            {"l": "Figures extracted", "v": f"{figs or 0:,}", "d": "diagrams, graphs, tables", "icon": "image"},
            {"l": "Low-confidence tags", "v": f"{low or 0:,}", "d": "waiting for review", "icon": "rule"},
        ],
        "stages": ingestion.STAGES,
        "sources": [source_row(s) for s in srcs],
    }


@router.post("/kb/sources")
def add_source(
    kind: str = Form(...),
    title: str = Form(""),
    url: str = Form(""),
    subject_id: str = Form(""),
    chapter_id: str = Form(""),
    file: UploadFile | None = File(None),
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
):
    if kind not in ("textbook", "slides", "video"):
        raise HTTPException(400, "Choose a textbook PDF, slide deck or lecture video.")
    src = KbSource(kind=kind, origin="admin", title=title.strip(), created_by=user.id,
                   subject_id=uuid.UUID(subject_id) if subject_id else None,
                   chapter_id=uuid.UUID(chapter_id) if chapter_id else None)
    if kind == "video" and url.strip():
        if not parsing.is_youtube(url):
            raise HTTPException(400, "Paste a YouTube video or playlist link, or upload a video file.")
        src.url = url.strip()
        src.title = src.title or url.strip()
    else:
        if not file:
            raise HTTPException(400, "Choose a file to upload.")
        allowed = {"textbook": {".pdf"}, "slides": {".pptx", ".pdf"},
                   "video": {".mp4", ".webm", ".mkv", ".mov", ".mp3", ".m4a", ".wav"}}[kind]
        src.file_path, src.mime, _ = storage.save_upload(file, allowed)
        src.title = src.title or (file.filename or "Untitled").rsplit(".", 1)[0]
    db.add(src)
    db.commit()
    tasks.ingest_source.delay(str(src.id))
    return source_row(src)


@router.post("/kb/sources/{sid}/reprocess")
def reprocess(sid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    s = get_or_404(db, KbSource, sid, "source")
    s.status, s.stage, s.error = "Processing", 0, ""
    db.commit()
    tasks.ingest_source.delay(str(s.id))
    return source_row(s)


class SourcePatch(BaseModel):
    title: str | None = Field(None, max_length=400)
    subject_id: uuid.UUID | None = None
    chapter_id: uuid.UUID | None = None


@router.patch("/kb/sources/{sid}")
def patch_source(sid: str, body: SourcePatch, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    s = get_or_404(db, KbSource, sid, "source")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit()
    return source_row(s)


@router.delete("/kb/sources/{sid}")
def delete_source(sid: str, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    s = get_or_404(db, KbSource, sid, "source")
    db.delete(s)
    db.commit()
    return {"ok": True}


def unit_row(db: Session, u: ContentUnit, s: KbSource, topics: dict) -> dict:
    stype, icon = retrieval.SRC_TYPE.get(s.kind, ("Source", "description"))
    t = topics.get(u.topic_id)
    pre = [topics[p].name for p in (u.prereq_topic_ids or []) if p in topics]
    return {"id": str(u.id), "ex": retrieval._excerpt(u.text, 160), "text": u.text, "kind": u.kind, "src": stype, "icon": icon,
            "source_title": s.title, "source_id": str(s.id), "loc": u.location, "topic": t.name if t else None, "subtopic": u.subtopic or "",
            "topic_id": str(u.topic_id) if u.topic_id else None, "concepts": u.concepts or [], "pre": pre,
            "pre_ids": [str(p) for p in u.prereq_topic_ids or []], "conf": round(u.confidence * 100),
            "low": not u.approved, "labels": u.labels or [], "image_url": f"/api/units/{u.id}/image" if u.image_path else None}


@router.get("/kb/units")
def list_units(kind: str = "All", source_id: str | None = None, low: bool = False, q: str = "", page: int = 1,
               _: User = Depends(require_staff), db: Session = Depends(get_db)):
    base = select(ContentUnit, KbSource).join(KbSource, ContentUnit.source_id == KbSource.id).where(KbSource.origin == "admin")
    if source_id:
        base = base.where(ContentUnit.source_id == uuid.UUID(source_id))
    if low:
        base = base.where(ContentUnit.approved.is_(False))
    if q:
        base = base.where(ContentUnit.text.ilike(f"%{q}%"))
    counts = dict(db.execute(base.with_only_columns(ContentUnit.kind, func.count()).group_by(ContentUnit.kind)).all())
    if kind != "All":
        base = base.where(ContentUnit.kind == kind)
    rows = db.execute(base.order_by(ContentUnit.approved, ContentUnit.confidence, KbSource.created_at.desc(), ContentUnit.position)
                      .offset((max(page, 1) - 1) * 50).limit(50)).all()
    tids = {u.topic_id for u, _ in rows if u.topic_id} | {p for u, _ in rows for p in (u.prereq_topic_ids or [])}
    topics = {t.id: t for t in db.scalars(select(Topic).where(Topic.id.in_(tids)))} if tids else {}
    return {"counts": {"All": sum(counts.values()), **{k: counts.get(k, 0) for k in ("Text", "Transcript", "Slide", "Diagram")}},
            "units": [unit_row(db, u, s, topics) for u, s in rows], "page": page}


class UnitPatch(BaseModel):
    topic_id: uuid.UUID | None = None
    subtopic: str | None = Field(None, max_length=200)
    concepts: list[str] | None = None
    prereq_topic_ids: list[uuid.UUID] | None = None
    approved: bool | None = None
    text: str | None = None


@router.patch("/kb/units/{uid}")
def patch_unit(uid: str, body: UnitPatch, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    u = get_or_404(db, ContentUnit, uid, "unit")
    data = body.model_dump(exclude_unset=True)
    if "topic_id" in data:
        u.topic_id = data["topic_id"]
    if data.get("subtopic") is not None:
        u.subtopic = " ".join(data["subtopic"].split())
    if data.get("concepts") is not None:
        u.concepts = [c.strip()[:80] for c in data["concepts"] if c.strip()][:8]
    if data.get("prereq_topic_ids") is not None:
        u.prereq_topic_ids = data["prereq_topic_ids"]
    if data.get("text"):
        from app.services import embeddings

        u.text = data["text"]
        u.embedding = embeddings.embed_one(f"{u.heading}\n{u.text}", "passage")
    if data.get("approved") is not None:
        u.approved = data["approved"]
        if u.approved:
            u.confidence = max(u.confidence, 1.0)
    db.commit()
    s = db.get(KbSource, u.source_id)
    left = db.scalar(select(func.count()).select_from(ContentUnit).where(ContentUnit.source_id == s.id, ContentUnit.approved.is_(False)))
    s.stats = {**(s.stats or {}), "low_confidence": left}
    if s.status == "Needs Review" and not left:
        s.status = "Ready"
    db.commit()
    topics = {t.id: t for t in db.scalars(select(Topic).where(Topic.id.in_([x for x in [u.topic_id, *(u.prereq_topic_ids or [])] if x])))}
    return unit_row(db, u, s, topics)


# --------------------------------------------------------------------------- topics found in material


def _refresh_source(db: Session, s: KbSource) -> None:
    left = db.scalar(select(func.count()).select_from(ContentUnit).where(ContentUnit.source_id == s.id, ContentUnit.approved.is_(False))) or 0
    pending = db.scalar(select(func.count()).select_from(TopicProposal).where(TopicProposal.source_id == s.id,
                                                                            TopicProposal.status == "pending")) or 0
    s.stats = {**(s.stats or {}), "low_confidence": left, "proposals": pending}
    if s.status == "Needs Review" and not left:
        s.status = "Ready"


def proposal_row(db: Session, p: TopicProposal) -> dict:
    src = db.get(KbSource, p.source_id)
    subj = db.get(Subject, p.subject_id) if p.subject_id else None
    ids = [uuid.UUID(k) for k in (p.unit_subtopics or {})]
    samples = list(db.scalars(select(ContentUnit).where(ContentUnit.id.in_(ids)).order_by(ContentUnit.position).limit(3))) if ids else []
    return {"id": str(p.id), "topic": p.topic_name, "summary": p.summary, "subtopics": p.subtopics or [],
            "chapter": p.chapter_name, "chapter_id": str(p.chapter_id) if p.chapter_id else None, "new_chapter": p.chapter_id is None,
            "subject": f"{subj.name} · {subj.board} {subj.class_level}" if subj else None,
            "subject_id": str(p.subject_id) if p.subject_id else None, "units": len(ids), "status": p.status,
            "source": src.title if src else "", "source_id": str(p.source_id), "when": rel_time(p.created_at),
            "samples": [{"loc": u.location, "text": retrieval._excerpt(u.text, 140)} for u in samples]}


@router.get("/kb/proposals")
def list_proposals(status: str = "pending", _: User = Depends(require_staff), db: Session = Depends(get_db)):
    q = select(TopicProposal).order_by(TopicProposal.created_at.desc()).limit(200)
    if status != "all":
        q = q.where(TopicProposal.status == status)
    return [proposal_row(db, p) for p in db.scalars(q)]


class AcceptIn(BaseModel):
    subject_id: uuid.UUID | None = None
    chapter_id: uuid.UUID | None = None
    chapter_name: str = Field("", max_length=200)
    topic_name: str = Field("", max_length=200)
    summary: str | None = Field(None, max_length=1000)


@router.post("/kb/proposals/{pid}/accept")
def accept_proposal(pid: str, body: AcceptIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    """Create the topic (as a draft, so students see it after the next Publish) and tag its units."""
    from app.routers.admin.curriculum import slugify

    p = get_or_404(db, TopicProposal, pid, "suggestion")
    if p.status != "pending":
        raise HTTPException(400, "This suggestion was already handled.")
    sid = body.subject_id or p.subject_id
    subj = db.get(Subject, sid) if sid else None
    if not subj:
        raise HTTPException(400, "Choose the subject this topic belongs to.")
    ch = db.get(Chapter, body.chapter_id) if body.chapter_id else None
    if ch is None and not body.chapter_name and p.chapter_id:
        ch = db.get(Chapter, p.chapter_id)
    if ch is not None and ch.subject_id != subj.id:
        raise HTTPException(400, "That chapter belongs to a different subject.")
    if ch is None:
        name = (body.chapter_name or p.chapter_name or "New chapter").strip()
        ch = db.scalar(select(Chapter).where(Chapter.subject_id == subj.id, func.lower(Chapter.name) == name.lower()))
        if ch is None:
            ch = Chapter(subject_id=subj.id, name=name, position=len(subj.chapters), published=False)
            db.add(ch)
            db.flush()
    tname = (body.topic_name or p.topic_name).strip()
    t = db.scalar(select(Topic).where(Topic.chapter_id == ch.id, func.lower(Topic.name) == tname.lower()))
    if t is None:
        t = Topic(chapter_id=ch.id, name=tname, slug=slugify(tname), summary=body.summary if body.summary is not None else p.summary,
                  est_minutes=15, position=len(ch.topics), published=False)
        db.add(t)
        db.flush()
    subs = p.unit_subtopics or {}
    for u in db.scalars(select(ContentUnit).where(ContentUnit.id.in_([uuid.UUID(k) for k in subs]))):
        u.topic_id, u.subtopic = t.id, subs.get(str(u.id)) or u.subtopic
        u.approved, u.confidence = True, max(u.confidence, 0.9)
    p.status, p.topic_id, p.subject_id, p.chapter_id = "accepted", t.id, subj.id, ch.id
    subj.has_draft = True
    db.flush()
    _refresh_source(db, db.get(KbSource, p.source_id))
    db.commit()
    return {**proposal_row(db, p), "topic_id": str(t.id), "chapter_id": str(ch.id)}


@router.post("/kb/proposals/{pid}/reject")
def reject_proposal(pid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    p = get_or_404(db, TopicProposal, pid, "suggestion")
    p.status = "rejected"
    db.flush()
    _refresh_source(db, db.get(KbSource, p.source_id))
    db.commit()
    return {"ok": True}


@router.get("/topics/lookup")
def topic_lookup(q: str = "", subject_id: str | None = None, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    from app.models import Chapter

    base = select(Topic, Chapter, Subject).join(Chapter, Topic.chapter_id == Chapter.id).join(Subject, Chapter.subject_id == Subject.id)
    if q:
        base = base.where(Topic.name.ilike(f"%{q}%") | Chapter.name.ilike(f"%{q}%"))
    if subject_id:
        base = base.where(Subject.id == uuid.UUID(subject_id))
    rows = db.execute(base.order_by(Subject.name, Chapter.position, Topic.position).limit(40)).all()
    return [{"id": str(t.id), "name": t.name, "chapter": c.name, "subject": f"{s.name} · {s.board} {s.class_level}"} for t, c, s in rows]


# --------------------------------------------------------------------------- evaluation


def run_row(r: EvalRun) -> dict:
    # A queued or running run has empty results ({}): send null so the page shows progress, not empty cards.
    return {"id": str(r.id), "number": r.number, "framework": r.framework, "pipeline": r.pipeline_version, "status": r.status,
            "progress": r.progress, "metrics": r.metrics if (r.metrics or {}).get("values") else None,
            "categories": r.categories or [], "failures": r.failures or [],
            "question_bank": r.question_bank or None, "simulation": r.simulation if (r.simulation or {}).get("adaptive") else None,
            "error": r.error,
            "when": rel_time(r.finished_at or r.created_at), "date": fmt_date(r.finished_at or r.created_at)}


@router.get("/eval/runs")
def list_runs(_: User = Depends(require_staff), db: Session = Depends(get_db)):
    runs = list(db.scalars(select(EvalRun).order_by(EvalRun.number.desc()).limit(20)))
    n_cases = db.scalar(select(func.count()).select_from(EvalCase)) or 0
    n_off = db.scalar(select(func.count()).select_from(EvalCase).where(EvalCase.off_material.is_(True))) or 0
    return {"runs": [run_row(r) for r in runs], "cases": n_cases, "off_material": n_off,
            "labels": evaluation.LABELS, "targets": evaluation.TARGETS}


class RunIn(BaseModel):
    framework: str = "RAGAS"


@router.post("/eval/runs")
def start_run(body: RunIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    if body.framework not in ("RAGAS", "DeepEval", "TruLens"):
        raise HTTPException(400, "Unknown framework")
    if not db.scalar(select(func.count()).select_from(EvalCase)):
        raise HTTPException(400, "Add test questions first. The harness needs a held-out test set.")
    running = db.scalar(select(EvalRun).where(EvalRun.status.in_(("queued", "running"))))
    if running:
        raise HTTPException(400, f"Run {running.number} is still in progress.")
    r = EvalRun(number=evaluation.next_number(db), framework=body.framework, created_by=user.id, status="queued")
    db.add(r)
    db.commit()
    tasks.run_eval.delay(str(r.id))
    return run_row(r)


@router.get("/eval/runs/{rid}")
def get_run(rid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    return run_row(get_or_404(db, EvalRun, rid, "run"))


class CaseIn(BaseModel):
    question: str = Field(min_length=5, max_length=2000)
    expected_answer: str = Field("", max_length=4000)
    expected_locations: list[str] = []
    category: str = "Textbook page"
    off_material: bool = False
    subject_id: uuid.UUID | None = None


def case_row(c: EvalCase) -> dict:
    return {"id": str(c.id), "question": c.question, "expected_answer": c.expected_answer,
            "expected_locations": c.expected_locations, "category": c.category, "off_material": c.off_material,
            "subject_id": str(c.subject_id) if c.subject_id else None}


@router.get("/eval/cases")
def list_cases(_: User = Depends(require_staff), db: Session = Depends(get_db)):
    return [case_row(c) for c in db.scalars(select(EvalCase).order_by(EvalCase.created_at.desc()))]


@router.post("/eval/cases")
def add_cases(body: list[CaseIn], user: User = Depends(require_staff), db: Session = Depends(get_db)):
    out = []
    for c in body:
        if c.category not in ("Textbook page", "Video timestamp", "Slide number", "Diagram / figure"):
            raise HTTPException(400, f"Unknown category {c.category}")
        row = EvalCase(**c.model_dump(), created_by=user.id)
        db.add(row)
        out.append(row)
    db.commit()
    return [case_row(c) for c in out]


@router.put("/eval/cases/{cid}")
def update_case(cid: str, body: CaseIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    c = get_or_404(db, EvalCase, cid, "case")
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    db.commit()
    return case_row(c)


CSV_TEMPLATE = (
    "question,expected_answer,expected_locations,category,off_material\n"
    "State Ohm's law.,\"At constant temperature, the current through a metallic conductor is proportional to the "
    "potential difference across it; V = IR.\",p. 2,Textbook page,no\n"
    "What is the equivalent resistance of 5 ohm and 10 ohm in series?,15 ohm,p. 3,Textbook page,no\n"
    "Who won the 2011 Cricket World Cup?,,,Textbook page,yes\n"
)


@router.get("/eval/cases/template.csv")
def cases_template(_: User = Depends(require_staff)):
    return Response(CSV_TEMPLATE, media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="intellinova-test-set-template.csv"'})


@router.post("/eval/cases/import")
def import_cases(file: UploadFile = File(...), subject_id: str = Form(""), user: User = Depends(require_staff),
                 db: Session = Depends(get_db)):
    """Adds questions from a CSV or JSON test set. Questions already in the set are skipped."""
    raw = file.file.read(2_000_001)
    if len(raw) > 2_000_000:
        raise HTTPException(413, "That file is too large (2 MB max).")
    try:
        rows = evaluation.parse_cases(raw, file.filename or "")
    except (ValueError, UnicodeError) as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001 - malformed JSON etc.
        raise HTTPException(400, f"Couldn't read that file: {e}") from e
    sid = uuid.UUID(subject_id) if subject_id else None
    existing = {q.lower() for q in db.scalars(select(EvalCase.question))}
    added = 0
    for r in rows:
        if r["question"].lower() in existing:
            continue
        existing.add(r["question"].lower())
        db.add(EvalCase(**r, subject_id=sid, created_by=user.id))
        added += 1
    db.commit()
    return {"added": added, "skipped": len(rows) - added}


class DraftIn(BaseModel):
    subject_id: uuid.UUID | None = None
    n: int = Field(12, ge=1, le=40)
    off_material: int = Field(3, ge=0, le=6)


@router.post("/eval/cases/draft")
def draft_cases(body: DraftIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    """Drafts test questions from the knowledge base (each with its real source location) for staff to review."""
    try:
        rows = evaluation.draft_cases(db, body.subject_id, body.n, body.off_material)
    except ValueError as e:
        raise HTTPException(503, str(e)) from e
    if not rows:
        raise HTTPException(400, "No processed class material yet. Upload and process a source in the knowledge base first.")
    out = [EvalCase(**r, created_by=user.id) for r in rows]
    db.add_all(out)
    db.commit()
    return [case_row(c) for c in out]


@router.get("/eval/bank")
def question_bank(_: User = Depends(require_staff), db: Session = Depends(get_db)):
    topics = evaluation.bank_by_topic(db)
    return {"topics": topics, "ready": sum(1 for t in topics if t["ready"]), "min": evaluation.MIN_BANK,
            "prep": evaluation.bank_prep_state(db), "stats": questions.bank_stats(db)}


class BankIn(BaseModel):
    per_topic: int = Field(10, ge=evaluation.MIN_BANK, le=30)


@router.post("/eval/bank/prepare")
def prepare_bank(body: BankIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    from app.models import AppSetting

    if (evaluation.bank_prep_state(db) or {}).get("status") in ("queued", "running"):
        raise HTTPException(400, "The question bank is already being prepared.")
    db.merge(AppSetting(key="bank_prep", value={"status": "queued", "done": 0, "total": 0, "generated": 0, "skipped": [],
                                                "updated_at": datetime.now(timezone.utc).isoformat()}))
    db.commit()
    tasks.prepare_question_bank.delay(body.per_topic)
    return {"ok": True}


@router.get("/eval/runs/{rid}/report.md")
def run_report_md(rid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    r = get_or_404(db, EvalRun, rid, "run")
    return Response(evaluation.report_markdown(r), media_type="text/markdown; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="intellinova-eval-run-{r.number}.md"'})


@router.get("/eval/runs/{rid}/report.csv")
def run_report_csv(rid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    r = get_or_404(db, EvalRun, rid, "run")
    return Response(evaluation.report_csv(r), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="intellinova-eval-run-{r.number}.csv"'})


@router.delete("/eval/cases/{cid}")
def delete_case(cid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    db.delete(get_or_404(db, EvalCase, cid, "case"))
    db.commit()
    return {"ok": True}
