"""Thin client for GoTrue (Supabase Auth). The browser never talks to GoTrue
directly: the API proxies these calls so it can keep tokens in httpOnly cookies
and enforce IntelliNova's own rules (invite-only admin accounts, suspensions)."""
import time
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

from app.config import settings


class GoTrueError(Exception):
    def __init__(self, status: int, message: str, code: str = ""):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code


def _service_token() -> str:
    now = int(time.time())
    return jwt.encode(
        {"role": "service_role", "iss": "intellinova-api", "iat": now, "exp": now + 300},
        settings.jwt_secret,
        algorithm="HS256",
    )


def _raise(r: httpx.Response) -> None:
    if r.status_code < 400:
        return
    try:
        body = r.json()
    except ValueError:
        body = {}
    msg = (
        body.get("msg")
        or body.get("message")
        or body.get("error_description")
        or body.get("error")
        or r.text
        or "Authentication failed"
    )
    raise GoTrueError(r.status_code, str(msg), str(body.get("error_code") or body.get("code") or ""))


def _call(method: str, path: str, *, token: str | None = None, admin: bool = False, **kw: Any) -> dict:
    headers = kw.pop("headers", {})
    if admin:
        headers["Authorization"] = f"Bearer {_service_token()}"
    elif token:
        headers["Authorization"] = f"Bearer {token}"
    with httpx.Client(base_url=settings.gotrue_url, timeout=20) as c:
        r = c.request(method, path, headers=headers, **kw)
    _raise(r)
    if not r.content:
        return {}
    try:
        return r.json()
    except ValueError:
        return {}


# ---- public flows


def settings_info() -> dict:
    return _call("GET", "/settings")


def signup(email: str, password: str, data: dict) -> dict:
    return _call("POST", "/signup", json={"email": email, "password": password, "data": data})


def verify(kind: str, token: str, email: str | None = None, phone: str | None = None,
           token_hash: str | None = None) -> dict:
    body: dict[str, Any] = {"type": kind}
    if token_hash:
        body["token_hash"] = token_hash
    else:
        body["token"] = token
        if email:
            body["email"] = email
        if phone:
            body["phone"] = phone
    return _call("POST", "/verify", json=body)


def resend(kind: str, email: str | None = None, phone: str | None = None) -> dict:
    body: dict[str, Any] = {"type": kind}
    if email:
        body["email"] = email
    if phone:
        body["phone"] = phone
    return _call("POST", "/resend", json=body)


def password_grant(email: str, password: str) -> dict:
    return _call("POST", "/token", params={"grant_type": "password"},
                 json={"email": email, "password": password})


def refresh_grant(refresh_token: str) -> dict:
    return _call("POST", "/token", params={"grant_type": "refresh_token"},
                 json={"refresh_token": refresh_token})


def logout(access_token: str) -> None:
    """Ends only this session. (GoTrue's default scope is global: it would also sign the same account out
    in every other tab and device, e.g. an admin's open console when a login attempt is refused.)"""
    try:
        _call("POST", "/logout", token=access_token, params={"scope": "local"})
    except GoTrueError:
        pass


def recover(email: str, redirect_to: str) -> dict:
    return _call("POST", "/recover", params={"redirect_to": redirect_to}, json={"email": email})


def send_phone_otp(phone: str, create_user: bool) -> dict:
    return _call("POST", "/otp", json={"phone": phone, "create_user": create_user})


def get_user(access_token: str) -> dict:
    return _call("GET", "/user", token=access_token)


def update_user(access_token: str, attrs: dict) -> dict:
    return _call("PUT", "/user", token=access_token, json=attrs)


# ---- admin (service role)


def admin_create_user(email: str, password: str | None, name: str, confirmed: bool) -> dict:
    body: dict[str, Any] = {"email": email, "email_confirm": confirmed, "user_metadata": {"name": name}}
    if password:
        body["password"] = password
    return _call("POST", "/admin/users", admin=True, json=body)


def admin_update_user(user_id: str, attrs: dict) -> dict:
    return _call("PUT", f"/admin/users/{user_id}", admin=True, json=attrs)


def admin_delete_user(user_id: str) -> None:
    try:
        _call("DELETE", f"/admin/users/{user_id}", admin=True)
    except GoTrueError as e:
        if e.status != 404:
            raise


def admin_invite(email: str, data: dict) -> dict:
    """Creates the GoTrue user and emails the invite template (which links to our signup page)."""
    return _call("POST", "/invite", admin=True, json={"email": email, "data": data})


def admin_find_user_by_email(email: str) -> dict | None:
    page = 1
    while page < 50:
        res = _call("GET", "/admin/users", admin=True, params={"page": page, "per_page": 200})
        users = res.get("users", [])
        for u in users:
            if (u.get("email") or "").lower() == email.lower():
                return u
        if len(users) < 200:
            return None
        page += 1
    return None


def authorize_url(provider: str, redirect_to: str) -> str:
    return f"{settings.public_url}/auth/v1/authorize?" + urlencode(
        {"provider": provider, "redirect_to": redirect_to}
    )
