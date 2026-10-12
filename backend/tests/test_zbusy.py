"""When the AI is busy: the tutor goes first, figure captioning stays within a budget, a failed tutor answer
leaves no unanswered question behind, and a quiz stuck "preparing" can be cancelled, stops by itself and can be
tried again."""
import time
import uuid
from datetime import timedelta

import pytest

from app.services import llm
from tests.conftest import mail_code, new_client


def ok(r, code=200):
    assert r.status_code == code, f"{r.status_code}: {r.text}"
    return r.json()


# --------------------------------------------------------------------------- tutor priority

def test_background_calls_wait_while_the_tutor_answers(monkeypatch):
    from app.config import settings

    assert not llm.interactive_waiting()
    with llm.priority():
        assert llm.interactive_waiting()
        monkeypatch.setattr(settings, "llm_yield_max_s", 1.0)
        t0 = time.time()
        llm.yield_to_interactive("tag_units")
        assert time.time() - t0 >= 0.9, "background work held back while a student waits"
    assert not llm.interactive_waiting()
    t0 = time.time()
    llm.yield_to_interactive("tag_units")
    assert time.time() - t0 < 0.5, "nothing waits when no student is waiting"


def test_priority_never_blocks_when_redis_is_down(monkeypatch):
    def broken():
        raise ConnectionError("redis is down")

    monkeypatch.setattr(llm, "_redis", broken)
    with llm.priority():
        assert not llm.interactive_waiting()
    t0 = time.time()
    llm.yield_to_interactive("tag_units")
    assert time.time() - t0 < 0.5


# --------------------------------------------------------------------------- figure budget

def _figures(tmp_path, n_numbered: int, n_plain: int, logo_repeats: int):
    from app.services.parsing import Figure

    out = []
    for i in range(logo_repeats):
        p = tmp_path / f"logo{i}.png"
        p.write_bytes(b"same school logo on every page")
        out.append(Figure(str(p), f"p. {i + 1}", page=i + 1, context=""))
    for i in range(n_plain):
        p = tmp_path / f"plain{i}.png"
        p.write_bytes(f"photo {i}".encode())
        out.append(Figure(str(p), f"p. {i + 1}", page=i + 1, context="A photograph"))
    for i in range(n_numbered):
        p = tmp_path / f"fig{i}.png"
        p.write_bytes(f"figure {i}".encode())
        out.append(Figure(str(p), f"p. {i + 1}", page=i + 1, context=f"Figure 11.{i + 1} A circuit"))
    return out


def test_figures_numbered_first_duplicates_once_and_capped(tmp_path, monkeypatch):
    from app.config import settings
    from app.services import ingestion

    monkeypatch.setattr(settings, "figure_caption_max", 6)
    seen = []

    def caption(path, context):
        seen.append((path, context))
        return {"kind": "diagram", "caption": f"Described {len(seen)}.", "labels": ["R1"]}

    monkeypatch.setattr(ingestion, "caption_figure", caption)
    segs, described, skipped = ingestion.describe_figures(_figures(tmp_path, n_numbered=4, n_plain=5, logo_repeats=3))
    assert described == 6 and len(segs) == 6 and len(seen) == 6
    assert all(c.startswith("Figure 11.") for _, c in seen[:4]), "numbered figures are described first"
    assert sum("logo" in p for p, _ in seen) <= 1, "a repeated image is described once"
    assert skipped == 10 - 6, "unique figures beyond the budget are skipped (repeats aren't counted)"
    assert segs[0].kind == "Diagram" and "Labels: R1." in segs[0].text


def test_figures_stop_after_repeated_timeouts(tmp_path, monkeypatch):
    from app.config import settings
    from app.services import ingestion

    monkeypatch.setattr(settings, "figure_caption_stop_after", 2)
    calls = []

    def caption(path, context):
        calls.append(path)
        raise llm.LLMTimeout("The AI model did not answer within 90 s")

    monkeypatch.setattr(ingestion, "caption_figure", caption)
    segs, described, skipped = ingestion.describe_figures(_figures(tmp_path, n_numbered=3, n_plain=10, logo_repeats=0))
    assert len(calls) == 2, "stops asking a model that keeps timing out"
    assert segs == [] and described == 0 and skipped == 13


def test_caption_timeout_is_short_and_not_retried(monkeypatch, tmp_path):
    from app.services import ingestion

    img = tmp_path / "f.png"
    img.write_bytes(b"x")
    got = {}

    def fake_chat(messages, **kw):
        got.update(kw)
        raise llm.LLMTimeout("slow")

    monkeypatch.setattr(ingestion.llm, "chat", fake_chat)
    with pytest.raises(llm.LLMTimeout):
        ingestion.caption_figure(str(img), "Figure 1")
    assert got["attempts"] == 1 and got["timeout_s"] <= 120


# --------------------------------------------------------------------------- tutor busy

def test_tutor_timeout_leaves_no_unanswered_question(student):
    def slow(messages, schema):
        raise llm.LLMTimeout("The AI model did not answer within 180 s")

    old = {k: llm._fakes.get(k) for k in ("tutor_answer", "tutor_general")}
    c = ok(student.post("/api/tutor/conversations", json={"lang": "en", "source_only": True}))
    try:
        llm.register_fake("tutor_answer", slow)
        llm.register_fake("tutor_general", slow)
        r = student.post(f"/api/tutor/conversations/{c['id']}/messages",
                         json={"content": "What does Ohm's law state about current and potential difference?"})
        assert r.status_code == 503 and "busy" in r.json()["detail"] and "try again" in r.json()["detail"]
        conv = ok(student.get(f"/api/tutor/conversations/{c['id']}"))
        assert not any(m["role"] == "user" for m in conv["messages"]), "the failed question is not left in the chat"
        assert conv["title"] in ("New conversation", "Getting started")
    finally:
        for k, fn in old.items():
            if fn:
                llm.register_fake(k, fn)
            else:
                llm._fakes.pop(k, None)
    r = ok(student.post(f"/api/tutor/conversations/{c['id']}/messages",
                        json={"content": "What does Ohm's law state about current and potential difference?"}))
    assert r["assistant"]["status"] == "answered", "asking again works once the AI answers"


# --------------------------------------------------------------------------- stuck quiz

def _topics(student) -> list[str]:
    setup = ok(student.get("/api/practice/setup"))
    tids = [t["id"] for ch in setup["chapters"] for t in ch["topics"]]
    assert tids, "needs the curriculum from test_flow"
    return tids[:2]


def _preparing(student, tids, minutes_ago: float) -> str:
    from app.db import SessionLocal
    from app.models import Quiz
    from app.routers.common import now

    uid = uuid.UUID(ok(student.get("/api/auth/me"))["id"])
    with SessionLocal() as db:
        q = Quiz(user_id=uid, title="Busy AI quiz", types=["MCQ"], topic_ids=[uuid.UUID(t) for t in tids], n=3,
                 status="preparing", created_at=now() - timedelta(minutes=minutes_ago))
        db.add(q)
        db.commit()
        return str(q.id)


def test_stuck_quiz_stops_by_itself_and_can_be_tried_again(student):
    tids = _topics(student)
    qid = _preparing(student, tids, minutes_ago=4)
    q = ok(student.get(f"/api/practice/quizzes/{qid}"))
    assert q["status"] == "preparing" and 230 <= q["preparing_s"] <= 300 and not q["retryable"]
    assert any(j["id"] == f"quiz:{qid}" for j in ok(student.get("/api/jobs"))["jobs"])

    stuck = _preparing(student, tids, minutes_ago=20)
    assert ok(student.get("/api/practice/setup"))["active_quiz_id"] != stuck, "a stuck quiz never blocks a new one"
    q = ok(student.get(f"/api/practice/quizzes/{stuck}"))
    assert q["status"] == "failed" and "took too long" in q["error"] and q["retryable"]
    assert not any(j["id"] == f"quiz:{stuck}" for j in ok(student.get("/api/jobs"))["jobs"])

    q = ok(student.post(f"/api/practice/quizzes/{stuck}/retry"))  # Celery runs inline in tests
    q = ok(student.get(f"/api/practice/quizzes/{stuck}"))
    assert q["status"] == "active" and q["items"], "trying again prepares the quiz"
    assert student.post(f"/api/practice/quizzes/{stuck}/retry").status_code == 400

    q = ok(student.post(f"/api/practice/quizzes/{qid}/cancel"))
    assert q["status"] == "failed" and q["error"].startswith("Cancelled") and q["retryable"]
    assert student.post(f"/api/practice/quizzes/{qid}/cancel").status_code == 400


def test_a_cancelled_quiz_is_not_revived_by_its_worker(student):
    from app.db import SessionLocal
    from app.models import Quiz
    from app.services import quiz_engine

    qid = _preparing(student, _topics(student), minutes_ago=1)
    ok(student.post(f"/api/practice/quizzes/{qid}/cancel"))
    with SessionLocal() as db:
        quiz_engine.prepare(db, uuid.UUID(qid))
        q = db.get(Quiz, uuid.UUID(qid))
        assert q.status == "failed" and not q.items


def test_other_students_cannot_cancel_or_retry(student, stamp):
    qid = _preparing(student, _topics(student), minutes_ago=1)
    other = new_client()
    email = f"busy-{stamp}@example.com"
    ok(other.post("/api/auth/signup", json={"name": "Kiran Rao", "email": email, "password": "studentpw1", "accepted_terms": True}))
    ok(other.post("/api/auth/verify", json={"type": "signup", "email": email, "token": mail_code(email)}))
    assert other.post(f"/api/practice/quizzes/{qid}/cancel").status_code == 404
    assert other.post(f"/api/practice/quizzes/{qid}/retry").status_code == 404
    ok(student.post(f"/api/practice/quizzes/{qid}/cancel"))


# --------------------------------------------------------------------------- YouTube bot check

class _BlockedYdl:
    def __init__(self, *a, **k):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def extract_info(self, url, download=False):
        raise Exception("ERROR: [youtube] zaXvqdF8oxA: Sign in to confirm you're not a bot. Use --cookies-from-browser")


def test_youtube_bot_check_falls_back_to_oembed_and_captions(monkeypatch):
    from app.services import parsing, resources

    monkeypatch.setattr(parsing, "_ydl", lambda opts: _BlockedYdl())
    monkeypatch.setattr(parsing, "youtube_oembed", lambda url: {"title": "Ohm's law explained", "author_name": "Physics Class",
                                                                "thumbnail_url": "https://i.ytimg.com/x.jpg"})
    monkeypatch.setattr(parsing, "youtube_captions", lambda vid, langs=(): [
        {"text": "Ohm's law says current is proportional to potential difference.", "start": 0.0, "duration": 30.0},
        {"text": "The constant is the resistance.", "start": 30.0, "duration": 95.0}])
    p = parsing.parse_video_url("https://youtu.be/zaXvqdF8oxA?si=EagL5Bk434Rf0qjI")
    assert p.title == "Ohm's law explained" and p.segments and "proportional" in p.segments[0].text
    assert p.size_label == "2 min", "length comes from the captions"
    d = resources.detect("https://youtu.be/zaXvqdF8oxA")
    assert d["available"] and d["title"] == "Ohm's law explained" and d["creator"] == "Physics Class"


def test_youtube_bot_check_without_captions_explains_what_to_do(monkeypatch):
    from app.services import parsing

    monkeypatch.setattr(parsing, "_ydl", lambda opts: _BlockedYdl())
    monkeypatch.setattr(parsing, "youtube_oembed", lambda url: {"title": "A lecture"})
    monkeypatch.setattr(parsing, "youtube_captions", lambda vid, langs=(): None)
    with pytest.raises(ValueError) as e:
        parsing.parse_video_url("https://www.youtube.com/watch?v=zaXvqdF8oxA")
    assert "confirm this isn't a bot" in str(e.value) and "upload the video file" in str(e.value)
    assert "--cookies" not in str(e.value)
    with pytest.raises(ValueError) as e:
        parsing.list_videos("https://www.youtube.com/playlist?list=PL123")
    assert "one at a time" in str(e.value)


def test_youtube_private_video_still_reports_the_real_error(monkeypatch):
    from app.services import parsing

    monkeypatch.setattr(parsing, "_ydl", lambda opts: _BlockedYdl())
    monkeypatch.setattr(parsing, "youtube_oembed", lambda url: None)
    with pytest.raises(Exception, match="not a bot"):
        parsing.list_videos("https://youtu.be/zaXvqdF8oxA")


def test_cookies_file_is_used_when_present(tmp_path, monkeypatch):
    from app.config import settings
    from app.services import parsing

    monkeypatch.setattr(settings, "youtube_cookies_file", str(tmp_path / "cookies.txt"))
    assert "cookiefile" not in parsing._ydl({}).params
    (tmp_path / "cookies.txt").write_text("# Netscape HTTP Cookie File\n")
    assert parsing._ydl({}).params["cookiefile"] == str(tmp_path / "cookies.txt")
