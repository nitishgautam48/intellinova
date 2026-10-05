import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ActivityEvent, ContentUnit, User


def now() -> datetime:
    return datetime.now(timezone.utc)


def parse_uuid(s: str | uuid.UUID | None, what: str = "item") -> uuid.UUID:
    if isinstance(s, uuid.UUID):
        return s
    try:
        return uuid.UUID(str(s))
    except (ValueError, TypeError) as e:
        raise HTTPException(404, f"{what.capitalize()} not found") from e


def get_or_404(db: Session, model, id_, what: str = "item"):
    obj = db.get(model, parse_uuid(id_, what) if not isinstance(id_, tuple) else id_)
    if obj is None:
        raise HTTPException(404, f"{what.capitalize()} not found")
    return obj


def rel_time(dt: datetime | None) -> str:
    if not dt:
        return "—"
    d = now() - dt
    if d < timedelta(minutes=1):
        return "just now"
    if d < timedelta(hours=1):
        return f"{int(d.total_seconds() // 60)} min ago"
    if d < timedelta(days=1) and dt.date() == now().date():
        return f"{int(d.total_seconds() // 3600)} h ago"
    days = (now().date() - dt.date()).days
    if days == 0:
        return "Today"
    if days == 1:
        return "Yesterday"
    if days < 7:
        return f"{days} d ago"
    if days < 30:
        return f"{days // 7} w ago"
    if days < 365:
        return f"{days // 30} mo ago"
    return f"{days // 365} y ago"


def until(dt: datetime | None) -> str:
    if not dt:
        return "—"
    days = (dt.date() - now().date()).days
    if days <= 0:
        return "today" if dt.date() >= now().date() else "overdue"
    if days == 1:
        return "tomorrow"
    return f"in {days} days"


def fmt_date(dt: datetime | None) -> str:
    return dt.strftime("%-d %b %Y") if dt else "—"


def fact_status(verified_at: datetime | None, source: str) -> str:
    """Verified within 12 months with a source -> Verified; older -> May be outdated; no source -> Unverified."""
    if not source or not verified_at:
        return "Unverified"
    if now() - verified_at > timedelta(days=365):
        return "May be outdated"
    return "Verified"


def class_num(s: str) -> str:
    return re.sub(r"\D", "", s or "") or s


def norm_class(s: str | None) -> str:
    """Canonical class level so admin-entered and student-picked values match:
    "10", "class 10", "Grade 10", "10th" -> "Class 10". Other labels ("Starting college") are kept."""
    s = " ".join((s or "").split())
    m = re.fullmatch(r"(?i)(?:class|grade|std\.?|standard)?\s*(\d{1,2})(?:st|nd|rd|th)?", s)
    return f"Class {int(m.group(1))}" if m else s


def track(db: Session, user: User | None, kind: str, ref_id=None, module: str = "", minutes: float = 0.0, **meta) -> None:
    db.add(ActivityEvent(user_id=user.id if user else None, kind=kind, ref_id=ref_id, module=module,
                         minutes=minutes, meta=meta))


def dur_label(minutes: int) -> str:
    h, m = divmod(int(minutes), 60)
    return f"{h} h {m:02d} m" if h else f"{m} min"


def subtopics_by_topic(db: Session, topic_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    """Subtopics found in tagged material, most-covered first (the outline under each topic)."""
    if not topic_ids:
        return {}
    rows = db.execute(select(ContentUnit.topic_id, ContentUnit.subtopic, func.count(), func.min(ContentUnit.position))
                      .where(ContentUnit.topic_id.in_(topic_ids), ContentUnit.subtopic != "")
                      .group_by(ContentUnit.topic_id, ContentUnit.subtopic)).all()
    out: dict[uuid.UUID, list[tuple[int, int, str]]] = {}
    for tid, name, n, pos in rows:
        out.setdefault(tid, []).append((-n, pos or 0, name))
    return {tid: [n for *_, n in sorted(v)][:10] for tid, v in out.items()}
