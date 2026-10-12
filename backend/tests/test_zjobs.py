"""The "running" indicator: each portal sees only its own background work, and stuck jobs drop off."""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from tests.conftest import mail_code, new_client


def ok(r, code=200):
    assert r.status_code == code, f"{r.status_code}: {r.text}"
    return r.json()


def _student(stamp: str, n: int):
    c = new_client()
    email = f"jobs{n}-{stamp}@example.com"
    ok(c.post("/api/auth/signup", json={"name": "Meera Iyer", "email": email, "password": "studentpw1", "accepted_terms": True}))
    ok(c.post("/api/auth/verify", json={"type": "signup", "email": email, "token": mail_code(email)}))
    return c, uuid.UUID(ok(c.get("/api/auth/me"))["id"])


def test_running_jobs_are_listed_per_portal(admin, stamp):
    from app.db import SessionLocal
    from app.models import EvalRun, KbSource, Quiz, StudyMaterial
    from app.services import evaluation

    s1, u1 = _student(stamp, 1)
    s2, _ = _student(stamp, 2)
    old = datetime.now(timezone.utc) - timedelta(hours=8)
    with SessionLocal() as db:
        mat = StudyMaterial(user_id=u1, title="Heating effect notes", input_kind="text", status="Processing", stage=2)
        stuck = StudyMaterial(user_id=u1, title="Stuck notes", input_kind="text", status="Processing")
        quiz = Quiz(user_id=u1, title="Electricity quiz", status="preparing")
        done = StudyMaterial(user_id=u1, title="Finished notes", input_kind="text", status="Ready")
        src = KbSource(title=f"Jobs textbook {stamp}", kind="textbook", origin="admin", status="Processing", stage=3)
        run = EvalRun(number=evaluation.next_number(db), framework="RAGAS", status="queued")
        db.add_all([mat, stuck, quiz, done, src, run])
        db.commit()
        db.execute(update(StudyMaterial).where(StudyMaterial.id == stuck.id).values(updated_at=old))
        db.commit()
        ids = {"mat": mat.id, "stuck": stuck.id, "quiz": quiz.id, "done": done.id, "src": src.id, "run": run.id}

    try:
        mine = ok(s1.get("/api/jobs"))["jobs"]
        got = {j["id"] for j in mine}
        assert f"material:{ids['mat']}" in got and f"quiz:{ids['quiz']}" in got
        assert f"material:{ids['stuck']}" not in got, "a job with no progress for hours is not shown as running"
        assert f"material:{ids['done']}" not in got
        m = next(j for j in mine if j["id"] == f"material:{ids['mat']}")
        assert m["href"] == f"/app/study/{ids['mat']}" and m["label"] == "Heating effect notes" and m["detail"]
        assert not any(j["kind"] in ("source", "eval") for j in mine), "students never see staff jobs"

        assert ok(s2.get("/api/jobs"))["jobs"] == [], "another student's work is private"

        staff = ok(admin.get("/api/admin/jobs"))["jobs"]
        sg = {j["id"]: j for j in staff}
        assert f"source:{ids['src']}" in sg and sg[f"source:{ids['src']}"]["detail"].startswith("Step 4 of 6")
        assert f"eval:{ids['run']}" in sg and sg[f"eval:{ids['run']}"]["href"] == "/admin/eval?tab=results"
        assert not any(j["kind"] in ("material", "quiz") for j in staff), "staff jobs don't include students' notes"

        assert s1.get("/api/admin/jobs").status_code in (401, 403)
        assert admin.get("/api/jobs").status_code == 403
    finally:
        with SessionLocal() as db:
            for model, key in ((StudyMaterial, "mat"), (StudyMaterial, "stuck"), (StudyMaterial, "done"), (Quiz, "quiz"),
                               (KbSource, "src"), (EvalRun, "run")):
                obj = db.get(model, ids[key])
                if obj is not None:
                    db.delete(obj)
            db.commit()
