"""Course flow map (problem statement 6a): every topic of a subject laid out in course order, with
prerequisite edges, each node coloured by the student's mastery.

Layout is done here so both the student app and the admin console draw the same map: columns are
chapters in teaching order; inside a chapter, topics keep their order. `level` is the longest
prerequisite chain leading to a topic, so the UI can also show "what to learn first"."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Mastery, Subject, Topic, TopicPrereq, TopicProgress
from app.routers.common import subtopics_by_topic
from app.services import learner


def build(db: Session, subj: Subject, user_id: uuid.UUID | None = None, include_drafts: bool = False) -> dict:
    chapters = [c for c in subj.chapters if (include_drafts or (c.published and not c.disabled))]
    topics: list[tuple[int, int, Topic]] = []
    for ci, c in enumerate(chapters):
        for ti, t in enumerate(x for x in c.topics if include_drafts or x.published):
            topics.append((ci, ti, t))
    ids = {t.id for *_, t in topics}
    edges_raw = list(db.execute(select(TopicPrereq.prereq_id, TopicPrereq.topic_id).where(TopicPrereq.topic_id.in_(ids)))) if ids else []

    # Prerequisites that live in another subject are shown as small external nodes.
    external: dict[uuid.UUID, Topic] = {}
    for pre, _ in edges_raw:
        if pre not in ids and pre not in external:
            t = db.get(Topic, pre)
            if t:
                external[pre] = t

    done: set[uuid.UUID] = set()
    mastery: dict[uuid.UUID, Mastery] = {}
    if user_id:
        done = set(db.scalars(select(TopicProgress.topic_id).where(TopicProgress.user_id == user_id, TopicProgress.topic_id.in_(ids))))
        mastery = {m.topic_id: m for m in db.scalars(select(Mastery).where(Mastery.user_id == user_id, Mastery.topic_id.in_(ids)))}

    # Longest prerequisite chain (within this subject) = "learn first" level. Cycles are cut defensively.
    parents: dict[uuid.UUID, list[uuid.UUID]] = {}
    for pre, tid in edges_raw:
        if pre in ids:
            parents.setdefault(tid, []).append(pre)
    level: dict[uuid.UUID, int] = {}

    def lv(t: uuid.UUID, seen: frozenset = frozenset()) -> int:
        if t in level:
            return level[t]
        if t in seen:
            return 0
        v = 1 + max((lv(p, seen | {t}) for p in parents.get(t, [])), default=-1)
        level[t] = v
        return v

    subs = subtopics_by_topic(db, list(ids))
    now = datetime.now(timezone.utc)
    cur = next((t.id for *_, t in topics if t.id not in done), None) if user_id else None
    nodes = []
    for ci, ti, t in topics:
        m = mastery.get(t.id)
        p = m.p if m and m.n_obs else None
        status = learner.status_of(p) if p is not None else "Not assessed"
        nodes.append({"id": str(t.id), "name": t.name, "chapter_id": str(t.chapter_id), "col": ci, "row": ti, "level": lv(t.id),
                      "published": t.published, "subtopics": subs.get(t.id, [])[:5],
                      "state": "done" if t.id in done else "current" if t.id == cur else "todo",
                      "mastery": round(p, 2) if p is not None else None, "status": status,
                      "due": bool(m and m.next_review_at and m.next_review_at <= now)})
    for t in external.values():
        nodes.append({"id": str(t.id), "name": t.name, "chapter_id": str(t.chapter_id), "col": -1, "row": len([n for n in nodes if n["col"] == -1]),
                      "level": 0, "published": t.published, "subtopics": [], "state": "external", "mastery": None,
                      "status": "Other subject", "due": False, "external": f"{t.chapter.subject.name} · {t.chapter.name}"})
    return {
        "subject": {"id": str(subj.id), "name": subj.name},
        "chapters": [{"id": str(c.id), "name": c.name, "col": i} for i, c in enumerate(chapters)],
        "nodes": nodes,
        "edges": [{"from": str(pre), "to": str(tid)} for pre, tid in edges_raw if pre in ids or pre in external],
        "has_external": bool(external),
    }
