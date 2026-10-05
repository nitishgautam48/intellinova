"""Keyword search over the catalog (chapters, topics, resources, exams, career
data) with Meilisearch: typo-tolerant, filterable by board / class / subject."""
import difflib
import logging
import re
import uuid

import meilisearch
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import CareerNode, Chapter, Exam, Resource, Subject

log = logging.getLogger(__name__)
INDEX = "catalog"
_client: meilisearch.Client | None = None


def client() -> meilisearch.Client:
    global _client
    if _client is None:
        _client = meilisearch.Client(settings.meili_url, settings.meili_master_key or None, timeout=10)
    return _client


def ensure_index() -> None:
    c = client()
    try:
        c.get_index(INDEX)
    except meilisearch.errors.MeilisearchApiError:
        c.wait_for_task(c.create_index(INDEX, {"primaryKey": "id"}).task_uid)
    idx = c.index(INDEX)
    idx.update_settings({
        "searchableAttributes": ["title", "subtitle", "keywords", "body"],
        "filterableAttributes": ["kind", "board", "class_level", "subject", "languages", "rtype", "difficulty", "chapter_id"],
        "rankingRules": ["words", "typo", "proximity", "attribute", "sort", "exactness", "weight:desc"],
        "sortableAttributes": ["weight"],
    })


def _cls(s: str) -> str:
    return re.sub(r"\D", "", s or "") or s


def docs_for_subject(db: Session, subj: Subject) -> list[dict]:
    out = []
    for ch in subj.chapters:
        if ch.disabled or not ch.published:
            continue
        base = {"board": subj.board, "class_level": subj.class_level, "subject": subj.name}
        out.append({**base, "id": f"chapter-{ch.id}", "kind": "chapter", "title": ch.name,
                    "subtitle": f"Chapter · Class {_cls(subj.class_level)} {subj.name}", "icon": "menu_book",
                    "keywords": " ".join(t.name for t in ch.topics), "body": "", "ref": str(ch.id), "chapter_id": str(ch.id),
                    "weight": 3})
        for t in ch.topics:
            if not t.published:
                continue
            out.append({**base, "id": f"topic-{t.id}", "kind": "topic", "title": t.name, "subtitle": f"Topic · {ch.name}",
                        "icon": "label", "keywords": ch.name, "body": t.summary, "ref": str(t.id), "chapter_id": str(ch.id),
                        "weight": 2})
    return out


def resource_doc(db: Session, r: Resource) -> dict:
    subj = db.get(Subject, r.subject_id) if r.subject_id else None
    ch = db.get(Chapter, r.chapter_id) if r.chapter_id else None
    return {"id": f"resource-{r.id}", "kind": "resource", "title": r.title,
            "subtitle": f"{r.rtype} · {r.duration_label}".strip(" ·"),
            "icon": {"Playlist": "playlist_play", "Video": "smart_display", "Article": "article",
                     "Article series": "article", "Document": "description"}.get(r.rtype, "link"),
            "keywords": " ".join(filter(None, [ch.name if ch else "", r.creator])), "body": r.description[:1500],
            "board": subj.board if subj else "", "class_level": r.class_level, "subject": subj.name if subj else "",
            "languages": r.languages, "rtype": r.rtype, "difficulty": r.difficulty, "ref": str(r.id),
            "chapter_id": str(r.chapter_id) if r.chapter_id else "", "weight": 1}


def reindex_all(db: Session) -> int:
    ensure_index()
    docs: list[dict] = []
    for subj in db.scalars(select(Subject)):
        docs += docs_for_subject(db, subj)
    for r in db.scalars(select(Resource).where(Resource.status == "Active")):
        docs.append(resource_doc(db, r))
    for n in db.scalars(select(CareerNode).where(CareerNode.ntype.in_(("area", "degree", "entrance", "combination")))):
        label = {"area": "Career area", "degree": "Degree direction", "entrance": "Entrance exam",
                 "combination": "Subject combination"}[n.ntype]
        docs.append({"id": f"career-{n.id}", "kind": "career", "title": n.name, "subtitle": label, "icon": "explore",
                     "keywords": n.summary, "body": n.description[:1000], "ref": str(n.id), "weight": 1})
    for e in db.scalars(select(Exam).where(Exam.status == "Active")):
        docs.append({"id": f"exam-{e.id}", "kind": "exam", "title": e.name, "subtitle": f"Exam · {e.full_name}",
                     "icon": "flag", "keywords": e.full_name, "body": e.description[:1000], "ref": str(e.id), "weight": 2})
    idx = client().index(INDEX)
    idx.delete_all_documents()
    for i in range(0, len(docs), 500):
        idx.add_documents(docs[i:i + 500])
    return len(docs)


def safe_reindex(db: Session) -> None:
    try:
        reindex_all(db)
    except Exception as e:  # noqa: BLE001 - search must never block content edits
        log.warning("Search reindex failed: %s", e)


def query(q: str, filters: dict | None = None, limit: int = 30) -> dict:
    parts = []
    for k, v in (filters or {}).items():
        if v in (None, "", "Any"):
            continue
        vals = v if isinstance(v, list) else [v]
        parts.append("(" + " OR ".join(f'{k} = "{str(x).replace(chr(34), "")}"' for x in vals) + ")")
    try:
        return client().index(INDEX).search(q, {"limit": limit, "filter": " AND ".join(parts) or None,
                                                "attributesToHighlight": [], "showRankingScore": True})
    except meilisearch.errors.MeilisearchApiError as e:
        if "index_not_found" in str(e):
            return {"hits": [], "estimatedTotalHits": 0}
        raise


def did_you_mean(q: str, hits: list[dict]) -> str | None:
    """Suggest the spelling the results matched, e.g. "electrisity" -> "electricity"."""
    vocab: set[str] = set()
    for h in hits[:15]:
        vocab |= set(re.findall(r"[a-z]{3,}", f"{h.get('title', '')} {h.get('keywords', '')}".lower()))
    if not vocab:
        return None
    out, changed = [], False
    for w in q.lower().split():
        if len(w) > 3 and w not in vocab:
            m = difflib.get_close_matches(w, vocab, n=1, cutoff=0.75)
            if m:
                out.append(m[0])
                changed = True
                continue
        out.append(w)
    return " ".join(out) if changed else None


def suggest(q: str, filters: dict | None = None) -> list[dict]:
    res = query(q, filters, limit=6)
    return [{"t": h["title"], "m": h.get("subtitle", ""), "icon": h.get("icon", "search"), "kind": h["kind"],
             "ref": h.get("ref"), "chapter_id": h.get("chapter_id")} for h in res.get("hits", [])]


def uuid_or_none(s: str | None) -> uuid.UUID | None:
    try:
        return uuid.UUID(s) if s else None
    except ValueError:
        return None
