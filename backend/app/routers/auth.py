"""Sign-up, log-in and session endpoints for both the student app and the
invite-only admin console. GoTrue does the credential work; this layer keeps
tokens in httpOnly cookies and applies IntelliNova's account rules."""
import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import gotrue
from app.config import settings
from app.db import get_db
from app.gotrue import GoTrueError
from app.models import AdminInvite, StudentProfile, User
from app.security import (
    COOKIES,
    STAFF_ROLES,
    current_user,
    decode_token,
    portal_for_role,
    request_portal,
    require_admin,
    token_from_request,
    upsert_user_from_claims,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

REFRESH_MAX_AGE = 60 * 60 * 24 * 30


# --------------------------------------------------------------------------- helpers


def _friendly(e: GoTrueError) -> str:
    m = e.message.lower()
    if "invalid login credentials" in m:
        return "That email and password don't match."
    if "email not confirmed" in m:
        return "Verify your email first: enter the 6-digit code from your sign-up email."
    if "already registered" in m or "already been registered" in m or e.code == "user_already_exists":
        return "An account with this email already exists. Log in instead."
    if "token has expired" in m or "otp_expired" in e.code or "invalid" in m and "otp" in m:
        return "That code is wrong or has expired. Request a new one."
    if "rate limit" in m or e.status == 429:
        return "Too many emails or attempts in a short time. Wait a few minutes and try again."
    if "password" in m and ("weak" in m or "at least" in m):
        return "Choose a stronger password (at least 8 characters with a number)."
    return e.message


def _gt(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except GoTrueError as e:
        raise HTTPException(400 if e.status < 500 else 502, _friendly(e)) from e


def _set_session(resp: Response, session: dict, remember: bool = True, portal: str = "student") -> None:
    """Session cookies for one app: students get the student app's, admins and curators the console's."""
    access_c, refresh_c, marker_c = COOKIES[portal]
    access = session.get("access_token")
    refresh = session.get("refresh_token")
    if not access:
        raise HTTPException(502, "Sign-in did not return a session")
    resp.set_cookie(
        access_c, access, httponly=True, secure=settings.cookie_secure, samesite="lax",
        max_age=int(session.get("expires_in") or 3600), path="/",
    )
    if refresh:
        resp.set_cookie(
            refresh_c, refresh, httponly=True, secure=settings.cookie_secure, samesite="lax",
            max_age=REFRESH_MAX_AGE if remember else None, path="/api/auth",
        )
        # The refresh token is only sent to /api/auth. This marker (no secret in it) tells the web app's
        # page gate that a session can still be refreshed after the short-lived access cookie expires.
        resp.set_cookie(marker_c, "1", httponly=True, secure=settings.cookie_secure, samesite="lax",
                        max_age=REFRESH_MAX_AGE if remember else None, path="/")


def _clear_session(resp: Response, portal: str | None = None) -> None:
    for p in [portal] if portal else list(COOKIES):
        access_c, refresh_c, marker_c = COOKIES[p]
        resp.delete_cookie(access_c, path="/")
        resp.delete_cookie(refresh_c, path="/api/auth")
        resp.delete_cookie(marker_c, path="/")


def _signed_out(status: int, detail: str, portal: str | None = None) -> JSONResponse:
    """An error that also removes the session cookies. (Cookies set on an injected Response are dropped
    when an HTTPException is raised, so a dead session would otherwise stick around.)"""
    out = JSONResponse({"detail": detail}, status_code=status)
    _clear_session(out, portal)
    return out


def _sign_in(resp: Response, session: dict, user: User, remember: bool = True) -> None:
    _set_session(resp, session, remember, portal_for_role(user.role))


def _user_out(db: Session, user: User) -> dict:
    prof = db.get(StudentProfile, user.id)
    return {
        "id": str(user.id),
        "email": user.email,
        "phone": user.phone,
        "name": user.name,
        "role": user.role,
        "status": user.status,
        "is_staff": user.role in STAFF_ROLES,
        "onboarded": bool(prof and prof.onboarded_at),
    }


def _session_user(db: Session, session: dict) -> User:
    claims = decode_token(session["access_token"])
    return upsert_user_from_claims(db, claims)


def _admins_exist(db: Session) -> bool:
    return bool(db.scalar(select(func.count()).select_from(User).where(User.role == "admin")))


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


PW_RE = re.compile(r"\d")


def _check_password(pw: str) -> None:
    if len(pw) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    if not PW_RE.search(pw):
        raise HTTPException(400, "Password needs at least one number.")


# --------------------------------------------------------------------------- settings


@router.get("/settings")
def auth_settings(db: Session = Depends(get_db)):
    try:
        s = gotrue.settings_info()
    except GoTrueError:
        s = {}
    ext = s.get("external", {})
    return {
        "email": ext.get("email", True),
        "google": bool(ext.get("google")),
        "phone": bool(ext.get("phone")),
        "signup_enabled": not s.get("disable_signup", False),
        "email_verification": not s.get("mailer_autoconfirm", False),
        "admin_bootstrap": not _admins_exist(db),
        "admin_bootstrap_needs_token": bool(settings.admin_bootstrap_token),
    }


# --------------------------------------------------------------------------- student auth


class SignupIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    password: str
    accepted_terms: bool


@router.post("/signup")
def signup(body: SignupIn, response: Response, db: Session = Depends(get_db)):
    if not body.accepted_terms:
        raise HTTPException(400, "Please accept the terms to continue.")
    _check_password(body.password)
    res = _gt(gotrue.signup, body.email.lower(), body.password, {"name": body.name.strip()})
    if not res.get("access_token") and res.get("identities") == []:
        # GoTrue answers "success" but sends no email when the address already has a confirmed account,
        # which left people waiting for a code that never comes. Say what happened instead.
        existing = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
        if existing and existing.role in STAFF_ROLES:
            raise HTTPException(409, "This email belongs to an admin account. Log in on the admin console at /admin/login.")
        raise HTTPException(409, "An account with this email already exists. Log in instead, or use “Forgot password?”.")
    # With mailer autoconfirm GoTrue returns a session immediately.
    if res.get("access_token"):
        user = _session_user(db, res)
        _sign_in(response, res, user)
        return {"status": "signed_in", "user": _user_out(db, user)}
    return {"status": "verify", "email": body.email.lower()}


class VerifyIn(BaseModel):
    type: str = "signup"  # signup | sms | email | recovery
    token: str = Field(min_length=6, max_length=10)
    email: EmailStr | None = None
    phone: str | None = None
    remember: bool = True


@router.post("/verify")
def verify(body: VerifyIn, response: Response, db: Session = Depends(get_db)):
    if body.type not in {"signup", "sms", "email", "recovery", "magiclink"}:
        raise HTTPException(400, "Unknown verification type")
    phone = _norm_phone(body.phone) if body.phone else None
    res = _gt(gotrue.verify, body.type, body.token, email=(body.email or None), phone=phone)
    user = _session_user(db, res)
    if user.status == "suspended":
        gotrue.logout(res["access_token"])
        raise HTTPException(403, "This account is suspended.")
    if phone and not user.phone:
        user.phone = phone
        db.commit()
    _sign_in(response, res, user, body.remember)
    return {"status": "signed_in", "user": _user_out(db, user)}


class ResendIn(BaseModel):
    type: str = "signup"
    email: EmailStr | None = None
    phone: str | None = None


@router.post("/resend")
def resend(body: ResendIn):
    if body.phone:
        _gt(gotrue.send_phone_otp, _norm_phone(body.phone), True)
    else:
        _gt(gotrue.resend, body.type, email=body.email)
    return {"ok": True}


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    remember: bool = True
    portal: str = "student"  # student | admin


@router.post("/login")
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    try:
        res = gotrue.password_grant(body.email.lower(), body.password)
    except GoTrueError as e:
        if "email not confirmed" in e.message.lower() and body.portal != "admin":
            # Signed up earlier but never entered the code: send a new one (GoTrue doesn't on login).
            try:
                gotrue.resend("signup", email=body.email.lower())
            except GoTrueError as e2:
                if e2.status == 429:
                    raise HTTPException(429, _friendly(e2)) from e2
            return {"status": "verify", "email": body.email.lower()}
        raise HTTPException(400 if e.status < 500 else 502, _friendly(e)) from e
    user = _session_user(db, res)
    if user.status == "suspended":
        gotrue.logout(res["access_token"])
        raise HTTPException(403, "This account is suspended. Contact your school or the IntelliNova team.")
    if body.portal == "admin" and user.role not in STAFF_ROLES:
        gotrue.logout(res["access_token"])
        raise HTTPException(403, "This account doesn't have admin console access. Ask an admin for an invite.")
    if body.portal != "admin" and user.role in STAFF_ROLES:
        gotrue.logout(res["access_token"])
        raise HTTPException(403, "This is an admin account. Log in on the admin console at /admin/login.")
    _sign_in(response, res, user, body.remember)
    return {"status": "signed_in", "user": _user_out(db, user)}


def _norm_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        digits = "91" + digits
    if len(digits) < 11:
        raise HTTPException(400, "Enter a 10-digit mobile number.")
    return digits


class PhoneIn(BaseModel):
    phone: str
    create: bool = True


@router.post("/otp")
def phone_otp(body: PhoneIn):
    _gt(gotrue.send_phone_otp, _norm_phone(body.phone), body.create)
    return {"ok": True}


@router.post("/refresh")
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    portal = request_portal(request) or "student"
    rt = request.cookies.get(COOKIES[portal][1])
    if not rt:
        return _signed_out(401, "Not signed in", portal)
    try:
        res = gotrue.refresh_grant(rt)
    except GoTrueError:
        return _signed_out(401, "Session expired", portal)
    user = _session_user(db, res)
    if user.status == "suspended":
        return _signed_out(403, "This account is suspended.", portal)
    if portal_for_role(user.role) != portal:
        # A session from before the apps had separate sessions, or a role that changed: log in again.
        return _signed_out(401, "Please log in again.", portal)
    _set_session(response, res, portal=portal)
    return {"status": "signed_in", "user": _user_out(db, user)}


@router.post("/logout")
def logout(request: Request, response: Response):
    token = token_from_request(request)
    if token:
        gotrue.logout(token)
    _clear_session(response, request_portal(request))
    return {"ok": True}


class RecoverIn(BaseModel):
    email: EmailStr
    portal: str = "student"


@router.post("/recover")
def recover(body: RecoverIn, db: Session = Depends(get_db)):
    path = "/admin/reset-password" if body.portal == "admin" else "/reset-password"
    local = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if local and (body.portal == "admin") != (local.role in STAFF_ROLES):
        raise HTTPException(404, "No admin account uses this email." if body.portal == "admin"
                            else "This email belongs to an admin account. Reset it from the admin console login.")
    try:
        found = gotrue.admin_find_user_by_email(body.email.lower())
    except GoTrueError:
        found = True  # can't check: try anyway
    if not found:
        # GoTrue would answer "ok" and send nothing; a school app is better served by saying so.
        raise HTTPException(404, "No account uses this email. Check the spelling, or create an account.")
    try:
        gotrue.recover(body.email.lower(), settings.public_url + path)
    except GoTrueError as e:
        if e.status == 429:
            raise HTTPException(429, _friendly(e)) from e
    return {"ok": True}


class ResetIn(BaseModel):
    password: str
    email: EmailStr | None = None
    token: str | None = None
    token_hash: str | None = None


@router.post("/reset-password")
def reset_password(body: ResetIn, response: Response, db: Session = Depends(get_db)):
    _check_password(body.password)
    if body.token_hash:
        res = _gt(gotrue.verify, "recovery", "", token_hash=body.token_hash)
    elif body.token and body.email:
        res = _gt(gotrue.verify, "recovery", body.token, email=body.email)
    else:
        raise HTTPException(400, "The reset link is incomplete. Request a new one.")
    _gt(gotrue.update_user, res["access_token"], {"password": body.password})
    user = _session_user(db, res)
    _sign_in(response, res, user)
    return {"status": "signed_in", "user": _user_out(db, user)}


class SessionIn(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int = 3600


@router.post("/session")
def adopt_session(body: SessionIn, response: Response, db: Session = Depends(get_db)):
    """OAuth callback: GoTrue redirects to /auth/callback#access_token=...; the page posts it here."""
    user = _session_user(db, body.model_dump())
    if user.status == "suspended":
        raise HTTPException(403, "This account is suspended.")
    if user.role in STAFF_ROLES:  # Google sign-in is on the student login only
        gotrue.logout(body.access_token)
        raise HTTPException(403, "This is an admin account. Log in on the admin console at /admin/login.")
    _sign_in(response, body.model_dump(), user)
    return {"status": "signed_in", "user": _user_out(db, user)}


@router.get("/google")
def google_url(next: str = "/app"):
    return {"url": gotrue.authorize_url("google", settings.public_url + "/auth/callback?next=" + next)}


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _user_out(db, user)


class ChangePasswordIn(BaseModel):
    password: str


@router.post("/change-password")
def change_password(body: ChangePasswordIn, request: Request, user: User = Depends(current_user)):
    _check_password(body.password)
    _gt(gotrue.update_user, token_from_request(request), {"password": body.password})
    return {"ok": True}


# --------------------------------------------------------------------------- admin console accounts


@router.get("/admin/invite/{token}")
def invite_info(token: str, db: Session = Depends(get_db)):
    inv = db.scalar(select(AdminInvite).where(AdminInvite.token_hash == _hash(token)))
    now = datetime.now(timezone.utc)
    if not inv or inv.revoked_at or inv.accepted_at or inv.expires_at < now:
        raise HTTPException(404, "This invite link is invalid or has expired. Ask an admin for a new one.")
    return {"email": inv.email, "role": inv.role, "expires_at": inv.expires_at.isoformat()}


class AdminSignupIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    password: str
    invite_token: str | None = None
    bootstrap_token: str | None = None


@router.post("/admin/signup")
def admin_signup(body: AdminSignupIn, response: Response, db: Session = Depends(get_db)):
    """Invite-only. The very first account on a fresh install becomes the admin."""
    _check_password(body.password)
    email = body.email.lower()
    now = datetime.now(timezone.utc)

    if body.invite_token:
        inv = db.scalar(
            select(AdminInvite).where(AdminInvite.token_hash == _hash(body.invite_token)).with_for_update()
        )
        if not inv or inv.revoked_at or inv.accepted_at or inv.expires_at < now:
            raise HTTPException(400, "This invite link is invalid or has expired.")
        if inv.email.lower() != email:
            raise HTTPException(400, "Use the email address the invite was sent to.")
        role = inv.role
        existing = db.scalar(select(User).where(func.lower(User.email) == email))
        if existing and existing.status == "active" and existing.role in STAFF_ROLES:
            raise HTTPException(400, "This account already exists. Log in instead.")
        gt_user = gotrue.admin_find_user_by_email(email)
        if gt_user:
            _gt(gotrue.admin_update_user, gt_user["id"],
                {"password": body.password, "email_confirm": True, "user_metadata": {"name": body.name.strip()}})
            gid = gt_user["id"]
        else:
            gid = _gt(gotrue.admin_create_user, email, body.password, body.name.strip(), True)["id"]
        inv.accepted_at = now
    else:
        if _admins_exist(db):
            raise HTTPException(403, "Admin accounts are invite-only. Ask an existing admin to invite you.")
        if settings.admin_bootstrap_token and not secrets.compare_digest(
            body.bootstrap_token or "", settings.admin_bootstrap_token
        ):
            raise HTTPException(403, "Enter the setup token from the server configuration.")
        role = "admin"
        gt_user = gotrue.admin_find_user_by_email(email)
        if gt_user:
            _gt(gotrue.admin_update_user, gt_user["id"],
                {"password": body.password, "email_confirm": True, "user_metadata": {"name": body.name.strip()}})
            gid = gt_user["id"]
        else:
            gid = _gt(gotrue.admin_create_user, email, body.password, body.name.strip(), True)["id"]

    user = db.get(User, uuid.UUID(gid))
    if user is None:
        user = User(id=uuid.UUID(gid), email=email, name=body.name.strip(), role=role, status="active")
        db.add(user)
    else:
        user.email, user.name, user.role, user.status = email, body.name.strip(), role, "active"
    db.commit()

    res = _gt(gotrue.password_grant, email, body.password)
    _sign_in(response, res, user)
    return {"status": "signed_in", "user": _user_out(db, user)}


class InviteIn(BaseModel):
    email: EmailStr
    role: str = "curator"


def create_invite(db: Session, inviter: User, email: str, role: str) -> tuple[AdminInvite, str, bool]:
    """Returns (invite, signup_link, email_sent)."""
    if role not in STAFF_ROLES:
        raise HTTPException(400, "Role must be curator or admin")
    email = email.lower()
    existing = db.scalar(select(User).where(func.lower(User.email) == email))
    if existing and existing.role in STAFF_ROLES and existing.status == "active":
        raise HTTPException(400, "This person already has admin console access.")
    for old in db.scalars(select(AdminInvite).where(AdminInvite.email == email, AdminInvite.accepted_at.is_(None),
                                                    AdminInvite.revoked_at.is_(None))):
        old.revoked_at = datetime.now(timezone.utc)
    token = secrets.token_urlsafe(32)
    inv = AdminInvite(
        email=email, role=role, token_hash=_hash(token), invited_by=inviter.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.invite_ttl_days),
    )
    db.add(inv)
    link = f"{settings.public_url}/admin/signup?invite={token}"
    sent = False
    try:
        gt_user = gotrue.admin_find_user_by_email(email)
        if not gt_user:
            gt_user = gotrue.admin_invite(email, {"invite_url": link, "role": role, "inviter": inviter.name})
            sent = True
        if existing is None:
            db.add(User(id=uuid.UUID(gt_user["id"]), email=email, name="", role=role, status="invited"))
        elif existing.role == "student":
            # An existing student account being given staff access keeps its login.
            pass
    except GoTrueError:
        sent = False
    db.commit()
    return inv, link, sent


@router.post("/admin/invites")
def invite(body: InviteIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    inv, link, sent = create_invite(db, admin, body.email, body.role)
    return {"id": str(inv.id), "email": inv.email, "role": inv.role, "link": link, "email_sent": sent,
            "expires_at": inv.expires_at.isoformat()}


# --------------------------------------------------------------------------- email templates for GoTrue

_TPL = """<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:Figtree,Segoe UI,Arial,sans-serif;color:#1c2422">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<div style="font:700 18px 'JetBrains Mono',monospace;margin-bottom:24px">IntelliNova</div>
<div style="background:#fff;border:1px solid #e1e6e4;border-radius:14px;padding:28px">{body}</div>
<p style="font-size:12px;color:#6b7774;margin-top:18px">If you didn't ask for this, you can ignore this email.</p>
</div></body></html>"""

_CODE = '<div style="font:700 32px \'JetBrains Mono\',monospace;letter-spacing:8px;padding:14px 0">{{ .Token }}</div>'

TEMPLATES = {
    "confirmation": _TPL.format(body=(
        "<h2 style='margin:0 0 8px'>Your verification code</h2>"
        "<p style='margin:0;color:#4b5653'>Enter this code in IntelliNova to finish creating your account. "
        "It expires in one hour.</p>" + _CODE)),
    "recovery": _TPL.format(body=(
        "<h2 style='margin:0 0 8px'>Reset your password</h2>"
        "<p style='color:#4b5653'>Use the button below to choose a new password. The link expires in one hour.</p>"
        "<p><a href=\"{{ .RedirectTo }}#token_hash={{ .TokenHash }}&type=recovery\" "
        "style='display:inline-block;background:#1f9d74;color:#fff;padding:11px 18px;border-radius:999px;"
        "text-decoration:none;font-weight:600'>Choose a new password</a></p>"
        "<p style='color:#4b5653;font-size:13px'>Or enter this code: <b>{{ .Token }}</b></p>")),
    "invite": _TPL.format(body=(
        "<h2 style='margin:0 0 8px'>You're invited to the admin console</h2>"
        "<p style='color:#4b5653'>You've been given access to manage content in IntelliNova. "
        "Create your account with the link below. It expires in 7 days.</p>"
        "<p><a href=\"{{ .Data.invite_url }}\" style='display:inline-block;background:#1f9d74;color:#fff;"
        "padding:11px 18px;border-radius:999px;text-decoration:none;font-weight:600'>Accept invite</a></p>")),
}


@router.get("/email-templates/{kind}", response_class=HTMLResponse, include_in_schema=False)
def email_template(kind: str):
    if kind not in TEMPLATES:
        raise HTTPException(404)
    return TEMPLATES[kind]
