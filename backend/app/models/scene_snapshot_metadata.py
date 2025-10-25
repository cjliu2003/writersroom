"""
Scene Snapshot Metadata Model

Tracks snapshot creation history and freshness for Yjs-primary architecture.
"""
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, String, DateTime, Index
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.scene import Scene
    from app.models.scene_version import SceneVersion
    from app.models.user import User


class SceneSnapshotMetadata(Base):
    """
    Tracks snapshot creation history and freshness.

    Each record represents one snapshot creation event, allowing us to:
    - Track snapshot generation performance
    - Verify snapshot freshness
    - Audit snapshot sources
    - Monitor system health
    """
    __tablename__ = 'scene_snapshot_metadata'
    __table_args__ = (
        Index('idx_snapshot_metadata_scene', 'scene_id', 'created_at'),
    )

    # Identity
    snapshot_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        nullable=False
    )

    scene_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scenes.scene_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )

    # Snapshot details
    snapshot_source: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment='Source: yjs, manual, import, migrated, compacted'
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True
    )

    created_by: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('users.user_id'),
        nullable=True,
        comment='User who triggered snapshot (null for automatic)'
    )

    # Freshness tracking
    yjs_version_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment='Number of Yjs updates at snapshot time'
    )

    yjs_latest_version_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scene_versions.version_id'),
        nullable=True,
        comment='Latest Yjs version included in snapshot'
    )

    yjs_checksum: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        comment='SHA256 checksum of Yjs state'
    )

    # Performance metrics
    generation_time_ms: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment='Time taken to generate snapshot in milliseconds'
    )

    snapshot_size_bytes: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment='Size of generated snapshot in bytes'
    )

    # Relationships
    scene: Mapped['Scene'] = relationship(
        'Scene',
        back_populates='snapshot_metadata',
        lazy='selectin'
    )

    creator: Mapped[Optional['User']] = relationship(
        'User',
        lazy='selectin'
    )

    latest_yjs_version: Mapped[Optional['SceneVersion']] = relationship(
        'SceneVersion',
        foreign_keys=[yjs_latest_version_id],
        lazy='selectin'
    )

    def __repr__(self) -> str:
        return (
            f"<SceneSnapshotMetadata {self.snapshot_id} "
            f"for scene {self.scene_id} at {self.created_at}>"
        )

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        return {
            'snapshot_id': str(self.snapshot_id),
            'scene_id': str(self.scene_id),
            'snapshot_source': self.snapshot_source,
            'created_at': self.created_at.isoformat(),
            'created_by': str(self.created_by) if self.created_by else None,
            'yjs_version_count': self.yjs_version_count,
            'yjs_latest_version_id': str(self.yjs_latest_version_id) if self.yjs_latest_version_id else None,
            'yjs_checksum': self.yjs_checksum,
            'generation_time_ms': self.generation_time_ms,
            'snapshot_size_bytes': self.snapshot_size_bytes
        }
