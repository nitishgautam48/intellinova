"""Admin console: Overview and Analytics."""
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    ActivityEvent,
    CareerEdge,
    Chapter,
    ContentFlag,
    ContentTask,
    Resource,
    ResourceFeedback,
    ResourceReport,
    SearchLog,
    StudyMaterial,
    Subject,
    User,
)
from app.routers.common import class_num, fact_status, now, rel_time
from app.security import require_staff

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _pct_change(cur: int, prev: int) -> str:
    if prev == 0:
        return "new this week" if cur else "no change"
    d = 100 * (cur - prev) / prev
    return f"{'+' if d >= 0 else '−'}{abs(d):.1f}% vs last week"


@router.get("/overview")
def overview(_: User = Depends(require_staff), db: Session = Depends(get_db)):
    t = now()
    w1, w2 = t - timedelta(days=7), t - timedelta(days=14)
    users = db.scalar(select(func.count()).select_from(User).where(User.role == "student")) or 0
    new_this = db.scalar(select(func.count()).select_from(User).where(User.role == "student", User.created_at >= w1)) or 0
    new_prev = db.scalar(select(func.count()).select_from(User).where(User.role == "student", User.created_at >= w2,
                                                                      User.created_at < w1)) or 0
    active = db.scalar(select(func.count()).select_from(Resource).where(Resource.status == "Active")) or 0
    review = db.scalar(select(func.count()).select_from(Resource).where(Resource.status == "Needs Review")) or 0
    notes7 = db.scalar(select(func.count()).select_from(StudyMaterial).where(StudyMaterial.created_at >= w1)) or 0
    active_users = db.scalar(select(func.count(func.distinct(ActivityEvent.user_id))).where(ActivityEvent.created_at >= w1)) or 0
    s7 = db.scalar(select(func.count()).select_from(SearchLog).where(SearchLog.created_at >= w1)) or 0
    z7 = db.scalar(select(func.count()).select_from(SearchLog).where(SearchLog.created_at >= w1, SearchLog.result_count == 0)) or 0

    pop = db.execute(select(SearchLog.normalized, func.count()).where(SearchLog.created_at >= w1, SearchLog.result_count > 0)
                     .group_by(SearchLog.normalized).order_by(func.count().desc()).limit(5)).all()
    top = db.execute(select(ActivityEvent.ref_id, func.count()).where(ActivityEvent.kind == "view_chapter",
                                                                      ActivityEvent.created_at >= w1)
                     .group_by(ActivityEvent.ref_id).order_by(func.count().desc()).limit(5)).all()
    top_rows = []
    mx = max([n for _, n in top] or [1])
    for cid, n in top:
        c = db.get(Chapter, cid)
        if c:
            top_rows.append({"t": c.name, "s": f"{c.subject.name} {class_num(c.subject.class_level)}", "n": n,
                             "w": f"{round(100 * n / mx)}%"})

    reps = db.execute(select(ResourceReport.resource_id, func.count(), func.max(ResourceReport.reason))
                      .where(ResourceReport.resolved.is_(False)).group_by(ResourceReport.resource_id)
                      .order_by(func.count().desc()).limit(5)).all()
    rep_rows = []
    for rid, n, reason in reps:
        r = db.get(Resource, rid)
        if r:
            rep_rows.append({"id": str(r.id), "t": r.title, "r": reason, "s": r.status, "n": f"{n} report{'s' if n > 1 else ''}"})

    queue = []
    for m in db.scalars(select(StudyMaterial).where(StudyMaterial.status == "Flagged").order_by(StudyMaterial.updated_at.desc()).limit(3)):
        nf = db.scalar(select(func.count(func.distinct(ContentFlag.user_id))).where(ContentFlag.material_id == m.id,
                                                                                   ContentFlag.resolved.is_(False))) or 0
        queue.append({"kind": "generated", "id": str(m.id), "t": f"Generated notes · {m.title}", "r": f"Flagged by {nf} student{'s' if nf != 1 else ''}",
                      "when": rel_time(m.updated_at), "icon": "auto_awesome"})
    for e in db.scalars(select(CareerEdge).where(CareerEdge.requirement.is_not(None)).order_by(CareerEdge.verified_at.asc().nullsfirst()).limit(10)):
        st = fact_status(e.verified_at, e.source_name)
        if st != "Verified":
            queue.append({"kind": "career", "id": str(e.id), "t": f"Career fact · {e.label or 'eligibility rule'}",
                          "r": "Verification older than 12 months" if st == "May be outdated" else "No source recorded",
                          "when": rel_time(e.verified_at or e.created_at), "icon": "verified"})
            if len([q for q in queue if q["kind"] == "career"]) >= 2:
                break
    for r in db.scalars(select(Resource).where(Resource.status == "Needs Review").order_by(Resource.created_at.desc()).limit(3)):
        queue.append({"kind": "resource", "id": str(r.id), "t": f"Resource · {r.title}", "r": "New submission",
                      "when": rel_time(r.created_at), "icon": "video_library"})

    return {
        "stats": [
            {"l": "Total users", "v": f"{users:,}", "d": _pct_change(new_this, new_prev), "icon": "group"},
            {"l": "Active resources", "v": f"{active:,}", "d": f"{review} need review", "icon": "video_library"},
            {"l": "Notes generated (7 d)", "v": f"{notes7:,}",
             "d": f"Avg {notes7 / active_users:.1f} per active user" if active_users else "No active users yet", "icon": "auto_awesome"},
            {"l": "Zero-result searches (7 d)", "v": f"{z7:,}", "d": f"{100 * z7 / s7:.1f}% of all searches" if s7 else "No searches yet",
             "icon": "search_off"},
        ],
        "popular": [{"t": q, "n": n} for q, n in pop],
        "top_chapters": top_rows,
        "reports": rep_rows,
        "queue": queue[:6],
    }


RANGES = {"7d": 7, "30d": 30, "90d": 90}


@router.get("/analytics")
def analytics(period: str = Query("7d", alias="range"), _: User = Depends(require_staff), db: Session = Depends(get_db)):
    days = RANGES.get(period, 7)
    t = now()
    cur, prev = t - timedelta(days=days), t - timedelta(days=2 * days)

    def count(model, *where):
        return db.scalar(select(func.count()).select_from(model).where(*where)) or 0

    def delta(a, b, pts=False):
        if pts:
            return f"{'+' if a - b >= 0 else '−'}{abs(a - b):.1f} pts"
        if b == 0:
            return "—" if a == 0 else "new"
        d = 100 * (a - b) / b
        return f"{'+' if d >= 0 else '−'}{abs(d):.0f}%"

    s_cur, s_prev = count(SearchLog, SearchLog.created_at >= cur), count(SearchLog, SearchLog.created_at >= prev, SearchLog.created_at < cur)
    z_cur = count(SearchLog, SearchLog.created_at >= cur, SearchLog.result_count == 0)
    z_prev = count(SearchLog, SearchLog.created_at >= prev, SearchLog.created_at < cur, SearchLog.result_count == 0)
    zr_cur = 100 * z_cur / s_cur if s_cur else 0
    zr_prev = 100 * z_prev / s_prev if s_prev else 0
    n_cur = count(StudyMaterial, StudyMaterial.created_at >= cur)
    n_prev = count(StudyMaterial, StudyMaterial.created_at >= prev, StudyMaterial.created_at < cur)
    r_cur = count(ResourceFeedback, ResourceFeedback.updated_at >= cur)
    r_prev = count(ResourceFeedback, ResourceFeedback.updated_at >= prev, ResourceFeedback.updated_at < cur)

    top = db.execute(select(SearchLog.normalized, func.count()).where(SearchLog.created_at >= cur, SearchLog.result_count > 0)
                     .group_by(SearchLog.normalized).order_by(func.count().desc()).limit(6)).all()
    zero = db.execute(select(SearchLog.normalized, func.count()).where(SearchLog.created_at >= cur, SearchLog.result_count == 0)
                      .group_by(SearchLog.normalized).order_by(func.count().desc()).limit(6)).all()
    tasks = {x.title for x in db.scalars(select(ContentTask).where(ContentTask.status == "open"))}
    views = db.execute(select(ActivityEvent.ref_id, func.count()).where(ActivityEvent.kind == "view_chapter", ActivityEvent.created_at >= cur)
                       .group_by(ActivityEvent.ref_id).order_by(func.count().desc()).limit(6)).all()
    mxv = max([n for _, n in views] or [1])
    chapters = []
    for cid, n in views:
        c = db.get(Chapter, cid)
        if c:
            s: Subject = c.subject
            chapters.append({"t": c.name, "s": f"{s.name} {class_num(s.class_level)}", "n": n, "w": f"{round(100 * n / mxv)}%"})
    opened = db.execute(select(ActivityEvent.ref_id, func.count()).where(ActivityEvent.kind == "open_resource", ActivityEvent.created_at >= cur)
                        .group_by(ActivityEvent.ref_id).order_by(func.count().desc()).limit(6)).all()
    sel = []
    for rid, n in opened:
        r = db.get(Resource, rid)
        if not r:
            continue
        up = count(ResourceFeedback, ResourceFeedback.resource_id == rid, ResourceFeedback.helpful == "up")
        down = count(ResourceFeedback, ResourceFeedback.resource_id == rid, ResourceFeedback.helpful == "down")
        h = round(100 * up / (up + down)) if up + down else None
        sel.append({"t": r.title, "n": n, "h": h})

    buckets = 7
    size = timedelta(days=days / buckets)
    mods = []
    for label, module, icon, color in (("Notes generation", "notes", "auto_awesome", "pri"), ("Exam module", "exam", "flag", "teal"),
                                       ("Career exploration", "career", "explore", "warn")):
        bars = []
        for i in range(buckets):
            a = cur + size * i
            bars.append(count(ActivityEvent, ActivityEvent.module == module, ActivityEvent.created_at >= a, ActivityEvent.created_at < a + size))
        mods.append({"l": label, "icon": icon, "c": color, "tot": sum(bars), "bars": bars})

    return {
        "range": period, "label": {"7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days"}.get(period, "last 7 days"),
        "kpis": [
            {"l": "Searches", "v": f"{s_cur:,}", "d": delta(s_cur, s_prev)},
            {"l": "Zero-result rate", "v": f"{zr_cur:.1f}%", "d": delta(zr_cur, zr_prev, True)},
            {"l": "Notes generated", "v": f"{n_cur:,}", "d": delta(n_cur, n_prev)},
            {"l": "Resource ratings", "v": f"{r_cur:,}", "d": delta(r_cur, r_prev)},
        ],
        "top": [{"t": q, "n": n} for q, n in top],
        "zero": [{"t": q, "n": n, "task": q in tasks} for q, n in zero],
        "chapters": chapters, "selection": sel, "modules": mods,
    }


class TaskIn(BaseModel):
    title: str = Field(min_length=2, max_length=300)


@router.post("/content-tasks")
def create_task(body: TaskIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    if not db.scalar(select(ContentTask).where(ContentTask.title == body.title, ContentTask.status == "open")):
        db.add(ContentTask(title=body.title, created_by=user.id))
        db.commit()
    return {"ok": True}


@router.get("/content-tasks")
def list_tasks(_: User = Depends(require_staff), db: Session = Depends(get_db)):
    return [{"id": str(t.id), "title": t.title, "status": t.status, "when": rel_time(t.created_at)}
            for t in db.scalars(select(ContentTask).order_by(ContentTask.created_at.desc()).limit(100))]


@router.post("/content-tasks/{tid}/done")
def task_done(tid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    from app.routers.common import get_or_404

    t = get_or_404(db, ContentTask, tid, "task")
    t.status = "done"
    db.commit()
    return {"ok": True}
