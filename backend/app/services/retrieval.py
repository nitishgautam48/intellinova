"""Hybrid retrieval over source-linked chunks: pgvector similarity + Postgres
full-text, merged with reciprocal-rank fusion, then re-ranked by a small multilingual
cross-encoder (RERANK_MODEL; empty turns it off)."""
import logging
import threading
import time
import uuid
from dataclasses import dataclass

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import ContentUnit, KbSource, User
from app.services import embeddings

log = logging.getLogger(__name__)

READY = ("Ready", "Needs Review")
_reranker = None
_reranker_lock = threading.Lock()
_reranker_failed_at = 0.0


def rerank_scores(query: str, texts: list[str]) -> list[float] | None:
    """Cross-encoder relevance scores, or None when re-ranking is off or unavailable. A failed load
    (e.g. no internet for the first download) is retried after 10 minutes, not on every question."""
    global _reranker, _reranker_failed_at
    model = settings.rerank_model.strip()
    if not model or not texts or time.time() - _reranker_failed_at < 600:
        return None
    try:
        with _reranker_lock:
            if _reranker is None:
                from sentence_transformers import CrossEncoder

                _reranker = CrossEncoder(model, device="cpu", max_length=512)
        return [float(x) for x in _reranker.predict([(query, t[:1500]) for t in texts])]
    except Exception as ex:  # noqa: BLE001
        _reranker_failed_at = time.time()
        log.warning("Re-ranking skipped: %s", ex)
        return None


@dataclass
class Hit:
    unit: ContentUnit
    source: KbSource
    sim: float
    score: float


def visible_sources_clause(user: User | None):
    """Admin knowledge base for everyone, plus the student's own uploads."""
    conds = [(KbSource.origin == "admin") & KbSource.status.in_(READY)]
    if user is not None:
        conds.append((KbSource.owner_id == user.id) & KbSource.status.in_(READY))
    return or_(*conds)


def search(
    db: Session,
    query: str,
    user: User | None,
    k: int | None = None,
    subject_id: uuid.UUID | None = None,
    topic_ids: list[uuid.UUID] | None = None,
    source_ids: list[uuid.UUID] | None = None,
) -> list[Hit]:
    k = k or settings.retrieval_k
    qv = embeddings.embed_one(query, "query")
    base = select(ContentUnit, KbSource).join(KbSource, ContentUnit.source_id == KbSource.id)
    if source_ids:
        base = base.where(ContentUnit.source_id.in_(source_ids))
    else:
        base = base.where(visible_sources_clause(user))
    if subject_id:
        base = base.where(or_(KbSource.subject_id == subject_id, KbSource.subject_id.is_(None)))
    if topic_ids:
        base = base.where(or_(ContentUnit.topic_id.in_(topic_ids), ContentUnit.prereq_topic_ids.overlap(topic_ids)))

    dist = ContentUnit.embedding.cosine_distance(qv)
    vec_rows = db.execute(base.add_columns(dist.label("d")).where(ContentUnit.embedding.is_not(None))
                          .order_by(dist).limit(30)).all()
    tsq = func.plainto_tsquery("simple", query)
    tsv = func.to_tsvector("simple", ContentUnit.text)
    rank = func.ts_rank(tsv, tsq)
    kw_rows = db.execute(base.add_columns(rank.label("r")).where(tsv.op("@@")(tsq)).order_by(rank.desc()).limit(30)).all()

    fused: dict[uuid.UUID, dict] = {}
    for r, (u, s, d) in enumerate(vec_rows):
        e = fused.setdefault(u.id, {"u": u, "s": s, "sim": 1 - float(d), "score": 0.0})
        e["score"] += 1 / (60 + r)
    for r, (u, s, _rk) in enumerate(kw_rows):
        e = fused.setdefault(u.id, {"u": u, "s": s, "sim": None, "score": 0.0})
        e["score"] += 1 / (60 + r)
    for e in fused.values():
        if e["sim"] is None and e["u"].embedding is not None:
            e["sim"] = embeddings.cosine(qv, list(e["u"].embedding))
        e["sim"] = e["sim"] or 0.0
    hits = sorted(fused.values(), key=lambda e: -e["score"])[: max(k * 3, 12)]

    scores = rerank_scores(query, [e["u"].text for e in hits])
    if scores is not None:
        for e, sc in zip(hits, scores):
            e["score"] = sc
        hits.sort(key=lambda e: -e["score"])
    return [Hit(e["u"], e["s"], e["sim"], e["score"]) for e in hits[:k]]


SRC_TYPE = {"textbook": ("Textbook", "menu_book"), "slides": ("Class slides", "slideshow"),
            "video": ("Lecture video", "smart_display"), "text": ("Your notes", "description")}


def citation(n: int, hit: Hit) -> dict:
    u, s = hit.unit, hit.source
    stype, icon = SRC_TYPE.get(s.kind, ("Source", "description"))
    return {
        "n": n,
        "unit_id": str(u.id),
        "source_id": str(s.id),
        "source_title": s.title,
        "source_type": stype,
        "icon": icon,
        "kind": {"Transcript": "transcript", "Slide": "slide", "Diagram": "diagram"}.get(u.kind, "page"),
        "location": u.location,
        "excerpt": _excerpt(u.text),
    }


def _excerpt(t: str, n: int = 180) -> str:
    t = " ".join(t.split())
    return t if len(t) <= n else t[: n - 1].rsplit(" ", 1)[0] + "…"
