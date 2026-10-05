"""Exam-date study schedule (6c)."""
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Chapter, DailyTask, StudentProfile, StudySchedule, Subject, User
from app.security import student_user
from app.services import planner, schedule

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


def out(db: Session, sch: StudySchedule | None) -> dict:
    if not sch:
        return {"schedule": None}
    plan = sch.plan or {}
    done = schedule.completed_keys(db, sch, plan)
    today = date.today().isoformat()
    days = [{**d, "items": [{**it, "done": it["key"] in done} for it in d["items"]]} for d in plan.get("days", [])]
    all_items = [it for d in days for it in d["items"]]
    t = next((d for d in days if d["date"] == today), None)
    return {"schedule": {
        "title": sch.title, "exam_date": sch.exam_date.isoformat(), "days_left": (sch.exam_date - date.today()).days,
        "minutes_per_day": sch.minutes_per_day, "subject_ids": [str(x) for x in sch.subject_ids],
        "chapter_ids": [str(x) for x in sch.chapter_ids], "rest_days": sch.rest_days,
        "summary": plan.get("summary", {}), "forgetting": plan.get("forgetting", []), "days": days,
        "today": t["items"] if t else [], "done": sum(1 for it in all_items if it["done"]), "total": len(all_items),
        "past": sch.exam_date <= date.today(),
    }}


@router.get("")
def get_schedule(user: User = Depends(student_user), db: Session = Depends(get_db)):
    sch = db.get(StudySchedule, user.id)
    if sch and sch.exam_date > date.today():
        schedule.ensure_current(db, sch)
    return out(db, sch)


@router.get("/options")
def options(user: User = Depends(student_user), db: Session = Depends(get_db)):
    """The student's subjects with their published chapters, for choosing what the exam covers."""
    subs = planner.student_subjects(db, db.get(StudentProfile, user.id))
    return [{"id": str(s.id), "name": s.name, "chapters": [{"id": str(c.id), "name": c.name} for c in s.chapters if c.published and not c.disabled]}
            for s in subs]


class ScheduleIn(BaseModel):
    title: str = Field("My exam", min_length=1, max_length=200)
    exam_date: date
    minutes_per_day: int = Field(60, ge=15, le=600)
    subject_ids: list[uuid.UUID] = Field(min_length=1)
    chapter_ids: list[uuid.UUID] = []
    rest_days: list[int] = []


def _clear_today(db: Session, user_id: uuid.UUID) -> None:
    """Today's plan on the dashboard is cached per day; drop it so it picks up the new schedule."""
    db.execute(delete(DailyTask).where(DailyTask.user_id == user_id, DailyTask.day == date.today()))


@router.put("")
def save(body: ScheduleIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    if body.exam_date <= date.today():
        raise HTTPException(400, "Pick an exam date after today.")
    if body.exam_date > date.today() + timedelta(days=366):
        raise HTTPException(400, "Pick an exam date within the next year.")
    if any(d < 0 or d > 6 for d in body.rest_days) or len(set(body.rest_days)) > 5:
        raise HTTPException(400, "Keep at least two study days a week.")
    found = set(db.scalars(select(Subject.id).where(Subject.id.in_(body.subject_ids))))
    if found != set(body.subject_ids):
        raise HTTPException(400, "Unknown subject.")
    chapters = list(db.scalars(select(Chapter).where(Chapter.id.in_(body.chapter_ids)))) if body.chapter_ids else []
    if len(chapters) != len(set(body.chapter_ids)) or any(c.subject_id not in found for c in chapters):
        raise HTTPException(400, "Those chapters aren't in the chosen subjects.")
    sch = db.get(StudySchedule, user.id) or StudySchedule(user_id=user.id, done=[])
    sch.title, sch.exam_date, sch.minutes_per_day = body.title.strip(), body.exam_date, body.minutes_per_day
    sch.subject_ids, sch.chapter_ids, sch.rest_days = list(dict.fromkeys(body.subject_ids)), list(dict.fromkeys(body.chapter_ids)), sorted(set(body.rest_days))
    db.add(sch)
    db.flush()
    _clear_today(db, user.id)
    schedule.ensure_current(db, sch, force=True)
    return out(db, sch)


@router.post("/rebuild")
def rebuild(user: User = Depends(student_user), db: Session = Depends(get_db)):
    sch = db.get(StudySchedule, user.id)
    if not sch:
        raise HTTPException(404, "No schedule yet")
    _clear_today(db, user.id)
    schedule.ensure_current(db, sch, force=True)
    return out(db, sch)


@router.post("/items/{key}/toggle")
def toggle(key: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    sch = db.get(StudySchedule, user.id)
    if not sch or not any(it["key"] == key for d in (sch.plan or {}).get("days", []) for it in d["items"]):
        raise HTTPException(404, "Item not found")
    done = list(sch.done or [])
    sch.done = [k for k in done if k != key] if key in done else [*done, key]
    db.commit()
    return {"done": key in sch.done}


@router.delete("")
def remove(user: User = Depends(student_user), db: Session = Depends(get_db)):
    sch = db.get(StudySchedule, user.id)
    if sch:
        db.delete(sch)
        _clear_today(db, user.id)
        db.commit()
    return {"ok": True}
