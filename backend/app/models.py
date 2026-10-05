"""Database schema.

Grouped the same way as the architecture: identity, curriculum, resources,
multimodal knowledge base, study material, tutor, assessment, learner model,
exam prep, career data, signals/analytics, privacy and evaluation.
"""
import uuid
from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import settings
from app.db import Base

EMBED_DIM = settings.embed_dim


def uid() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def fk(target: str, nullable: bool = False, ondelete: str = "CASCADE", index: bool = True) -> Mapped:
    return mapped_column(
        UUID(as_uuid=True), ForeignKey(target, ondelete=ondelete), nullable=nullable, index=index
    )


# --------------------------------------------------------------------------- identity


class User(Base):
    """Mirror of a GoTrue user. `id` is the GoTrue `sub`."""

    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    email: Mapped[str | None] = mapped_column(String(320), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(200), default="")
    role: Mapped[str] = mapped_column(String(20), default="student", index=True)  # student | curator | admin
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | suspended
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()

    profile: Mapped["StudentProfile | None"] = relationship(back_populates="user", uselist=False)


class AdminInvite(Base):
    __tablename__ = "admin_invites"
    id: Mapped[uuid.UUID] = uid()
    email: Mapped[str] = mapped_column(String(320), index=True)
    role: Mapped[str] = mapped_column(String(20))  # curator | admin
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    invited_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()


class StudentProfile(Base):
    __tablename__ = "student_profiles"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    nickname: Mapped[str] = mapped_column(String(80), default="")
    school: Mapped[str] = mapped_column(String(200), default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    avatar: Mapped[int] = mapped_column(Integer, default=0)
    board: Mapped[str] = mapped_column(String(60), default="")
    class_level: Mapped[str] = mapped_column(String(40), default="")
    stream: Mapped[str | None] = mapped_column(String(60))
    languages: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    subject_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list)
    interests: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    goals: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    exam_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list)
    diag_mode: Mapped[str] = mapped_column(String(20), default="skip")  # quiz | chat | skip
    prefs: Mapped[dict] = mapped_column(JSONB, default=dict)
    career_profile: Mapped[dict] = mapped_column(JSONB, default=dict)
    onboarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="profile")


# --------------------------------------------------------------------------- curriculum


class Subject(Base):
    __tablename__ = "subjects"
    __table_args__ = (UniqueConstraint("board", "class_level", "stream", "name"),)
    id: Mapped[uuid.UUID] = uid()
    board: Mapped[str] = mapped_column(String(60), index=True)
    class_level: Mapped[str] = mapped_column(String(40), index=True)
    stream: Mapped[str | None] = mapped_column(String(60))
    name: Mapped[str] = mapped_column(String(120))
    icon: Mapped[str] = mapped_column(String(60), default="menu_book")
    tone: Mapped[str] = mapped_column(String(20), default="pri")
    position: Mapped[int] = mapped_column(Integer, default=0)
    published_version: Mapped[int] = mapped_column(Integer, default=0)
    has_draft: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created()

    chapters: Mapped[list["Chapter"]] = relationship(
        back_populates="subject", order_by="Chapter.position", cascade="all, delete-orphan"
    )


class Chapter(Base):
    __tablename__ = "chapters"
    id: Mapped[uuid.UUID] = uid()
    subject_id: Mapped[uuid.UUID] = fk("subjects.id")
    position: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(String(200))
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    published: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created()

    subject: Mapped[Subject] = relationship(back_populates="chapters")
    topics: Mapped[list["Topic"]] = relationship(
        back_populates="chapter", order_by="Topic.position", cascade="all, delete-orphan"
    )


class Topic(Base):
    __tablename__ = "topics"
    id: Mapped[uuid.UUID] = uid()
    chapter_id: Mapped[uuid.UUID] = fk("chapters.id")
    position: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(200), index=True)
    est_minutes: Mapped[int] = mapped_column(Integer, default=15)
    summary: Mapped[str] = mapped_column(Text, default="")
    published: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created()

    chapter: Mapped[Chapter] = relationship(back_populates="topics")


class TopicPrereq(Base):
    __tablename__ = "topic_prereqs"
    topic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("topics.id", ondelete="CASCADE"), primary_key=True
    )
    prereq_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("topics.id", ondelete="CASCADE"), primary_key=True
    )


class CurriculumVersion(Base):
    __tablename__ = "curriculum_versions"
    id: Mapped[uuid.UUID] = uid()
    subject_id: Mapped[uuid.UUID] = fk("subjects.id")
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="Published")  # Published | Archived
    note: Mapped[str] = mapped_column(String(300), default="")
    created_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = created()


# --------------------------------------------------------------------------- resources


class Resource(Base):
    __tablename__ = "resources"
    id: Mapped[uuid.UUID] = uid()
    title: Mapped[str] = mapped_column(String(400))
    url: Mapped[str] = mapped_column(String(1000), unique=True)
    platform: Mapped[str] = mapped_column(String(60), default="Web")
    rtype: Mapped[str] = mapped_column(String(40), default="Video")  # Video | Playlist | Article | Article series | Document
    creator: Mapped[str] = mapped_column(String(200), default="")
    duration_label: Mapped[str] = mapped_column(String(80), default="")
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    thumbnail_url: Mapped[str] = mapped_column(String(1000), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    class_level: Mapped[str] = mapped_column(String(40), default="")
    subject_id: Mapped[uuid.UUID | None] = fk("subjects.id", nullable=True, ondelete="SET NULL")
    chapter_id: Mapped[uuid.UUID | None] = fk("chapters.id", nullable=True, ondelete="SET NULL")
    languages: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    difficulty: Mapped[str] = mapped_column(String(40), default="Beginner")
    quality: Mapped[str | None] = mapped_column(String(20))  # High | Medium | Low
    status: Mapped[str] = mapped_column(String(20), default="Draft", index=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    check_ok: Mapped[bool | None] = mapped_column(Boolean)
    signal: Mapped[dict] = mapped_column(JSONB, default=dict)  # YouTube engagement + sentiment
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ResourceTopic(Base):
    __tablename__ = "resource_topics"
    resource_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resources.id", ondelete="CASCADE"), primary_key=True
    )
    topic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("topics.id", ondelete="CASCADE"), primary_key=True
    )


class ResourceReport(Base):
    __tablename__ = "resource_reports"
    id: Mapped[uuid.UUID] = uid()
    resource_id: Mapped[uuid.UUID] = fk("resources.id")
    user_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    reason: Mapped[str] = mapped_column(String(120))
    note: Mapped[str] = mapped_column(Text, default="")
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created()


class ResourceFeedback(Base):
    __tablename__ = "resource_feedback"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    resource_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resources.id", ondelete="CASCADE"), primary_key=True
    )
    helpful: Mapped[str] = mapped_column(String(8))  # up | down
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ResourceProgress(Base):
    __tablename__ = "resource_progress"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    resource_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resources.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(String(20), default="started")  # started | completed
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SavedItem(Base):
    __tablename__ = "saved_items"
    __table_args__ = (UniqueConstraint("user_id", "kind", "ref_id"),)
    id: Mapped[uuid.UUID] = uid()
    user_id: Mapped[uuid.UUID] = fk("users.id")
    kind: Mapped[str] = mapped_column(String(20))  # resource | material | pathway
    ref_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    label: Mapped[str] = mapped_column(String(400), default="")
    created_at: Mapped[datetime] = created()


# --------------------------------------------------------------------------- knowledge base


class KbSource(Base):
    """One uploaded textbook, slide deck, lecture video or pasted text."""

    __tablename__ = "kb_sources"
    id: Mapped[uuid.UUID] = uid()
    title: Mapped[str] = mapped_column(String(400))
    kind: Mapped[str] = mapped_column(String(20))  # textbook | slides | video | text
    origin: Mapped[str] = mapped_column(String(20), default="admin")  # admin | student
    owner_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    url: Mapped[str] = mapped_column(String(1000), default="")
    file_path: Mapped[str] = mapped_column(String(1000), default="")
    mime: Mapped[str] = mapped_column(String(120), default="")
    size_label: Mapped[str] = mapped_column(String(80), default="")
    subject_id: Mapped[uuid.UUID | None] = fk("subjects.id", nullable=True, ondelete="SET NULL")
    chapter_id: Mapped[uuid.UUID | None] = fk("chapters.id", nullable=True, ondelete="SET NULL")
    status: Mapped[str] = mapped_column(String(20), default="Processing", index=True)
    stage: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")
    stats: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    units: Mapped[list["ContentUnit"]] = relationship(
        back_populates="source", cascade="all, delete-orphan", order_by="ContentUnit.position"
    )


class ContentUnit(Base):
    """A source-linked chunk: every unit knows its page, slide or timestamp."""

    __tablename__ = "content_units"
    id: Mapped[uuid.UUID] = uid()
    source_id: Mapped[uuid.UUID] = fk("kb_sources.id")
    position: Mapped[int] = mapped_column(Integer, default=0)
    kind: Mapped[str] = mapped_column(String(20))  # Text | Transcript | Slide | Diagram
    text: Mapped[str] = mapped_column(Text)
    location: Mapped[str] = mapped_column(String(120))  # "p. 208", "Slide 14", "Video 6 · 12:34"
    page: Mapped[int | None] = mapped_column(Integer)
    slide: Mapped[int | None] = mapped_column(Integer)
    t_start: Mapped[float | None] = mapped_column(Float)
    t_end: Mapped[float | None] = mapped_column(Float)
    heading: Mapped[str] = mapped_column(String(300), default="")
    topic_id: Mapped[uuid.UUID | None] = fk("topics.id", nullable=True, ondelete="SET NULL")
    subtopic: Mapped[str] = mapped_column(String(200), default="")  # finer grouping inside the topic
    concepts: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    prereq_topic_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    labels: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    image_path: Mapped[str] = mapped_column(String(1000), default="")
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM))
    created_at: Mapped[datetime] = created()

    source: Mapped[KbSource] = relationship(back_populates="units")


# --------------------------------------------------------------------------- study AI


class StudyMaterial(Base):
    __tablename__ = "study_materials"
    id: Mapped[uuid.UUID] = uid()
    user_id: Mapped[uuid.UUID] = fk("users.id")
    source_id: Mapped[uuid.UUID | None] = fk("kb_sources.id", nullable=True, ondelete="SET NULL")
    title: Mapped[str] = mapped_column(String(400), default="Untitled")
    input_kind: Mapped[str] = mapped_column(String(20))  # link | file | slides | text
    source_label: Mapped[str] = mapped_column(String(1000), default="")
    subject_label: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20), default="Processing", index=True)
    stage: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")
    outputs: Mapped[dict] = mapped_column(JSONB, default=dict)
    views: Mapped[int] = mapped_column(Integer, default=0)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    # Revision packs are built from the knowledge base for these topics instead of an upload (6b).
    topic_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list)
    disabled_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ContentFlag(Base):
    __tablename__ = "content_flags"
    id: Mapped[uuid.UUID] = uid()
    material_id: Mapped[uuid.UUID] = fk("study_materials.id")
    user_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    category: Mapped[str] = mapped_column(String(60))
    note: Mapped[str] = mapped_column(Text, default="")
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created()


class Flashcard(Base):
    __tablename__ = "flashcards"
    id: Mapped[uuid.UUID] = uid()
    material_id: Mapped[uuid.UUID] = fk("study_materials.id")
    position: Mapped[int] = mapped_column(Integer, default=0)
    front: Mapped[str] = mapped_column(Text)
    back: Mapped[str] = mapped_column(Text)
    topic_label: Mapped[str] = mapped_column(String(200), default="")
    source_loc: Mapped[str] = mapped_column(String(120), default="")
    unit_id: Mapped[uuid.UUID | None] = fk("content_units.id", nullable=True, ondelete="SET NULL")


class CardState(Base):
    __tablename__ = "card_states"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    flashcard_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flashcards.id", ondelete="CASCADE"), primary_key=True
    )
    fsrs: Mapped[dict] = mapped_column(JSONB, default=dict)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    last_rating: Mapped[str] = mapped_column(String(10), default="")


# --------------------------------------------------------------------------- tutor


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[uuid.UUID] = uid()
    user_id: Mapped[uuid.UUID] = fk("users.id")
    title: Mapped[str] = mapped_column(String(300), default="New conversation")
    lang: Mapped[str] = mapped_column(String(10), default="en")  # en | hing | hi
    source_only: Mapped[bool] = mapped_column(Boolean, default=False)
    scope: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="Message.created_at"
    )


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[uuid.UUID] = uid()
    conversation_id: Mapped[uuid.UUID] = fk("conversations.id")
    role: Mapped[str] = mapped_column(String(12))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    lang: Mapped[str] = mapped_column(String(10), default="en")
    citations: Mapped[list] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(20), default="answered")  # answered | declined | outside
    support: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = created()

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


# --------------------------------------------------------------------------- assessment


class Question(Base):
    __tablename__ = "questions"
    id: Mapped[uuid.UUID] = uid()
    topic_id: Mapped[uuid.UUID] = fk("topics.id")
    qtype: Mapped[str] = mapped_column(String(20))  # MCQ | Numerical | Short answer
    difficulty: Mapped[str] = mapped_column(String(10))  # Easy | Medium | Hard
    stem: Mapped[str] = mapped_column(Text)
    options: Mapped[list] = mapped_column(JSONB, default=list)
    answer: Mapped[str] = mapped_column(Text, default="")
    answer_num: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(20), default="")
    tolerance: Mapped[float] = mapped_column(Float, default=0.01)
    rubric: Mapped[list] = mapped_column(JSONB, default=list)
    explanation: Mapped[str] = mapped_column(Text, default="")
    misconceptions: Mapped[dict] = mapped_column(JSONB, default=dict)
    unit_id: Mapped[uuid.UUID | None] = fk("content_units.id", nullable=True, ondelete="SET NULL")
    status: Mapped[str] = mapped_column(String(20), default="verified", index=True)
    verification: Mapped[dict] = mapped_column(JSONB, default=dict)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM))
    irt_b: Mapped[float] = mapped_column(Float, default=0.0)
    times_served: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = created()


class Quiz(Base):
    __tablename__ = "quizzes"
    id: Mapped[uuid.UUID] = uid()
    user_id: Mapped[uuid.UUID] = fk("users.id")
    title: Mapped[str] = mapped_column(String(300), default="Quiz")
    mode: Mapped[str] = mapped_column(String(20), default="Quiz")  # Quiz | Mock exam | Diagnostic
    difficulty_mode: Mapped[str] = mapped_column(String(20), default="Adaptive")
    types: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    topic_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list)
    n: Mapped[int] = mapped_column(Integer, default=5)
    status: Mapped[str] = mapped_column(String(20), default="preparing")  # preparing | active | completed | failed
    error: Mapped[str] = mapped_column(Text, default="")
    time_limit_s: Mapped[int | None] = mapped_column(Integer)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = created()

    items: Mapped[list["QuizItem"]] = relationship(
        back_populates="quiz", cascade="all, delete-orphan", order_by="QuizItem.position"
    )


class QuizItem(Base):
    __tablename__ = "quiz_items"
    id: Mapped[uuid.UUID] = uid()
    quiz_id: Mapped[uuid.UUID] = fk("quizzes.id")
    position: Mapped[int] = mapped_column(Integer)
    question_id: Mapped[uuid.UUID] = fk("questions.id")
    response: Mapped[str | None] = mapped_column(Text)
    grade: Mapped[str | None] = mapped_column(String(10))  # correct | partial | wrong
    rubric_hits: Mapped[list] = mapped_column(JSONB, default=list)
    misconception: Mapped[str] = mapped_column(Text, default="")
    mastery_before: Mapped[float | None] = mapped_column(Float)
    mastery_after: Mapped[float | None] = mapped_column(Float)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    quiz: Mapped[Quiz] = relationship(back_populates="items")
    question: Mapped[Question] = relationship()


# --------------------------------------------------------------------------- learner model


class Mastery(Base):
    __tablename__ = "mastery"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    topic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("topics.id", ondelete="CASCADE"), primary_key=True
    )
    p: Mapped[float] = mapped_column(Float, default=0.25)
    uncertainty: Mapped[float] = mapped_column(Float, default=0.25)
    n_obs: Mapped[int] = mapped_column(Integer, default=0)
    last_evidence: Mapped[str] = mapped_column(String(200), default="")
    last_evidence_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fsrs: Mapped[dict] = mapped_column(JSONB, default=dict)
    next_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MasteryEvent(Base):
    __tablename__ = "mastery_events"
    id: Mapped[uuid.UUID] = uid()
    user_id: Mapped[uuid.UUID] = fk("users.id")
    topic_id: Mapped[uuid.UUID] = fk("topics.id")
    source: Mapped[str] = mapped_column(String(20))  # quiz | diagnostic | tutor | revision
    correct: Mapped[float] = mapped_column(Float)
    p_before: Mapped[float] = mapped_column(Float)
    p_after: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = created()


class TopicProgress(Base):
    __tablename__ = "topic_progress"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    topic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("topics.id", ondelete="CASCADE"), primary_key=True
    )
    completed_at: Mapped[datetime] = created()


class DailyTask(Base):
    __tablename__ = "daily_tasks"
    id: Mapped[uuid.UUID] = uid()
    user_id: Mapped[uuid.UUID] = fk("users.id")
    day: Mapped[date] = mapped_column(Date, index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[str] = mapped_column(String(300))
    meta: Mapped[str] = mapped_column(String(300), default="")
    dur_min: Mapped[int] = mapped_column(Integer, default=15)
    why: Mapped[str] = mapped_column(String(80), default="")
    tone: Mapped[str] = mapped_column(String(10), default="pri")
    link: Mapped[dict] = mapped_column(JSONB, default=dict)
    done: Mapped[bool] = mapped_column(Boolean, default=False)


# --------------------------------------------------------------------------- exam prep


class Exam(Base):
    __tablename__ = "exams"
    id: Mapped[uuid.UUID] = uid()
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    full_name: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(20), default="Draft")  # Active | Draft
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = created()

    subjects: Mapped[list["ExamSubject"]] = relationship(
        back_populates="exam", cascade="all, delete-orphan", order_by="ExamSubject.position"
    )
    facts: Mapped[list["ExamFact"]] = relationship(
        back_populates="exam", cascade="all, delete-orphan", order_by="ExamFact.position"
    )


class ExamSubject(Base):
    __tablename__ = "exam_subjects"
    id: Mapped[uuid.UUID] = uid()
    exam_id: Mapped[uuid.UUID] = fk("exams.id")
    name: Mapped[str] = mapped_column(String(200))
    position: Mapped[int] = mapped_column(Integer, default=0)

    exam: Mapped[Exam] = relationship(back_populates="subjects")
    units: Mapped[list["ExamUnit"]] = relationship(
        back_populates="subject", cascade="all, delete-orphan", order_by="ExamUnit.position"
    )


class ExamUnit(Base):
    __tablename__ = "exam_units"
    id: Mapped[uuid.UUID] = uid()
    exam_subject_id: Mapped[uuid.UUID] = fk("exam_subjects.id")
    name: Mapped[str] = mapped_column(String(200))
    position: Mapped[int] = mapped_column(Integer, default=0)

    subject: Mapped[ExamSubject] = relationship(back_populates="units")
    topics: Mapped[list["ExamTopic"]] = relationship(
        back_populates="unit", cascade="all, delete-orphan", order_by="ExamTopic.position",
        foreign_keys="ExamTopic.unit_id",
    )


class ExamTopic(Base):
    __tablename__ = "exam_topics"
    id: Mapped[uuid.UUID] = uid()
    unit_id: Mapped[uuid.UUID] = fk("exam_units.id")
    name: Mapped[str] = mapped_column(String(200))
    priority: Mapped[str] = mapped_column(String(10), default="Medium")  # High | Medium | Low
    prereq_id: Mapped[uuid.UUID | None] = fk("exam_topics.id", nullable=True, ondelete="SET NULL")
    topic_id: Mapped[uuid.UUID | None] = fk("topics.id", nullable=True, ondelete="SET NULL")
    position: Mapped[int] = mapped_column(Integer, default=0)

    unit: Mapped[ExamUnit] = relationship(back_populates="topics", foreign_keys=[unit_id])


class ExamTopicResource(Base):
    __tablename__ = "exam_topic_resources"
    exam_topic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("exam_topics.id", ondelete="CASCADE"), primary_key=True
    )
    resource_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resources.id", ondelete="CASCADE"), primary_key=True
    )


class ExamFact(Base):
    __tablename__ = "exam_facts"
    id: Mapped[uuid.UUID] = uid()
    exam_id: Mapped[uuid.UUID] = fk("exams.id")
    key: Mapped[str] = mapped_column(String(200))
    value: Mapped[str] = mapped_column(Text, default="")
    source_name: Mapped[str] = mapped_column(String(200), default="")
    source_url: Mapped[str] = mapped_column(String(1000), default="")
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    position: Mapped[int] = mapped_column(Integer, default=0)

    exam: Mapped[Exam] = relationship(back_populates="facts")


class StudentExamTopic(Base):
    __tablename__ = "student_exam_topics"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    exam_topic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("exam_topics.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(String(20), default="Not started")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class StudentExamPlan(Base):
    __tablename__ = "student_exam_plans"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    exam_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("exams.id", ondelete="CASCADE"), primary_key=True
    )
    target_session: Mapped[str] = mapped_column(String(60), default="")
    hours_per_week: Mapped[int] = mapped_column(Integer, default=6)
    plan: Mapped[dict] = mapped_column(JSONB, default=dict)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# --------------------------------------------------------------------------- career data


class CareerNode(Base):
    __tablename__ = "career_nodes"
    __table_args__ = (UniqueConstraint("ntype", "name"),)
    id: Mapped[uuid.UUID] = uid()
    ntype: Mapped[str] = mapped_column(String(20), index=True)  # interest | subject | combination | degree | entrance | area
    name: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(String(300), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    source_name: Mapped[str] = mapped_column(String(200), default="")
    source_url: Mapped[str] = mapped_column(String(1000), default="")
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()


class CareerEdge(Base):
    """A connection in the pathway graph. Edges with a `requirement` are eligibility rules."""

    __tablename__ = "career_edges"
    __table_args__ = (UniqueConstraint("from_id", "to_id"),)
    id: Mapped[uuid.UUID] = uid()
    from_id: Mapped[uuid.UUID] = fk("career_nodes.id")
    to_id: Mapped[uuid.UUID] = fk("career_nodes.id")
    requirement: Mapped[str | None] = mapped_column(String(20))  # Required | Recommended | Useful
    label: Mapped[str] = mapped_column(String(300), default="")
    note: Mapped[str] = mapped_column(String(500), default="")
    source_name: Mapped[str] = mapped_column(String(200), default="")
    source_url: Mapped[str] = mapped_column(String(1000), default="")
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()


class CareerDimension(Base):
    """A row of the combination comparison table ("Economics degrees", ...)."""

    __tablename__ = "career_dimensions"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    label: Mapped[str] = mapped_column(String(120))
    note: Mapped[str] = mapped_column(Text, default="")
    position: Mapped[int] = mapped_column(Integer, default=0)


# --------------------------------------------------------------------------- signals / analytics


class ActivityEvent(Base):
    __tablename__ = "activity_events"
    id: Mapped[uuid.UUID] = uid()
    user_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    kind: Mapped[str] = mapped_column(String(40), index=True)
    ref_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    module: Mapped[str] = mapped_column(String(20), default="")  # notes | exam | career | tutor | practice | learn
    minutes: Mapped[float] = mapped_column(Float, default=0.0)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class SearchLog(Base):
    __tablename__ = "search_logs"
    id: Mapped[uuid.UUID] = uid()
    user_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    query: Mapped[str] = mapped_column(String(300))
    normalized: Mapped[str] = mapped_column(String(300), index=True)
    result_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class ContentTask(Base):
    __tablename__ = "content_tasks"
    id: Mapped[uuid.UUID] = uid()
    kind: Mapped[str] = mapped_column(String(30), default="zero_result")
    title: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(20), default="open")
    created_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    created_at: Mapped[datetime] = created()


# --------------------------------------------------------------------------- privacy


class PrivacyRequest(Base):
    __tablename__ = "privacy_requests"
    id: Mapped[uuid.UUID] = uid()
    user_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    user_label: Mapped[str] = mapped_column(String(320), default="")
    kind: Mapped[str] = mapped_column(String(30))  # Data export | Account deletion | Data correction
    details: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | completed | rejected
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result_path: Mapped[str] = mapped_column(String(1000), default="")
    created_at: Mapped[datetime] = created()


# --------------------------------------------------------------------------- evaluation harness


class EvalCase(Base):
    """A held-out test question written by the content team."""

    __tablename__ = "eval_cases"
    id: Mapped[uuid.UUID] = uid()
    question: Mapped[str] = mapped_column(Text)
    expected_answer: Mapped[str] = mapped_column(Text, default="")
    expected_locations: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    category: Mapped[str] = mapped_column(String(40), default="Textbook page")
    off_material: Mapped[bool] = mapped_column(Boolean, default=False)
    subject_id: Mapped[uuid.UUID | None] = fk("subjects.id", nullable=True, ondelete="SET NULL")
    created_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    created_at: Mapped[datetime] = created()


class EvalRun(Base):
    __tablename__ = "eval_runs"
    id: Mapped[uuid.UUID] = uid()
    number: Mapped[int] = mapped_column(Integer, unique=True)
    framework: Mapped[str] = mapped_column(String(20), default="RAGAS")
    pipeline_version: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20), default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    metrics: Mapped[dict] = mapped_column(JSONB, default=dict)
    categories: Mapped[list] = mapped_column(JSONB, default=list)
    failures: Mapped[list] = mapped_column(JSONB, default=list)
    question_bank: Mapped[dict] = mapped_column(JSONB, default=dict)
    simulation: Mapped[dict] = mapped_column(JSONB, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()


class TopicProposal(Base):
    """A topic (with subtopics) the ingestion pipeline found in uploaded material that the curriculum
    doesn't have yet. Staff accept it (creating the chapter/topic as a draft and tagging the units) or reject it."""

    __tablename__ = "topic_proposals"
    id: Mapped[uuid.UUID] = uid()
    source_id: Mapped[uuid.UUID] = fk("kb_sources.id")
    subject_id: Mapped[uuid.UUID | None] = fk("subjects.id", nullable=True, ondelete="SET NULL")
    chapter_id: Mapped[uuid.UUID | None] = fk("chapters.id", nullable=True, ondelete="SET NULL")
    chapter_name: Mapped[str] = mapped_column(String(200), default="")
    topic_name: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(Text, default="")
    subtopics: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    unit_subtopics: Mapped[dict] = mapped_column(JSONB, default=dict)  # unit id -> subtopic
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending | accepted | rejected
    topic_id: Mapped[uuid.UUID | None] = fk("topics.id", nullable=True, ondelete="SET NULL")
    created_at: Mapped[datetime] = created()


class VideoDiscovery(Base):
    """One automatic YouTube search for a topic (or a free-text query), cached for discovery_ttl_days."""

    __tablename__ = "video_discoveries"
    id: Mapped[uuid.UUID] = uid()
    key: Mapped[str] = mapped_column(String(400), unique=True)  # topic:<id>:<lang> | q:<text>:<class>:<lang>
    topic_id: Mapped[uuid.UUID | None] = fk("topics.id", nullable=True)
    query: Mapped[str] = mapped_column(String(400), default="")
    label: Mapped[str] = mapped_column(String(300), default="")
    lang: Mapped[str] = mapped_column(String(10), default="en")
    class_level: Mapped[str] = mapped_column(String(40), default="")
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | running | done | failed | skipped
    resource_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list)
    stats: Mapped[dict] = mapped_column(JSONB, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class StudySchedule(Base):
    """A student's day-by-day plan up to an exam date (6c). One per user; rebuilt from the learner model
    each day so missed or finished work reshapes the rest of the plan."""

    __tablename__ = "study_schedules"
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), default="My exam")
    exam_date: Mapped[date] = mapped_column(Date)
    minutes_per_day: Mapped[int] = mapped_column(Integer, default=60)
    subject_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list)
    chapter_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list)  # empty = whole subjects
    rest_days: Mapped[list[int]] = mapped_column(ARRAY(Integer), default=list)  # 0 = Monday
    plan: Mapped[dict] = mapped_column(JSONB, default=dict)
    done: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)  # finished item keys
    built_on: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = created()


class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, default=dict)
