"""End-to-end: an admin builds the curriculum and knowledge base, a student
onboards and uses every module, the admin reviews and evaluates."""
import io
import time

import pymupdf
import pytest

PAGES = [
    ("Electric current and Ohm's law",
     "Electric current is the rate of flow of electric charge through a conductor. Its SI unit is the ampere. "
     "Ohm's law states that the current through a metallic conductor is directly proportional to the potential "
     "difference across its ends at constant temperature, so V = I R. The ammeter is always connected in series."),
    ("Resistors in series",
     "When resistors are joined in series the same current flows through every resistor. The total resistance is "
     "the sum Rs = R1 + R2 + R3. If one bulb in a series circuit fuses, all the bulbs go off because there is only one path."),
    ("Electric power",
     "Electric power is the rate at which electric energy is used. Power P = V I, which can also be written as "
     "P = I squared R. The SI unit of power is the watt. Household appliances are connected in parallel so each "
     "appliance gets the full voltage and one failing does not affect others."),
]


def make_pdf() -> bytes:
    doc = pymupdf.open()
    for head, body in PAGES:
        page = doc.new_page()
        page.insert_text((72, 80), head, fontsize=20)
        page.insert_textbox(pymupdf.Rect(72, 110, 520, 700), body, fontsize=11)
    return doc.tobytes()


S: dict = {}


def ok(r, code=200):
    assert r.status_code == code, f"{r.status_code}: {r.text}"
    return r.json()


def test_admin_builds_curriculum(admin):
    sub = ok(admin.post("/api/admin/curriculum/subjects", json={"board": "CBSE", "class_level": "Class 10", "name": "Science",
                                                              "icon": "science", "tone": "pri"}))
    S["subject"] = sub["id"]
    tree = ok(admin.post(f"/api/admin/curriculum/subjects/{sub['id']}/chapters", json={"name": "Electricity"}))
    ch = tree["chapters"][0]["id"]
    S["chapter"] = ch
    for name in ("Ohm's law", "Resistors in series", "Electric power"):
        tree = ok(admin.post(f"/api/admin/curriculum/chapters/{ch}/topics", json={"name": name, "est_minutes": 15}))
    topics = tree["chapters"][0]["topics"]
    S["topics"] = {t["name"]: t["id"] for t in topics}
    tree = ok(admin.patch(f"/api/admin/curriculum/topics/{S['topics']['Resistors in series']}",
                          json={"prereq_ids": [S["topics"]["Ohm's law"]]}))
    assert tree["chapters"][0]["topics"][1]["pre"][0]["name"] == "Ohm's law"
    assert tree["draft"] and tree["versions"][0]["l"] == "Draft"
    tree = ok(admin.post(f"/api/admin/curriculum/subjects/{sub['id']}/publish", json={"note": "first"}))
    assert tree["version"] == 1 and not tree["draft"]
    assert all(t["published"] for t in tree["chapters"][0]["topics"])


def test_admin_uploads_textbook(admin):
    files = {"file": ("ncert-electricity.pdf", io.BytesIO(make_pdf()), "application/pdf")}
    src = ok(admin.post("/api/admin/kb/sources", data={"kind": "textbook", "title": "Science Class 10 · Chapter 11",
                                                        "subject_id": S["subject"], "chapter_id": S["chapter"]}, files=files))
    kb = ok(admin.get("/api/admin/kb"))
    row = next(s for s in kb["sources"] if s["id"] == src["id"])
    assert row["s"] in ("Ready", "Needs Review"), row
    assert row["units"] >= 3 and row["stage"] == 6
    units = ok(admin.get("/api/admin/kb/units", params={"source_id": src["id"]}))
    assert units["counts"]["Text"] >= 3
    tagged = {u["topic"] for u in units["units"]}
    assert "Ohm's law" in tagged and "Electric power" in tagged
    u = units["units"][0]
    upd = ok(admin.patch(f"/api/admin/kb/units/{u['id']}", json={"approved": True, "concepts": ["Current"]}))
    assert upd["low"] is False and upd["concepts"] == ["Current"]
    S["source"] = src["id"]


def test_admin_adds_resources_exam_and_careers(admin):
    r = ok(admin.post("/api/admin/resources", json={
        "url": f"https://www.youtube.com/playlist?list=test{time.time_ns()}", "title": "Electricity — Full Chapter",
        "platform": "YouTube", "rtype": "Playlist", "creator": "Physics Teacher", "duration_label": "12 videos · 5 h 40 m",
        "class_level": "Class 10", "subject_id": S["subject"], "chapter_id": S["chapter"],
        "topic_ids": list(S["topics"].values()), "languages": ["English", "Hindi"], "difficulty": "Beginner",
        "quality": "High", "status": "Active"}))
    S["resource"] = r["id"]
    ok(admin.post("/api/admin/resources", json={
        "url": f"https://example.org/ohm-{time.time_ns()}", "title": "Ohm's law in 25 minutes", "rtype": "Article",
        "class_level": "Class 10", "subject_id": S["subject"], "chapter_id": S["chapter"], "topic_ids": [S["topics"]["Ohm's law"]],
        "languages": ["Hinglish"], "status": "Active"}))
    lst = ok(admin.get("/api/admin/resources"))
    assert lst["counts"]["Active"] >= 2

    e = ok(admin.post("/api/admin/exams", json={"code": f"ipm{time.time_ns() % 10**6}", "name": "IPMAT",
                                                "full_name": "Integrated Programme in Management Aptitude Test", "status": "Active"}))
    d = ok(admin.post(f"/api/admin/exams/{e['id']}/structure", json={"kind": "subject", "name": "Quantitative Ability"}))
    d = ok(admin.post(f"/api/admin/exams/{e['id']}/structure", json={"kind": "unit", "parent_id": d["subjects"][0]["id"], "name": "Arithmetic"}))
    uid = d["subjects"][0]["units"][0]["id"]
    ok(admin.post(f"/api/admin/exams/{e['id']}/structure", json={"kind": "topic", "parent_id": uid, "name": "Percentages", "priority": "High"}))
    d = ok(admin.post(f"/api/admin/exams/{e['id']}/structure", json={"kind": "topic", "parent_id": uid, "name": "Ratio and proportion", "priority": "High"}))
    fact = d["facts"][0]
    assert fact["s"] == "Unverified"
    bad = admin.patch(f"/api/admin/exams/{e['id']}/facts/{fact['id']}", json={"verify": True})
    assert bad.status_code == 400
    d = ok(admin.patch(f"/api/admin/exams/{e['id']}/facts/{fact['id']}", json={"value": "Quant, Verbal", "source_name": "Official bulletin", "verify": True}))
    assert d["facts"][0]["s"] == "Verified"
    S["exam"] = e["id"]

    ids = {}
    for t, n in [("interest", "Economics"), ("subject", "Mathematics (Class 11–12)"), ("combination", "Commerce with Mathematics"),
                 ("degree", "BA/BSc Economics"), ("entrance", "CUET (UG)"), ("area", "Economic research")]:
        ids[t] = ok(admin.post("/api/admin/careers/nodes", json={"ntype": t, "name": n, "summary": n}))["id"]
    ok(admin.patch(f"/api/admin/careers/nodes/{ids['interest']}", json={"down_ids": [ids["subject"]]}))
    ok(admin.patch(f"/api/admin/careers/nodes/{ids['subject']}", json={"down_ids": [ids["combination"]]}))
    ok(admin.patch(f"/api/admin/careers/nodes/{ids['combination']}", json={"down_ids": [ids["degree"]],
                                                                           "meta": {"considerations": "Keeps finance routes open.",
                                                                                    "dimensions": {"econ": "Well supported"}}}))
    ok(admin.patch(f"/api/admin/careers/nodes/{ids['degree']}", json={"down_ids": [ids["entrance"]]}))
    ok(admin.patch(f"/api/admin/careers/nodes/{ids['entrance']}", json={"down_ids": [ids["area"]]}))
    ok(admin.post("/api/admin/careers/rules", json={"from_id": ids["subject"], "to_id": ids["degree"], "requirement": "Required",
                                                    "label": "Class 12 Mathematics → Economics (Hons)", "source_name": "Admission bulletin",
                                                    "verify": True}))
    ok(admin.put("/api/admin/careers/dimensions", json={"dimensions": [{"key": "econ", "label": "Economics degrees", "note": "n"}]}))
    c = ok(admin.get("/api/admin/careers", params={"entity": "rules"}))
    assert c["rows"][0]["s"] == "Verified"
    S["career"] = ids


def test_student_onboarding(student):
    opts = ok(student.get("/api/me/options", params={"board": "CBSE", "class_level": "Class 10"}))
    assert "CBSE" in opts["boards"] and any(s["id"] == S["subject"] for s in opts["subjects"])
    p = ok(student.put("/api/me/profile", json={"board": "CBSE", "class_level": "Class 10", "languages": ["English", "Hindi"],
                                               "subject_ids": [S["subject"]], "interests": ["Economics"], "goals": ["School learning"],
                                               "exam_ids": [S["exam"]], "diag_mode": "quiz", "nickname": "Ravi"}))
    assert p["subjects"][0]["name"] == "Science"
    out = ok(student.post("/api/me/onboarding/complete"))
    assert "quiz_id" in out
    dq = ok(student.get(f"/api/practice/quizzes/{out['quiz_id']}"))
    assert dq["mode"] == "Diagnostic" and dq["status"] == "active", dq
    S["diag"] = out["quiz_id"]


def test_learn_and_recommendations(student):
    subs = ok(student.get("/api/learn/subjects"))
    assert subs[0]["chapters"] == 1
    ch = ok(student.get(f"/api/learn/chapters/{S['chapter']}"))
    assert [t["state"] for t in ch["topics"]] == ["current", "todo", "todo"]
    assert ch["best"]["title"]
    first = S["topics"]["Ohm's law"]
    ok(student.post(f"/api/learn/topics/{first}/complete"))
    ch = ok(student.get(f"/api/learn/chapters/{S['chapter']}"))
    assert ch["topics"][0]["state"] == "done" and ch["topics"][1]["state"] == "current"
    ok(student.post(f"/api/resources/{S['resource']}/feedback", json={"helpful": "up"}))
    ok(student.post(f"/api/resources/{S['resource']}/progress", json={"status": "completed"}))
    ok(student.post("/api/saved", json={"kind": "resource", "ref_id": S["resource"], "label": "x"}))
    saved = ok(student.get("/api/saved"))
    assert saved["resources"][0]["saved"] is True and saved["resources"][0]["helpful"] == "up"


def test_search(student):
    r = ok(student.get("/api/search", params={"q": "electricty"}))
    assert r["total"] >= 1
    assert r["did_you_mean"] in (None, "electricity")
    r = ok(student.get("/api/search", params={"q": "flux capacitor"}))
    assert r["total"] == 0
    home = ok(student.get("/api/search/home"))
    assert "electricty" in home["recent"]


def test_tutor_grounded_and_declines(student):
    c = ok(student.post("/api/tutor/conversations", json={"lang": "en", "source_only": True}))
    r = ok(student.post(f"/api/tutor/conversations/{c['id']}/messages", json={"content": "What does Ohm's law state about current and potential difference?"}))
    a = r["assistant"]
    assert a["status"] == "answered" and a["citations"], a
    assert "[1]" in a["content"] and a["citations"][0]["location"].startswith("p. ")
    ctx = ok(student.get(f"/api/units/{a['citations'][0]['unit_id']}"))
    assert ctx["kind"] == "page" and any(p["hi"] for p in ctx["paras"]) and ctx["open_url"].startswith("/api/sources/")
    r = ok(student.post(f"/api/tutor/conversations/{c['id']}/messages", json={"content": "Who won the football world cup in 1998?"}))
    assert r["assistant"]["status"] == "declined"
    ok(student.patch(f"/api/tutor/conversations/{c['id']}", json={"source_only": False}))
    r = ok(student.post(f"/api/tutor/conversations/{c['id']}/messages", json={"content": "Who won the football world cup in 1998?"}))
    assert r["assistant"]["status"] == "outside" and not r["assistant"]["citations"]


def test_diagnostic_and_adaptive_quiz(student):
    q = ok(student.get(f"/api/practice/quizzes/{S['diag']}"))
    while q["status"] == "active":
        it = q["items"][q["current"]]
        if it["answered"]:
            break
        resp = it["options"][0] if it["type"] == "MCQ" else "880" if it["type"] == "Numerical" else "full voltage, others not affected"
        q = ok(student.post(f"/api/practice/quizzes/{q['id']}/items/{it['id']}/answer", json={"response": resp}))
        if all(x["answered"] for x in q["items"]) and len(q["items"]) >= q["n"]:
            break
        if all(x["answered"] for x in q["items"]):
            break
    q = ok(student.post(f"/api/practice/quizzes/{S['diag']}/finish"))
    assert q["status"] == "completed" and q["summary"]["total"] >= 1

    setup = ok(student.get("/api/practice/setup"))
    tids = [t["id"] for t in setup["chapters"][0]["topics"]]
    qz = ok(student.post("/api/practice/quizzes", json={"topic_ids": tids, "types": ["MCQ", "Numerical", "Short answer"], "n": 5}))
    q = ok(student.get(f"/api/practice/quizzes/{qz['id']}"))
    assert q["status"] == "active", q
    wrong_once = False
    for _ in range(5):
        it = q["items"][q["current"]]
        if it["answered"]:
            break
        if it["type"] == "Numerical" and not wrong_once:
            resp, wrong_once = "55", True
        elif it["type"] == "MCQ":
            resp = it["options"][0] if it["options"][0] not in ("Current is used up in a resistor",) else it["options"][1]
        elif it["type"] == "Numerical":
            resp = "880 W"
        else:
            resp = "Each appliance gets the full voltage and one failing does not affect others"
        q = ok(student.post(f"/api/practice/quizzes/{q['id']}/items/{it['id']}/answer", json={"response": resp}))
        fb = next(x for x in q["items"] if x["id"] == it["id"])
        assert fb["grade"] in ("correct", "partial", "wrong") and fb["mastery_after"] is not None
        if resp == "55":
            assert fb["grade"] == "wrong" and fb["misconception"] == "Divides V by I"
    q = ok(student.post(f"/api/practice/quizzes/{qz['id']}/finish"))
    s = q["summary"]
    assert s["total"] >= 3 and s["topics"] and "counts" in s
    m = ok(student.get("/api/practice/mastery", params={"chapter_id": S["chapter"]}))
    assert any(r["status"] != "Not assessed" for r in m["rows"])


def test_mock_exam_hides_feedback(student):
    setup = ok(student.get("/api/practice/setup"))
    tids = [t["id"] for t in setup["chapters"][0]["topics"]]
    qz = ok(student.post("/api/practice/quizzes", json={"topic_ids": tids, "types": ["MCQ", "Numerical"], "n": 3, "mode": "Mock exam"}))
    q = ok(student.get(f"/api/practice/quizzes/{qz['id']}"))
    assert q["time_left"] and len(q["items"]) >= 1
    it = q["items"][0]
    q = ok(student.post(f"/api/practice/quizzes/{q['id']}/items/{it['id']}/answer", json={"response": it["options"][0] if it["options"] else "1"}))
    assert "grade" not in q["items"][0]
    q = ok(student.post(f"/api/practice/quizzes/{qz['id']}/finish"))
    assert q["status"] == "completed" and "grade" in q["items"][0]


def test_study_ai_from_text(student):
    text = "\n\n".join(b for _, b in PAGES)
    m = ok(student.post("/api/study/materials", data={"input_kind": "text", "text": text, "title": "My electricity notes"}))
    d = ok(student.get(f"/api/study/materials/{m['id']}"))
    assert d["status"] == "Ready", d
    o = d["outputs"]
    assert o["full"] and o["full"][0]["src"]["loc"].startswith("Paragraph") and o["map"]["nodes"][0]["main"]
    assert len(d["flashcards"]) == 2
    r = ok(student.post(f"/api/study/flashcards/{d['flashcards'][0]['id']}/review", json={"rating": "Good"}))
    assert r["due"]
    ok(student.patch(f"/api/study/materials/{m['id']}", json={"favorite": True, "revision_checked": [0]}))
    md = student.get(f"/api/study/materials/{m['id']}/export")
    assert md.status_code == 200 and md.text.startswith("# ")
    ok(student.post(f"/api/study/materials/{m['id']}/flag", json={"category": "Factual error", "note": "V=IR typo"}))
    S["material"] = m["id"]
    bad = student.post("/api/study/materials", data={"input_kind": "link", "url": "https://example.com/not-youtube"})
    assert bad.status_code == 400


def test_exam_and_career_student(student):
    e = ok(student.get(f"/api/exams/{S['exam']}"))
    assert e["pct"] == 0 and len(e["priority"]) == 2 and e["facts"][0]["s"] == "Verified"
    tid = e["tree"][0]["topics"][0]["id"]
    ok(student.put(f"/api/exams/{S['exam']}/topics/{tid}", json={"status": "Confident"}))
    e = ok(student.put(f"/api/exams/{S['exam']}/plan", json={"hours_per_week": 10, "target_session": "2028"}))
    assert e["pct"] == 50 and e["hours"] == 10 and e["strategy"]["week"]
    cp = ok(student.put("/api/careers/profile", json={"likes": ["Economics"], "acts": [], "unsure": [], "ideas": "Some vague ones"}))
    assert cp["directions"] and cp["directions"][0]["t"] == "Economic research"
    combos = ok(student.get("/api/careers/combinations"))
    c = combos["combinations"][0]
    assert c["dirs"] == ["BA/BSc Economics"] and c["req"][0]["k"] == "Required" and combos["dimensions"][0]["label"]
    g = ok(student.get("/api/careers/graph"))
    assert [x["type"] for x in g["columns"]][0] == "interest" and len(g["edges"]) >= 5
    nd = ok(student.get(f"/api/careers/nodes/{S['career']['degree']}"))
    assert nd["facts"] and nd["facts"][0]["stale"] is False


def test_dashboard_and_progress(student):
    d = ok(student.get("/api/dashboard"))
    assert d["continue"]["name"] == "Electricity" and d["tasks"] and d["exam"]["name"] == "IPMAT"
    assert d["career"] and d["streak"] >= 1
    ok(student.post(f"/api/dashboard/tasks/{d['tasks'][0]['id']}/toggle"))
    p = ok(student.get("/api/progress"))
    assert p["stats"][0]["l"] == "Overall progress" and p["heatmap"][0]["chapters"][0]["cells"][0] in ("done", "due")


def test_admin_review_and_people(admin, student):
    ov = ok(admin.get("/api/admin/overview"))
    assert ov["stats"][0]["l"] == "Total users"
    an = ok(admin.get("/api/admin/analytics", params={"range": "30d"}))
    assert an["kpis"][0]["l"] == "Searches" and any(z["t"] == "flux capacitor" for z in an["zero"])
    ok(admin.post("/api/admin/content-tasks", json={"title": "flux capacitor"}))
    gen = ok(admin.get("/api/admin/generated", params={"status": "Flagged"}))
    row = next(g for g in gen["rows"] if g["id"] == S["material"])
    assert row["flags"][0]["a"] == "Factual error"
    r = ok(admin.post(f"/api/admin/generated/{S['material']}", json={"action": "approve"}))
    assert r["s"] == "Ready" and not r["flags"]
    users = ok(admin.get("/api/admin/users", params={"role": "Student"}))
    assert any(u["n"] == "Ravi Kumar" for u in users["rows"])
    inv = ok(admin.post("/api/admin/invites", json={"email": f"curator{time.time_ns()}@example.com", "role": "curator"}))
    assert "/admin/signup?invite=" in inv["link"]
    pr = ok(student.post("/api/me/privacy", json={"kind": "Data export"}))
    ok(admin.post(f"/api/admin/privacy/{pr['id']}", json={"action": "complete"}))
    mine = ok(student.get("/api/me/privacy"))
    assert mine[0]["download"] is True
    dl = student.get(f"/api/me/privacy/{pr['id']}/download")
    assert dl.status_code == 200 and "mastery" in dl.json()


def test_evaluation_harness(admin):
    ok(admin.post("/api/admin/eval/cases", json=[
        {"question": "What does Ohm's law state about current and potential difference?", "expected_answer": "V = IR",
         "expected_locations": ["p. 1"], "category": "Textbook page", "subject_id": S["subject"]},
        {"question": "Who painted the Mona Lisa?", "off_material": True, "category": "Textbook page"},
    ]))
    run = ok(admin.post("/api/admin/eval/runs", json={"framework": "RAGAS"}))
    run = ok(admin.get(f"/api/admin/eval/runs/{run['id']}"))
    assert run["status"] == "completed", run["error"]
    v = run["metrics"]["values"]
    assert v["refuse"] == 1.0 and v["faith"] == 1.0 and v["cite"] == 1.0
    assert run["simulation"]["adaptive"][-1] > run["simulation"]["adaptive"][0]
    assert len(run["simulation"]["personas"]) == 6 and run["question_bank"]["verified"] >= 1


def test_public_quality_and_permissions(admin, student):
    from fastapi.testclient import TestClient

    from app.main import app

    pub = TestClient(app).get("/api/public/quality").json()
    assert pub["available"] and pub["metrics"]
    assert student.get("/api/admin/overview").status_code in (401, 403)
    assert TestClient(app).get("/api/dashboard").status_code == 401


@pytest.mark.parametrize("path", ["/api/learn/subjects", "/api/study/materials", "/api/tutor/conversations"])
def test_requires_login(path):
    from fastapi.testclient import TestClient

    from app.main import app

    assert TestClient(app).get(path).status_code == 401
