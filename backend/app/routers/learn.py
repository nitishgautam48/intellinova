"""Learn: subjects -> chapters -> topics, topic completion, recommended
resources, resource feedback / progress / reports, and Saved."""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    Chapter,
    Mastery,
    Resource,
    ResourceFeedback,
    ResourceProgress,
    ResourceReport,
    ResourceTopic,
    SavedItem,
    StudentProfile,
    StudyMaterial,
    Subject,
    Topic,
    TopicPrereq,
    TopicProgress,
    User,
)
from app.routers.common import dur_label, get_or_404, now, rel_time, subtopics_by_topic, track
from app.security import student_user
from app.config import settings
from app.services import discovery, planner, resources

router = APIRouter(prefix="/api", tags=["learn"])

TYPE_ICON = {"Playlist": "playlist_play", "Video": "smart_display", "Article": "article",
             "Article series": "article", "Document": "description"}


def resource_card(db: Session, user: User, r: Resource, why: str = "") -> dict:
    tids = list(db.scalars(select(ResourceTopic.topic_id).where(ResourceTopic.resource_id == r.id)))
    names = list(db.scalars(select(Topic.name).where(Topic.id.in_(tids)).order_by(Topic.position))) if tids else []
    fb = db.get(ResourceFeedback, (user.id, r.id))
    prog = db.get(ResourceProgress, (user.id, r.id))
    saved = db.scalar(select(SavedItem.id).where(SavedItem.user_id == user.id, SavedItem.kind == "resource",
                                                 SavedItem.ref_id == r.id))
    return {
        "id": str(r.id), "title": r.title, "creator": r.creator, "type": r.rtype, "icon": TYPE_ICON.get(r.rtype, "link"),
        "dur": r.duration_label, "diff": r.difficulty, "lang": ", ".join(r.languages or []), "thumb": r.thumbnail_url,
        "url": r.url, "platform": r.platform, "why": why, "topics": names, "unavailable": r.status == "Unavailable",
        "saved": bool(saved), "helpful": fb.helpful if fb else None, "progress": prog.status if prog else None,
        "auto": (r.meta or {}).get("origin") == "discovered",
    }


# --------------------------------------------------------------------------- subjects / chapters


def chapter_status(db: Session, user: User, ch: Chapter) -> tuple[str, int, int]:
    topics = [t for t in ch.topics if t.published]
    done = set(db.scalars(select(TopicProgress.topic_id).where(TopicProgress.user_id == user.id,
                                                               TopicProgress.topic_id.in_([t.id for t in topics]))))
    due = db.scalar(select(Mastery.topic_id).where(Mastery.user_id == user.id, Mastery.topic_id.in_(list(done) or [uuid.uuid4()]),
                                                   Mastery.next_review_at <= now()).limit(1))
    if topics and len(done) == len(topics):
        st = "Revision due" if due else "Completed"
    elif done:
        st = "Revision due" if due else "In progress"
    else:
        st = "Not started"
    return st, len(done), len(topics)


@router.get("/learn/subjects")
def my_subjects(user: User = Depends(student_user), db: Session = Depends(get_db)):
    prof = db.get(StudentProfile, user.id)
    out = []
    for s in planner.student_subjects(db, prof):
        sp = planner.subject_progress(db, user.id, s)
        chapters = [c for c in s.chapters if c.published and not c.disabled]
        nxt = sp["next"]
        out.append({"id": str(s.id), "name": s.name, "icon": s.icon, "tone": s.tone, "chapters": len(chapters),
                    "pct": sp["pct"], "next": f"{nxt.chapter.name} · {nxt.name}" if nxt else "All topics done"})
    return out


@router.get("/learn/subjects/{sid}")
def subject_detail(sid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    s = get_or_404(db, Subject, sid, "subject")
    chapters = []
    for i, c in enumerate([c for c in s.chapters if c.published and not c.disabled], start=1):
        st, done, total = chapter_status(db, user, c)
        chapters.append({"id": str(c.id), "n": f"{i:02d}", "name": c.name, "topics": total, "done": done, "status": st})
    sp = planner.subject_progress(db, user.id, s)
    return {"id": str(s.id), "name": s.name, "board": s.board, "class_level": s.class_level, "icon": s.icon,
            "tone": s.tone, "pct": sp["pct"], "chapters": chapters}


@router.get("/learn/subjects/{sid}/map")
def subject_map(sid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    """Course flow map: topics in course order with prerequisite links and this student's mastery."""
    from app.services import flowmap

    return flowmap.build(db, get_or_404(db, Subject, sid, "subject"), user.id)


@router.get("/learn/chapters/{cid}")
def chapter_detail(cid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    c = get_or_404(db, Chapter, cid, "chapter")
    if not c.published or c.disabled:
        raise HTTPException(404, "Chapter not found")
    topics = [t for t in c.topics if t.published]
    done = set(db.scalars(select(TopicProgress.topic_id).where(TopicProgress.user_id == user.id)))
    cur = next((t.id for t in topics if t.id not in done), None)
    tl = []
    subs = subtopics_by_topic(db, [t.id for t in topics])
    for t in topics:
        m = db.get(Mastery, (user.id, t.id))
        tl.append({"id": str(t.id), "name": t.name, "dur": f"{t.est_minutes} min", "summary": t.summary, "subtopics": subs.get(t.id, []),
                   "state": "done" if t.id in done else "current" if t.id == cur else "todo",
                   "mastery": round(m.p, 2) if m else None})
    # "Before you start": prerequisites that live in other chapters.
    before = []
    ids = [t.id for t in topics]
    if ids:
        for tp in db.scalars(select(TopicPrereq).where(TopicPrereq.topic_id.in_(ids))):
            pt = db.get(Topic, tp.prereq_id)
            if pt and pt.chapter_id != c.id and all(b["id"] != str(pt.id) for b in before):
                before.append({"id": str(pt.id), "name": pt.name, "chapter": pt.chapter.name,
                               "chapter_id": str(pt.chapter_id), "done": pt.id in done})
    # Topics the student is about to study that have too few videos: look for more on YouTube.
    finding = False
    if settings.discovery_enabled:
        prof = db.get(StudentProfile, user.id)
        for t in ([t for t in topics if t.id not in done] or topics)[:3]:
            d = discovery.for_topic(db, t, prof)
            finding = finding or bool(d and d.status in ("queued", "running"))
    recs = resources.recommend(db, user.id, chapter_id=c.id, limit=8)
    cards = [resource_card(db, user, x["resource"], x["why"]) for x in recs]
    left = sum(t.est_minutes for t in topics if t.id not in done)
    track(db, user, "view_chapter", c.id, "learn")
    db.commit()
    return {"id": str(c.id), "name": c.name, "subject": {"id": str(c.subject.id), "name": c.subject.name},
            "position": c.position + 1, "topics": tl, "done": len([t for t in topics if t.id in done]),
            "total": len(topics), "time_left": dur_label(left), "total_time": dur_label(sum(t.est_minutes for t in topics)),
            "before": before, "best": cards[0] if cards else None,
            "alternatives": cards[1:4], "more": cards[4:], "finding_videos": finding}


@router.post("/learn/topics/{tid}/complete")
def toggle_topic(tid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    t = get_or_404(db, Topic, tid, "topic")
    tp = db.get(TopicProgress, (user.id, t.id))
    if tp:
        db.delete(tp)
        done = False
    else:
        db.add(TopicProgress(user_id=user.id, topic_id=t.id))
        track(db, user, "topic_completed", t.id, "learn", minutes=float(t.est_minutes))
        done = True
    db.commit()
    return {"done": done}


class TimeIn(BaseModel):
    minutes: float = Field(ge=0, le=240)
    module: str = "learn"
    ref_id: uuid.UUID | None = None


@router.post("/activity/time")
def log_time(body: TimeIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    """Heartbeat from the web app: minutes actively spent in a module."""
    track(db, user, "time", body.ref_id, body.module[:20], minutes=body.minutes)
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- resources


@router.get("/resources/{rid}")
def resource_detail(rid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    r = get_or_404(db, Resource, rid, "resource")
    if r.status not in ("Active", "Unavailable"):
        raise HTTPException(404, "Resource not found")
    track(db, user, "open_resource", r.id, "learn")
    db.commit()
    return resource_card(db, user, r)


class FeedbackIn(BaseModel):
    helpful: str | None = None  # up | down | None to clear


@router.post("/resources/{rid}/feedback")
def feedback(rid: str, body: FeedbackIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    r = get_or_404(db, Resource, rid, "resource")
    fb = db.get(ResourceFeedback, (user.id, r.id))
    if body.helpful not in ("up", "down"):
        if fb:
            db.delete(fb)
    elif fb:
        fb.helpful = body.helpful
    else:
        db.add(ResourceFeedback(user_id=user.id, resource_id=r.id, helpful=body.helpful))
    track(db, user, "rate_resource", r.id, "learn", helpful=body.helpful)
    db.commit()
    return {"helpful": body.helpful}


class ProgressIn(BaseModel):
    status: str  # started | completed


@router.post("/resources/{rid}/progress")
def resource_progress(rid: str, body: ProgressIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    r = get_or_404(db, Resource, rid, "resource")
    if body.status not in ("started", "completed"):
        raise HTTPException(400, "status must be started or completed")
    p = db.get(ResourceProgress, (user.id, r.id)) or ResourceProgress(user_id=user.id, resource_id=r.id)
    if p.status != "completed" or body.status == "completed":
        p.status = body.status
    if body.status == "completed":
        p.completed_at = now()
    db.merge(p)
    db.commit()
    return {"status": p.status}


class ReportIn(BaseModel):
    reason: str = Field(min_length=2, max_length=120)
    note: str = Field("", max_length=1000)


@router.post("/resources/{rid}/report")
def report_resource(rid: str, body: ReportIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    r = get_or_404(db, Resource, rid, "resource")
    db.add(ResourceReport(resource_id=r.id, user_id=user.id, reason=body.reason, note=body.note))
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- saved


class SaveIn(BaseModel):
    kind: str
    ref_id: uuid.UUID
    label: str = ""


@router.post("/saved")
def save(body: SaveIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    if body.kind not in ("resource", "material", "pathway"):
        raise HTTPException(400, "Unknown kind")
    exists = db.scalar(select(SavedItem).where(SavedItem.user_id == user.id, SavedItem.kind == body.kind,
                                               SavedItem.ref_id == body.ref_id))
    if not exists:
        db.add(SavedItem(user_id=user.id, kind=body.kind, ref_id=body.ref_id, label=body.label[:400]))
        db.commit()
    return {"saved": True}


@router.delete("/saved/{kind}/{ref_id}")
def unsave(kind: str, ref_id: uuid.UUID, user: User = Depends(student_user), db: Session = Depends(get_db)):
    db.execute(delete(SavedItem).where(SavedItem.user_id == user.id, SavedItem.kind == kind, SavedItem.ref_id == ref_id))
    db.commit()
    return {"saved": False}


@router.get("/saved")
def saved(user: User = Depends(student_user), db: Session = Depends(get_db)):
    items = list(db.scalars(select(SavedItem).where(SavedItem.user_id == user.id).order_by(SavedItem.created_at.desc())))
    res, mats, paths = [], [], []
    for it in items:
        if it.kind == "resource":
            r = db.get(Resource, it.ref_id)
            if r:
                res.append(resource_card(db, user, r))
        elif it.kind == "material":
            m = db.get(StudyMaterial, it.ref_id)
            if m and m.user_id == user.id:
                mats.append({"id": str(m.id), "t": m.title, "s": m.subject_label, "when": rel_time(m.created_at),
                             "status": m.status})
        else:
            paths.append({"id": str(it.ref_id), "t": it.label, "when": rel_time(it.created_at)})
    # Everything the student generated also lives in Saved > Study material.
    own = db.scalars(select(StudyMaterial).where(StudyMaterial.user_id == user.id, StudyMaterial.status == "Ready")
                     .order_by(StudyMaterial.created_at.desc()).limit(50))
    ids = {m["id"] for m in mats}
    for m in own:
        if str(m.id) not in ids:
            mats.append({"id": str(m.id), "t": m.title, "s": m.subject_label, "when": rel_time(m.created_at),
                         "status": m.status, "fav": m.favorite})
    return {"resources": res, "materials": mats, "pathways": paths}

