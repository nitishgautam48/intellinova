"""Admin console: Resources (add-resource wizard, review, link checks), Exams
(structure + verified facts) and Career data (graph entities + eligibility rules)."""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    CareerDimension,
    CareerEdge,
    CareerNode,
    Chapter,
    Exam,
    ExamFact,
    ExamSubject,
    ExamTopic,
    ExamTopicResource,
    ExamUnit,
    Resource,
    ResourceReport,
    ResourceTopic,
    Subject,
    Topic,
    User,
)
from app.routers.common import class_num, fact_status, fmt_date, get_or_404, norm_class, now, rel_time
from app.security import require_admin, require_staff
from app.services import resources, search

router = APIRouter(prefix="/api/admin", tags=["admin"])

# --------------------------------------------------------------------------- resources

STATUSES = ("Draft", "Active", "Needs Review", "Unavailable", "Disabled")
QUALITY = ("High", "Medium", "Low")


def res_row(db: Session, r: Resource) -> dict:
    subj = db.get(Subject, r.subject_id) if r.subject_id else None
    ch = db.get(Chapter, r.chapter_id) if r.chapter_id else None
    return {"id": str(r.id), "t": r.title, "plat": r.platform, "type": r.rtype, "cls": class_num(r.class_level) or "—",
            "sub": subj.name if subj else "—", "chap": ch.name if ch else "—", "lang": ", ".join(r.languages or []) or "—",
            "diff": r.difficulty, "q": r.quality or "—", "s": r.status,
            "chk": rel_time(r.last_checked_at) if r.last_checked_at else "—", "url": r.url,
            "auto": (r.meta or {}).get("origin") == "discovered"}


AUTO = Resource.meta["origin"].astext == "discovered"


@router.get("/resources")
def list_resources(status: str = "All", q: str = "", origin: str = "", _: User = Depends(require_staff), db: Session = Depends(get_db)):
    counts = dict(db.execute(select(Resource.status, func.count()).group_by(Resource.status)).all())
    n_auto = db.scalar(select(func.count()).select_from(Resource).where(AUTO)) or 0
    base = select(Resource)
    if status != "All":
        base = base.where(Resource.status == status)
    if origin == "auto":
        base = base.where(AUTO)
    elif origin == "curated":
        base = base.where(AUTO.is_not(True))
    if q:
        base = base.where(Resource.title.ilike(f"%{q}%"))
    rows = db.scalars(base.order_by(Resource.updated_at.desc()).limit(500))
    return {"counts": {"All": sum(counts.values()), **{s: counts.get(s, 0) for s in STATUSES}, "Auto-found": n_auto},
            "rows": [res_row(db, r) for r in rows]}


@router.get("/resources/{rid}")
def resource_detail(rid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    r = get_or_404(db, Resource, rid, "resource")
    tids = list(db.scalars(select(ResourceTopic.topic_id).where(ResourceTopic.resource_id == r.id)))
    topics = [{"id": str(t.id), "name": t.name} for t in db.scalars(select(Topic).where(Topic.id.in_(tids)))] if tids else []
    reps = [{"id": str(x.id), "reason": x.reason, "note": x.note, "when": rel_time(x.created_at), "resolved": x.resolved}
            for x in db.scalars(select(ResourceReport).where(ResourceReport.resource_id == r.id).order_by(ResourceReport.created_at.desc()))]
    return {**res_row(db, r), "creator": r.creator, "dur": r.duration_label, "description": r.description,
            "thumb": r.thumbnail_url, "languages": r.languages, "difficulty": r.difficulty, "quality": r.quality,
            "subject_id": str(r.subject_id) if r.subject_id else None, "chapter_id": str(r.chapter_id) if r.chapter_id else None,
            "class_level": r.class_level, "topics": topics, "reports": reps, "signal": r.signal or {},
            "check_ok": r.check_ok, "created": fmt_date(r.created_at),
            "discovery": _discovery_info(r)}


def _discovery_info(r: Resource) -> dict | None:
    m = r.meta or {}
    if m.get("origin") != "discovered":
        return None
    return {"reason": m.get("reason", ""), "relevance": m.get("relevance"), "search": m.get("search", ""),
            "source": m.get("source", ""), "reddit": m.get("reddit"),
            "when": fmt_date(datetime.fromisoformat(m["discovered_at"])) if m.get("discovered_at") else "—"}


@router.get("/discoveries")
def list_discoveries(_: User = Depends(require_staff), db: Session = Depends(get_db)):
    """Recent automatic YouTube searches, so staff can see what was found and spot quota or model problems."""
    from app.models import VideoDiscovery

    rows = db.scalars(select(VideoDiscovery).order_by(VideoDiscovery.updated_at.desc()).limit(50))
    return [{"id": str(d.id), "label": d.label, "kind": "Topic" if d.topic_id else "Search", "lang": d.lang, "status": d.status,
             "added": len(d.resource_ids or []), "stats": d.stats or {}, "error": d.error, "when": rel_time(d.updated_at)}
            for d in rows]


class DetectIn(BaseModel):
    url: str = Field(min_length=4, max_length=1000)


@router.post("/resources/detect")
def detect(body: DetectIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    """Wizard steps 2-3: detect metadata, then suggest a classification."""
    meta = resources.detect(body.url)
    existing = db.scalar(select(Resource).where(Resource.url == meta.get("url", body.url)))
    if existing:
        meta["duplicate_of"] = {"id": str(existing.id), "title": existing.title, "status": existing.status}
    suggestion = resources.classify(db, meta) if meta.get("title") else None
    return {"meta": meta, "suggestion": suggestion}


class ResourceIn(BaseModel):
    url: str
    title: str = Field(min_length=2, max_length=400)
    platform: str = "Web"
    rtype: str = "Video"
    creator: str = ""
    duration_label: str = ""
    duration_seconds: int | None = None
    thumbnail_url: str = ""
    description: str = ""
    class_level: str = ""
    subject_id: uuid.UUID | None = None
    chapter_id: uuid.UUID | None = None
    topic_ids: list[uuid.UUID] = []
    languages: list[str] = []
    difficulty: str = "Beginner"
    quality: str | None = None
    status: str = "Active"
    stats: dict | None = None


def _apply_topics(db: Session, r: Resource, topic_ids: list[uuid.UUID]) -> None:
    db.execute(delete(ResourceTopic).where(ResourceTopic.resource_id == r.id))
    for t in dict.fromkeys(topic_ids):
        if db.get(Topic, t):
            db.add(ResourceTopic(resource_id=r.id, topic_id=t))


@router.post("/resources")
def create_resource(body: ResourceIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    if body.status not in STATUSES or (body.quality and body.quality not in QUALITY):
        raise HTTPException(400, "Invalid status or quality")
    if db.scalar(select(Resource).where(Resource.url == body.url)):
        raise HTTPException(400, "This link is already in the catalog.")
    data = body.model_dump(exclude={"topic_ids", "stats"})
    data["class_level"] = norm_class(data["class_level"])
    r = Resource(**data, created_by=user.id, last_checked_at=now(), check_ok=True)
    if body.stats:
        r.signal = {**body.stats, "like_ratio": round(body.stats.get("likes", 0) / body.stats["views"], 4) if body.stats.get("views") else None}
    db.add(r)
    db.flush()
    _apply_topics(db, r, body.topic_ids)
    db.commit()
    search.safe_reindex(db)
    return res_row(db, r)


class ResourcePatch(BaseModel):
    title: str | None = None
    status: str | None = None
    quality: str | None = None
    difficulty: str | None = None
    languages: list[str] | None = None
    class_level: str | None = None
    subject_id: uuid.UUID | None = None
    chapter_id: uuid.UUID | None = None
    topic_ids: list[uuid.UUID] | None = None
    description: str | None = None


@router.patch("/resources/{rid}")
def patch_resource(rid: str, body: ResourcePatch, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    r = get_or_404(db, Resource, rid, "resource")
    data = body.model_dump(exclude_unset=True)
    if data.get("status") and data["status"] not in STATUSES:
        raise HTTPException(400, "Unknown status")
    tids = data.pop("topic_ids", None)
    if data.get("class_level") is not None:
        data["class_level"] = norm_class(data["class_level"])
    for k, v in data.items():
        setattr(r, k, v)
    if tids is not None:
        _apply_topics(db, r, tids)
    if data.get("status") == "Active":
        for rep in db.scalars(select(ResourceReport).where(ResourceReport.resource_id == r.id, ResourceReport.resolved.is_(False))):
            rep.resolved = True
    db.commit()
    search.safe_reindex(db)
    return resource_detail(rid, _, db)


@router.post("/resources/{rid}/recheck")
def recheck(rid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    r = get_or_404(db, Resource, rid, "resource")
    ok = resources.check_link(r.url)
    r.check_ok, r.last_checked_at = ok, now()
    if not ok and r.status == "Active":
        r.status = "Unavailable"
    db.commit()
    return {"ok": ok, "status": r.status, "chk": "just now"}


@router.delete("/resources/{rid}")
def delete_resource(rid: str, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    db.delete(get_or_404(db, Resource, rid, "resource"))
    db.commit()
    search.safe_reindex(db)
    return {"ok": True}


@router.get("/structure")
def structure(_: User = Depends(require_staff), db: Session = Depends(get_db)):
    """Board/class/subject/chapter/topic tree for pickers."""
    out = []
    for s in db.scalars(select(Subject).order_by(Subject.board, Subject.class_level, Subject.position)):
        out.append({"id": str(s.id), "label": f"{s.name} · {s.board} {s.class_level}", "class_level": s.class_level,
                    "chapters": [{"id": str(c.id), "name": c.name,
                                  "topics": [{"id": str(t.id), "name": t.name} for t in c.topics]} for c in s.chapters]})
    return out


# --------------------------------------------------------------------------- exams


def exam_stats(db: Session, e: Exam) -> dict:
    topics = [t for s in e.subjects for u in s.units for t in u.topics]
    tids = [t.id for t in topics]
    res = db.scalar(select(func.count(func.distinct(ExamTopicResource.resource_id))).where(ExamTopicResource.exam_topic_id.in_(tids))) if tids else 0
    stale = sum(1 for f in e.facts if fact_status(f.verified_at, f.source_name) != "Verified")
    return {"subjects": len(e.subjects), "units": sum(len(s.units) for s in e.subjects), "topics": len(topics),
            "resources": res or 0, "stale": stale}


@router.get("/exams")
def list_exams(_: User = Depends(require_staff), db: Session = Depends(get_db)):
    out = []
    for e in db.scalars(select(Exam).order_by(Exam.name)):
        st = exam_stats(db, e)
        out.append({"id": str(e.id), "n": e.name, "code": e.code, "full": e.full_name, "st": e.status,
                    "topics": st["topics"], "res": st["resources"], "stale": st["stale"] > 0})
    return out


class ExamIn(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=120)
    full_name: str = ""
    description: str = ""
    status: str = "Draft"


@router.post("/exams")
def create_exam(body: ExamIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    code = body.code.lower().strip()
    if db.scalar(select(Exam).where(Exam.code == code)):
        raise HTTPException(400, "An exam with this code exists.")
    e = Exam(**{**body.model_dump(), "code": code})
    db.add(e)
    db.flush()
    for i, k in enumerate(["Sections / subjects", "Mode of exam", "Eligibility", "Paper pattern", "Next session dates"]):
        db.add(ExamFact(exam_id=e.id, key=k, position=i))
    db.commit()
    return {"id": str(e.id)}


def exam_detail_out(db: Session, e: Exam) -> dict:
    db.expire_all()
    st = exam_stats(db, e)
    all_tids = [t.id for s in e.subjects for u in s.units for t in u.topics]
    mapped: dict[uuid.UUID, list[dict]] = {}
    if all_tids:
        for etr, r in db.execute(select(ExamTopicResource, Resource).join(Resource, ExamTopicResource.resource_id == Resource.id)
                                 .where(ExamTopicResource.exam_topic_id.in_(all_tids))).all():
            mapped.setdefault(etr.exam_topic_id, []).append({"id": str(r.id), "name": r.title})
    linked = {x for s in e.subjects for u in s.units for x in (t.topic_id for t in u.topics) if x}
    tnames = {t.id: t.name for t in db.scalars(select(Topic).where(Topic.id.in_(linked)))} if linked else {}
    subjects = []
    for s in e.subjects:
        units = []
        for u in s.units:
            tids = [t.id for t in u.topics]
            res = db.scalar(select(func.count()).select_from(ExamTopicResource).where(ExamTopicResource.exam_topic_id.in_(tids))) if tids else 0
            units.append({"id": str(u.id), "n": u.name, "t": len(u.topics), "p": sum(1 for t in u.topics if t.prereq_id), "r": res or 0,
                          "topics": [{"id": str(t.id), "name": t.name, "priority": t.priority,
                                      "prereq_id": str(t.prereq_id) if t.prereq_id else None,
                                      "topic_id": str(t.topic_id) if t.topic_id else None,
                                      "topic_name": tnames.get(t.topic_id), "resources": mapped.get(t.id, [])} for t in u.topics]})
        subjects.append({"id": str(s.id), "name": s.name, "units": units})
    facts = [{"id": str(f.id), "k": f.key, "v": f.value, "src": f.source_name, "url": f.source_url,
              "d": fmt_date(f.verified_at), "s": fact_status(f.verified_at, f.source_name)} for f in e.facts]
    return {"id": str(e.id), "n": e.name, "code": e.code, "full": e.full_name, "description": e.description, "st": e.status,
            "stats": [{"l": "Subjects", "v": st["subjects"]}, {"l": "Units", "v": st["units"]}, {"l": "Topics", "v": st["topics"]},
                      {"l": "Mapped resources", "v": st["resources"]}, {"l": "Facts needing attention", "v": st["stale"]}],
            "subjects": subjects, "facts": facts}


@router.get("/exams/{eid}")
def get_exam(eid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    return exam_detail_out(db, get_or_404(db, Exam, eid, "exam"))


class ExamPatch(BaseModel):
    name: str | None = None
    full_name: str | None = None
    description: str | None = None
    status: str | None = None


@router.patch("/exams/{eid}")
def patch_exam(eid: str, body: ExamPatch, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    e = get_or_404(db, Exam, eid, "exam")
    if body.status and body.status not in ("Active", "Draft"):
        raise HTTPException(400, "Unknown status")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(e, k, v)
    db.commit()
    search.safe_reindex(db)
    return exam_detail_out(db, e)


class StructIn(BaseModel):
    kind: str  # subject | unit | topic
    parent_id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=200)
    priority: str = "Medium"
    prereq_id: uuid.UUID | None = None
    topic_id: uuid.UUID | None = None


@router.post("/exams/{eid}/structure")
def add_structure(eid: str, body: StructIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    e = get_or_404(db, Exam, eid, "exam")
    if body.kind == "subject":
        db.add(ExamSubject(exam_id=e.id, name=body.name, position=len(e.subjects)))
    elif body.kind == "unit":
        s = get_or_404(db, ExamSubject, body.parent_id, "subject")
        db.add(ExamUnit(exam_subject_id=s.id, name=body.name, position=len(s.units)))
    elif body.kind == "topic":
        u = get_or_404(db, ExamUnit, body.parent_id, "unit")
        if body.priority not in ("High", "Medium", "Low"):
            raise HTTPException(400, "Unknown priority")
        db.add(ExamTopic(unit_id=u.id, name=body.name, priority=body.priority, prereq_id=body.prereq_id,
                         topic_id=body.topic_id, position=len(u.topics)))
    else:
        raise HTTPException(400, "kind must be subject, unit or topic")
    db.commit()
    db.refresh(e)
    return exam_detail_out(db, e)


class StructPatch(BaseModel):
    name: str | None = None
    priority: str | None = None
    prereq_id: uuid.UUID | None = None
    topic_id: uuid.UUID | None = None
    resource_ids: list[uuid.UUID] | None = None


@router.patch("/exams/{eid}/structure/{kind}/{sid}")
def patch_structure(eid: str, kind: str, sid: str, body: StructPatch, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    e = get_or_404(db, Exam, eid, "exam")
    model = {"subject": ExamSubject, "unit": ExamUnit, "topic": ExamTopic}.get(kind)
    if not model:
        raise HTTPException(404)
    obj = get_or_404(db, model, sid, kind)
    data = body.model_dump(exclude_unset=True)
    rids = data.pop("resource_ids", None)
    for k, v in data.items():
        if hasattr(obj, k):
            setattr(obj, k, v)
    if rids is not None and kind == "topic":
        db.execute(delete(ExamTopicResource).where(ExamTopicResource.exam_topic_id == obj.id))
        for r in dict.fromkeys(rids):
            db.add(ExamTopicResource(exam_topic_id=obj.id, resource_id=r))
    db.commit()
    db.refresh(e)
    return exam_detail_out(db, e)


@router.delete("/exams/{eid}/structure/{kind}/{sid}")
def delete_structure(eid: str, kind: str, sid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    e = get_or_404(db, Exam, eid, "exam")
    model = {"subject": ExamSubject, "unit": ExamUnit, "topic": ExamTopic}.get(kind)
    if not model:
        raise HTTPException(404)
    db.delete(get_or_404(db, model, sid, kind))
    db.commit()
    db.refresh(e)
    return exam_detail_out(db, e)


class FactIn(BaseModel):
    key: str | None = None
    value: str | None = None
    source_name: str | None = None
    source_url: str | None = None
    verify: bool = False


@router.post("/exams/{eid}/facts")
def add_fact(eid: str, body: FactIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    e = get_or_404(db, Exam, eid, "exam")
    f = ExamFact(exam_id=e.id, key=body.key or "New fact", value=body.value or "", source_name=body.source_name or "",
                 source_url=body.source_url or "", position=len(e.facts), verified_at=now() if body.verify else None)
    db.add(f)
    db.commit()
    db.refresh(e)
    return exam_detail_out(db, e)


@router.patch("/exams/{eid}/facts/{fid}")
def patch_fact(eid: str, fid: str, body: FactIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    e = get_or_404(db, Exam, eid, "exam")
    f = get_or_404(db, ExamFact, fid, "fact")
    for k in ("key", "value", "source_name", "source_url"):
        v = getattr(body, k)
        if v is not None:
            setattr(f, k, v)
    if body.verify:
        if not f.source_name:
            raise HTTPException(400, "Add the official source before marking this fact verified.")
        f.verified_at = now()
    db.commit()
    db.refresh(e)
    return exam_detail_out(db, e)


@router.delete("/exams/{eid}/facts/{fid}")
def delete_fact(eid: str, fid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    e = get_or_404(db, Exam, eid, "exam")
    db.delete(get_or_404(db, ExamFact, fid, "fact"))
    db.commit()
    db.refresh(e)
    return exam_detail_out(db, e)


# --------------------------------------------------------------------------- career data

ENTS = [("interests", "Interests", "interest"), ("subjects", "Subjects", "subject"), ("combos", "Combinations", "combination"),
        ("degrees", "Degree directions", "degree"), ("entrances", "Entrance pathways", "entrance"),
        ("rules", "Eligibility rules", None), ("areas", "Career areas", "area")]
NT = {k: t for k, _, t in ENTS if t}


def _summary(ntype: str, ups: list, downs: list) -> str:
    down_by = {}
    for n in downs:
        down_by.setdefault(n.ntype, []).append(n)
    label = {"subject": "subject", "combination": "combination", "degree": "degree direction", "entrance": "entrance",
             "area": "career area", "interest": "interest"}
    parts = [f"{len(v)} {label[k]}{'s' if len(v) != 1 else ''}" for k, v in down_by.items()]
    if not parts and ups:
        up_by = {}
        for n in ups:
            up_by.setdefault(n.ntype, []).append(n)
        parts = ["Reached from " + ", ".join(f"{len(v)} {label[k]}{'s' if len(v) != 1 else ''}" for k, v in up_by.items())]
    return " · ".join(parts) or "No connections yet"


@router.get("/careers")
def careers(entity: str = "rules", _: User = Depends(require_staff), db: Session = Depends(get_db)):
    nodes = {n.id: n for n in db.scalars(select(CareerNode))}
    edges = list(db.scalars(select(CareerEdge)))
    counts = [{"k": k, "l": label, "n": (sum(1 for e in edges if e.requirement) if t is None else
                                         sum(1 for n in nodes.values() if n.ntype == t))} for k, label, t in ENTS]
    rows = []
    if entity == "rules":
        for e in edges:
            if not e.requirement:
                continue
            a, b = nodes.get(e.from_id), nodes.get(e.to_id)
            if not a or not b:
                continue
            kind = f"{a.ntype.capitalize()} → {b.ntype.capitalize()}"
            rows.append({"id": str(e.id), "is_rule": True, "n": e.label or f"{a.name} → {b.name}", "c": kind, "k": e.requirement,
                         "src": e.source_name or "—", "url": e.source_url, "d": fmt_date(e.verified_at),
                         "s": fact_status(e.verified_at, e.source_name), "up": [a.name], "down": [b.name], "note": e.note,
                         "from_id": str(a.id), "to_id": str(b.id)})
    else:
        t = NT.get(entity)
        for n in sorted((n for n in nodes.values() if n.ntype == t), key=lambda n: n.name):
            ups = [nodes[e.from_id] for e in edges if e.to_id == n.id and e.from_id in nodes]
            downs = [nodes[e.to_id] for e in edges if e.from_id == n.id and e.to_id in nodes]
            rows.append({"id": str(n.id), "is_rule": False, "n": n.name, "c": _summary(n.ntype, ups, downs), "k": "—",
                         "src": n.source_name or "—", "url": n.source_url, "d": fmt_date(n.verified_at),
                         "s": fact_status(n.verified_at, n.source_name), "up": [u.name for u in ups], "down": [d.name for d in downs],
                         "up_ids": [str(u.id) for u in ups], "down_ids": [str(d.id) for d in downs], "ntype": n.ntype,
                         "summary": n.summary, "description": n.description, "meta": n.meta})
    dims = [{"key": d.key, "label": d.label, "note": d.note} for d in db.scalars(select(CareerDimension).order_by(CareerDimension.position))]
    all_nodes = [{"id": str(n.id), "name": n.name, "type": n.ntype} for n in sorted(nodes.values(), key=lambda n: (n.ntype, n.name))]
    return {"counts": counts, "rows": rows, "dimensions": dims, "nodes": all_nodes}


class NodeIn(BaseModel):
    ntype: str
    name: str = Field(min_length=2, max_length=200)
    summary: str = ""
    description: str = ""
    meta: dict = {}
    source_name: str = ""
    source_url: str = ""
    verify: bool = False
    up_ids: list[uuid.UUID] = []
    down_ids: list[uuid.UUID] = []


@router.post("/careers/nodes")
def create_node(body: NodeIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    if body.ntype not in NT.values():
        raise HTTPException(400, "Unknown node type")
    if db.scalar(select(CareerNode).where(CareerNode.ntype == body.ntype, CareerNode.name == body.name)):
        raise HTTPException(400, "This already exists.")
    n = CareerNode(ntype=body.ntype, name=body.name, summary=body.summary, description=body.description, meta=body.meta,
                   source_name=body.source_name, source_url=body.source_url, verified_at=now() if body.verify and body.source_name else None)
    db.add(n)
    db.flush()
    for u in body.up_ids:
        db.add(CareerEdge(from_id=u, to_id=n.id))
    for d in body.down_ids:
        db.add(CareerEdge(from_id=n.id, to_id=d))
    db.commit()
    search.safe_reindex(db)
    return {"id": str(n.id)}


class NodePatch(BaseModel):
    name: str | None = None
    summary: str | None = None
    description: str | None = None
    meta: dict | None = None
    source_name: str | None = None
    source_url: str | None = None
    verify: bool = False
    up_ids: list[uuid.UUID] | None = None
    down_ids: list[uuid.UUID] | None = None


@router.patch("/careers/nodes/{nid}")
def patch_node(nid: str, body: NodePatch, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    n = get_or_404(db, CareerNode, nid, "node")
    data = body.model_dump(exclude_unset=True)
    for k in ("name", "summary", "description", "meta", "source_name", "source_url"):
        if data.get(k) is not None:
            setattr(n, k, data[k])
    if body.verify:
        if not n.source_name:
            raise HTTPException(400, "Record a source before marking this verified.")
        n.verified_at = now()
    if body.up_ids is not None:
        db.execute(delete(CareerEdge).where(CareerEdge.to_id == n.id, CareerEdge.requirement.is_(None)))
        for u in dict.fromkeys(body.up_ids):
            if not db.scalar(select(CareerEdge).where(CareerEdge.from_id == u, CareerEdge.to_id == n.id)):
                db.add(CareerEdge(from_id=u, to_id=n.id))
    if body.down_ids is not None:
        db.execute(delete(CareerEdge).where(CareerEdge.from_id == n.id, CareerEdge.requirement.is_(None)))
        for d in dict.fromkeys(body.down_ids):
            if not db.scalar(select(CareerEdge).where(CareerEdge.from_id == n.id, CareerEdge.to_id == d)):
                db.add(CareerEdge(from_id=n.id, to_id=d))
    db.commit()
    search.safe_reindex(db)
    return {"ok": True}


@router.delete("/careers/nodes/{nid}")
def delete_node(nid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    db.delete(get_or_404(db, CareerNode, nid, "node"))
    db.commit()
    search.safe_reindex(db)
    return {"ok": True}


class RuleIn(BaseModel):
    from_id: uuid.UUID
    to_id: uuid.UUID
    requirement: str = "Required"
    label: str = ""
    note: str = ""
    source_name: str = ""
    source_url: str = ""
    verify: bool = False


@router.post("/careers/rules")
def create_rule(body: RuleIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    if body.requirement not in ("Required", "Recommended", "Useful"):
        raise HTTPException(400, "Requirement must be Required, Recommended or Useful")
    e = db.scalar(select(CareerEdge).where(CareerEdge.from_id == body.from_id, CareerEdge.to_id == body.to_id))
    if e is None:
        e = CareerEdge(from_id=body.from_id, to_id=body.to_id)
        db.add(e)
    for k in ("requirement", "label", "note", "source_name", "source_url"):
        setattr(e, k, getattr(body, k))
    e.verified_at = now() if body.verify and body.source_name else e.verified_at
    db.commit()
    return {"id": str(e.id)}


class RulePatch(BaseModel):
    requirement: str | None = None
    label: str | None = None
    note: str | None = None
    source_name: str | None = None
    source_url: str | None = None
    verify: bool = False


@router.patch("/careers/rules/{eid}")
def patch_rule(eid: str, body: RulePatch, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    e = get_or_404(db, CareerEdge, eid, "rule")
    for k, v in body.model_dump(exclude_unset=True, exclude={"verify"}).items():
        if v is not None:
            setattr(e, k, v)
    if body.verify:
        if not e.source_name:
            raise HTTPException(400, "Record a source before marking this rule verified.")
        e.verified_at = now()
    db.commit()
    return {"ok": True}


@router.delete("/careers/rules/{eid}")
def delete_rule(eid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    db.delete(get_or_404(db, CareerEdge, eid, "rule"))
    db.commit()
    return {"ok": True}


class DimsIn(BaseModel):
    dimensions: list[dict]


@router.put("/careers/dimensions")
def set_dimensions(body: DimsIn, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    db.execute(delete(CareerDimension))
    for i, d in enumerate(body.dimensions):
        if d.get("key") and d.get("label"):
            db.add(CareerDimension(key=str(d["key"])[:40], label=str(d["label"])[:120], note=str(d.get("note", "")), position=i))
    db.commit()
    return {"ok": True}
