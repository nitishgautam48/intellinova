"""Exam-date study schedule (problem statement 6c).

Given an exam date, minutes a day and a scope (subjects or chapters), lays out every day up to the exam:

* topics not yet learned are taught in course order (so prerequisites come first), each followed by a
  practice session the next day and spaced reviews ~3 and ~7 days later;
* weak and developing topics (BKT mastery) get targeted practice, weakest first, interleaved with new
  learning so no day is all new material;
* topics already mastered are reviewed on the day FSRS predicts their recall drops to 90% (the card's
  stability), so they don't fade before the exam;
* the last few study days are a final-revision window ranked by predicted recall on exam day, ending
  with a mixed mock test.

The plan is rebuilt from the learner model every day (and whenever settings change), so missed work rolls
forward and finished work drops out."""
import bisect
import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Chapter, Mastery, MasteryEvent, StudySchedule, Subject, Topic, TopicProgress
from app.services import learner

PRACTICE_MIN = {"weak": 20, "developing": 15, "check": 10, "after": 15}
REVIEW_MIN = 10
FINAL_CHUNK = 15
MOCK_MIN = 30
KIND_TONE = {"learn": "pri", "practice": "err", "review": "warn", "mock": "teal"}


def _at(d: date) -> datetime:
    return datetime.combine(d, time(9), tzinfo=timezone.utc)


def scope_topics(db: Session, sch: StudySchedule) -> list[Topic]:
    q = (select(Topic).join(Chapter).join(Subject)
         .where(Chapter.subject_id.in_(sch.subject_ids or []), Chapter.published.is_(True), Chapter.disabled.is_(False),
                Topic.published.is_(True)))
    if sch.chapter_ids:
        q = q.where(Chapter.id.in_(sch.chapter_ids))
    return list(db.scalars(q.order_by(Subject.position, Chapter.position, Topic.position)))


def _item(kind: str, t: Topic, minutes: int, why: str) -> dict:
    ch = t.chapter
    return {"kind": kind, "topic_id": str(t.id), "name": t.name, "subject": ch.subject.name, "chapter": ch.name,
            "chapter_id": str(ch.id), "minutes": int(minutes), "why": why}


def build(db: Session, sch: StudySchedule, today: date | None = None) -> dict:
    today = today or date.today()
    uid = sch.user_id
    topics = scope_topics(db, sch)
    ids = [t.id for t in topics]
    done = set(db.scalars(select(TopicProgress.topic_id).where(TopicProgress.user_id == uid, TopicProgress.topic_id.in_(ids)))) if ids else set()
    mast = {m.topic_id: m for m in db.scalars(select(Mastery).where(Mastery.user_id == uid, Mastery.topic_id.in_(ids)))} if ids else {}
    exam_at = _at(sch.exam_date)

    calendar = [today + timedelta(days=i) for i in range(max(0, (sch.exam_date - today).days))]
    study = [d for d in calendar if d.weekday() not in (sch.rest_days or [])] or calendar
    n = len(study)
    k = 0 if n < 4 else min(5, max(1, round(n * 0.15)))
    main, final = study[: n - k], study[n - k:]

    # Per-topic state and forgetting-curve projection to exam day.
    risk: dict[uuid.UUID, float] = {}
    projected: list[dict] = []
    learn_q: list[dict] = []
    weak_q: list[tuple[float, dict]] = []
    fixed: list[tuple[date, dict]] = []
    for t in topics:
        m = mast.get(t.id)
        seen = bool(m and m.n_obs)
        if seen:  # forgetting-curve projection for anything with quiz/tutor evidence, finished or not
            r_exam = learner.recall_at(m, exam_at)
            projected.append({"topic_id": str(t.id), "name": t.name, "p": round(m.p, 2), "status": learner.status_of(m.p),
                              "recall_now": round(learner.recall(m), 2), "recall_exam": round(r_exam, 2)})
        if t.id not in done:
            why = f"Not finished yet · {learner.status_of(m.p).lower()} ({m.p:.2f})" if seen else "New topic, in course order"
            learn_q.append(_item("learn", t, t.est_minutes, why))
            risk[t.id] = 1.0
            continue
        if not seen:
            weak_q.append((0.6, _item("practice", t, PRACTICE_MIN["check"], "Quick check: no quiz on this yet")))
            risk[t.id] = 0.6
            continue
        risk[t.id] = max(1 - m.p, 1 - r_exam)
        if m.p < 0.5:
            weak_q.append((m.p, _item("practice", t, PRACTICE_MIN["weak"], f"Weak: mastery {m.p:.2f}")))
        elif m.p < 0.8:
            weak_q.append((m.p, _item("practice", t, PRACTICE_MIN["developing"], f"Developing: mastery {m.p:.2f}")))
        elif r_exam < 0.9:
            last = m.fsrs.get("last_review") if m.fsrs else None
            base = datetime.fromisoformat(last).date() if last else today
            due = max(today, base + timedelta(days=max(1, round(learner.stability(m)))))
            fixed.append((due, _item("review", t, REVIEW_MIN, f"Recall falls to 90% around {due.strftime('%-d %b')}")))
    weak_q.sort(key=lambda x: x[0])
    weak = [x for _, x in weak_q]

    # Fill the main study days.
    days: dict[date, list[dict]] = defaultdict(list)
    pending: dict[int, list[dict]] = defaultdict(list)
    cap = sch.minutes_per_day

    def idx_on_or_after(d: date) -> int | None:
        i = bisect.bisect_left(main, d)
        return i if i < len(main) else None

    for due, it in fixed:
        i = idx_on_or_after(due)
        if i is not None:
            pending[i].append(it)

    carry: list[dict] = []
    for i, d in enumerate(main):
        left = cap
        placed = days[d]
        queue, carry = carry + pending.pop(i, []), []
        for it in queue:  # follow-ups first; whatever doesn't fit rolls to the next day
            if it["minutes"] <= left or not placed:
                placed.append(it)
                left -= it["minutes"]
            else:
                carry.append(it)
        turn = 0
        while (learn_q or weak) and left >= 10:
            q = weak if (weak and (turn % 2 == 1 or not learn_q)) else learn_q
            it = q[0]
            if it["minutes"] > left and placed:
                break
            q.pop(0)
            placed.append(it)
            left -= it["minutes"]
            turn += 1
            t_id = it["topic_id"]
            t = next(x for x in topics if str(x.id) == t_id)
            if it["kind"] == "learn":
                if i + 1 < len(main):
                    pending[i + 1].append(_item("practice", t, PRACTICE_MIN["after"], f"Practice what you learned on {d.strftime('%a')}"))
                for gap in (3, 7):
                    j = idx_on_or_after(d + timedelta(days=gap))
                    if j is not None and j > i + 1:
                        pending[j].append(_item("review", t, REVIEW_MIN, f"Spaced review, {gap} days after learning"))
            elif it["kind"] == "practice" and it["why"].startswith(("Weak", "Developing")):
                j = idx_on_or_after(d + timedelta(days=3))
                if j is not None:
                    pending[j].append(_item("review", t, REVIEW_MIN, "Follow-up review of a weak topic"))
    overflow = learn_q + weak + carry + [it for i in sorted(pending) for it in pending[i]]
    main_minutes = sum(it["minutes"] for d in main for it in days[d]) + sum(it["minutes"] for it in overflow)

    # Final revision window: topics ranked by predicted recall on exam day, then a mock test.
    ranked = sorted(topics, key=lambda t: -risk.get(t.id, 0.5))
    ri = 0
    for fi, d in enumerate(final):
        left = cap
        if fi == len(final) - 1 and cap >= MOCK_MIN + FINAL_CHUNK and topics:
            days[d].append({"kind": "mock", "topic_id": "", "name": "Mixed mock test", "subject": ", ".join(sorted({t.chapter.subject.name for t in topics})),
                            "chapter": "", "chapter_id": "", "minutes": MOCK_MIN, "why": "Exam conditions, all topics",
                            "topic_ids": [str(t.id) for t in ranked[:12]]})
            left -= MOCK_MIN
        while left >= FINAL_CHUNK and ranked and ri < len(ranked) * 2:
            t = ranked[ri % len(ranked)]
            ri += 1
            days[d].append(_item("review", t, FINAL_CHUNK, "Final revision: " + ("lowest predicted recall" if ri <= len(ranked) else "second pass")))
            left -= FINAL_CHUNK

    out_days = []
    for d in study:
        items = days.get(d, [])
        seen: set[str] = set()
        for it in items:
            key = f"{d.isoformat()}:{it['kind']}:{it['topic_id']}"
            while key in seen:
                key += "+"
            seen.add(key)
            it["key"] = key
            it["tone"] = KIND_TONE[it["kind"]]
        out_days.append({"date": d.isoformat(), "final": d in final, "minutes": sum(it["minutes"] for it in items), "items": items})

    needed = round(main_minutes / len(main)) if main else 0
    projected.sort(key=lambda x: x["recall_exam"])
    return {
        "days": out_days,
        "summary": {
            "topics": len(topics), "to_learn": len([t for t in topics if t.id not in done]),
            "to_fix": len(weak_q), "reviews": sum(1 for d in out_days for it in d["items"] if it["kind"] == "review"),
            "study_days": n, "final_from": final[0].isoformat() if final else None,
            "fits": not overflow, "unscheduled": len(overflow), "needed_per_day": max(needed, 0),
        },
        "forgetting": projected[:8],
    }


def completed_keys(db: Session, sch: StudySchedule, plan: dict) -> set[str]:
    """Items done either by ticking them or by doing the work (finishing the topic, answering a quiz)."""
    keys = set(sch.done or [])
    days = {d["date"]: d for d in plan.get("days", [])}
    if not days:
        return keys
    first = min(days)
    since = _at(date.fromisoformat(first)) - timedelta(hours=9)
    prog = {(str(t), c.date().isoformat()) for t, c in db.execute(select(TopicProgress.topic_id, TopicProgress.completed_at)
                                                                     .where(TopicProgress.user_id == sch.user_id, TopicProgress.completed_at >= since))}
    evs = {(str(t), c.date().isoformat()) for t, c in db.execute(select(MasteryEvent.topic_id, MasteryEvent.created_at)
                                                                    .where(MasteryEvent.user_id == sch.user_id, MasteryEvent.created_at >= since,
                                                                           MasteryEvent.source.in_(("quiz", "revision"))))}
    for ds, d in days.items():
        for it in d["items"]:
            if it["kind"] == "learn" and (it["topic_id"], ds) in prog:
                keys.add(it["key"])
            elif it["kind"] in ("practice", "review") and (it["topic_id"], ds) in evs:
                keys.add(it["key"])
            elif it["kind"] == "mock" and any((x, ds) in evs for x in it.get("topic_ids", [])):
                keys.add(it["key"])
    return keys


def ensure_current(db: Session, sch: StudySchedule, force: bool = False) -> StudySchedule:
    today = date.today()
    if force or sch.built_on != today or not sch.plan:
        # Keep today's ticks when rebuilding mid-day; older ticks belong to days no longer in the plan.
        sch.plan = build(db, sch, today)
        sch.done = [k for k in (sch.done or []) if k.startswith(today.isoformat())]
        sch.built_on = today
        db.commit()
    return sch


def today_items(db: Session, user_id: uuid.UUID) -> tuple[StudySchedule, list[dict]] | None:
    sch = db.get(StudySchedule, user_id)
    if not sch or sch.exam_date <= date.today():
        return None
    ensure_current(db, sch)
    d = next((x for x in sch.plan.get("days", []) if x["date"] == date.today().isoformat()), None)
    return sch, (d["items"] if d else [])
