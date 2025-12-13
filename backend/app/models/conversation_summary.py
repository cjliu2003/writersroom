from datetime import datetime
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.chat_conversation import ChatConversation  # noqa: F401
    from app.models.chat_message import ChatMessage  # noqa: F401


class ConversationSummary(Base):
    """
    Summary of conversation history for long conversations.

    Generated after 15+ messages to keep context window manageable.
    Includes topics discussed, changes made, and user preferences.
    """
    __tablename__ = 'conversation_summaries'

    # Columns
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        index=True
    )

    conversation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('chat_conversations.conversation_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )

    summary_text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment='Summary of topics discussed, edits made, user preferences'
    )

    tokens_estimate: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment='Estimated token count for budget planning'
    )

    messages_covered: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment='Number of messages this summary covers'
    )

    last_message_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('chat_messages.message_id'),
        nullable=True,
        comment='Last message included in this summary'
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    # Relationships
    conversation: Mapped['ChatConversation'] = relationship(
        'ChatConversation',
        back_populates='summaries',
        lazy='selectin'
    )

    last_message: Mapped[Optional['ChatMessage']] = relationship(
        'ChatMessage',
        foreign_keys=[last_message_id],
        lazy='selectin'
    )

    def __repr__(self) -> str:
        return f"<ConversationSummary conversation_id={self.conversation_id} messages={self.messages_covered}>"

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            'id': str(self.id),
            'conversation_id': str(self.conversation_id),
            'summary_text': self.summary_text,
            'tokens_estimate': self.tokens_estimate,
            'messages_covered': self.messages_covered,
            'last_message_id': str(self.last_message_id) if self.last_message_id else None,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
