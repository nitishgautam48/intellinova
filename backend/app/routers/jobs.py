"""Work still running in the background, for the "running" indicator in the top bar.

Students see their own Study AI materials and quizzes being prepared; staff see textbook processing, evaluation
runs, question-bank preparation and video searches. Only reads existing status fields. Jobs that have shown no
progress for a long time (a worker restarted mid-job) are left out so the indicator never spins forever."""
from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import EvalRun, KbSource, Quiz, StudyMaterial, User, VideoDiscovery
from app.routers.common import now
from app.security import require_staff, student_user
from app.services import evaluation, ingestion, notes

router = APIRouter(tags=["jobs"])

STALE = {"material": timedelta(hours=3), "quiz": timedelta(minutes=15), "source": timedelta(hours=3),
         "eval": timedelta(hours=12), "discovery": timedelta(hours=1)}


def _job(id_, kind, label, detail, href, progress=None, started=None) -> dict:
    return {"id": f"{kind}:{id_}", "kind": kind, "label": label[:120], "detail": detail, "href": href,
            "progress": progress, "started": started.isoformat() if started else None}


def _step(steps: list[str], stage: int) -> str:
    return steps[min(max(stage, 0), len(steps) - 1)] if steps else ""


@router.get("/api/jobs")
def my_jobs(user: User = Depends(student_user), db: Session = Depends(get_db)):
    t = now()
    jobs = []
    for m in db.scalars(select(StudyMaterial).where(StudyMaterial.user_id == user.id, StudyMaterial.status == "Processing",
                                                    StudyMaterial.updated_at > t - STALE["material"])
                        .order_by(StudyMaterial.created_at)):
        jobs.append(_job(m.id, "material", m.title if m.title != "Untitled" else "Study material",
                         _step(notes.STEPS, m.stage), f"/app/study/{m.id}", (m.stage + 1) / (len(notes.STEPS) + 1), m.created_at))
    for q in db.scalars(select(Quiz).where(Quiz.user_id == user.id, Quiz.status == "preparing",
                                           Quiz.created_at > t - STALE["quiz"]).order_by(Quiz.created_at)):
        jobs.append(_job(q.id, "quiz", q.title, "Writing and checking questions", f"/app/practice/{q.id}", None, q.created_at))
    return {"jobs": jobs}


@router.get("/api/admin/jobs")
def staff_jobs(_: User = Depends(require_staff), db: Session = Depends(get_db)):
    t = now()
    jobs = []
    for s in db.scalars(select(KbSource).where(KbSource.origin == "admin", KbSource.status == "Processing",
                                               KbSource.updated_at > t - STALE["source"]).order_by(KbSource.created_at)):
        jobs.append(_job(s.id, "source", s.title, f"Step {min(s.stage, 5) + 1} of 6 · {_step(ingestion.STAGES, s.stage)}",
                         "/admin/kb", (s.stage + 0.5) / len(ingestion.STAGES), s.created_at))
    for r in db.scalars(select(EvalRun).where(EvalRun.status.in_(("queued", "running")),
                                              EvalRun.created_at > t - STALE["eval"]).order_by(EvalRun.number)):
        jobs.append(_job(r.id, "eval", f"Evaluation run {r.number} · {r.framework}",
                         "Waiting to start" if r.status == "queued" else f"{round((r.progress or 0) * 100)}% done",
                         "/admin/eval?tab=results", r.progress or 0.0, r.started_at or r.created_at))
    prep = evaluation.bank_prep_state(db)
    if prep and prep.get("status") in ("queued", "running"):
        total, done = prep.get("total") or 0, prep.get("done") or 0
        jobs.append({"id": "bank:prep", "kind": "bank", "label": "Preparing the question bank",
                     "detail": f"{done} of {total} topics" if total else "Starting", "href": "/admin/eval?tab=bank",
                     "progress": (done / total) if total else None, "started": prep.get("started_at")})
    for d in db.scalars(select(VideoDiscovery).where(VideoDiscovery.status.in_(("queued", "running")),
                                                     VideoDiscovery.updated_at > t - STALE["discovery"])
                        .order_by(VideoDiscovery.created_at).limit(10)):
        jobs.append(_job(d.id, "discovery", f"Finding videos · {d.label or d.query or 'topic'}",
                         "Searching YouTube and checking each video", "/admin/resources", None, d.created_at))
    return {"jobs": jobs}
