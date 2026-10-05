"""Admin console: Generated content review, Users, Invites and Privacy requests."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app import gotrue
from app.db import get_db
from app.gotrue import GoTrueError
from app.models import AdminInvite, ContentFlag, KbSource, PrivacyRequest, StudentProfile, StudyMaterial, User
from app.routers.auth import create_invite
from app.routers.common import class_num, fmt_date, get_or_404, now, rel_time, until
from app.security import require_admin, require_staff
from app.services import storage
from app.workers import tasks

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])

# --------------------------------------------------------------------------- generated content

GEN_STATUSES = ("Ready", "Processing", "Flagged", "Failed", "Disabled")
KIND = {"link": "Lecture video", "file": "Textbook", "slides": "Slide deck", "text": "Pasted text", "pack": "Revision pack"}


def gen_row(db: Session, m: StudyMaterial) -> dict:
    flags = list(db.scalars(select(ContentFlag).where(ContentFlag.material_id == m.id, ContentFlag.resolved.is_(False))))
    grouped: dict[tuple[str, str], int] = {}
    for f in flags:
        grouped[(f.category, f.note)] = grouped.get((f.category, f.note), 0) + 1
    o = m.outputs or {}
    ex = ""
    if o.get("full"):
        ex = o["full"][0]["p"][:220]
    elif m.status == "Processing":
        from app.services.notes import STEPS

        ex = f"{STEPS[min(m.stage, 4)]} · stage {min(m.stage, 4) + 1} of 5"
    elif m.status == "Failed":
        ex = m.error or "Nothing was generated."
    elif m.status == "Disabled":
        by = db.get(User, m.disabled_by) if m.disabled_by else None
        ex = f"Disabled by {by.name if by else 'an admin'} on {fmt_date(m.disabled_at)}."
    return {"id": str(m.id), "t": m.title, "kind": KIND.get(m.input_kind, m.input_kind), "src": m.source_label or "—",
            "sub": m.subject_label or "—", "when": rel_time(m.created_at), "s": m.status,
            "flags": [{"a": c, "b": n or "—", "c": f"{k} student{'s' if k != 1 else ''}"} for (c, n), k in grouped.items()],
            "views": m.views, "ex": ex}


@router.get("/generated")
def list_generated(status: str = "All", _: User = Depends(require_staff), db: Session = Depends(get_db)):
    counts = dict(db.execute(select(StudyMaterial.status, func.count()).group_by(StudyMaterial.status)).all())
    base = select(StudyMaterial)
    if status != "All":
        base = base.where(StudyMaterial.status == status)
    rows = db.scalars(base.order_by(StudyMaterial.updated_at.desc()).limit(300))
    return {"counts": {"All": sum(counts.values()), **{s: counts.get(s, 0) for s in GEN_STATUSES}},
            "rows": [gen_row(db, m) for m in rows]}


@router.get("/generated/{mid}")
def generated_detail(mid: str, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    m = get_or_404(db, StudyMaterial, mid, "material")
    src = db.get(KbSource, m.source_id) if m.source_id else None
    return {**gen_row(db, m), "outputs": m.outputs or {}, "source": {"title": src.title, "url": src.url} if src else None}


class GenAction(BaseModel):
    action: str  # approve | regenerate | disable


@router.post("/generated/{mid}")
def act_generated(mid: str, body: GenAction, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    m = get_or_404(db, StudyMaterial, mid, "material")
    if body.action == "approve":
        for f in db.scalars(select(ContentFlag).where(ContentFlag.material_id == m.id)):
            f.resolved = True
        m.status = "Ready" if m.outputs else m.status
        m.disabled_by = m.disabled_at = None
    elif body.action == "regenerate":
        for f in db.scalars(select(ContentFlag).where(ContentFlag.material_id == m.id)):
            f.resolved = True
        m.status, m.stage, m.error = "Processing", 0, ""
        db.commit()
        tasks.generate_material.delay(str(m.id), (m.outputs or {}).get("lang", "en"))
    elif body.action == "disable":
        m.status, m.disabled_by, m.disabled_at = "Disabled", user.id, now()
    else:
        raise HTTPException(400, "Unknown action")
    db.commit()
    return gen_row(db, m)


# --------------------------------------------------------------------------- users

ROLE_LABEL = {"student": "Student", "curator": "Curator", "admin": "Admin"}


def mask(email: str | None) -> str:
    if not email or "@" not in email:
        return email or "—"
    name, dom = email.split("@", 1)
    return f"{name[:7]}•••@{dom}" if len(name) > 3 else f"{name[0]}•••@{dom}"


@router.get("/users")
def list_users(q: str = "", role: str = "All", _: User = Depends(require_staff), db: Session = Depends(get_db)):
    cnt = dict(db.execute(select(User.role, func.count()).where(User.status != "invited").group_by(User.role)).all())
    open_priv = db.scalar(select(func.count()).select_from(PrivacyRequest).where(PrivacyRequest.status == "open")) or 0
    base = select(User)
    if role != "All":
        base = base.where(User.role == {"Student": "student", "Curator": "curator", "Admin": "admin"}.get(role, role))
    if q:
        base = base.where(or_(User.name.ilike(f"%{q}%"), User.email.ilike(f"%{q}%")))
    rows = []
    for u in db.scalars(base.order_by(User.created_at.desc()).limit(300)):
        p = db.get(StudentProfile, u.id)
        cls = f"Class {class_num(p.class_level)} · {p.board}" if p and p.class_level else "—"
        status = {"active": "Active", "suspended": "Suspended", "invited": "Invited"}.get(u.status, u.status)
        rows.append({"id": str(u.id), "n": u.name or "(no name yet)", "e": mask(u.email) if u.role == "student" else (u.email or "—"),
                     "c": cls if u.role == "student" else "—", "r": ROLE_LABEL.get(u.role, u.role), "j": fmt_date(u.created_at),
                     "a": rel_time(u.last_seen_at) if u.last_seen_at else "—", "s": status,
                     "ini": "".join(w[0] for w in (u.name or u.email or "?").split()[:2]).upper()})
    return {"stats": [{"l": "Students", "v": f"{cnt.get('student', 0):,}", "icon": "school"},
                      {"l": "Curators", "v": f"{cnt.get('curator', 0):,}", "icon": "edit_note"},
                      {"l": "Admins", "v": f"{cnt.get('admin', 0):,}", "icon": "shield_person"},
                      {"l": "Open privacy requests", "v": str(open_priv), "icon": "lock"}],
            "rows": rows}


class UserPatch(BaseModel):
    status: str | None = None  # active | suspended
    role: str | None = None  # student | curator | admin


@router.patch("/users/{uid}")
def patch_user(uid: str, body: UserPatch, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = get_or_404(db, User, uid, "user")
    if u.id == admin.id and (body.status == "suspended" or (body.role and body.role != "admin")):
        raise HTTPException(400, "You can't suspend yourself or remove your own admin role.")
    if body.status:
        if body.status not in ("active", "suspended"):
            raise HTTPException(400, "Unknown status")
        u.status = body.status
    if body.role:
        if body.role not in ROLE_LABEL:
            raise HTTPException(400, "Unknown role")
        if u.role == "admin" and body.role != "admin":
            admins = db.scalar(select(func.count()).select_from(User).where(User.role == "admin", User.status == "active"))
            if admins <= 1:
                raise HTTPException(400, "There must be at least one admin.")
        u.role = body.role
    db.commit()
    return {"ok": True}


@router.get("/invites")
def list_invites(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.scalars(select(AdminInvite).where(AdminInvite.accepted_at.is_(None), AdminInvite.revoked_at.is_(None))
                      .order_by(AdminInvite.created_at.desc()))
    return [{"id": str(i.id), "email": i.email, "role": ROLE_LABEL.get(i.role, i.role), "expires": until(i.expires_at),
             "expired": i.expires_at < now(), "sent": rel_time(i.created_at)} for i in rows]


class InviteIn(BaseModel):
    email: EmailStr
    role: str = "curator"


@router.post("/invites")
def invite(body: InviteIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    inv, link, sent = create_invite(db, admin, str(body.email), body.role)
    return {"id": str(inv.id), "link": link, "email_sent": sent}


@router.delete("/invites/{iid}")
def revoke_invite(iid: str, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    inv = get_or_404(db, AdminInvite, iid, "invite")
    inv.revoked_at = now()
    u = db.scalar(select(User).where(func.lower(User.email) == inv.email, User.status == "invited"))
    if u:
        db.delete(u)
        try:
            gotrue.admin_delete_user(str(u.id))
        except GoTrueError as e:
            log.warning("Could not delete invited GoTrue user: %s", e)
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- privacy


@router.get("/privacy")
def privacy(status: str = "open", _: User = Depends(require_admin), db: Session = Depends(get_db)):
    base = select(PrivacyRequest)
    if status != "all":
        base = base.where(PrivacyRequest.status == status)
    rows = db.scalars(base.order_by(PrivacyRequest.due_at))
    icon = {"Data export": "download", "Account deletion": "delete", "Data correction": "edit"}
    return [{"id": str(r.id), "t": r.kind, "n": r.user_label, "d": f"Due {until(r.due_at)}", "icon": icon.get(r.kind, "lock"),
             "details": r.details, "status": r.status, "download": bool(r.result_path)} for r in rows]


class ResolveIn(BaseModel):
    action: str  # complete | reject
    note: str = ""


@router.post("/privacy/{rid}")
def resolve_privacy(rid: str, body: ResolveIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    r = get_or_404(db, PrivacyRequest, rid, "request")
    if r.status != "open":
        raise HTTPException(400, "Already resolved")
    if body.action == "reject":
        r.status = "rejected"
    elif body.action == "complete":
        if r.kind == "Data export":
            u = db.get(User, r.user_id) if r.user_id else None
            if not u:
                raise HTTPException(400, "The account no longer exists.")
            r.result_path = tasks.export_user_data(db, u)
        elif r.kind == "Account deletion":
            u = db.get(User, r.user_id) if r.user_id else None
            if u:
                if u.role != "student":
                    raise HTTPException(400, "Remove staff access before deleting a staff account.")
                try:
                    gotrue.admin_delete_user(str(u.id))
                except GoTrueError as e:
                    raise HTTPException(502, f"Could not delete the login: {e.message}") from e
                db.delete(u)  # cascades to all personal data
        r.status = "completed"
    else:
        raise HTTPException(400, "Unknown action")
    r.resolved_by, r.resolved_at = admin.id, now()
    db.commit()
    return {"ok": True, "status": r.status}


@router.get("/privacy/{rid}/download")
def privacy_download(rid: str, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    r = get_or_404(db, PrivacyRequest, rid, "request")
    if not r.result_path:
        raise HTTPException(404)
    return FileResponse(storage.safe_path(r.result_path), filename="data-export.json", media_type="application/json")
