from datetime import datetime
from typing import List, Optional, Dict, Any
from uuid import UUID, uuid4
from sqlalchemy import String, Text, Integer, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.sql import func

from app.models.base import Base

class Script(Base):
    """
    Script model representing a screenplay or script in the system.
    """
    __tablename__ = 'scripts'

    # Columns
    script_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        index=True,
        unique=True,
        nullable=False
    )
    
    owner_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('users.user_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )
    
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )
    
    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True
    )
    
    current_version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False
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
    
    # File paths for FDX import/export and PDF export
    imported_fdx_path: Mapped[Optional[str]] = mapped_column(
        String,
        nullable=True
    )
    
    exported_fdx_path: Mapped[Optional[str]] = mapped_column(
        String,
        nullable=True
    )
    
    exported_pdf_path: Mapped[Optional[str]] = mapped_column(
        String,
        nullable=True
    )

    # Script-level content and versioning (for script-level editing)
    content_blocks: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(
        JSONB,
        nullable=True,
        comment='Full script content blocks for script-level editing'
    )

    scene_summaries: Mapped[Optional[Dict[str, str]]] = mapped_column(
        JSONB,
        nullable=True,
        comment='AI-generated summaries for scenes in script-level editor. Format: {scene_heading: summary_text}'
    )

    version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default='0',
        comment='Optimistic locking version for compare-and-swap'
    )

    yjs_state: Mapped[Optional[bytes]] = mapped_column(
        nullable=True,
        comment='Yjs state snapshot for quick loading'
    )

    updated_by: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('users.user_id'),
        nullable=True,
        comment='User who last updated the script'
    )

    # Relationships
    owner: Mapped['User'] = relationship(
        'User',
        foreign_keys=[owner_id],
        back_populates='scripts',
        lazy='joined'
    )

    last_editor: Mapped[Optional['User']] = relationship(
        'User',
        foreign_keys=[updated_by],
        lazy='selectin'
    )
    
    collaborators: Mapped[List['ScriptCollaborator']] = relationship(
        'ScriptCollaborator',
        back_populates='script',
        cascade='all, delete-orphan',
        lazy='selectin'
    )
    
    scenes: Mapped[List['Scene']] = relationship(
        'Scene',
        back_populates='script',
        cascade='all, delete-orphan',
        lazy='selectin',
        order_by='Scene.position'
    )
    
    # Chat conversations related to this script
    chat_conversations: Mapped[List['ChatConversation']] = relationship(
        'ChatConversation',
        back_populates='script',
        cascade='all, delete-orphan',
        lazy='dynamic'
    )
    
    scene_embeddings: Mapped[List['SceneEmbedding']] = relationship(
        'SceneEmbedding',
        back_populates='script',
        cascade='all, delete-orphan',
        lazy='selectin'
    )

    # Script-level Yjs version history
    versions: Mapped[List['ScriptVersion']] = relationship(
        'ScriptVersion',
        back_populates='script',
        cascade='all, delete-orphan',
        lazy='dynamic',
        order_by='ScriptVersion.created_at'
    )

    def __repr__(self) -> str:
        return f"<Script {self.title} (v{self.current_version})>"
    
    def to_dict(self) -> dict:
        """Convert Script instance to dictionary."""
        return {
            'script_id': str(self.script_id),
            'owner_id': str(self.owner_id),
            'title': self.title,
            'description': self.description,
            'current_version': self.current_version,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'imported_fdx_path': self.imported_fdx_path,
            'exported_fdx_path': self.exported_fdx_path,
            'exported_pdf_path': self.exported_pdf_path,
            'owner': self.owner.to_dict() if self.owner else None
        }
