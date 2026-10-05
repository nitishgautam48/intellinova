"""subtopics, topic suggestions from material, study schedules, revision packs

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    # 1c: subtopics inside topics, and topics proposed from uploaded material
    op.add_column("content_units", sa.Column("subtopic", sa.String(length=200), server_default="", nullable=False))
    op.create_table(
        "topic_proposals",
        sa.Column("id", UUID, nullable=False),
        sa.Column("source_id", UUID, nullable=False),
        sa.Column("subject_id", UUID, nullable=True),
        sa.Column("chapter_id", UUID, nullable=True),
        sa.Column("chapter_name", sa.String(length=200), nullable=False),
        sa.Column("topic_name", sa.String(length=200), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("subtopics", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("unit_subtopics", JSONB, nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("topic_id", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["kb_sources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subject_id"], ["subjects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["chapter_id"], ["chapters.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for col in ("source_id", "subject_id", "chapter_id", "topic_id", "status"):
        op.create_index(f"ix_topic_proposals_{col}", "topic_proposals", [col])
    # 6c: exam-date study schedule
    op.create_table(
        "study_schedules",
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("exam_date", sa.Date(), nullable=False),
        sa.Column("minutes_per_day", sa.Integer(), nullable=False),
        sa.Column("subject_ids", postgresql.ARRAY(UUID), nullable=False),
        sa.Column("chapter_ids", postgresql.ARRAY(UUID), nullable=False),
        sa.Column("rest_days", postgresql.ARRAY(sa.Integer()), nullable=False),
        sa.Column("plan", JSONB, nullable=False),
        sa.Column("done", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("built_on", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    # 6b: revision packs built from the knowledge base for chosen topics
    op.add_column("study_materials", sa.Column("topic_ids", postgresql.ARRAY(UUID), server_default="{}", nullable=False))
    # @@NEXT@@


def downgrade() -> None:
    # @@NEXT_DOWN@@
    op.drop_column("study_materials", "topic_ids")
    op.drop_table("study_schedules")
    op.drop_table("topic_proposals")
    op.drop_column("content_units", "subtopic")
