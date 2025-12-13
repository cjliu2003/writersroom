from datetime import datetime
from uuid import UUID, uuid4
from typing import Optional, List, TYPE_CHECKING
from sqlalchemy import String, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.sql import func

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.conversation_summary import ConversationSummary  # noqa: F401

class ChatConversation(Base):
    """
    ChatConversation model representing a conversation thread
    between a user and the AI about a specific script.
    """
    __tablename__ = 'chat_conversations'

    # Columns
    conversation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        index=True,
        unique=True,
        nullable=False
    )
    
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('users.user_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )
    
    script_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scripts.script_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )
    
    current_scene_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scenes.scene_id', ondelete='SET NULL'),
        nullable=True,
        index=True
    )
    
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        default="New Conversation"
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
    user: Mapped['User'] = relationship(
        'User',
        back_populates='chat_conversations',
        lazy='selectin'
    )
    
    script: Mapped['Script'] = relationship(
        'Script',
        back_populates='chat_conversations',
        lazy='selectin'
    )
    
    current_scene: Mapped[Optional['Scene']] = relationship(
        'Scene',
        lazy='selectin'
    )
    
    messages: Mapped[List['ChatMessage']] = relationship(
        'ChatMessage',
        back_populates='conversation',
        cascade='all, delete-orphan',
        lazy='selectin',
        order_by='ChatMessage.created_at'
    )

    # AI system relationships (Phase 0)
    summaries: Mapped[List['ConversationSummary']] = relationship(
        'ConversationSummary',
        back_populates='conversation',
        cascade='all, delete-orphan',
        lazy='selectin',
        order_by='ConversationSummary.created_at.desc()'
    )

    def __repr__(self) -> str:
        return f"<ChatConversation {self.title} (User: {self.user_id}, Script: {self.script_id})>"
    
    def to_dict(self) -> dict:
        """Convert ChatConversation instance to dictionary."""
        return {
            'conversation_id': str(self.conversation_id),
            'user_id': str(self.user_id),
            'script_id': str(self.script_id),
            'current_scene_id': str(self.current_scene_id) if self.current_scene_id else None,
            'title': self.title,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'message_count': len(self.messages) if hasattr(self, 'messages') else 0
        }
