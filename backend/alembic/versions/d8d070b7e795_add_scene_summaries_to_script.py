"""add_scene_summaries_to_script

Revision ID: d8d070b7e795
Revises: 03bc249cb8b3
Create Date: 2025-10-27 15:55:51.148021

Add scene_summaries JSONB field to scripts table for storing AI-generated
summaries in script-level editor (where individual Scene records don't exist).

Format: {"scene_heading": "summary_text"}
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'd8d070b7e795'
down_revision = '03bc249cb8b3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add scene_summaries JSONB column to scripts table
    op.add_column('scripts', sa.Column(
        'scene_summaries',
        postgresql.JSONB(astext_type=sa.Text()),
        nullable=True,
        comment='AI-generated summaries for scenes in script-level editor. Format: {scene_heading: summary_text}'
    ))


def downgrade() -> None:
    # Remove scene_summaries column from scripts table
    op.drop_column('scripts', 'scene_summaries')
