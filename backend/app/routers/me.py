"""The student's own account: onboarding, profile, preferences, privacy."""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Chapter, Conversation, Exam, PrivacyRequest, Quiz, StudentProfile, Subject, Topic, User
from app.routers.common import fmt_date, get_or_404, norm_class, now
from app.security import student_user
from app.services import storage
from app.workers import tasks

router = APIRouter(prefix="/api/me", tags=["me"])

DEFAULT_PREFS = {"short": False, "hinglish": True, "reminders": True, "weekly": True, "share": False, "research": False}
INTERESTS = ["Mathematics", "Economics", "Technology", "Business", "Current affairs", "Creativity", "Analysis & puzzles",
             "Biology", "Writing", "Design", "Public speaking", "Environment"]
GOALS = [["School learning", "Keep up with class chapters", "school"],
         ["Board preparation", "Revise for your board exams", "task_alt"],
         ["Competitive exam preparation", "Start early on an entrance exam", "flag"],
         ["Career exploration", "Understand subjects and pathways", "explore"],
         ["Not sure yet", "That's fine. We'll start simple.", "help"]]
LANGUAGES = ["English", "Hindi", "Hinglish", "Tamil", "Bengali", "Marathi"]


def profile_of(db: Session, user: User) -> StudentProfile:
    p = db.get(StudentProfile, user.id)
    if p is None:
        p = StudentProfile(user_id=user.id, nickname=(user.name or "").split(" ")[0], prefs=dict(DEFAULT_PREFS),
                           languages=[], subject_ids=[], interests=[], goals=[], exam_ids=[])
        db.add(p)
        db.commit()
    return p


def profile_out(db: Session, user: User, p: StudentProfile) -> dict:
    subs = list(db.scalars(select(Subject).where(Subject.id.in_(p.subject_ids or [])))) if p.subject_ids else []
    exams = list(db.scalars(select(Exam).where(Exam.id.in_(p.exam_ids or [])))) if p.exam_ids else []
    return {
        "name": user.name, "email": user.email, "phone": user.phone, "nickname": p.nickname, "school": p.school,
        "city": p.city, "avatar": p.avatar, "board": p.board, "class_level": p.class_level, "stream": p.stream,
        "languages": p.languages or [], "subject_ids": [str(s) for s in p.subject_ids or []],
        "subjects": [{"id": str(s.id), "name": s.name} for s in subs],
        "interests": p.interests or [], "goals": p.goals or [], "exam_ids": [str(e) for e in p.exam_ids or []],
        "exams": [{"id": str(e.id), "name": e.name} for e in exams], "diag_mode": p.diag_mode,
        "prefs": {**DEFAULT_PREFS, **(p.prefs or {})}, "onboarded": bool(p.onboarded_at),
        "joined": fmt_date(user.created_at),
    }


@router.get("/profile")
def get_profile(user: User = Depends(student_user), db: Session = Depends(get_db)):
    return profile_out(db, user, profile_of(db, user))


@router.get("/options")
def options(board: str | None = None, class_level: str | None = None, db: Session = Depends(get_db)):
    """Choices offered during onboarding, drawn from the published curriculum."""
    class_level = norm_class(class_level) if class_level else class_level
    rows = db.execute(select(Subject.board, Subject.class_level).join(Chapter).where(Chapter.published.is_(True))
                      .distinct()).all()
    boards = sorted({b for b, _ in rows})
    classes = sorted({c for b, c in rows if not board or b == board}, key=lambda c: (len(c), c))
    subs = []
    if board and class_level:
        subs = [{"id": str(s.id), "name": s.name, "stream": s.stream}
                for s in db.scalars(select(Subject).where(Subject.board == board, Subject.class_level == class_level)
                                    .order_by(Subject.position, Subject.name))
                if any(c.published and not c.disabled for c in s.chapters)]
    exams = [{"id": str(e.id), "name": e.name, "full_name": e.full_name}
             for e in db.scalars(select(Exam).where(Exam.status == "Active").order_by(Exam.name))]
    return {"boards": boards, "classes": classes, "subjects": subs, "exams": exams, "languages": LANGUAGES,
            "interests": INTERESTS, "goals": [{"v": v, "d": d, "i": i} for v, d, i in GOALS]}


class ProfileIn(BaseModel):
    name: str | None = Field(None, max_length=200)
    nickname: str | None = Field(None, max_length=80)
    school: str | None = Field(None, max_length=200)
    city: str | None = Field(None, max_length=120)
    avatar: int | None = Field(None, ge=0, le=5)
    board: str | None = None
    class_level: str | None = None
    stream: str | None = None
    languages: list[str] | None = None
    subject_ids: list[uuid.UUID] | None = None
    interests: list[str] | None = None
    goals: list[str] | None = None
    exam_ids: list[uuid.UUID] | None = None
    diag_mode: str | None = None
    prefs: dict | None = None


@router.put("/profile")
def update_profile(body: ProfileIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    p = profile_of(db, user)
    data = body.model_dump(exclude_unset=True)
    if data.get("class_level") is not None:
        data["class_level"] = norm_class(data["class_level"])
    if "name" in data and data["name"] is not None:
        user.name = data.pop("name").strip()
    else:
        data.pop("name", None)
    if "subject_ids" in data and data["subject_ids"] is not None:
        valid = set(db.scalars(select(Subject.id).where(Subject.id.in_(data["subject_ids"]))))
        data["subject_ids"] = [s for s in data["subject_ids"] if s in valid]
    if "exam_ids" in data and data["exam_ids"] is not None:
        valid = set(db.scalars(select(Exam.id).where(Exam.id.in_(data["exam_ids"]))))
        data["exam_ids"] = [e for e in data["exam_ids"] if e in valid]
    if data.get("diag_mode") not in (None, "quiz", "chat", "skip"):
        raise HTTPException(400, "Unknown starting point")
    if "prefs" in data and data["prefs"] is not None:
        data["prefs"] = {**DEFAULT_PREFS, **(p.prefs or {}), **{k: bool(v) for k, v in data["prefs"].items() if k in DEFAULT_PREFS}}
    for k, v in data.items():
        if v is not None:
            setattr(p, k, v)
    db.commit()
    return profile_out(db, user, p)


def diagnostic_topics(db: Session, p: StudentProfile) -> list[uuid.UUID]:
    """One topic per chapter area across the student's subjects (up to 6), preferring topics with material."""
    chapters = list(db.scalars(select(Chapter).where(Chapter.subject_id.in_(p.subject_ids or []),
                                                     Chapter.published.is_(True), Chapter.disabled.is_(False))
                               .order_by(Chapter.position)))
    picked: list[uuid.UUID] = []
    by_subject: dict[uuid.UUID, list[Chapter]] = {}
    for c in chapters:
        by_subject.setdefault(c.subject_id, []).append(c)
    i = 0
    while len(picked) < 6 and any(by_subject.values()):
        for sid in list(by_subject):
            if not by_subject[sid]:
                continue
            ch = by_subject[sid].pop(0)
            t = next((t for t in ch.topics if t.published), None)
            if t:
                picked.append(t.id)
            if len(picked) >= 6:
                break
        i += 1
        if i > 50:
            break
    return picked


@router.post("/onboarding/complete")
def complete_onboarding(user: User = Depends(student_user), db: Session = Depends(get_db)):
    p = profile_of(db, user)
    if not p.board or not p.class_level:
        raise HTTPException(400, "Choose your board and class first.")
    p.onboarded_at = p.onboarded_at or now()
    out: dict = {"ok": True}
    if p.diag_mode == "quiz":
        topics = diagnostic_topics(db, p)
        if topics:
            q = Quiz(user_id=user.id, title="Diagnostic", mode="Diagnostic", difficulty_mode="Adaptive",
                     types=["MCQ", "Numerical"], topic_ids=topics, n=min(6, max(len(topics), 3)))
            db.add(q)
            db.commit()
            tasks.prepare_quiz.delay(str(q.id))
            out["quiz_id"] = str(q.id)
    elif p.diag_mode == "chat":
        c = Conversation(user_id=user.id, title="Getting started", lang="en", scope={"intake": True})
        db.add(c)
        db.commit()
        out["conversation_id"] = str(c.id)
    db.commit()
    return out


# --------------------------------------------------------------------------- privacy


class PrivacyIn(BaseModel):
    kind: str
    details: str = Field("", max_length=2000)


KINDS = {"Data export": 30, "Account deletion": 30, "Data correction": 30}


@router.get("/privacy")
def my_privacy(user: User = Depends(student_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(PrivacyRequest).where(PrivacyRequest.user_id == user.id).order_by(PrivacyRequest.created_at.desc()))
    return [{"id": str(r.id), "kind": r.kind, "status": r.status, "created": fmt_date(r.created_at),
             "download": bool(r.result_path) and r.kind == "Data export" and r.status == "completed"} for r in rows]


@router.post("/privacy")
def request_privacy(body: PrivacyIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    if body.kind not in KINDS:
        raise HTTPException(400, "Unknown request type")
    open_same = db.scalar(select(PrivacyRequest).where(PrivacyRequest.user_id == user.id, PrivacyRequest.kind == body.kind,
                                                       PrivacyRequest.status == "open"))
    if open_same:
        raise HTTPException(400, "You already have an open request of this type.")
    r = PrivacyRequest(user_id=user.id, user_label=user.name or user.email or "", kind=body.kind, details=body.details,
                       due_at=now() + timedelta(days=KINDS[body.kind]))
    db.add(r)
    db.commit()
    return {"id": str(r.id), "status": r.status}


@router.get("/privacy/{rid}/download")
def download_export(rid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    r = get_or_404(db, PrivacyRequest, rid, "request")
    if r.user_id != user.id or not r.result_path or r.status != "completed":
        raise HTTPException(404, "Export not ready")
    return FileResponse(storage.safe_path(r.result_path), filename="intellinova-data-export.json",
                        media_type="application/json")


@router.get("/topics/{tid}")
def topic_brief(tid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    t = get_or_404(db, Topic, tid, "topic")
    return {"id": str(t.id), "name": t.name, "chapter_id": str(t.chapter_id), "chapter": t.chapter.name,
            "subject": t.chapter.subject.name}


@router.get("/header")
def header(user: User = Depends(student_user), db: Session = Depends(get_db)):
    """Small payload for the app header: identity, streak and reminders."""
    from sqlalchemy import func

    from app.models import CardState, Mastery
    from app.routers.home import streak

    p = profile_of(db, user)
    name = user.name or user.email or ""
    initials = "".join(w[0] for w in name.split()[:2]).upper() or "?"
    due_topics = db.scalar(select(func.count()).select_from(Mastery).where(Mastery.user_id == user.id, Mastery.next_review_at <= now())) or 0
    due_cards = db.scalar(select(func.count()).select_from(CardState).where(CardState.user_id == user.id, CardState.due_at <= now())) or 0
    reminders = []
    if due_topics:
        reminders.append({"icon": "replay", "t": f"{due_topics} topic{'s' if due_topics > 1 else ''} due for revision", "href": "/app/progress"})
    if due_cards:
        reminders.append({"icon": "style", "t": f"{due_cards} flashcard{'s' if due_cards > 1 else ''} to review", "href": "/app/study"})
    return {"name": name, "nickname": p.nickname or name.split(" ")[0], "initials": initials, "avatar": p.avatar,
            "streak": streak(db, user), "onboarded": bool(p.onboarded_at), "is_staff": user.role in ("curator", "admin"),
            "reminders": reminders}
