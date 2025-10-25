"""Add Yjs-primary architecture metadata fields

Revision ID: 20250122_yjs_primary
Revises: add_fdx_fields_to_scenes
Create Date: 2025-01-22 12:00:00.000000

This migration implements the database schema changes for the Yjs-primary
persistence architecture as specified in:
docs/architecture/yjs-primary-persistence-design.md

Changes:
1. Add metadata columns to scenes table for snapshot tracking
2. Add compaction columns to scene_versions table
3. Create scene_snapshot_metadata table for audit trail
4. Add indexes for performance optimization
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20250122_yjs_primary'
down_revision = 'add_fdx_fields_to_scenes'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade database schema to Yjs-primary architecture."""

    # ===================================================================
    # 1. Add Yjs-primary metadata columns to scenes table
    # ===================================================================
    op.add_column('scenes', sa.Column(
        'snapshot_source',
        sa.String(length=20),
        nullable=False,
        server_default='rest',
        comment='Source of snapshot: yjs, manual, import, migrated, compacted'
    ))

    op.add_column('scenes', sa.Column(
        'snapshot_at',
        sa.DateTime(timezone=True),
        nullable=True,
        comment='When this snapshot was created'
    ))

    op.add_column('scenes', sa.Column(
        'yjs_derived',
        sa.Integer(),  # Boolean as 0/1 for SQLite compatibility
        nullable=False,
        server_default='0',
        comment='True if content_blocks derived from Yjs state'
    ))

    op.add_column('scenes', sa.Column(
        'yjs_checksum',
        sa.String(length=64),
        nullable=True,
        comment='SHA256 checksum of Yjs state for comparison'
    ))

    # Add check constraint for snapshot_source enum
    op.create_check_constraint(
        'ck_scenes_snapshot_source',
        'scenes',
        "snapshot_source IN ('yjs', 'manual', 'import', 'migrated', 'compacted', 'rest')"
    )

    # Add index for snapshot freshness queries
    op.create_index(
        'idx_scenes_snapshot_at',
        'scenes',
        ['snapshot_at'],
        postgresql_where=sa.text('yjs_derived = 1')
    )

    # ===================================================================
    # 2. Add compaction metadata columns to scene_versions table
    # ===================================================================
    op.add_column('scene_versions', sa.Column(
        'is_compacted',
        sa.Integer(),  # Boolean as 0/1
        nullable=False,
        server_default='0',
        comment='True if this is a compacted update merging multiple originals'
    ))

    op.add_column('scene_versions', sa.Column(
        'compacted_count',
        sa.Integer(),
        nullable=False,
        server_default='1',
        comment='Number of updates merged into this compacted version'
    ))

    op.add_column('scene_versions', sa.Column(
        'compacted_by',
        postgresql.UUID(as_uuid=True),
        nullable=True,
        comment='If this update was compacted, references the compacted version'
    ))

    op.add_column('scene_versions', sa.Column(
        'created_by',
        postgresql.UUID(as_uuid=True),
        nullable=True,
        comment='User who created this update (null for system/migration)'
    ))

    # Add foreign key for compacted_by (self-referential)
    op.create_foreign_key(
        'fk_scene_versions_compacted_by',
        'scene_versions',
        'scene_versions',
        ['compacted_by'],
        ['version_id'],
        ondelete='SET NULL'
    )

    # Add foreign key for created_by
    op.create_foreign_key(
        'fk_scene_versions_created_by',
        'scene_versions',
        'users',
        ['created_by'],
        ['user_id'],
        ondelete='SET NULL'
    )

    # Add check constraints
    op.create_check_constraint(
        'yjs_update_not_empty',
        'scene_versions',
        'length(yjs_update) > 0'
    )

    op.create_check_constraint(
        'compacted_count_positive',
        'scene_versions',
        'compacted_count > 0'
    )

    # Add index for finding non-compacted updates efficiently
    op.create_index(
        'idx_scene_versions_compacted',
        'scene_versions',
        ['scene_id', 'is_compacted', 'created_at'],
        postgresql_where=sa.text('is_compacted = 0')
    )

    # ===================================================================
    # 3. Create scene_snapshot_metadata table
    # ===================================================================
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
    """Downgrade database schema (rollback Yjs-primary changes)."""

    # ===================================================================
    # 1. Drop scene_snapshot_metadata table
    # ===================================================================
    op.drop_index('idx_snapshot_metadata_created_at', 'scene_snapshot_metadata')
    op.drop_index('idx_snapshot_metadata_scene', 'scene_snapshot_metadata')
    op.drop_table('scene_snapshot_metadata')

    # ===================================================================
    # 2. Remove compaction columns from scene_versions
    # ===================================================================
    op.drop_index('idx_scene_versions_compacted', 'scene_versions')
    op.drop_constraint('compacted_count_positive', 'scene_versions', type_='check')
    op.drop_constraint('yjs_update_not_empty', 'scene_versions', type_='check')
    op.drop_constraint('fk_scene_versions_created_by', 'scene_versions', type_='foreignkey')
    op.drop_constraint('fk_scene_versions_compacted_by', 'scene_versions', type_='foreignkey')

    op.drop_column('scene_versions', 'created_by')
    op.drop_column('scene_versions', 'compacted_by')
    op.drop_column('scene_versions', 'compacted_count')
    op.drop_column('scene_versions', 'is_compacted')

    # ===================================================================
    # 3. Remove Yjs-primary metadata from scenes table
    # ===================================================================
    op.drop_index('idx_scenes_snapshot_at', 'scenes')
    op.drop_constraint('ck_scenes_snapshot_source', 'scenes', type_='check')

    op.drop_column('scenes', 'yjs_checksum')
    op.drop_column('scenes', 'yjs_derived')
    op.drop_column('scenes', 'snapshot_at')
    op.drop_column('scenes', 'snapshot_source')
