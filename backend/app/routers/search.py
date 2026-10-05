from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.config import settings
from app.models import Resource, ResourceTopic, SearchLog, StudentProfile, Topic, User, VideoDiscovery
from app.routers.common import class_num, get_or_404, norm_class, now, track
from app.routers.learn import resource_card
from app.security import student_user
from app.services import cache, discovery, resources, search
from app.services.search import uuid_or_none

router = APIRouter(prefix="/api/search", tags=["search"])


def _filters(prof: StudentProfile | None, board: str | None, class_level: str | None, subject: str | None,
             rtype: str | None, language: str | None, difficulty: str | None) -> dict:
    return {
        "board": board if board is not None else (prof.board if prof else None),
        "class_level": norm_class(class_level) if class_level is not None else (prof.class_level if prof else None),
        "subject": subject, "rtype": rtype, "languages": language, "difficulty": difficulty,
    }


@router.get("/home")
def search_home(user: User = Depends(student_user), db: Session = Depends(get_db)):
    prof = db.get(StudentProfile, user.id)
    recent = [q for (q,) in db.execute(select(SearchLog.query).where(SearchLog.user_id == user.id)
                                       .group_by(SearchLog.query).order_by(func.max(SearchLog.created_at).desc()).limit(5))]

    def trending():
        rows = db.execute(select(SearchLog.normalized, func.count().label("n")).where(
            SearchLog.created_at >= now() - timedelta(days=7), SearchLog.result_count > 0)
            .group_by(SearchLog.normalized).order_by(func.count().desc()).limit(6)).all()
        return [r[0] for r in rows]

    chips = []
    if prof:
        chips = [x for x in [f"Class {class_num(prof.class_level)}" if prof.class_level else "", prof.board,
                             " + ".join(prof.languages[:2]) if prof.languages else ""] if x]
    return {"recent": recent, "trending": cache.cached("search:trending", 600, trending), "context": chips}


@router.get("/suggest")
def suggest(q: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    if len(q.strip()) < 2:
        return {"suggestions": [], "did_you_mean": None}
    prof = db.get(StudentProfile, user.id)
    f = _filters(prof, None, None, None, None, None, None)
    res = search.query(q, f, limit=6)
    hits = res.get("hits", [])
    dym = search.did_you_mean(q, hits)
    return {"suggestions": [{"t": h["title"], "m": h.get("subtitle", ""), "icon": h.get("icon", "search"),
                             "kind": h["kind"], "ref": h.get("ref"), "chapter_id": h.get("chapter_id")} for h in hits],
            "did_you_mean": dym}


@router.get("")
def run_search(q: str, board: str | None = None, class_level: str | None = None, subject: str | None = None,
               rtype: str | None = None, language: str | None = None, difficulty: str | None = None,
               user: User = Depends(student_user), db: Session = Depends(get_db)):
    q = q.strip()[:300]
    prof = db.get(StudentProfile, user.id)
    f = _filters(prof, board, class_level, subject, rtype, language, difficulty)
    res = search.query(q, f, limit=40) if q else {"hits": []}
    hits = res.get("hits", [])
    if not hits and (f.get("board") or f.get("class_level")) and q:
        # Nothing in the student's own class: widen before giving up.
        res = search.query(q, {k: v for k, v in f.items() if k not in ("board", "class_level")}, limit=40)
        hits = res.get("hits", [])
    res_ids = [uuid_or_none(h["ref"]) for h in hits if h["kind"] == "resource"]
    res_ids = [r for r in res_ids if r]
    disc = _discover(db, user, prof, q, hits, len(res_ids))
    if disc and disc.status == "done":
        res_ids += [r for r in disc.resource_ids if r not in res_ids]
    ranked = resources.recommend(db, user.id, resource_ids=res_ids, limit=12) if res_ids else []
    # Blend: Meilisearch relevance order first, recommendation score breaks ties.
    order = {rid: i for i, rid in enumerate(res_ids)}
    ranked.sort(key=lambda x: order.get(x["resource"].id, 99) - 4 * x["score"])
    cards = [resource_card(db, user, x["resource"], x["why"]) for x in ranked]
    unavailable = [resource_card(db, user, r) for r in db.scalars(select(Resource).where(Resource.id.in_(res_ids),
                                                                                         Resource.status == "Unavailable"))]
    matches = [{"t": h["title"], "m": h.get("subtitle", ""), "icon": h.get("icon"), "kind": h["kind"],
                "ref": h.get("ref"), "chapter_id": h.get("chapter_id")} for h in hits if h["kind"] != "resource"][:8]
    best_topics = []
    if cards and ranked:
        best_topics = cards[0]["topics"]
    total = len(cards) + len(matches)
    db.add(SearchLog(user_id=user.id, query=q, normalized=" ".join(q.lower().split()), result_count=total))
    track(db, user, "search", None, "search", q=q, n=total)
    db.commit()
    return {
        "query": q, "did_you_mean": search.did_you_mean(q, hits), "filters": f,
        "best": cards[0] if cards else None, "best_topics": best_topics,
        "alternatives": cards[1:4], "more": cards[4:] + unavailable, "matches": matches, "total": total,
        "discovery": discovery_out(disc),
    }


def _discover(db: Session, user: User, prof: StudentProfile | None, q: str, hits: list[dict], n_resources: int) -> VideoDiscovery | None:
    """Find YouTube videos when the catalog is thin: for the best-matching syllabus topic, or for the query itself."""
    if not q or not settings.discovery_enabled:
        return None
    th = next((h for h in hits[:5] if h["kind"] == "topic"), None)
    t = db.get(Topic, uuid_or_none(th["ref"])) if th else None
    if t is None:  # top hits are videos: use the syllabus topic they teach (no extra free-text YouTube search)
        rids = [r for r in (uuid_or_none(h["ref"]) for h in hits[:5] if h["kind"] == "resource") if r]
        tid = db.scalar(select(ResourceTopic.topic_id).where(ResourceTopic.resource_id.in_(rids)).limit(1)) if rids else None
        t = db.get(Topic, tid) if tid else None
    if t and t.published:
        return discovery.for_topic(db, t, prof)
    if not any(h["kind"] in ("topic", "chapter") for h in hits[:5]) and n_resources < settings.discovery_min_videos:
        return discovery.for_query(db, q, prof, user.id)
    return None


def discovery_out(d: VideoDiscovery | None) -> dict | None:
    if not d:
        return None
    return {"id": str(d.id), "status": d.status, "label": d.label, "added": len(d.resource_ids or []),
            "searching": d.status in ("queued", "running")}


@router.get("/discovery/{did}")
def discovery_status(did: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    """Poll a running video discovery; returns the ranked videos once done."""
    d = get_or_404(db, VideoDiscovery, did, "discovery")
    if d.status != "done":
        return {**discovery_out(d), "videos": []}
    ranked = resources.recommend(db, user.id, resource_ids=list(d.resource_ids or []), limit=12)
    return {**discovery_out(d), "videos": [resource_card(db, user, x["resource"], x["why"]) for x in ranked]}
