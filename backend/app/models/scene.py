from datetime import datetime
from typing import Dict, List, Any, Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, String, Text, DateTime, ARRAY
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.script import Script  # noqa: F401
    from app.models.scene_version import SceneVersion  # noqa: F401

class Scene(Base):
    """Scene model representing a scene within a script."""
    __tablename__ = 'scenes'

    # Columns
    scene_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        index=True,
        unique=True,
        nullable=False
    )
    
    script_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scripts.script_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )
    
    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        index=True
    )
    
    scene_heading: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        default=""
    )
    
    content_blocks: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict
    )
    
    summary: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True
    )
    
    # FDX-specific fields for scene memory functionality
    characters: Mapped[Optional[List[str]]] = mapped_column(
        ARRAY(String),
        nullable=True,
        default=list
    )
    
    themes: Mapped[Optional[List[str]]] = mapped_column(
        ARRAY(String),
        nullable=True,
        default=list
    )
    
    tokens: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        default=0
    )
    
    word_count: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        default=0
    )
    
    # Store the full content as text for search and analysis
    full_content: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True
    )
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )
    
    # Relationships
    script: Mapped['Script'] = relationship(
        'Script',
        back_populates='scenes',
        lazy='selectin'
    )
    
    # Version history
    versions: Mapped[List['SceneVersion']] = relationship(
        'SceneVersion',
        back_populates='scene',
        cascade='all, delete-orphan',
        lazy='selectin',
        order_by='desc(SceneVersion.created_at)'
    )
    
    # Embedding relationship
    embedding = relationship(
        'SceneEmbedding',
        back_populates='scene',
        uselist=False,  # one-to-one relationship
        cascade='all, delete-orphan',
        lazy='selectin'
    )
    
    def __repr__(self) -> str:
        return f"<Scene {self.scene_heading[:30]}...>"
    
    def to_dict(self) -> dict:
        """Convert Scene instance to dictionary."""
        return {
            'scene_id': str(self.scene_id),
            'script_id': str(self.script_id),
            'position': self.position,
            'scene_heading': self.scene_heading,
            'content_blocks': self.content_blocks,
            'summary': self.summary,
            'characters': self.characters or [],
            'themes': self.themes or [],
            'tokens': self.tokens or 0,
            'word_count': self.word_count or 0,
            'full_content': self.full_content,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
