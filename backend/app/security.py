"""Request authentication: verify GoTrue JWTs and load the local user."""
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import User

ACCESS_COOKIE = "inn_at"
REFRESH_COOKIE = "inn_rt"
SESSION_MARKER = "inn_s"  # no secret; lets the web app gate pages while a refresh is still possible
STAFF_ROLES = {"curator", "admin"}
# The student app and the admin console keep separate sessions (access, refresh, marker cookies), so a
# student and a staff member can be signed in side by side in one browser without replacing each other.
COOKIES = {"student": (ACCESS_COOKIE, REFRESH_COOKIE, SESSION_MARKER), "admin": ("inn_aat", "inn_art", "inn_as")}
# Request header: which app a request comes from. Response header (on a 403): which app the account belongs to.
PORTAL_HEADER = "X-IntelliNova-Portal"


def request_portal(request: Request) -> str | None:
    p = (request.headers.get(PORTAL_HEADER) or "").strip().lower()
    if p in COOKIES:
        return p
    if request.url.path.startswith("/api/admin"):
        return "admin"
    return None


def portal_for_role(role: str) -> str:
    return "admin" if role in STAFF_ROLES else "student"


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(
            token, settings.jwt_secret, algorithms=["HS256"], audience=settings.jwt_audience
        )
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(401, "Session expired") from e
    except jwt.PyJWTError as e:
        raise HTTPException(401, "Not signed in") from e


def token_from_request(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    portal = request_portal(request)
    if portal:
        return request.cookies.get(COOKIES[portal][0])
    # No portal given (e.g. an <img> for a source figure, shown in both apps): either session will do.
    return request.cookies.get(COOKIES["student"][0]) or request.cookies.get(COOKIES["admin"][0])


def upsert_user_from_claims(db: Session, claims: dict, default_role: str = "student") -> User:
    uid = uuid.UUID(claims["sub"])
    user = db.get(User, uid)
    meta = claims.get("user_metadata") or {}
    email = (claims.get("email") or "").lower() or None
    if user is None:
        user = User(
            id=uid,
            email=email,
            phone=claims.get("phone") or None,
            name=(meta.get("name") or meta.get("full_name") or "").strip(),
            role=default_role,
            status="active",
        )
        db.add(user)
        db.commit()
    else:
        changed = False
        if email and user.email != email:
            user.email, changed = email, True
        if not user.name and (meta.get("name") or meta.get("full_name")):
            user.name, changed = (meta.get("name") or meta.get("full_name")).strip(), True
        if changed:
            db.commit()
    return user


def current_user_optional(request: Request, db: Session = Depends(get_db)) -> User | None:
    token = token_from_request(request)
    if not token:
        return None
    try:
        claims = decode_token(token)
    except HTTPException:
        return None
    user = upsert_user_from_claims(db, claims)
    return user if user.status == "active" else None


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = token_from_request(request)
    if not token:
        raise HTTPException(401, "Not signed in")
    claims = decode_token(token)
    user = upsert_user_from_claims(db, claims)
    if user.status == "suspended":
        raise HTTPException(403, "This account is suspended. Contact your school or the IntelliNova team.")
    if user.status != "active":
        raise HTTPException(403, "This account is not active yet.")
    now = datetime.now(timezone.utc)
    if not user.last_seen_at or now - user.last_seen_at > timedelta(minutes=5):
        user.last_seen_at = now
        db.commit()
    return user


def student_user(user: User = Depends(current_user)) -> User:
    """The student app is for student accounts only; admins and curators use the admin console."""
    if user.role in STAFF_ROLES:
        raise HTTPException(403, "This is an admin account. Use the admin console.", headers={PORTAL_HEADER: "admin"})
    return user


def require_staff(user: User = Depends(current_user)) -> User:
    if user.role not in STAFF_ROLES:
        raise HTTPException(403, "Admin console access only")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Only admins can do this")
    return user
