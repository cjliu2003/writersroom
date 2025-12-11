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
    from app.models.scene_snapshot import SceneSnapshot  # noqa: F401
    from app.models.scene_snapshot_metadata import SceneSnapshotMetadata  # noqa: F401
    from app.models.user import User  # noqa: F401
    from app.models.scene_summary import SceneSummary  # noqa: F401
    from app.models.scene_character import SceneCharacter  # noqa: F401

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
    
    content_blocks: Mapped[List[Dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=False,
        default=list
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
    
    # Version counter for compare-and-swap
    version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )

    # User who last updated this scene
    updated_by: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('users.user_id'),
        nullable=True
    )

    # Yjs-Primary Metadata (Phase 2.2 additions)
    snapshot_source: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default='rest',
        comment='Source of snapshot: yjs, manual, import, migrated, compacted'
    )

    snapshot_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment='When this snapshot was created'
    )

    yjs_derived: Mapped[bool] = mapped_column(
        Integer,  # SQLite doesn't have Boolean, use 0/1
        nullable=False,
        default=False,
        comment='True if content_blocks derived from Yjs state'
    )

    yjs_checksum: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        comment='SHA256 checksum of Yjs state for comparison'
    )

    # AI system fields (Phase 1 - Scene hashing for change detection)
    hash: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        index=True,
        comment='SHA-256 hash of normalized scene content for change detection'
    )

    is_key_scene: Mapped[bool] = mapped_column(
        Integer,  # SQLite doesn't have Boolean, use 0/1
        nullable=False,
        default=False,
        comment='Manually flagged as key scene (plot point, major character moment, etc.)'
    )

    # Relationships
    script: Mapped['Script'] = relationship(
        'Script',
        back_populates='scenes',
        lazy='selectin'
    )
    
    # User who last updated this scene
    last_editor: Mapped['User'] = relationship(
        'User',
        foreign_keys=[updated_by],
        lazy='selectin'
    )
    
    # Version history (Yjs updates)
    versions: Mapped[List['SceneVersion']] = relationship(
        'SceneVersion',
        back_populates='scene',
        cascade='all, delete-orphan',
        lazy='selectin',
        order_by='desc(SceneVersion.created_at)'
    )
    
    # Snapshots (for autosave and version history)
    snapshots: Mapped[List['SceneSnapshot']] = relationship(
        'SceneSnapshot',
        back_populates='scene',
        cascade='all, delete-orphan',
        lazy='selectin',
        order_by='desc(SceneSnapshot.saved_at)'
    )

    # Snapshot metadata (Yjs-primary architecture)
    snapshot_metadata: Mapped[List['SceneSnapshotMetadata']] = relationship(
        'SceneSnapshotMetadata',
        back_populates='scene',
        cascade='all, delete-orphan',
        lazy='selectin',
        order_by='desc(SceneSnapshotMetadata.created_at)'
    )

    # Embedding relationship
    embedding = relationship(
        'SceneEmbedding',
        back_populates='scene',
        uselist=False,  # one-to-one relationship
        cascade='all, delete-orphan',
        lazy='selectin'
    )

    # AI system relationships (Phase 0)
    scene_summary: Mapped['SceneSummary'] = relationship(
        'SceneSummary',
        back_populates='scene',
        uselist=False,  # one-to-one relationship
        cascade='all, delete-orphan',
        lazy='selectin'
    )

    scene_characters: Mapped[List['SceneCharacter']] = relationship(
        'SceneCharacter',
        back_populates='scene',
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
            'version': self.version,
            'updated_by': str(self.updated_by) if self.updated_by else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'hash': self.hash,
            'is_key_scene': bool(self.is_key_scene)
        }
