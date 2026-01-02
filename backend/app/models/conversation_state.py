"""
Conversation State Model

Stores working set state for conversation continuity.
"""

from datetime import datetime
from uuid import UUID, uuid4
from typing import List, Optional, TYPE_CHECKING
from sqlalchemy import String, ForeignKey, DateTime, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, ARRAY
from sqlalchemy.sql import func

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.chat_conversation import ChatConversation


class ConversationState(Base):
    """
    Working set state for conversation continuity.

    Tracks active entities and last assistant commitment
    to enable pronoun resolution and callback handling.
    """
    __tablename__ = 'conversation_states'

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4
    )

    conversation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('chat_conversations.conversation_id', ondelete='CASCADE'),
        nullable=False,
        unique=True,
        index=True
    )

    # Active entities (last 1-3 of each)
    active_scene_ids: Mapped[List[int]] = mapped_column(
        ARRAY(Integer),
        nullable=False,
        default=list
    )

    active_characters: Mapped[List[str]] = mapped_column(
        ARRAY(String(100)),
        nullable=False,
        default=list
    )

    active_threads: Mapped[List[str]] = mapped_column(
        ARRAY(String(200)),
        nullable=False,
        default=list
    )

    # Last intent and commitment
    last_user_intent: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True
    )

    last_assistant_commitment: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True
    )

    # Timestamps
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

    # Relationship
    conversation: Mapped['ChatConversation'] = relationship(
        'ChatConversation',
        back_populates='state',
        lazy='selectin'
    )

    def __repr__(self) -> str:
        return f"<ConversationState {self.conversation_id}>"

    def to_dict(self) -> dict:
        """Convert ConversationState instance to dictionary."""
        return {
            'id': str(self.id),
            'conversation_id': str(self.conversation_id),
            'active_scene_ids': self.active_scene_ids or [],
            'active_characters': self.active_characters or [],
            'active_threads': self.active_threads or [],
            'last_user_intent': self.last_user_intent,
            'last_assistant_commitment': self.last_assistant_commitment,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
