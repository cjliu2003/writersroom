"""Add script_versions table for script-level Yjs persistence

Revision ID: 20251026_script_versions
Revises: 6d02409f37a6
Create Date: 2025-10-26 19:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = '20251026_script_versions'
down_revision = '6d02409f37a6'
branch_labels = None
depends_on = None


def upgrade():
    """Create script_versions table for script-level Yjs updates."""
    op.create_table(
        'script_versions',
        sa.Column('version_id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('script_id', UUID(as_uuid=True), sa.ForeignKey('scripts.script_id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('update', sa.LargeBinary, nullable=False, comment='Yjs binary update'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('users.user_id'), nullable=True),
    )

    # Create composite index for efficient querying
    op.create_index(
        'idx_script_versions_script_created',
        'script_versions',
        ['script_id', 'created_at']
    )


def downgrade():
    """Drop script_versions table."""
    op.drop_index('idx_script_versions_script_created', table_name='script_versions')
    op.drop_table('script_versions')
