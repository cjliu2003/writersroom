from datetime import datetime
from typing import Dict, Any, Optional, TYPE_CHECKING, List, cast
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, DateTime, Index, select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.sql import func

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.scene import Scene  # noqa: F401
    from app.models.user import User  # noqa: F401

class SceneSnapshot(Base):
    """
    SceneSnapshot model for storing scene content snapshots during autosave.
    Each snapshot represents a full copy of scene content at a specific version.
    This differs from SceneVersion which stores Yjs binary updates for realtime collab.
    """
    __tablename__ = 'scene_snapshots'
    __table_args__ = (
        # Indexes for faster lookups
        Index('idx_scene_snapshots_scene_id_saved_at', 'scene_id', 'saved_at'),
        Index('idx_scene_snapshots_scene_id_version', 'scene_id', 'version')
    )

    # Columns
    id: Mapped[UUID] = mapped_column(
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
    
    # Version number to match the scene version at save time
    version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        index=True
    )
    
    # Full scene content as JSON
    payload: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False
    )
    
    # When this snapshot was saved
    saved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True
    )
    
    # Who saved this snapshot
    saved_by: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('users.user_id'),
        nullable=True
    )
    
    # Relationships
    scene: Mapped['Scene'] = relationship(
        'Scene',
        back_populates='snapshots',
        lazy='selectin'
    )
    
    author: Mapped[Optional['User']] = relationship(
        'User',
        lazy='selectin'
    )
    
    def __repr__(self) -> str:
        return f"<SceneSnapshot {self.id} for scene {self.scene_id} version {self.version}>"
    
    def to_dict(self) -> dict:
        """Convert SceneSnapshot instance to dictionary."""
        return {
            'id': str(self.id),
            'scene_id': str(self.scene_id),
            'version': self.version,
            'saved_at': self.saved_at.isoformat() if self.saved_at else None,
            'saved_by': str(self.saved_by) if self.saved_by else None,
            'payload_size': len(str(self.payload)) if self.payload else 0
        }
    
    @classmethod
    async def create_snapshot(
        cls, 
        scene_id: UUID,
        version: int, 
        payload: Dict[str, Any],
        saved_by: Optional[UUID] = None
    ) -> 'SceneSnapshot':
        """Helper to create a new snapshot."""
        return cls(
            scene_id=scene_id,
            version=version,
            payload=payload,
            saved_by=saved_by
        )
    
    @classmethod
    async def get_latest_snapshot(
        cls, 
        session: AsyncSession, 
        scene_id: UUID
    ) -> Optional['SceneSnapshot']:
        """Get the most recent snapshot for a scene."""
        stmt = (
            select(cls)
            .where(cls.scene_id == scene_id)
            .order_by(desc(cls.version))
            .limit(1)
        )
        result = await session.execute(stmt)
        return result.scalars().first()
    
    @classmethod
    async def get_snapshot_history(
        cls, 
        session: AsyncSession, 
        scene_id: UUID, 
        limit: int = 10
    ) -> List['SceneSnapshot']:
        """Get snapshot history for a scene, most recent first."""
        stmt = (
            select(cls)
            .where(cls.scene_id == scene_id)
            .order_by(desc(cls.version))
            .limit(limit)
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())
    
    @classmethod
    async def get_snapshot_by_version(
        cls, 
        session: AsyncSession, 
        scene_id: UUID,
        version: int
    ) -> Optional['SceneSnapshot']:
        """Get a specific snapshot by version number."""
        stmt = (
            select(cls)
            .where(cls.scene_id == scene_id, cls.version == version)
        )
        result = await session.execute(stmt)
        return result.scalars().first()
