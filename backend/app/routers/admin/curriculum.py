"""Admin console: Curriculum (board / class / stream / subject tree, chapter and
topic editor, prerequisites, reordering, versioned publishing)."""
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Chapter, CurriculumVersion, ResourceTopic, Subject, Topic, TopicPrereq, User
from app.routers.common import fmt_date, get_or_404, norm_class, subtopics_by_topic
from app.security import require_staff
from app.services import search

router = APIRouter(prefix="/api/admin/curriculum", tags=["admin"])


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:200]


def _dirty(db: Session, subj: Subject) -> None:
    subj.has_draft = True


@router.get("/subjects")
def list_subjects(_: User = Depends(require_staff), db: Session = Depends(get_db)):
    rows = db.scalars(select(Subject).order_by(Subject.board, Subject.class_level, Subject.stream, Subject.position, Subject.name))
    return [{"id": str(s.id), "board": s.board, "class_level": s.class_level, "stream": s.stream, "name": s.name,
             "icon": s.icon, "tone": s.tone, "version": s.published_version, "draft": s.has_draft,
             "chapters": len(s.chapters)} for s in rows]


class SubjectIn(BaseModel):
    board: str = Field(min_length=2, max_length=60)
    class_level: str = Field(min_length=1, max_length=40)
    stream: str | None = Field(None, max_length=60)
    name: str = Field(min_length=2, max_length=120)
    icon: str = "menu_book"
    tone: str = "pri"


@router.post("/subjects")
def create_subject(body: SubjectIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    body.class_level = norm_class(body.class_level)
    body.board, body.name = body.board.strip(), body.name.strip()
    body.stream = (body.stream or "").strip() or None
    if db.scalar(select(Subject).where(Subject.board == body.board, Subject.class_level == body.class_level,
                                       Subject.stream == body.stream, Subject.name == body.name)):
        raise HTTPException(400, "This subject already exists for that board and class.")
    pos = db.scalar(select(func.count()).select_from(Subject).where(Subject.board == body.board,
                                                                    Subject.class_level == body.class_level)) or 0
    s = Subject(**body.model_dump(), position=pos, has_draft=True)
    db.add(s)
    db.commit()
    return {"id": str(s.id)}


class SubjectPatch(BaseModel):
    name: str | None = None
    icon: str | None = None
    tone: str | None = None
    stream: str | None = None


@router.patch("/subjects/{sid}")
def patch_subject(sid: str, body: SubjectPatch, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    s = get_or_404(db, Subject, sid, "subject")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit()
    search.safe_reindex(db)
    return {"ok": True}


def subject_tree(db: Session, s: Subject) -> dict:
    db.expire_all()  # sessions keep objects across commits; reload collections edited above
    tids = [t.id for c in s.chapters for t in c.topics]
    pre: dict[uuid.UUID, list[uuid.UUID]] = {}
    for tp in db.scalars(select(TopicPrereq).where(TopicPrereq.topic_id.in_(tids))) if tids else []:
        pre.setdefault(tp.topic_id, []).append(tp.prereq_id)
    names = {t.id: (t.name, t.chapter.name) for t in db.scalars(select(Topic).where(Topic.id.in_({p for v in pre.values() for p in v})))} if pre else {}
    res_n = dict(db.execute(select(ResourceTopic.topic_id, func.count()).where(ResourceTopic.topic_id.in_(tids))
                            .group_by(ResourceTopic.topic_id)).all()) if tids else {}
    subs = subtopics_by_topic(db, tids)
    chapters = []
    for i, c in enumerate(s.chapters, start=1):
        chapters.append({
            "id": str(c.id), "n": f"{i:02d}", "name": c.name, "disabled": c.disabled, "published": c.published,
            "topics": [{"id": str(t.id), "n": j, "name": t.name, "slug": t.slug, "est": t.est_minutes, "summary": t.summary,
                        "published": t.published, "res": res_n.get(t.id, 0), "subtopics": subs.get(t.id, []),
                        "pre": [{"id": str(p), "name": (f"{names[p][1]} › {names[p][0]}" if names[p][1] != c.name else names[p][0])}
                                for p in pre.get(t.id, []) if p in names]}
                       for j, t in enumerate(c.topics, start=1)],
        })
    versions = []
    if s.has_draft:
        versions.append({"v": f"v{s.published_version + 1}", "l": "Draft", "m": "Unpublished changes", "tone": "warn"})
    for v in db.scalars(select(CurriculumVersion).where(CurriculumVersion.subject_id == s.id).order_by(CurriculumVersion.version.desc())):
        by = db.get(User, v.created_by) if v.created_by else None
        versions.append({"v": f"v{v.version}", "l": v.status, "m": f"{fmt_date(v.created_at)} · {by.name if by else 'import'}"
                         + (f" · {v.note}" if v.note else ""), "tone": "ok" if v.status == "Published" else "mute"})
    return {"id": str(s.id), "board": s.board, "class_level": s.class_level, "stream": s.stream, "name": s.name,
            "icon": s.icon, "tone": s.tone, "version": s.published_version, "draft": s.has_draft,
            "chapters": chapters, "versions": versions}


@router.get("/subjects/{sid}")
def get_subject(sid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    return subject_tree(db, get_or_404(db, Subject, sid, "subject"))


@router.get("/subjects/{sid}/map")
def subject_map(sid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    from app.services import flowmap

    return flowmap.build(db, get_or_404(db, Subject, sid, "subject"), None, include_drafts=True)


@router.delete("/subjects/{sid}")
def delete_subject(sid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    s = get_or_404(db, Subject, sid, "subject")
    if s.published_version > 0:
        raise HTTPException(400, "Published subjects can't be deleted. Disable their chapters instead.")
    db.delete(s)
    db.commit()
    return {"ok": True}


class NameIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)


@router.post("/subjects/{sid}/chapters")
def add_chapter(sid: str, body: NameIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    s = get_or_404(db, Subject, sid, "subject")
    c = Chapter(subject_id=s.id, name=body.name.strip(), position=len(s.chapters), published=False)
    db.add(c)
    _dirty(db, s)
    db.commit()
    return subject_tree(db, s)


class ChapterPatch(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=200)
    disabled: bool | None = None


@router.patch("/chapters/{cid}")
def patch_chapter(cid: str, body: ChapterPatch, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    c = get_or_404(db, Chapter, cid, "chapter")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    _dirty(db, c.subject)
    db.commit()
    return subject_tree(db, c.subject)


@router.delete("/chapters/{cid}")
def delete_chapter(cid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    c = get_or_404(db, Chapter, cid, "chapter")
    if c.published:
        raise HTTPException(400, "Published chapters can't be deleted. Hide the chapter instead.")
    s = c.subject
    db.delete(c)
    db.flush()
    for i, ch in enumerate(sorted(s.chapters, key=lambda x: x.position)):
        ch.position = i
    db.commit()
    return subject_tree(db, s)


class OrderIn(BaseModel):
    ids: list[uuid.UUID]


@router.post("/subjects/{sid}/reorder")
def reorder_chapters(sid: str, body: OrderIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    s = get_or_404(db, Subject, sid, "subject")
    pos = {cid: i for i, cid in enumerate(body.ids)}
    if set(pos) != {c.id for c in s.chapters}:
        raise HTTPException(400, "Send every chapter id exactly once.")
    for c in s.chapters:
        c.position = pos[c.id]
    _dirty(db, s)
    db.commit()
    db.refresh(s)
    return subject_tree(db, s)


class TopicIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    est_minutes: int = Field(15, ge=1, le=600)
    summary: str = Field("", max_length=2000)


@router.post("/chapters/{cid}/topics")
def add_topic(cid: str, body: TopicIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    c = get_or_404(db, Chapter, cid, "chapter")
    t = Topic(chapter_id=c.id, name=body.name.strip(), slug=slugify(body.name), est_minutes=body.est_minutes,
              summary=body.summary, position=len(c.topics), published=False)
    db.add(t)
    _dirty(db, c.subject)
    db.commit()
    return subject_tree(db, c.subject)


class TopicPatch(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=200)
    slug: str | None = None
    est_minutes: int | None = Field(None, ge=1, le=600)
    summary: str | None = Field(None, max_length=2000)
    prereq_ids: list[uuid.UUID] | None = None


@router.patch("/topics/{tid}")
def patch_topic(tid: str, body: TopicPatch, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    t = get_or_404(db, Topic, tid, "topic")
    data = body.model_dump(exclude_unset=True)
    pre = data.pop("prereq_ids", None)
    for k, v in data.items():
        if v is not None:
            setattr(t, k, slugify(v) if k == "slug" else v)
    if "name" in data and "slug" not in data:
        t.slug = slugify(t.name)
    if pre is not None:
        if t.id in pre:
            raise HTTPException(400, "A topic can't be its own prerequisite.")
        db.execute(delete(TopicPrereq).where(TopicPrereq.topic_id == t.id))
        for p in dict.fromkeys(pre):
            if db.get(Topic, p):
                db.add(TopicPrereq(topic_id=t.id, prereq_id=p))
    _dirty(db, t.chapter.subject)
    db.commit()
    return subject_tree(db, t.chapter.subject)


@router.post("/topics/{tid}/discover")
def discover_topic(tid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    """Search YouTube for this topic now, even if it already has videos."""
    from app.routers.search import discovery_out
    from app.services import discovery

    t = get_or_404(db, Topic, tid, "topic")
    d = discovery.for_topic(db, t, None, force=True)
    if d is None:
        raise HTTPException(400, "Automatic video discovery is turned off (DISCOVERY_ENABLED=false).")
    return discovery_out(d)


@router.post("/chapters/{cid}/reorder")
def reorder_topics(cid: str, body: OrderIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    c = get_or_404(db, Chapter, cid, "chapter")
    pos = {tid: i for i, tid in enumerate(body.ids)}
    if set(pos) != {t.id for t in c.topics}:
        raise HTTPException(400, "Send every topic id exactly once.")
    for t in c.topics:
        t.position = pos[t.id]
    _dirty(db, c.subject)
    db.commit()
    db.refresh(c)
    return subject_tree(db, c.subject)


@router.delete("/topics/{tid}")
def delete_topic(tid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    t = get_or_404(db, Topic, tid, "topic")
    if t.published:
        raise HTTPException(400, "Published topics can't be deleted; students may have progress on them.")
    c = t.chapter
    db.delete(t)
    db.flush()
    for i, x in enumerate(sorted(c.topics, key=lambda y: y.position)):
        x.position = i
    db.commit()
    return subject_tree(db, c.subject)


class PublishIn(BaseModel):
    note: str = Field("", max_length=300)


@router.post("/subjects/{sid}/publish")
def publish(sid: str, body: PublishIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    s = get_or_404(db, Subject, sid, "subject")
    if not s.has_draft:
        raise HTTPException(400, "There are no unpublished changes.")
    if not s.chapters:
        raise HTTPException(400, "Add at least one chapter before publishing.")
    for c in s.chapters:
        c.published = True
        for t in c.topics:
            t.published = True
    for v in db.scalars(select(CurriculumVersion).where(CurriculumVersion.subject_id == s.id, CurriculumVersion.status == "Published")):
        v.status = "Archived"
    s.published_version += 1
    s.has_draft = False
    db.flush()
    snap = subject_tree(db, s)
    db.add(CurriculumVersion(subject_id=s.id, version=s.published_version, status="Published", note=body.note,
                             created_by=user.id, snapshot=snap))
    db.commit()
    search.safe_reindex(db)
    return subject_tree(db, s)
