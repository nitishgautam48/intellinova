"""automatic YouTube video discovery

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "video_discoveries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(length=400), nullable=False),
        sa.Column("topic_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("query", sa.String(length=400), nullable=False),
        sa.Column("label", sa.String(length=300), nullable=False),
        sa.Column("lang", sa.String(length=10), nullable=False),
        sa.Column("class_level", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("resource_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True)), nullable=False),
        sa.Column("stats", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )
    op.create_index("ix_video_discoveries_topic_id", "video_discoveries", ["topic_id"])
    # Auto-found resources are marked in resources.meta->>'origin'; index it for the admin filter.
    op.execute("CREATE INDEX ix_resources_origin ON resources ((meta->>'origin'))")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_resources_origin")
    op.drop_index("ix_video_discoveries_topic_id", table_name="video_discoveries")
    op.drop_table("video_discoveries")
