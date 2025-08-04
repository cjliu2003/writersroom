from datetime import datetime
from uuid import UUID, uuid4
from typing import Optional, List
from sqlalchemy import ForeignKey, LargeBinary, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.sql import func

from app.db.base import Base

class SceneVersion(Base):
    """
    SceneVersion model for storing version history of scenes using Yjs updates.
    Each version represents a snapshot of the Yjs document state.
    """
    __tablename__ = 'scene_versions'
    __table_args__ = (
        # Index for faster lookup of versions by scene
        Index('idx_scene_versions_scene_id_created_at', 'scene_id', 'created_at'),
    )

    # Columns
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
    
    # Yjs update in binary format
    yjs_update: Mapped[bytes] = mapped_column(
        LargeBinary,
        nullable=False
    )
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True
    )
    
    # Relationship
    scene: Mapped['Scene'] = relationship(
        'Scene',
        back_populates='versions',
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
    def create_version(cls, scene_id: UUID, yjs_update: bytes):
        """Helper to create a new version."""
        return cls(
            scene_id=scene_id,
            yjs_update=yjs_update
        )
    
    @classmethod
    def get_latest_version(cls, session, scene_id: UUID):
        """Get the most recent version for a scene."""
        from sqlalchemy import desc
        
        return session.query(cls)\
            .filter_by(scene_id=scene_id)\
            .order_by(desc(cls.created_at))\
            .first()
    
    @classmethod
    def get_version_history(cls, session, scene_id: UUID, limit: int = 10):
        """Get version history for a scene, most recent first."""
        from sqlalchemy import desc
        
        return session.query(cls)\
            .filter_by(scene_id=scene_id)\
            .order_by(desc(cls.created_at))\
            .limit(limit)\
            .all()
