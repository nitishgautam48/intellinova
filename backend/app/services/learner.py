"""Learner model (architecture v4, page 4): per-topic mastery with Bayesian
Knowledge Tracing, review timing with FSRS (py-fsrs), difficulty targeting with
a simple IRT-style ability estimate.

BKT parameters default to textbook values; `fit_bkt_params` refits them from
the logged evidence with pyBKT when it is installed (weekly Celery task)."""
import logging
import math
import uuid
from datetime import datetime, timezone

from fsrs import Card, Rating, Scheduler
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppSetting, Mastery, MasteryEvent

log = logging.getLogger(__name__)

P_INIT = 0.25
P_TRANSIT = 0.12
P_SLIP = 0.10
GUESS = {"MCQ": 0.25, "Numerical": 0.05, "Short answer": 0.10, "chat": 0.2}
_scheduler = Scheduler(desired_retention=0.9, enable_fuzzing=False)


def status_of(p: float) -> str:
    return "Mastered" if p >= 0.8 else "Developing" if p >= 0.5 else "Weak"


def params(db: Session, topic_id: uuid.UUID) -> dict:
    s = db.get(AppSetting, "bkt_params")
    if s and str(topic_id) in (s.value or {}):
        return s.value[str(topic_id)]
    return {"init": P_INIT, "transit": P_TRANSIT, "slip": P_SLIP}


def get(db: Session, user_id: uuid.UUID, topic_id: uuid.UUID) -> Mastery:
    m = db.get(Mastery, (user_id, topic_id))
    if m is None:
        m = Mastery(user_id=user_id, topic_id=topic_id, p=params(db, topic_id)["init"], uncertainty=0.25, n_obs=0)
        db.add(m)
        db.flush()
    return m


def bkt_update(p: float, credit: float, slip: float, guess: float, transit: float) -> float:
    post_c = p * (1 - slip) / (p * (1 - slip) + (1 - p) * guess)
    post_w = p * slip / (p * slip + (1 - p) * (1 - guess))
    post = credit * post_c + (1 - credit) * post_w
    return min(0.99, max(0.01, post + (1 - post) * transit))


def update(db: Session, user_id: uuid.UUID, topic_id: uuid.UUID, credit: float, source: str,
           qtype: str = "MCQ", evidence: str = "", weight: float = 1.0) -> tuple[float, float]:
    """Applies one piece of evidence. `weight` < 1 for softer signals (tutor chat)."""
    m = get(db, user_id, topic_id)
    pr = params(db, topic_id)
    before = m.p
    after = bkt_update(before, credit, pr["slip"], GUESS.get(qtype, 0.2), pr["transit"])
    after = before + (after - before) * weight
    m.p = after
    m.n_obs += 1
    m.uncertainty = math.sqrt(after * (1 - after) / (m.n_obs + 2))
    now = datetime.now(timezone.utc)
    m.last_evidence = evidence[:200]
    m.last_evidence_at = now

    card = Card.from_dict(m.fsrs) if m.fsrs else Card()
    rating = Rating.Again if credit < 0.34 else Rating.Hard if credit < 0.8 else (
        Rating.Easy if after >= 0.9 else Rating.Good)
    card, _ = _scheduler.review_card(card, rating, review_datetime=now)
    m.fsrs = card.to_dict()
    m.next_review_at = card.due
    db.add(MasteryEvent(user_id=user_id, topic_id=topic_id, source=source, correct=credit,
                        p_before=before, p_after=after))
    return before, after


def recall(m: Mastery) -> float:
    """FSRS-predicted chance of recalling the topic right now."""
    if not m.fsrs:
        return m.p
    try:
        return float(_scheduler.get_card_retrievability(Card.from_dict(m.fsrs)))
    except Exception:  # noqa: BLE001
        return m.p


def recall_at(m: Mastery, when: datetime) -> float:
    """FSRS-predicted recall at a future moment if the topic is not reviewed before then."""
    if not m.fsrs:
        return m.p
    try:
        return float(_scheduler.get_card_retrievability(Card.from_dict(m.fsrs), current_datetime=when))
    except Exception:  # noqa: BLE001
        return m.p


def stability(m: Mastery) -> float:
    """Days until predicted recall falls to 90% after a review (the FSRS stability)."""
    return float((m.fsrs or {}).get("stability") or 1.0)


def target_difficulty(p: float) -> str:
    """Aim for about a 70% chance of success (IRT-style: b ≈ θ − logit(0.7))."""
    theta = math.log(max(p, 0.01) / max(1 - p, 0.01))
    b = theta - math.log(0.7 / 0.3)
    return "Easy" if b < -0.6 else "Hard" if b > 0.6 else "Medium"


def update_item_difficulty(q, correct: bool, p_student: float, lr: float = 0.05) -> None:
    """Online Rasch/Elo update of question difficulty from real answers."""
    theta = math.log(max(p_student, 0.01) / max(1 - p_student, 0.01))
    expected = 1 / (1 + math.exp(-(theta - q.irt_b)))
    q.irt_b += lr * (expected - (1.0 if correct else 0.0))


def fit_bkt_params(db: Session) -> int:
    """Refit BKT parameters per topic from logged evidence using pyBKT (optional)."""
    try:
        import pandas as pd
        from pyBKT.models import Model
    except ImportError:
        log.info("pyBKT not installed; keeping default BKT parameters")
        return 0
    rows = db.execute(select(MasteryEvent.user_id, MasteryEvent.topic_id, MasteryEvent.correct,
                             MasteryEvent.created_at).where(MasteryEvent.source.in_(("quiz", "diagnostic")))
                      .order_by(MasteryEvent.created_at)).all()
    if len(rows) < 200:
        return 0
    df = pd.DataFrame([{"user_id": str(u), "skill_name": str(t), "correct": int(c >= 0.5), "order_id": i}
                       for i, (u, t, c, _) in enumerate(rows)])
    counts = df.groupby("skill_name").size()
    df = df[df.skill_name.isin(counts[counts >= 50].index)]
    if df.empty:
        return 0
    model = Model(seed=7, num_fits=3)
    model.fit(data=df)
    fitted = model.params().reset_index()
    out: dict[str, dict] = {}
    for skill, grp in fitted.groupby("skill"):
        vals = {r["param"]: float(r["value"]) for _, r in grp.iterrows()}
        out[skill] = {"init": vals.get("prior", P_INIT), "transit": vals.get("learns", P_TRANSIT),
                      "slip": vals.get("slips", P_SLIP)}
    s = db.get(AppSetting, "bkt_params") or AppSetting(key="bkt_params", value={})
    s.value = {**(s.value or {}), **out}
    db.merge(s)
    db.commit()
    return len(out)
