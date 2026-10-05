"""Exam Prep and Career Explorer (student side)."""
import uuid
from collections import Counter, deque

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    CareerDimension,
    CareerEdge,
    CareerNode,
    Exam,
    ExamTopic,
    StudentExamPlan,
    StudentExamTopic,
    StudentProfile,
    User,
)
from app.routers.common import fact_status, fmt_date, get_or_404, now, track
from app.security import student_user
from app.services import planner

router = APIRouter(prefix="/api", tags=["explore"])

# --------------------------------------------------------------------------- exams


def _profile(db: Session, user: User) -> StudentProfile:
    from app.routers.me import profile_of

    return profile_of(db, user)


@router.get("/exams")
def list_exams(user: User = Depends(student_user), db: Session = Depends(get_db)):
    p = _profile(db, user)
    mine = set(p.exam_ids or [])
    return [{"id": str(e.id), "code": e.code, "name": e.name, "full_name": e.full_name, "following": e.id in mine}
            for e in db.scalars(select(Exam).where(Exam.status == "Active").order_by(Exam.name))]


def exam_overview(db: Session, user: User, e: Exam) -> dict:
    plan = db.get(StudentExamPlan, (user.id, e.id))
    tree = planner.exam_tree(db, user.id, e)
    all_t = [dict(t, unit=u["name"], sub=u["sub"]) for u in tree for t in u["topics"]]
    subs = []
    for s in e.subjects:
        ts = [t for t in all_t if t["sub"] == s.name]
        subs.append({"n": s.name, "p": planner.pct(ts), "units": [u for u in tree if u["sub"] == s.name]})
    hours = plan.hours_per_week if plan else 6
    strat = planner.strategy(tree, hours)
    facts = [{"k": f.key, "v": f.value, "src": f.source_name or "—", "url": f.source_url,
              "d": fmt_date(f.verified_at), "s": fact_status(f.verified_at, f.source_name)} for f in e.facts]
    return {
        "id": str(e.id), "name": e.name, "full_name": e.full_name, "description": e.description,
        "target_session": plan.target_session if plan else "", "hours": hours,
        "pct": planner.pct(all_t), "subjects": subs, "tree": tree,
        "priority": [t for t in all_t if t["prio"] == "High" and t["status"] != "Confident"][:4],
        "revision_due": [t for t in all_t if t["status"] == "Revision due"],
        "plan_today": strat["today"], "strategy": strat, "facts": facts,
        "dates_known": any("date" in f.key.lower() and f.value and "not yet" not in f.value.lower() for f in e.facts),
    }


@router.get("/exams/{eid}")
def exam_detail(eid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    e = get_or_404(db, Exam, eid, "exam")
    if e.status != "Active":
        raise HTTPException(404, "Exam not found")
    track(db, user, "exam_view", e.id, "exam")
    db.commit()
    return exam_overview(db, user, e)


class TopicStatusIn(BaseModel):
    status: str


@router.put("/exams/{eid}/topics/{tid}")
def set_topic_status(eid: str, tid: str, body: TopicStatusIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    if body.status not in planner.STATUS_SCORE:
        raise HTTPException(400, "Unknown status")
    t = get_or_404(db, ExamTopic, tid, "topic")
    st = db.get(StudentExamTopic, (user.id, t.id)) or StudentExamTopic(user_id=user.id, exam_topic_id=t.id)
    st.status = body.status
    db.merge(st)
    track(db, user, "exam_topic", t.id, "exam", status=body.status)
    db.commit()
    return {"status": body.status}


class PlanIn(BaseModel):
    target_session: str | None = Field(None, max_length=60)
    hours_per_week: int | None = Field(None, ge=1, le=60)


@router.put("/exams/{eid}/plan")
def set_plan(eid: str, body: PlanIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    e = get_or_404(db, Exam, eid, "exam")
    plan = db.get(StudentExamPlan, (user.id, e.id)) or StudentExamPlan(user_id=user.id, exam_id=e.id)
    if body.target_session is not None:
        plan.target_session = body.target_session
    if body.hours_per_week is not None:
        plan.hours_per_week = body.hours_per_week
    plan.generated_at = now()
    db.merge(plan)
    p = _profile(db, user)
    if e.id not in (p.exam_ids or []):
        p.exam_ids = [*(p.exam_ids or []), e.id]
    db.commit()
    return exam_overview(db, user, e)


@router.post("/exams/{eid}/follow")
def follow(eid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    e = get_or_404(db, Exam, eid, "exam")
    p = _profile(db, user)
    ids = list(p.exam_ids or [])
    p.exam_ids = [x for x in ids if x != e.id] if e.id in ids else [*ids, e.id]
    db.commit()
    return {"following": e.id in p.exam_ids}


# --------------------------------------------------------------------------- careers

COLS = [("interest", "Interest"), ("subject", "Subjects"), ("combination", "Combination"),
        ("degree", "Degree direction"), ("entrance", "Entrance"), ("area", "Career area")]
ACTIVITIES = ["Working with numbers", "Reading news", "Debating", "Building things", "Drawing and design",
              "Helping people", "Solving puzzles", "Writing", "Understanding markets"]
IDEAS = ["Yes, a few", "Some vague ones", "Not really"]


def _graph(db: Session) -> tuple[dict[uuid.UUID, CareerNode], list[CareerEdge]]:
    nodes = {n.id: n for n in db.scalars(select(CareerNode))}
    edges = list(db.scalars(select(CareerEdge)))
    return nodes, edges


def directions(db: Session, likes: list[str], limit: int = 6) -> list[dict]:
    nodes, edges = _graph(db)
    out: dict[uuid.UUID, list[uuid.UUID]] = {}
    for e in edges:
        out.setdefault(e.from_id, []).append(e.to_id)
    starts = [n.id for n in nodes.values() if n.ntype == "interest" and n.name in likes]
    starts += [n.id for n in nodes.values() if n.ntype == "subject" and any(n.name.startswith(x) for x in likes)]
    score: Counter = Counter()
    for s in starts:
        seen = {s}
        dq = deque([(s, 0)])
        while dq:
            cur, d = dq.popleft()
            if nodes[cur].ntype == "area":
                score[cur] += 1 / (1 + d * 0.2)
                continue
            for nx in out.get(cur, []):
                if nx not in seen and nx in nodes:
                    seen.add(nx)
                    dq.append((nx, d + 1))
    return [{"id": str(i), "t": nodes[i].name, "icon": nodes[i].meta.get("icon", "explore"), "summary": nodes[i].summary}
            for i, _ in score.most_common(limit)]


@router.get("/careers/profile")
def career_profile(user: User = Depends(student_user), db: Session = Depends(get_db)):
    p = _profile(db, user)
    cp = p.career_profile or {}
    interests = [n.name for n in db.scalars(select(CareerNode).where(CareerNode.ntype == "interest").order_by(CareerNode.name))]
    subjects = [n.name for n in db.scalars(select(CareerNode).where(CareerNode.ntype == "subject").order_by(CareerNode.name))]
    return {"profile": {"likes": cp.get("likes", []), "acts": cp.get("acts", []), "unsure": cp.get("unsure", []),
                        "ideas": cp.get("ideas", "")},
            "options": {"likes": interests, "acts": ACTIVITIES, "unsure": subjects, "ideas": IDEAS},
            "directions": directions(db, cp.get("likes", []))}


class CareerProfileIn(BaseModel):
    likes: list[str] = []
    acts: list[str] = []
    unsure: list[str] = []
    ideas: str = ""


@router.put("/careers/profile")
def save_career_profile(body: CareerProfileIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    p = _profile(db, user)
    p.career_profile = body.model_dump()
    track(db, user, "career_profile", None, "career")
    db.commit()
    return {"directions": directions(db, body.likes)}


def combo_out(db: Session, c: CareerNode, nodes: dict, edges: list[CareerEdge]) -> dict:
    subs = [nodes[e.from_id].name for e in edges if e.to_id == c.id and nodes[e.from_id].ntype == "subject"]
    subs = c.meta.get("subjects") or subs
    degrees = [nodes[e.to_id] for e in edges if e.from_id == c.id and nodes[e.to_id].ntype == "degree"]
    deg_ids = {d.id for d in degrees}
    req = []
    for e in edges:
        if e.requirement and e.to_id in deg_ids:
            frm = nodes[e.from_id]
            if frm.ntype == "subject" and (not subs or any(frm.name.startswith(s.split(" (")[0]) for s in subs)) or frm.id == c.id:
                req.append({"a": frm.name if frm.id != c.id else "This combination", "k": e.requirement,
                            "b": e.note or f"for {nodes[e.to_id].name}"})
    return {"id": str(c.id), "name": c.name, "summary": c.summary, "subs": subs, "dirs": [d.name for d in degrees],
            "req": req[:4], "cons": c.meta.get("considerations", ""), "dims": c.meta.get("dimensions", {})}


@router.get("/careers/combinations")
def combinations(user: User = Depends(student_user), db: Session = Depends(get_db)):
    nodes, edges = _graph(db)
    combos = [combo_out(db, n, nodes, edges) for n in nodes.values() if n.ntype == "combination"]
    dims = [{"key": d.key, "label": d.label, "note": d.note}
            for d in db.scalars(select(CareerDimension).order_by(CareerDimension.position))]
    track(db, user, "career_view", None, "career", view="combos")
    db.commit()
    return {"combinations": sorted(combos, key=lambda c: c["name"]), "dimensions": dims}


@router.get("/careers/graph")
def graph(user: User = Depends(student_user), db: Session = Depends(get_db)):
    nodes, edges = _graph(db)
    cols = [{"type": t, "label": label, "nodes": [{"id": str(n.id), "l": n.name} for n in
                                                  sorted((n for n in nodes.values() if n.ntype == t), key=lambda n: n.name)]}
            for t, label in COLS]
    track(db, user, "career_view", None, "career", view="graph")
    db.commit()
    return {"columns": cols, "edges": [[str(e.from_id), str(e.to_id)] for e in edges if e.from_id in nodes and e.to_id in nodes]}


@router.get("/careers/nodes/{nid}")
def node_detail(nid: str, user: User = Depends(student_user), db: Session = Depends(get_db)):
    n = get_or_404(db, CareerNode, nid, "node")
    facts = []
    for e in db.scalars(select(CareerEdge).where((CareerEdge.from_id == n.id) | (CareerEdge.to_id == n.id),
                                                 CareerEdge.requirement.is_not(None))):
        other = db.get(CareerNode, e.to_id if e.from_id == n.id else e.from_id)
        st = fact_status(e.verified_at, e.source_name)
        facts.append({"a": e.label or (f"{db.get(CareerNode, e.from_id).name} → {db.get(CareerNode, e.to_id).name}"),
                      "k": e.requirement, "b": e.note or (other.name if other else ""),
                      "src": e.source_name or "No source recorded", "url": e.source_url,
                      "v": ("Verified " + fmt_date(e.verified_at)) if st == "Verified" else
                           ("Last verified " + fmt_date(e.verified_at) if e.verified_at else "Not verified yet"),
                      "stale": st != "Verified"})
    return {"id": str(n.id), "l": n.name, "type": dict(COLS)[n.ntype], "d": n.description or n.summary, "facts": facts}


class SavePathIn(BaseModel):
    node_id: uuid.UUID


@router.post("/careers/save")
def save_pathway(body: SavePathIn, user: User = Depends(student_user), db: Session = Depends(get_db)):
    from app.models import SavedItem

    n = get_or_404(db, CareerNode, body.node_id, "node")
    if not db.scalar(select(SavedItem).where(SavedItem.user_id == user.id, SavedItem.kind == "pathway", SavedItem.ref_id == n.id)):
        db.add(SavedItem(user_id=user.id, kind="pathway", ref_id=n.id, label=n.name))
        db.commit()
    return {"saved": True}
