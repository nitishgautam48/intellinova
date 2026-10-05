"""Automatic YouTube video discovery: a student searches a topic with no curated videos and gets checked,
ranked videos; filters, curator removals, caching, free-text searches and the optional Reddit signal.
YouTube itself is replaced by fixed candidate lists (see conftest.no_youtube)."""
import pytest

from app.config import settings
from app.services import discovery, reddit
from tests.conftest import mail_code, new_client

M: dict = {}


def ok(r, code=200):
    assert r.status_code == code, f"{r.status_code}: {r.text}"
    return r.json()


def cand(vid: str, title: str, duration: int = 900, views: int = 50_000, likes: int = 2_000, live: bool = False) -> dict:
    return {"video_id": vid, "title": title, "description": f"{title}. Full lesson with examples.", "channel": "Maths Made Easy",
            "duration": duration, "live": live, "thumbnail": "", "language": "en", "views": views, "likes": likes,
            "comments": 10, "embeddable": True, "published": ""}


@pytest.fixture
def youtube(monkeypatch, stamp):
    """Swap in a candidate list for YouTube and count the searches made."""
    calls = []

    def install(cands):
        def fake(q, lang, n):
            calls.append(q)
            return list(cands), "test"
        monkeypatch.setattr(discovery, "search_candidates", fake)
        return calls
    return install


def test_setup_topic_without_videos(admin, stamp):
    s = ok(admin.post("/api/admin/curriculum/subjects", json={"board": "CBSE", "class_level": "10", "name": "Mathematics"}))
    tree = ok(admin.post(f"/api/admin/curriculum/subjects/{s['id']}/chapters", json={"name": "Quadratic Equations"}))
    ch = tree["chapters"][0]["id"]
    tree = ok(admin.post(f"/api/admin/curriculum/chapters/{ch}/topics", json={"name": "Factorisation of quadratics"}))
    M["topic"] = tree["chapters"][0]["topics"][0]["id"]
    M["chapter"] = ch
    ok(admin.post(f"/api/admin/curriculum/subjects/{s['id']}/publish", json={}))
    # A video a curator already removed must never come back.
    M["blocked"] = f"blk{stamp}"[:11]
    ok(admin.post("/api/admin/resources", json={"url": f"https://www.youtube.com/watch?v={M['blocked']}", "title": "Old factorisation video",
                                              "platform": "YouTube", "status": "Disabled"}))
    c = new_client()
    email = f"meera{stamp}@example.com"
    ok(c.post("/api/auth/signup", json={"name": "Meera Iyer", "email": email, "password": "studentpw1", "accepted_terms": True}))
    ok(c.post("/api/auth/verify", json={"type": "signup", "email": email, "token": mail_code(email)}))
    opts = ok(c.get("/api/me/options", params={"board": "CBSE", "class_level": "Class 10"}))
    maths = [x["id"] for x in opts["subjects"] if x["name"] == "Mathematics"]
    ok(c.put("/api/me/profile", json={"board": "CBSE", "class_level": "Class 10", "languages": ["English"], "subject_ids": maths,
                                     "diag_mode": "skip"}))
    ok(c.post("/api/me/onboarding/complete"))
    M["student"] = c


def test_search_finds_checks_and_ranks_videos(youtube, stamp):
    s = stamp[-6:]
    calls = youtube([
        cand(f"good1{s}", "Factorisation of quadratics explained | Class 10 Maths", views=900_000, likes=40_000),
        cand(f"good2{s}", "Quadratics by factorisation in Hindi", views=20_000, likes=500),
        cand(f"short{s}", "Factorisation trick #shorts", duration=45),
        cand(f"live{s}", "Factorisation live class", live=True),
        cand(f"crick{s}", "Cricket world cup highlights", duration=600),
        cand(M["blocked"], "Old factorisation video"),
    ])
    st = M["student"]
    res = ok(st.get("/api/search", params={"q": "factorisation"}))
    d = res["discovery"]
    assert d and d["status"] == "done" and d["added"] == 2, d
    assert calls and "Factorisation of quadratics" in calls[0] and "class 10" in calls[0]
    found = [c for c in [res["best"], *res["alternatives"], *res["more"]] if c]
    urls = {c["url"] for c in found}
    assert {f"https://www.youtube.com/watch?v=good1{s}", f"https://www.youtube.com/watch?v=good2{s}"} <= urls
    assert not any(x in u for u in urls for x in (f"short{s}", f"live{s}", f"crick{s}", M["blocked"]))
    auto = [c for c in found if c["auto"]]
    assert auto and all(c["why"].startswith("Found on YouTube") for c in auto)
    M["discovery"] = d["id"]

    polled = ok(st.get(f"/api/search/discovery/{d['id']}"))
    assert polled["status"] == "done" and len(polled["videos"]) == 2
    assert polled["videos"][0]["url"].endswith(f"good1{s}")  # more engagement ranks first
    hindi = next(v for v in polled["videos"] if v["url"].endswith(f"good2{s}"))
    assert hindi["lang"] == "Hindi"

    # Cached: the same topic isn't searched again, and the chapter now has the videos.
    ok(st.get("/api/search", params={"q": "factorisation"}))
    assert len(calls) == 1
    chap = ok(st.get(f"/api/learn/chapters/{M['chapter']}"))
    assert chap["best"] and chap["finding_videos"] is False


def test_curator_removal_sticks_and_admin_view(admin, youtube, stamp):
    s = stamp[-6:]
    rows = ok(admin.get("/api/admin/resources", params={"origin": "auto"}))
    assert rows["counts"]["Auto-found"] >= 2 and all(r["auto"] for r in rows["rows"])
    good1 = next(r for r in rows["rows"] if r["url"].endswith(f"good1{s}"))
    detail = ok(admin.get(f"/api/admin/resources/{good1['id']}"))
    assert detail["discovery"]["relevance"] == 0.9 and detail["discovery"]["reason"]
    ok(admin.patch(f"/api/admin/resources/{good1['id']}", json={"status": "Disabled"}))

    calls = youtube([cand(f"good1{s}", "Factorisation of quadratics explained | Class 10 Maths"),
                     cand(f"good3{s}", "Factorisation of quadratics: practice problems")])
    d = ok(admin.post(f"/api/admin/curriculum/topics/{M['topic']}/discover"))
    assert d["status"] == "done" and d["added"] == 1 and len(calls) == 1
    log = ok(admin.get("/api/admin/discoveries"))
    assert log[0]["stats"]["added"] == 1 and log[0]["kind"] == "Topic"
    videos = ok(M["student"].get(f"/api/search/discovery/{d['id']}"))["videos"]
    assert [v["url"][-len(f"good3{s}"):] for v in videos] == [f"good3{s}"]


def test_free_text_search_and_optional_reddit(youtube, monkeypatch, stamp):
    s = stamp[-6:]
    youtube([cand(f"photo{s}", "Photosynthesis light reaction explained", duration=700)])
    assert not reddit.enabled()  # off by default
    monkeypatch.setattr(settings, "reddit_client_id", "x")
    monkeypatch.setattr(settings, "reddit_client_secret", "y")
    monkeypatch.setattr(reddit, "_search", lambda vid: {"posts": 2, "upvotes": 40, "subreddits": ["CBSE"]})
    st = M["student"]
    res = ok(st.get("/api/search", params={"q": f"photosynthesis light reaction {s}"}))
    assert res["discovery"]["status"] == "done", res["discovery"]
    card = next(c for c in [res["best"], *res["alternatives"], *res["more"]] if c and c["url"].endswith(f"photo{s}"))
    assert card["auto"] and card["why"] == "Recommended by students on r/CBSE"

    # Not a study topic: no YouTube search at all.
    calls = youtube([cand(f"crk{s}", "Cricket score today")])
    before = len(calls)
    res = ok(st.get("/api/search", params={"q": f"cricket score {s}"}))
    assert res["discovery"]["status"] == "skipped" and len(calls) == before


def test_discovery_can_be_turned_off(monkeypatch, admin):
    monkeypatch.setattr(settings, "discovery_enabled", False)
    r = admin.post(f"/api/admin/curriculum/topics/{M['topic']}/discover")
    assert r.status_code == 400
    res = ok(M["student"].get("/api/search", params={"q": "factorisation"}))
    assert res["discovery"] is None
