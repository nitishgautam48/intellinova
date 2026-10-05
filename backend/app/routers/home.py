"""Dashboard and My Progress."""
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    ActivityEvent,
    CareerNode,
    Chapter,
    DailyTask,
    Exam,
    Mastery,
    Resource,
    ResourceProgress,
    StudentProfile,
    StudyMaterial,
    Topic,
    TopicProgress,
    User,
)
from app.routers.common import class_num, dur_label, get_or_404, now, rel_time
from app.routers.learn import resource_card
from app.security import student_user
from app.services import learner, planner, resources

router = APIRouter(prefix="/api", tags=["home"])


def _day_start(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def minutes_by_day(db: Session, user: User, days: int) -> dict[date, float]:
    since = _day_start(date.today() - timedelta(days=days - 1))
    rows = db.execute(select(func.date(ActivityEvent.created_at), func.sum(ActivityEvent.minutes))
                      .where(ActivityEvent.user_id == user.id, ActivityEvent.created_at >= since)
                      .group_by(func.date(ActivityEvent.created_at))).all()
    return {d: float(m or 0) for d, m in rows}


def streak(db: Session, user: User) -> int:
    days = set(db.scalars(select(func.date(ActivityEvent.created_at)).where(
        ActivityEvent.user_id == user.id, ActivityEvent.created_at >= now() - timedelta(days=120)).distinct()))
    n, d = 0, date.today()
    if d not in days:
        d -= timedelta(days=1)
    while d in days:
        n += 1
        d -= timedelta(days=1)
    return n


def attention(db: Session, user: User, limit: int = 3) -> list[dict]:
    out = []
    rows = db.execute(select(Mastery, Topic).join(Topic, Mastery.topic_id == Topic.id)
                      .where(Mastery.user_id == user.id, Mastery.n_obs > 0).order_by(Mastery.p).limit(12)).all()
    for m, t in rows:
        ch = t.chapter
        sub = f"{ch.subject.name} · Ch {ch.position + 1}"
        if m.p < 0.5:
            out.append({"topic_id": str(t.id), "name": t.name, "sub": sub,
                        "signal": f"Mastery {m.p:.2f}" + (f" after {m.last_evidence.split(' · ')[0]}" if m.last_evidence else "")})
        elif m.fsrs and learner.recall(m) < 0.7:
            out.append({"topic_id": str(t.id), "name": t.name, "sub": sub, "signal": "Recall predicted below 70%"})
        if len(out) >= limit:
            break
    return out


@router.get("/dashboard")
def dashboard(user: User = Depends(student_user), db: Session = Depends(get_db)):
    prof = db.get(StudentProfile, user.id)
    if not prof or not prof.onboarded_at:
        raise HTTPException(409, "Finish setting up your profile first.")
    subs = planner.student_subjects(db, prof)
    chips = [x for x in [f"Class {class_num(prof.class_level)}" if prof.class_level else "", prof.board,
                         f"{len(subs)} subjects" if subs else "", " · ".join(prof.languages[:2])] if x]

    cont = None
    ch = planner.current_chapter(db, user.id, prof)
    if ch:
        topics = [t for t in ch.topics if t.published]
        done = set(db.scalars(select(TopicProgress.topic_id).where(TopicProgress.user_id == user.id)))
        nxt = next((t for t in topics if t.id not in done), None)
        n_done = len([t for t in topics if t.id in done])
        cont = {"chapter_id": str(ch.id), "name": ch.name, "subject": ch.subject.name, "pos": ch.position + 1,
                "next": nxt.name if nxt else None, "next_id": str(nxt.id) if nxt else None,
                "dots": [{"name": t.name, "state": "done" if t.id in done else "current" if nxt and t.id == nxt.id else "todo"} for t in topics],
                "done": n_done, "total": len(topics), "pct": round(100 * n_done / len(topics)) if topics else 0,
                "time_left": dur_label(sum(t.est_minutes for t in topics if t.id not in done))}

    tasks = planner.build_today(db, user.id)
    recs = []
    if ch:
        recs = [resource_card(db, user, x["resource"], x["why"]) for x in resources.recommend(db, user.id, chapter_id=ch.id, limit=3)]

    mins = minutes_by_day(db, user, 7)
    week = []
    for i in range(6, -1, -1):
        d = date.today() - timedelta(days=i)
        week.append({"d": d.strftime("%a"), "m": round(mins.get(d, 0)), "today": i == 0})

    recent = []
    for ev in db.scalars(select(ActivityEvent).where(ActivityEvent.user_id == user.id,
                                                     ActivityEvent.kind.in_(("open_resource", "study_generate", "view_chapter")))
                         .order_by(ActivityEvent.created_at.desc()).limit(10)):
        if ev.kind == "open_resource":
            r = db.get(Resource, ev.ref_id)
            if r:
                recent.append({"t": r.title, "s": f"{r.rtype} · {rel_time(ev.created_at)}", "icon": "smart_display",
                               "link": {"screen": "resource", "id": str(r.id), "url": r.url}})
        elif ev.kind == "study_generate":
            m = db.get(StudyMaterial, ev.ref_id)
            if m:
                recent.append({"t": m.title, "s": f"Study AI · {rel_time(ev.created_at)}", "icon": "fact_check",
                               "link": {"screen": "study", "id": str(m.id)}})
        elif ev.kind == "view_chapter":
            c = db.get(Chapter, ev.ref_id)
            if c:
                recent.append({"t": c.name, "s": f"Chapter · {rel_time(ev.created_at)}", "icon": "menu_book",
                               "link": {"screen": "learn", "chapter_id": str(c.id)}})
        seen = set()
        recent = [x for x in recent if not (x["t"] in seen or seen.add(x["t"]))]
        if len(recent) >= 3:
            break

    exam = None
    if prof.exam_ids:
        e = db.get(Exam, prof.exam_ids[0])
        if e and e.status == "Active":
            from app.models import StudentExamPlan

            tree = planner.exam_tree(db, user.id, e)
            all_t = [t for u in tree for t in u["topics"]]
            plan = db.get(StudentExamPlan, (user.id, e.id))
            nxt = next((t for t in all_t if t["prio"] == "High" and t["status"] != "Confident"), None) or \
                next((t for t in all_t if t["status"] != "Confident"), None)
            exam = {"id": str(e.id), "name": e.name, "target": plan.target_session if plan else "",
                    "pct": planner.pct(all_t), "next": nxt["name"] if nxt else None}

    plan = None
    from app.models import StudySchedule

    sch = db.get(StudySchedule, user.id)
    if sch and sch.exam_date > date.today():
        plan = {"title": sch.title, "days_left": (sch.exam_date - date.today()).days, "exam_date": sch.exam_date.strftime("%-d %b"),
                "fits": (sch.plan or {}).get("summary", {}).get("fits", True)}

    career = None
    cp = prof.career_profile or {}
    if cp.get("likes"):
        from app.routers.explore import directions

        career = directions(db, cp["likes"], 3)
    elif db.scalar(select(func.count()).select_from(CareerNode)):
        career = []

    return {
        "name": prof.nickname or (user.name or "").split(" ")[0], "date": date.today().strftime("%A, %-d %B"),
        "chips": chips, "streak": streak(db, user), "continue": cont,
        "tasks": [{"id": str(t.id), "title": t.title, "meta": t.meta, "dur": f"{t.dur_min} min", "why": t.why,
                   "tone": t.tone, "done": t.done, "link": t.link} for t in tasks],
        "tasks_left": len([t for t in tasks if not t.done]),
        "tasks_minutes": sum(t.dur_min for t in tasks if not t.done),
        "attention": attention(db, user), "recs": recs, "week": week, "recent": recent,
        "exam": exam, "plan": plan, "career": career, "has_subjects": bool(subs),
    }


@router.post("/dashboard/tasks/{tid}/toggle")
def toggle_task(tid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    t = get_or_404(db, DailyTask, tid, "task")
    if t.user_id != user.id:
        raise HTTPException(404, "Task not found")
    t.done = not t.done
    db.commit()
    return {"done": t.done}


@router.get("/progress")
def progress(user: User = Depends(student_user), db: Session = Depends(get_db)):
    prof = db.get(StudentProfile, user.id)
    subs = planner.student_subjects(db, prof)
    sp = [(s, planner.subject_progress(db, user.id, s)) for s in subs]
    overall = round(sum(p["pct"] for _, p in sp) / len(sp)) if sp else 0
    week_start = date.today() - timedelta(days=date.today().weekday())
    month_start = _day_start(date.today().replace(day=1))
    week_mins = sum(v for d, v in minutes_by_day(db, user, 7).items() if d >= week_start)
    res_done = db.scalar(select(func.count()).select_from(ResourceProgress).where(
        ResourceProgress.user_id == user.id, ResourceProgress.status == "completed", ResourceProgress.completed_at >= month_start)) or 0
    notes_n = db.scalar(select(func.count()).select_from(StudyMaterial).where(
        StudyMaterial.user_id == user.id, StudyMaterial.created_at >= month_start)) or 0
    due = db.scalar(select(func.count()).select_from(Mastery).where(Mastery.user_id == user.id, Mastery.next_review_at <= now())) or 0
    overdue = db.scalar(select(func.count()).select_from(Mastery).where(
        Mastery.user_id == user.id, Mastery.next_review_at <= now() - timedelta(days=1))) or 0

    done = set(db.scalars(select(TopicProgress.topic_id).where(TopicProgress.user_id == user.id)))
    due_ids = set(db.scalars(select(Mastery.topic_id).where(Mastery.user_id == user.id, Mastery.next_review_at <= now())))
    heat = []
    for s, p in sp:
        chapters = []
        for i, c in enumerate([c for c in s.chapters if c.published and not c.disabled], start=1):
            tps = [t for t in c.topics if t.published]
            first_todo = next((t.id for t in tps if t.id not in done), None)
            cells = ["due" if t.id in due_ids and t.id in done else "done" if t.id in done else
                     "current" if t.id == first_todo and any(x.id in done for x in tps) else "todo" for t in tps]
            chapters.append({"n": f"{i:02d}", "name": c.name, "cells": cells})
        heat.append({"subject": s.name, "chapters": chapters})

    # Insights (rules over the learner model and activity)
    insights = []
    by_ch = defaultdict(list)
    for tid in due_ids & done:
        t = db.get(Topic, tid)
        if t:
            by_ch[t.chapter.name].append(t)
    if by_ch:
        name, ts = max(by_ch.items(), key=lambda x: len(x[1]))
        insights.append({"icon": "replay", "t": f"Revise {name}", "d": f"{len(ts)} topic{'s' if len(ts) > 1 else ''} "
                         "are due for review based on your recall.", "a": "Start revision", "tone": "warn",
                         "link": {"screen": "practice", "topic_ids": [str(t.id) for t in ts]}})
    if len(sp) > 1:
        s, p = min(sp, key=lambda x: x[1]["pct"])
        insights.append({"icon": "calendar_month", "t": f"{s.name} is falling behind",
                         "d": f"{p['pct']}% complete, the lowest of your subjects. A 10-minute task a day would help close the gap.",
                         "a": "Open subject", "tone": "pri", "link": {"screen": "subject", "id": str(s.id)}})
    tmins = defaultdict(list)
    for ev in db.scalars(select(ActivityEvent).where(ActivityEvent.user_id == user.id, ActivityEvent.kind == "topic_completed")):
        t = db.get(Topic, ev.ref_id)
        if t:
            tmins[t.chapter.name].append(t.est_minutes)
    if len(tmins) >= 2:
        avg = {k: sum(v) / len(v) for k, v in tmins.items() if len(v) >= 2}
        if len(avg) >= 2:
            fast = min(avg, key=avg.get)
            insights.append({"icon": "bolt", "t": f"{fast} is your fastest chapter",
                             "d": f"You average {round(avg[fast])} minutes a topic here.", "a": "", "tone": "ok", "link": None})

    weeks = []
    mins = minutes_by_day(db, user, 28)
    for w in range(3, -1, -1):
        start = week_start - timedelta(days=7 * w)
        m = sum(v for d, v in mins.items() if start <= d < start + timedelta(days=7))
        weeks.append({"l": start.strftime("%-d %b"), "m": round(m), "v": dur_label(round(m)), "current": w == 0})

    return {
        "stats": [
            {"v": f"{overall}%", "l": "Overall progress", "s": f"Across {len(subs)} subjects"},
            {"v": dur_label(round(week_mins)), "l": "Learning time", "s": "This week"},
            {"v": str(res_done), "l": "Resources completed", "s": "This month"},
            {"v": str(notes_n), "l": "Notes generated", "s": "This month"},
            {"v": str(due), "l": "Revision due", "s": f"{overdue} overdue" if overdue else "None overdue"},
        ],
        "subjects": [{"id": str(s.id), "name": s.name, "icon": s.icon, "tone": s.tone, "pct": p["pct"]} for s, p in sp],
        "heatmap": heat, "insights": insights[:3], "weeks": weeks,
    }


@router.get("/progress/topics/{tid}/curve")
def forgetting_curve(tid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    """Predicted recall over 28 days from the FSRS card, with past review points."""
    from app.models import MasteryEvent

    t = get_or_404(db, Topic, tid, "topic")
    m = db.get(Mastery, (user.id, t.id))
    evs = list(db.scalars(select(MasteryEvent).where(MasteryEvent.user_id == user.id, MasteryEvent.topic_id == t.id)
                          .order_by(MasteryEvent.created_at)))
    if not m or not m.fsrs or not evs:
        return {"topic": t.name, "points": [], "reviews": [], "today": 0, "next": None}
    start = evs[0].created_at
    stab = float(m.fsrs.get("stability") or 1.0)
    reviews = [(e.created_at - start).total_seconds() / 86400 for e in evs]
    pts = []
    for i in range(0, 113):
        d = i / 4
        last = max([r for r in reviews if r <= d] or [0])
        # FSRS forgetting curve R(t) = (1 + F * t / S) ^ C with F = 19/81, C = -0.5
        r = (1 + (19 / 81) * (d - last) / max(stab, 0.1)) ** -0.5
        pts.append([round(d, 2), round(r, 3)])
    today = (now() - start).total_seconds() / 86400
    nxt = (m.next_review_at - start).total_seconds() / 86400 if m.next_review_at else None
    return {"topic": t.name, "points": pts, "reviews": [round(r, 2) for r in reviews], "today": round(today, 2),
            "next": round(nxt, 2) if nxt else None}
