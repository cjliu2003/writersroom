"""fix_missing_scene_snapshot_metadata_table

Revision ID: 03bc249cb8b3
Revises: 20251026_script_content
Create Date: 2025-10-26 15:29:29.098246

Fix for missing scene_snapshot_metadata table that should have been created
by the 20250122_yjs_primary migration but was somehow not created.
This migration ensures the table exists for the Scene model relationship.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '03bc249cb8b3'
down_revision = '20251026_script_content'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create scene_snapshot_metadata table if it doesn't exist."""

    # Check if table already exists to make this migration idempotent
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if 'scene_snapshot_metadata' not in inspector.get_table_names():
        # Create scene_snapshot_metadata table
        op.create_table(
            'scene_snapshot_metadata',
            sa.Column(
                'snapshot_id',
                postgresql.UUID(as_uuid=True),
                primary_key=True,
                nullable=False
            ),
            sa.Column(
                'scene_id',
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey('scenes.scene_id', ondelete='CASCADE'),
                nullable=False
            ),
            sa.Column(
                'snapshot_source',
                sa.String(length=20),
                nullable=False,
                comment='Source: yjs, manual, import, migrated, compacted'
            ),
            sa.Column(
                'created_at',
                sa.DateTime(timezone=True),
                server_default=sa.text('NOW()'),
                nullable=False
            ),
            sa.Column(
                'created_by',
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey('users.user_id', ondelete='SET NULL'),
                nullable=True,
                comment='User who triggered snapshot (null for automatic)'
            ),
            sa.Column(
                'yjs_version_count',
                sa.Integer(),
                nullable=False,
                comment='Number of Yjs updates at snapshot time'
            ),
            sa.Column(
                'yjs_latest_version_id',
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey('scene_versions.version_id', ondelete='SET NULL'),
                nullable=True,
                comment='Latest Yjs version included in snapshot'
            ),
            sa.Column(
                'yjs_checksum',
                sa.String(length=64),
                nullable=False,
                comment='SHA256 checksum of Yjs state'
            ),
            sa.Column(
                'generation_time_ms',
                sa.Integer(),
                nullable=True,
                comment='Time taken to generate snapshot in milliseconds'
            ),
            sa.Column(
                'snapshot_size_bytes',
                sa.Integer(),
                nullable=True,
                comment='Size of generated snapshot in bytes'
            )
        )

        # Add indexes for scene_snapshot_metadata
        op.create_index(
            'idx_snapshot_metadata_scene',
            'scene_snapshot_metadata',
            ['scene_id', 'created_at']
        )

        op.create_index(
            'idx_snapshot_metadata_created_at',
            'scene_snapshot_metadata',
            ['created_at']
        )


def downgrade() -> None:
    """Drop scene_snapshot_metadata table."""

    # Drop indexes
    op.drop_index('idx_snapshot_metadata_created_at', 'scene_snapshot_metadata')
    op.drop_index('idx_snapshot_metadata_scene', 'scene_snapshot_metadata')

    # Drop table
    op.drop_table('scene_snapshot_metadata')
