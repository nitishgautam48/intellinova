"""Integration tests run against real services (Postgres+pgvector, Redis,
Meilisearch, GoTrue, Mailpit) - see README "Running the tests". Only the LLM
is replaced (tests/fakes.py). Celery tasks run inline."""
import os
import re
import time

import httpx
import pytest

os.environ.setdefault("CELERY_EAGER", "true")
os.environ.setdefault("EMBEDDINGS_BACKEND", "hash")
os.environ.setdefault("RERANK_MODEL", "")  # no model downloads in tests
os.environ.setdefault("PIPER_AUTO_DOWNLOAD", "false")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from tests import fakes  # noqa: E402

MAILPIT = os.environ.get("MAILPIT_URL", "http://localhost:58025")


@pytest.fixture(autouse=True)
def no_youtube(monkeypatch):
    """Tests never call YouTube: video discovery sees no candidates unless a test supplies some."""
    from app.services import discovery

    monkeypatch.setattr(discovery, "search_candidates", lambda q, lang, n: ([], "test"))
    monkeypatch.setattr(discovery, "fetch_captions", lambda vid, langs=(): None)


@pytest.fixture(autouse=True)
def no_eval_frameworks(monkeypatch):
    """The RAGAS / DeepEval / TruLens adapters need a real Ollama judge; tests use the built-in judges unless a
    test supplies an adapter."""
    from app.services import evaluation

    monkeypatch.setattr(evaluation, "FRAMEWORKS", {k: (n, lambda rows: None) for k, (n, _) in evaluation.FRAMEWORKS.items()})


@pytest.fixture(scope="session", autouse=True)
def fake_llm():
    fakes.install()
    yield


def mail_code(email: str) -> str:
    for _ in range(40):
        msgs = httpx.get(f"{MAILPIT}/api/v1/messages").json()["messages"]
        for m in msgs:
            if any(t["Address"] == email for t in m["To"]):
                html = httpx.get(f"{MAILPIT}/api/v1/message/{m['ID']}").json()["HTML"]
                code = re.search(r">(\d{6})<", html) or re.search(r"code:?\s*(?:<b>)?(\d{6})", html)
                if code:
                    return code.group(1)
        time.sleep(0.25)
    raise AssertionError(f"no verification email for {email}")


def new_client() -> TestClient:
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture(scope="session")
def stamp() -> str:
    return str(int(time.time() * 1000))


@pytest.fixture(scope="session")
def admin(stamp) -> TestClient:
    c = new_client()
    email = f"admin{stamp}@example.com"
    r = c.post("/api/auth/admin/signup", json={"name": "Asha Admin", "email": email, "password": "adminpass1"})
    if r.status_code == 403:  # an admin already exists (reused database): invite a fresh one through it
        raise AssertionError("Run the tests against a fresh database, or set ADMIN_EMAIL/ADMIN_PASSWORD")
    assert r.status_code == 200, r.text
    return c


@pytest.fixture(scope="session")
def student(stamp) -> TestClient:
    c = new_client()
    email = f"student{stamp}@example.com"
    r = c.post("/api/auth/signup", json={"name": "Ravi Kumar", "email": email, "password": "studentpw1", "accepted_terms": True})
    assert r.status_code == 200, r.text
    r = c.post("/api/auth/verify", json={"type": "signup", "email": email, "token": mail_code(email)})
    assert r.status_code == 200, r.text
    return c
