"""Quiz lifecycle: prepare the question pool, pick each next question
adaptively from the learner model, grade answers, feed the learner model and
build the post-assessment report."""
import logging
import math
import random
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ActivityEvent, ContentUnit, KbSource, Mastery, Question, Quiz, QuizItem, Topic
from app.services import grading, learner, questions, retrieval
from app.services.llm import LLMError

log = logging.getLogger(__name__)
HARDER = {"Easy": "Medium", "Medium": "Hard", "Hard": "Hard"}
EASIER = {"Hard": "Medium", "Medium": "Easy", "Easy": "Easy"}


def _seen(db: Session, user_id: uuid.UUID) -> set[uuid.UUID]:
    return set(db.scalars(select(QuizItem.question_id).join(Quiz).where(Quiz.user_id == user_id)))


def prepare(db: Session, quiz_id: uuid.UUID) -> Quiz:
    quiz = db.get(Quiz, quiz_id)
    try:
        seen = _seen(db, quiz.user_id)
        per_topic = max(2, math.ceil(quiz.n / max(len(quiz.topic_ids), 1)) + 1)
        problems = []
        for tid in quiz.topic_ids:
            have = db.scalar(select(func.count()).select_from(Question).where(
                Question.topic_id == tid, Question.status == "verified", Question.qtype.in_(quiz.types),
                Question.id.not_in(seen) if seen else True)) or 0
            if have < per_topic:
                t = db.get(Topic, tid)
                try:
                    questions.generate(db, t, per_topic - have, quiz.types)
                except questions.NoMaterial as e:
                    problems.append(str(e))
                except LLMError as e:
                    problems.append(str(e))
        total = questions.pool(db, quiz.topic_ids, quiz.types)
        if total == 0:
            quiz.status = "failed"
            quiz.error = problems[0] if problems else "No questions could be prepared for these topics yet."
            db.commit()
            return quiz
        quiz.status = "active"
        quiz.started_at = datetime.now(timezone.utc)
        if quiz.mode == "Mock exam":
            quiz.time_limit_s = quiz.n * 90
            diffs = ["Easy", "Medium", "Medium", "Hard"]
            for i in range(quiz.n):
                if not _add_item(db, quiz, i, diffs[i % len(diffs)]):
                    break
        else:
            _add_next(db, quiz)
        if not quiz.items:
            quiz.status, quiz.error = "failed", "No questions could be prepared for these topics yet."
        db.commit()
        return quiz
    except Exception as e:  # noqa: BLE001
        db.rollback()
        quiz = db.get(Quiz, quiz_id)
        quiz.status, quiz.error = "failed", str(e)[:500]
        db.commit()
        log.exception("Quiz %s preparation failed", quiz_id)
        return quiz


def _topic_order(db: Session, quiz: Quiz) -> list[uuid.UUID]:
    counts = {t: 0 for t in quiz.topic_ids}
    for it in quiz.items:
        q = db.get(Question, it.question_id)
        if q and q.topic_id in counts:
            counts[q.topic_id] += 1
    mast = {t: (db.get(Mastery, (quiz.user_id, t)).p if db.get(Mastery, (quiz.user_id, t)) else learner.P_INIT)
            for t in quiz.topic_ids}
    return sorted(quiz.topic_ids, key=lambda t: (counts[t], mast[t]))


def _pick(db: Session, quiz: Quiz, topic_id: uuid.UUID, diff: str, used: set[uuid.UUID], seen: set[uuid.UUID]) -> Question | None:
    base = select(Question).where(Question.topic_id == topic_id, Question.status == "verified",
                                  Question.qtype.in_(quiz.types), Question.id.not_in(used) if used else True)
    for cond in ((Question.difficulty == diff, True), (True, True), (True, False)):
        q = base.where(cond[0])
        if cond[1] and seen:
            q = q.where(Question.id.not_in(seen))
        rows = list(db.scalars(q.order_by(Question.times_served, func.random()).limit(5)))
        if rows:
            return random.choice(rows[:3])
    return None


def _add_item(db: Session, quiz: Quiz, pos: int, diff: str | None = None) -> QuizItem | None:
    used = {it.question_id for it in quiz.items}
    seen = _seen(db, quiz.user_id)
    for tid in _topic_order(db, quiz):
        m = db.get(Mastery, (quiz.user_id, tid))
        p = m.p if m else learner.P_INIT
        d = diff or (learner.target_difficulty(p) if quiz.difficulty_mode == "Adaptive" else quiz.difficulty_mode)
        q = _pick(db, quiz, tid, d, used, seen)
        if q:
            q.times_served += 1
            item = QuizItem(quiz_id=quiz.id, position=pos, question_id=q.id)
            quiz.items.append(item)
            db.flush()
            return item
    return None


def _add_next(db: Session, quiz: Quiz) -> QuizItem | None:
    if len(quiz.items) >= quiz.n:
        return None
    diff = None
    if quiz.mode == "Diagnostic" and quiz.items:
        last = quiz.items[-1]
        lq = db.get(Question, last.question_id)
        diff = HARDER[lq.difficulty] if last.grade == "correct" else EASIER[lq.difficulty]
    elif quiz.mode == "Diagnostic":
        diff = "Medium"
    return _add_item(db, quiz, len(quiz.items), diff)


def answer(db: Session, quiz: Quiz, item: QuizItem, response: str) -> QuizItem:
    q = db.get(Question, item.question_id)
    res = grading.grade(q, response)
    item.response = response
    item.grade = res["grade"]
    item.rubric_hits = res["rubric_hits"]
    item.misconception = res["misconception"]
    item.answered_at = datetime.now(timezone.utc)
    source = "diagnostic" if quiz.mode == "Diagnostic" else "quiz"
    label = f"{'Diagnostic' if source == 'diagnostic' else quiz.title} · {datetime.now().strftime('%d %b')}"
    before, after = learner.update(db, quiz.user_id, q.topic_id, res["credit"], source, q.qtype, label)
    learner.update_item_difficulty(q, res["grade"] == "correct", before)
    item.mastery_before, item.mastery_after = before, after
    db.add(ActivityEvent(user_id=quiz.user_id, kind="quiz_answer", ref_id=q.id, module="practice",
                         meta={"grade": res["grade"], "topic_id": str(q.topic_id)}))
    if quiz.mode != "Mock exam":
        _add_next(db, quiz)
    db.commit()
    return item


def finish(db: Session, quiz: Quiz) -> Quiz:
    if quiz.status != "completed":
        quiz.status = "completed"
        quiz.finished_at = datetime.now(timezone.utc)
        mins = (quiz.finished_at - (quiz.started_at or quiz.created_at)).total_seconds() / 60
        db.add(ActivityEvent(user_id=quiz.user_id, kind="quiz_completed", ref_id=quiz.id, module="practice",
                             minutes=round(min(mins, 180), 1)))
        # Items that were never shown/answered don't count.
        for it in list(quiz.items):
            if it.response is None and quiz.mode != "Mock exam":
                quiz.items.remove(it)
                db.delete(it)
        for it in quiz.items:
            if it.response is None:  # unanswered in a mock exam counts as wrong
                q = db.get(Question, it.question_id)
                before, after = learner.update(db, quiz.user_id, q.topic_id, 0.0, "quiz", q.qtype, quiz.title)
                it.grade, it.mastery_before, it.mastery_after = "wrong", before, after
        quiz.summary = report(db, quiz)
        db.commit()
    return quiz


def item_view(db: Session, item: QuizItem, reveal: bool) -> dict:
    q = db.get(Question, item.question_id)
    t = db.get(Topic, q.topic_id)
    unit = db.get(ContentUnit, q.unit_id) if q.unit_id else None
    src = db.get(KbSource, unit.source_id) if unit else None
    stype, icon = retrieval.SRC_TYPE.get(src.kind, ("Source", "description")) if src else ("", "description")
    out = {
        "id": str(item.id), "position": item.position, "type": q.qtype, "topic": t.name if t else "",
        "topic_id": str(q.topic_id), "difficulty": q.difficulty, "question": q.stem,
        "options": q.options if q.qtype == "MCQ" else [], "unit": q.unit,
        "source": {"loc": unit.location if unit else "", "type": stype, "icon": icon,
                   "unit_id": str(unit.id) if unit else None, "title": src.title if src else ""},
        "response": item.response, "answered": item.response is not None,
    }
    if reveal and item.response is not None:
        out.update({
            "grade": item.grade, "answer": q.answer if q.qtype != "Short answer" else "",
            "explanation": q.explanation, "rubric": [{"t": r, "hit": bool(item.rubric_hits[i]) if i < len(item.rubric_hits) else False}
                                                     for i, r in enumerate(q.rubric or [])],
            "misconception": item.misconception, "mastery_before": item.mastery_before,
            "mastery_after": item.mastery_after,
        })
    return out


def report(db: Session, quiz: Quiz) -> dict:
    counts = {"correct": 0, "partial": 0, "wrong": 0}
    topics: dict[str, dict] = {}
    mis, review = [], []
    for it in quiz.items:
        if it.grade:
            counts[it.grade] += 1
        v = item_view(db, it, True)
        tid = v["topic_id"]
        if tid not in topics:
            topics[tid] = {"t": v["topic"], "b": it.mastery_before, "a": it.mastery_after}
        elif it.mastery_after is not None:
            topics[tid]["a"] = it.mastery_after
        if it.grade == "wrong" and it.misconception:
            mis.append({"t": it.misconception, "ev": f"Q{it.position + 1} · you answered {it.response}"
                        + (f" {v['unit']}" if v["unit"] and v["type"] == "Numerical" else ""),
                        "loc": v["source"]["loc"], "unit_id": v["source"]["unit_id"]})
        review.append({"n": f"Q{it.position + 1}", "grade": it.grade or "wrong", "t": v["question"], "topic": v["topic"],
                       "loc": v["source"]["loc"], "type": v["type"]})
    tl = [{**x, "b": x["b"] if x["b"] is not None else learner.P_INIT,
           "a": x["a"] if x["a"] is not None else learner.P_INIT} for x in topics.values()]
    return {"counts": counts, "total": len(quiz.items), "topics": tl,
            "weak": [{"t": x["t"], "m": x["a"]} for x in tl if x["a"] < 0.5],
            "misconceptions": mis, "review": review}
