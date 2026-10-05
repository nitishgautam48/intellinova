"""Study scheduling: the dashboard's "Today's plan" and the exam-prep strategy.
Both read the learner model (mastery + FSRS review dates) - architecture v4."""
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    Chapter,
    DailyTask,
    Exam,
    ExamTopic,
    Mastery,
    StudentExamTopic,
    StudentProfile,
    Subject,
    Topic,
    TopicProgress,
)

PRIO_W = {"High": 3, "Medium": 2, "Low": 1}
STATUS_SCORE = {"Not started": 0.0, "Learning": 0.4, "Revision due": 0.7, "Confident": 1.0}


def student_subjects(db: Session, prof: StudentProfile | None) -> list[Subject]:
    if not prof or not prof.subject_ids:
        return []
    subs = list(db.scalars(select(Subject).where(Subject.id.in_(prof.subject_ids)).order_by(Subject.position)))
    return subs


def subject_progress(db: Session, user_id: uuid.UUID, subj: Subject) -> dict:
    topics = list(db.scalars(select(Topic).join(Chapter).where(
        Chapter.subject_id == subj.id, Chapter.published.is_(True), Chapter.disabled.is_(False), Topic.published.is_(True))
        .order_by(Chapter.position, Topic.position)))
    done = set(db.scalars(select(TopicProgress.topic_id).where(TopicProgress.user_id == user_id,
                                                               TopicProgress.topic_id.in_([t.id for t in topics]))))
    nxt = next((t for t in topics if t.id not in done), None)
    return {"topics": topics, "done": done, "next": nxt,
            "pct": round(100 * len(done) / len(topics)) if topics else 0}


def current_chapter(db: Session, user_id: uuid.UUID, prof: StudentProfile | None) -> Chapter | None:
    last = db.execute(select(TopicProgress.topic_id).where(TopicProgress.user_id == user_id)
                      .order_by(TopicProgress.completed_at.desc()).limit(1)).scalar()
    if last:
        t = db.get(Topic, last)
        ch = t.chapter if t else None
        if ch:
            remaining = [x for x in ch.topics if x.published and not db.get(TopicProgress, (user_id, x.id))]
            if remaining:
                return ch
    for subj in student_subjects(db, prof):
        sp = subject_progress(db, user_id, subj)
        if sp["next"]:
            return sp["next"].chapter
    return None


def build_today(db: Session, user_id: uuid.UUID) -> list[DailyTask]:
    today = date.today()
    existing = list(db.scalars(select(DailyTask).where(DailyTask.user_id == user_id, DailyTask.day == today)
                               .order_by(DailyTask.position)))
    if existing:
        return existing
    # With an exam schedule, today's plan is that schedule's day (6c).
    from app.services import schedule

    sched = schedule.today_items(db, user_id)
    if sched and sched[1]:
        sch, items = sched
        left = (sch.exam_date - today).days
        why = f"{sch.title[:40]} in {left} day{'s' if left != 1 else ''}"
        rows = []
        for i, it in enumerate(items[:5]):
            link = ({"screen": "learn", "chapter_id": it["chapter_id"], "topic_id": it["topic_id"]} if it["kind"] == "learn"
                    else {"screen": "practice", "topic_ids": it.get("topic_ids") or [it["topic_id"]]})
            verb = {"learn": "Learn ", "practice": "Practice ", "review": "Revise ", "mock": ""}[it["kind"]]
            rows.append(DailyTask(user_id=user_id, day=today, position=i, title=f"{verb}{it['name']}"[:300],
                                  meta=f"{it['subject']} · {it['chapter']}".strip(" ·")[:300], dur_min=it["minutes"],
                                  why=why[:80], tone=it["tone"], link=link))
        db.add_all(rows)
        db.commit()
        return rows
    prof = db.get(StudentProfile, user_id)
    tasks: list[dict] = []
    ch = current_chapter(db, user_id, prof)
    if ch:
        nxt = next((t for t in ch.topics if t.published and not db.get(TopicProgress, (user_id, t.id))), None)
        if nxt:
            tasks.append({"title": f"Finish “{nxt.name}”", "meta": f"{ch.subject.name} · {ch.name}",
                          "dur_min": nxt.est_minutes + 5, "why": "Next in chapter", "tone": "pri",
                          "link": {"screen": "learn", "chapter_id": str(ch.id), "topic_id": str(nxt.id)}})
    now = datetime.now(timezone.utc)
    due = db.execute(select(Mastery, Topic).join(Topic, Mastery.topic_id == Topic.id)
                     .where(Mastery.user_id == user_id, Mastery.next_review_at <= now + timedelta(hours=12))
                     .order_by(Mastery.next_review_at).limit(2)).all()
    for m, t in due:
        tasks.append({"title": f"Revise {t.name}", "meta": f"{t.chapter.subject.name} · {t.chapter.name}",
                      "dur_min": 15, "why": "Revision due", "tone": "warn",
                      "link": {"screen": "practice", "topic_ids": [str(t.id)]}})
    weak = db.execute(select(Mastery, Topic).join(Topic, Mastery.topic_id == Topic.id)
                      .where(Mastery.user_id == user_id, Mastery.p < 0.5, Mastery.n_obs > 0)
                      .order_by(Mastery.p).limit(1)).first()
    if weak and all(weak[1].name not in x["title"] for x in tasks):
        m, t = weak
        tasks.append({"title": f"Practice {t.name}", "meta": f"{t.chapter.subject.name} · {t.chapter.name}",
                      "dur_min": 20, "why": "Needs attention", "tone": "err",
                      "link": {"screen": "practice", "topic_ids": [str(t.id)]}})
    subs = student_subjects(db, prof)
    if len(subs) > 1:
        prog = sorted(((subject_progress(db, user_id, s), s) for s in subs), key=lambda x: x[0]["pct"])
        sp, s = prog[0]
        if sp["next"] and (not ch or sp["next"].chapter_id != ch.id):
            tasks.append({"title": f"Read “{sp['next'].name}”", "meta": s.name, "dur_min": sp["next"].est_minutes,
                          "why": f"Keeps {s.name} on pace", "tone": "teal",
                          "link": {"screen": "learn", "chapter_id": str(sp["next"].chapter_id), "topic_id": str(sp["next"].id)}})
    rows = [DailyTask(user_id=user_id, day=today, position=i, **t) for i, t in enumerate(tasks[:4])]
    db.execute(delete(DailyTask).where(DailyTask.user_id == user_id, DailyTask.day < today - timedelta(days=14)))
    db.add_all(rows)
    db.commit()
    return rows


# --------------------------------------------------------------------------- exam prep


def exam_tree(db: Session, user_id: uuid.UUID, exam: Exam) -> list[dict]:
    status = dict(db.execute(select(StudentExamTopic.exam_topic_id, StudentExamTopic.status)
                             .where(StudentExamTopic.user_id == user_id)).all())
    out = []
    for s in exam.subjects:
        for u in s.units:
            tps = []
            for t in u.topics:
                st = status.get(t.id, "Not started")
                pre = db.get(ExamTopic, t.prereq_id) if t.prereq_id else None
                tps.append({"id": str(t.id), "name": t.name, "status": st, "prio": t.priority,
                            "prereq": pre.name if pre else "", "topic_id": str(t.topic_id) if t.topic_id else None})
            out.append({"id": str(u.id), "sub": s.name, "name": u.name, "topics": tps})
    return out


def pct(topics: list[dict]) -> int:
    return round(100 * sum(STATUS_SCORE.get(t["status"], 0) for t in topics) / len(topics)) if topics else 0


def strategy(tree: list[dict], hours: int) -> dict:
    need: dict[str, float] = defaultdict(float)
    todo: dict[str, list[dict]] = defaultdict(list)
    for u in tree:
        for t in u["topics"]:
            gap = 1 - STATUS_SCORE.get(t["status"], 0)
            need[u["sub"]] += gap * PRIO_W.get(t["prio"], 2)
            if t["status"] != "Confident":
                todo[u["sub"]].append({**t, "unit": u["name"]})
    total = sum(need.values()) or 1
    rev = 0.15
    alloc = [{"n": s, "f": round((1 - rev) * v / total, 3)} for s, v in sorted(need.items(), key=lambda x: -x[1])]
    alloc.append({"n": "Revision", "f": rev})
    alloc = [{**a, "h": round(hours * a["f"], 1)} for a in alloc if a["f"] > 0]
    per_day = round(hours * 60 / 6)
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    queue = {s: sorted(ts, key=lambda t: (-PRIO_W.get(t["prio"], 2), STATUS_SCORE.get(t["status"], 0)))
             for s, ts in todo.items()}
    week = []
    subs = [a["n"] for a in alloc if a["n"] != "Revision"]
    for i, d in enumerate(days):
        blocks = []
        if i == 5:
            blocks.append({"t": "Weekly review", "m": per_day, "tone": "warn"})
        else:
            for j, s in enumerate(subs[:2]):
                share = next(a["f"] for a in alloc if a["n"] == s)
                q = queue.get(s) or []
                t = q[(i + j) % len(q)] if q else None
                minutes = round(per_day * share / max(sum(a["f"] for a in alloc if a["n"] in subs[:2]), 0.01))
                blocks.append({"t": t["name"] if t else s, "m": minutes, "tone": "pri" if j == 0 else "teal"})
        week.append({"d": d, "blocks": blocks})
    plan_today = []
    for s in subs[:2]:
        for t in (queue.get(s) or [])[:2]:
            plan_today.append({"t": t["name"], "d": 25 if t["status"] == "Not started" else 15, "s": t["status"]})
    return {"alloc": alloc, "week": week, "today": plan_today[:3], "hours": hours}
