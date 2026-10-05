"""Practice: quiz builder, adaptive quiz / timed mock exam, feedback and the
post-assessment report."""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Chapter, Mastery, Quiz, QuizItem, StudentProfile, Topic, User
from app.routers.common import get_or_404, now, rel_time, until
from app.security import student_user
from app.services import learner, planner, quiz_engine
from app.workers import tasks

router = APIRouter(prefix="/api/practice", tags=["practice"])


@router.get("/setup")
def setup(user: User = Depends(student_user), db: Session = Depends(get_db)):
    prof = db.get(StudentProfile, user.id)
    chapters = []
    for s in planner.student_subjects(db, prof):
        for c in s.chapters:
            if not c.published or c.disabled:
                continue
            tl = []
            for t in c.topics:
                if not t.published:
                    continue
                m = db.get(Mastery, (user.id, t.id))
                tl.append({"id": str(t.id), "name": t.name, "mastery": round(m.p, 2) if m else None})
            if tl:
                chapters.append({"id": str(c.id), "name": c.name, "subject": s.name, "topics": tl})
    cur = planner.current_chapter(db, user.id, prof)
    hist = []
    for q in db.scalars(select(Quiz).where(Quiz.user_id == user.id, Quiz.status == "completed")
                        .order_by(Quiz.finished_at.desc()).limit(8)):
        c = (q.summary or {}).get("counts", {})
        hist.append({"id": str(q.id), "t": q.title, "mode": q.mode, "when": rel_time(q.finished_at),
                     "m": f"{c.get('correct', 0)} of {(q.summary or {}).get('total', len(q.items))} · {rel_time(q.finished_at)}",
                     "icon": {"Mock exam": "timer", "Diagnostic": "explore"}.get(q.mode, "quiz")})
    active = db.scalar(select(Quiz).where(Quiz.user_id == user.id, Quiz.status.in_(("preparing", "active")))
                       .order_by(Quiz.created_at.desc()).limit(1))
    return {"chapters": chapters, "current_chapter_id": str(cur.id) if cur else None, "history": hist,
            "active_quiz_id": str(active.id) if active else None}


class QuizIn(BaseModel):
    topic_ids: list[uuid.UUID] = Field(min_length=1, max_length=40)
    types: list[str] = ["MCQ", "Numerical", "Short answer"]
    difficulty: str = "Adaptive"
    n: int = Field(5, ge=3, le=30)
    mode: str = "Quiz"


@router.post("/quizzes")
def create_quiz(body: QuizIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    types = [t for t in body.types if t in ("MCQ", "Numerical", "Short answer")]
    if not types:
        raise HTTPException(400, "Pick at least one question type.")
    if body.difficulty not in ("Adaptive", "Easy", "Medium", "Hard"):
        raise HTTPException(400, "Unknown difficulty")
    if body.mode not in ("Quiz", "Mock exam"):
        raise HTTPException(400, "Unknown mode")
    topics = list(db.scalars(select(Topic).where(Topic.id.in_(body.topic_ids), Topic.published.is_(True))))
    if not topics:
        raise HTTPException(400, "Pick at least one topic.")
    chapters = {t.chapter_id for t in topics}
    ch = db.get(Chapter, next(iter(chapters)))
    count = (db.scalar(select(func.count()).select_from(Quiz).where(Quiz.user_id == user.id, Quiz.mode == body.mode)) or 0) + 1
    title = f"{'Mock exam' if body.mode == 'Mock exam' else 'Quiz'} {count} · {ch.name if len(chapters) == 1 else 'Mixed'}"
    q = Quiz(user_id=user.id, title=title, mode=body.mode, difficulty_mode=body.difficulty, types=types,
             topic_ids=[t.id for t in topics], n=body.n)
    db.add(q)
    db.commit()
    tasks.prepare_quiz.delay(str(q.id))
    return {"id": str(q.id), "status": q.status}


def quiz_out(db: Session, q: Quiz) -> dict:
    reveal_all = q.mode != "Mock exam" or q.status == "completed"
    items = [quiz_engine.item_view(db, it, reveal_all) for it in q.items]
    current = next((i for i, it in enumerate(q.items) if it.response is None), len(q.items) - 1 if q.items else 0)
    time_left = None
    if q.time_limit_s and q.started_at and q.status == "active":
        time_left = max(0, int(q.time_limit_s - (now() - q.started_at).total_seconds()))
    return {"id": str(q.id), "title": q.title, "mode": q.mode, "status": q.status, "error": q.error, "n": q.n,
            "difficulty": q.difficulty_mode, "types": q.types, "items": items, "current": current,
            "time_left": time_left, "summary": q.summary if q.status == "completed" else None}


def _own(db: Session, qid: str, user: User) -> Quiz:
    q = get_or_404(db, Quiz, qid, "quiz")
    if q.user_id != user.id:
        raise HTTPException(404, "Quiz not found")
    return q


@router.get("/quizzes/{qid}")
def get_quiz(qid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    q = _own(db, qid, user)
    if q.status == "active" and q.time_limit_s and q.started_at and (now() - q.started_at).total_seconds() > q.time_limit_s + 5:
        quiz_engine.finish(db, q)
    return quiz_out(db, q)


class AnswerIn(BaseModel):
    response: str = Field(min_length=1, max_length=4000)


@router.post("/quizzes/{qid}/items/{iid}/answer")
def answer(qid: str, iid: str, body: AnswerIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    q = _own(db, qid, user)
    if q.status != "active":
        raise HTTPException(400, "This quiz is not running.")
    item = get_or_404(db, QuizItem, iid, "question")
    if item.quiz_id != q.id:
        raise HTTPException(404, "Question not found")
    if item.response is not None and q.mode != "Mock exam":
        raise HTTPException(400, "Already answered.")
    if q.mode == "Mock exam":
        item.response = body.response.strip()
        db.commit()
    else:
        quiz_engine.answer(db, q, item, body.response.strip())
    return quiz_out(db, q)


@router.post("/quizzes/{qid}/finish")
def finish(qid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    q = _own(db, qid, user)
    if q.status != "active":
        return quiz_out(db, q)
    if q.mode == "Mock exam":
        for it in q.items:
            if it.response is not None and it.grade is None:
                quiz_engine.answer(db, q, it, it.response)
    quiz_engine.finish(db, q)
    return quiz_out(db, q)


@router.post("/quizzes/{qid}/schedule-requiz")
def schedule_requiz(qid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    """Pull weak topics' next review forward so they appear in Today's plan."""
    q = _own(db, qid, user)
    weak = [w for w in (q.summary or {}).get("weak", [])]
    n = 0
    for tid in q.topic_ids:
        m = db.get(Mastery, (user.id, tid))
        if m and m.p < 0.5:
            m.next_review_at = min(m.next_review_at or now() + timedelta(days=3), now() + timedelta(days=3))
            n += 1
    db.commit()
    return {"scheduled": n, "weak": len(weak), "due": until(now() + timedelta(days=3))}


@router.get("/mastery")
def mastery_table(chapter_id: str | None = None, user: User = Depends(student_user), db: Session = Depends(get_db)):
    """The learner model for one chapter: estimate, uncertainty, last evidence, next review."""
    prof = db.get(StudentProfile, user.id)
    ch = db.get(Chapter, uuid.UUID(chapter_id)) if chapter_id else planner.current_chapter(db, user.id, prof)
    if not ch:
        return {"chapter": None, "rows": []}
    rows = []
    for t in ch.topics:
        if not t.published:
            continue
        m = db.get(Mastery, (user.id, t.id))
        p = m.p if m else learner.P_INIT
        ci = m.uncertainty if m else 0.25
        rows.append({"topic_id": str(t.id), "t": t.name, "p": round(p, 2), "ci": round(ci, 2),
                     "status": learner.status_of(p) if m and m.n_obs else "Not assessed",
                     "evidence": f"{m.last_evidence} · {rel_time(m.last_evidence_at)}" if m and m.last_evidence else "No evidence yet",
                     "next": until(m.next_review_at) if m and m.next_review_at else "—",
                     "recall": round(learner.recall(m), 2) if m and m.fsrs else None})
    return {"chapter": {"id": str(ch.id), "name": ch.name}, "rows": rows}
