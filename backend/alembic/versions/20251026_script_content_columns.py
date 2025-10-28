"""Add content and version columns to scripts table

Revision ID: 20251026_script_content
Revises: 20251026_script_versions
Create Date: 2025-10-26 19:35:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers, used by Alembic.
revision = '20251026_script_content'
down_revision = '20251026_script_versions'
branch_labels = None
depends_on = None


def upgrade():
    """Add script-level content columns for script-level editing."""
    # Add content_blocks column (JSONB for full script content)
    op.add_column(
        'scripts',
        sa.Column('content_blocks', JSONB, nullable=True, comment='Full script content blocks')
    )

    # Add version column for optimistic locking (CAS)
    op.add_column(
        'scripts',
        sa.Column('version', sa.Integer, nullable=False, server_default='0', comment='Optimistic locking version for CAS')
    )

    # Add yjs_state column for optional Yjs state snapshot caching
    op.add_column(
        'scripts',
        sa.Column('yjs_state', sa.LargeBinary, nullable=True, comment='Yjs state snapshot for quick loading')
    )

    # Add updated_by column to track last editor
    op.add_column(
        'scripts',
        sa.Column('updated_by', UUID(as_uuid=True), sa.ForeignKey('users.user_id'), nullable=True)
    )


def downgrade():
    """Remove script-level content columns."""
    op.drop_column('scripts', 'updated_by')
    op.drop_column('scripts', 'yjs_state')
    op.drop_column('scripts', 'version')
    op.drop_column('scripts', 'content_blocks')
