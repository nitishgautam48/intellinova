"""Background jobs. Four worker roles from the architecture share one image:
ingest (parsing/transcription), ai (LLM + embeddings), signal (YouTube
engagement) and feedback (students' own behaviour -> learner model)."""
import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from app.db import SessionLocal
from app.models import (
    ActivityEvent,
    CardState,
    Conversation,
    Mastery,
    Message,
    PrivacyRequest,
    Quiz,
    QuizItem,
    Resource,
    SavedItem,
    StudentProfile,
    StudyMaterial,
    Topic,
    User,
)
from app.services import evaluation, ingestion, learner, llm, notes, quiz_engine, resources, search, storage
from app.services.llm import LLMError, arr, obj
from app.workers.celery_app import celery

log = logging.getLogger(__name__)


def _uuid(x) -> uuid.UUID:
    return x if isinstance(x, uuid.UUID) else uuid.UUID(str(x))


@celery.task
def ingest_source(source_id: str) -> str:
    with SessionLocal() as db:
        src = ingestion.ingest(db, _uuid(source_id))
        return src.status


@celery.task
def generate_material(material_id: str, lang: str = "en") -> str:
    with SessionLocal() as db:
        return notes.generate(db, _uuid(material_id), lang).status


@celery.task
def prepare_quiz(quiz_id: str) -> str:
    with SessionLocal() as db:
        return quiz_engine.prepare(db, _uuid(quiz_id)).status


@celery.task
def generate_questions(topic_id: str, n: int = 6) -> dict:
    from app.services import questions

    with SessionLocal() as db:
        t = db.get(Topic, _uuid(topic_id))
        return questions.generate(db, t, n) if t else {}


EVIDENCE_SCHEMA = obj({"evidence": arr(obj({"topic": llm.INT, "understood": llm.N}))})


@celery.task
def chat_evidence(message_id: str) -> int:
    """Soft learner-model evidence from a tutor conversation: only when the
    student clearly shows understanding or a misconception."""
    with SessionLocal() as db:
        msg = db.get(Message, _uuid(message_id))
        if not msg or msg.role != "user" or len(msg.content) < 40:
            return 0
        conv = db.get(Conversation, msg.conversation_id)
        topic_ids = [uuid.UUID(t) for t in (conv.scope or {}).get("recent_topics", [])][:8]
        if not topic_ids:
            return 0
        topics = [db.get(Topic, t) for t in topic_ids]
        topics = [t for t in topics if t]
        try:
            out = llm.chat([
                {"role": "system", "content": "Decide if the student's message shows they understand (1) or "
                                              "misunderstand (0) any listed topic. Only include topics with clear "
                                              "evidence; return an empty list otherwise."},
                {"role": "user", "content": "Topics:\n" + "\n".join(f"{i}: {t.name}" for i, t in enumerate(topics))
                                            + f"\n\nStudent: {msg.content[:1500]}"}],
                task="chat_evidence", schema=EVIDENCE_SCHEMA, temperature=0.0)
        except LLMError:
            return 0
        n = 0
        for ev in out.get("evidence", []):
            i = ev.get("topic")
            if isinstance(i, int) and 0 <= i < len(topics):
                learner.update(db, conv.user_id, topics[i].id, max(0.0, min(1.0, float(ev.get("understood", 0.5)))),
                               "tutor", "chat", "Tutor chat · " + datetime.now().strftime("%d %b"), weight=0.35)
                n += 1
        db.commit()
        return n


@celery.task
def run_eval(run_id: str) -> str:
    with SessionLocal() as db:
        return evaluation.execute(db, _uuid(run_id)).status


@celery.task
def prepare_question_bank(per_topic: int = 10) -> dict:
    with SessionLocal() as db:
        return evaluation.prepare_bank(db, per_topic)


@celery.task
def check_links() -> dict:
    with SessionLocal() as db:
        ok = bad = 0
        for r in db.scalars(select(Resource).where(Resource.status.in_(("Active", "Needs Review")))):
            alive = resources.check_link(r.url)
            prev = r.check_ok
            r.check_ok, r.last_checked_at = alive, datetime.now(timezone.utc)
            if not alive and prev is False:  # two failed checks in a row
                r.status = "Unavailable"
                bad += 1
            else:
                ok += 1
            db.commit()
        search.safe_reindex(db)
        return {"ok": ok, "unavailable": bad}


@celery.task
def refresh_signals() -> int:
    with SessionLocal() as db:
        n = 0
        for r in db.scalars(select(Resource).where(Resource.status == "Active", Resource.platform == "YouTube")):
            try:
                resources.refresh_signal(db, r)
                db.commit()
                n += 1
            except Exception as e:  # noqa: BLE001
                db.rollback()
                log.warning("Signal refresh failed for %s: %s", r.url, e)
        return n


@celery.task
def discover_videos(discovery_id: str) -> str:
    """Search YouTube for a topic, judge the candidates and add the best (services/discovery.py)."""
    from app.services import discovery

    with SessionLocal() as db:
        return discovery.run(db, _uuid(discovery_id)).status


@celery.task
def fit_bkt() -> int:
    with SessionLocal() as db:
        return learner.fit_bkt_params(db)


@celery.task
def reindex_search() -> int:
    with SessionLocal() as db:
        return search.reindex_all(db)


def export_user_data(db, user: User) -> str:
    prof = db.get(StudentProfile, user.id)

    def rows(model, *where):
        return [{c.name: getattr(o, c.name) for c in model.__table__.columns if c.name != "embedding"}
                for o in db.scalars(select(model).where(*where))]

    data = {
        "account": {"id": user.id, "email": user.email, "name": user.name, "created_at": user.created_at},
        "profile": {c.name: getattr(prof, c.name) for c in StudentProfile.__table__.columns} if prof else None,
        "mastery": rows(Mastery, Mastery.user_id == user.id),
        "quizzes": rows(Quiz, Quiz.user_id == user.id),
        "quiz_answers": rows(QuizItem, QuizItem.quiz_id.in_(select(Quiz.id).where(Quiz.user_id == user.id))),
        "study_materials": rows(StudyMaterial, StudyMaterial.user_id == user.id),
        "flashcard_reviews": rows(CardState, CardState.user_id == user.id),
        "conversations": rows(Conversation, Conversation.user_id == user.id),
        "messages": rows(Message, Message.conversation_id.in_(select(Conversation.id).where(Conversation.user_id == user.id))),
        "saved": rows(SavedItem, SavedItem.user_id == user.id),
        "activity": rows(ActivityEvent, ActivityEvent.user_id == user.id),
    }
    return storage.save_bytes(json.dumps(data, default=str, indent=2, ensure_ascii=False).encode(), ".json", "exports")


@celery.task
def privacy_export(request_id: str) -> str:
    with SessionLocal() as db:
        req = db.get(PrivacyRequest, _uuid(request_id))
        user = db.get(User, req.user_id) if req and req.user_id else None
        if not user:
            return "missing"
        req.result_path = export_user_data(db, user)
        db.commit()
        return req.result_path
