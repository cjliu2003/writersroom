from datetime import datetime
from typing import Optional, List, TYPE_CHECKING, cast
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, LargeBinary, DateTime, Index, select, desc, Integer, CheckConstraint
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.sql import func

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.scene import Scene  # noqa: F401
    from app.models.user import User  # noqa: F401

class SceneVersion(Base):
    """
    SceneVersion model for storing version history of scenes using Yjs updates.
    Each version represents a Yjs document update in the append-only event log.

    In Yjs-primary architecture, this is the PRIMARY SOURCE OF TRUTH.
    """
    __tablename__ = 'scene_versions'
    __table_args__ = (
        # Index for faster lookup of versions by scene
        Index('idx_scene_versions_scene_id_created_at', 'scene_id', 'created_at'),
        # Index for finding non-compacted updates efficiently
        Index('idx_scene_versions_compacted', 'scene_id', 'is_compacted', 'created_at',
              postgresql_where='is_compacted = FALSE'),
        # Constraints
        CheckConstraint('length(yjs_update) > 0', name='yjs_update_not_empty'),
        CheckConstraint('compacted_count > 0', name='compacted_count_positive'),
    )

    # Identity
    version_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        index=True,
        unique=True,
        nullable=False
    )

    scene_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scenes.scene_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )

    # Yjs Data (PRIMARY SOURCE OF TRUTH)
    yjs_update: Mapped[bytes] = mapped_column(
        LargeBinary,
        nullable=False,
        comment='Binary-encoded Yjs update'
    )

    # Compaction Metadata
    is_compacted: Mapped[bool] = mapped_column(
        Integer,  # Boolean stored as 0/1 for SQLite compatibility
        nullable=False,
        default=False,
        comment='True if this is a compacted update merging multiple originals'
    )

    compacted_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        comment='Number of updates merged into this compacted version'
    )

    compacted_by: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scene_versions.version_id'),
        nullable=True,
        comment='If this update was compacted, references the compacted version'
    )

    # Audit Trail
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
        comment='User who created this update (null for system/migration)'
    )
    
    # Relationships
    scene: Mapped['Scene'] = relationship(
        'Scene',
        back_populates='versions',
        lazy='selectin'
    )

    creator: Mapped[Optional['User']] = relationship(
        'User',
        foreign_keys=[created_by],
        lazy='selectin'
    )

    # Self-referential relationship for compaction tracking
    compacted_version: Mapped[Optional['SceneVersion']] = relationship(
        'SceneVersion',
        remote_side=[version_id],
        foreign_keys=[compacted_by],
        lazy='selectin'
    )
    
    def __repr__(self) -> str:
        return f"<SceneVersion {self.version_id} for scene {self.scene_id} at {self.created_at}>"
    
    def to_dict(self) -> dict:
        """Convert SceneVersion instance to dictionary."""
        return {
            'version_id': str(self.version_id),
            'scene_id': str(self.scene_id),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'update_size': len(self.yjs_update) if self.yjs_update else 0
        }
    
    @classmethod
    def create_version(cls, scene_id: UUID, yjs_update: bytes) -> 'SceneVersion':
        """Helper to create a new version."""
        return cls(
            scene_id=scene_id,
            yjs_update=yjs_update
        )
    
    @classmethod
    async def get_latest_version(
        cls, 
        session: AsyncSession, 
        scene_id: UUID
    ) -> Optional['SceneVersion']:
        """Get the most recent version for a scene asynchronously."""
        stmt = (
            select(cls)
            .where(cls.scene_id == scene_id)
            .order_by(desc(cls.created_at))
            .limit(1)
        )
        result = await session.execute(stmt)
        return result.scalars().first()
    
    @classmethod
    async def get_version_history(
        cls, 
        session: AsyncSession, 
        scene_id: UUID, 
        limit: int = 10
    ) -> List['SceneVersion']:
        """Get version history for a scene, most recent first, asynchronously."""
        stmt = (
            select(cls)
            .where(cls.scene_id == scene_id)
            .order_by(desc(cls.created_at))
            .limit(limit)
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())
