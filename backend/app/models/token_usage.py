"""
Token Usage Model

Tracks AI API token usage for analytics and billing.
"""

from datetime import datetime
from uuid import UUID, uuid4
from typing import Optional
from sqlalchemy import ForeignKey, Integer, Numeric, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.sql import func

from app.models.base import Base


class TokenUsage(Base):
    """
    Token usage tracking for AI API calls.

    Tracks Claude API token usage including:
    - Input tokens (normal price)
    - Cache creation tokens (write to cache, 25% premium)
    - Cache read tokens (read from cache, 90% discount)
    - Output tokens
    - Total cost calculation
    """
    __tablename__ = 'token_usage'

    # Columns
    usage_id: Mapped[UUID] = mapped_column(
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

    conversation_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('chat_conversations.conversation_id', ondelete='CASCADE'),
        nullable=True,
        index=True
    )

    # Token counts
    input_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )

    cache_creation_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )

    cache_read_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )

    output_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )

    # Cost tracking (in USD)
    total_cost: Mapped[float] = mapped_column(
        Numeric(10, 6),  # Up to $9999.999999
        nullable=False,
        default=0.0
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True
    )

    # Relationships
    user: Mapped['User'] = relationship(
        'User',
        lazy='selectin'
    )

    script: Mapped['Script'] = relationship(
        'Script',
        lazy='selectin'
    )

    conversation: Mapped[Optional['ChatConversation']] = relationship(
        'ChatConversation',
        lazy='selectin'
    )

    def __repr__(self) -> str:
        return f"<TokenUsage user={self.user_id} in={self.input_tokens} out={self.output_tokens} cost=${self.total_cost:.4f}>"

    def to_dict(self) -> dict:
        """Convert TokenUsage instance to dictionary."""
        return {
            'usage_id': str(self.usage_id),
            'user_id': str(self.user_id),
            'script_id': str(self.script_id),
            'conversation_id': str(self.conversation_id) if self.conversation_id else None,
            'input_tokens': self.input_tokens,
            'cache_creation_tokens': self.cache_creation_tokens,
            'cache_read_tokens': self.cache_read_tokens,
            'output_tokens': self.output_tokens,
            'total_cost': float(self.total_cost),
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
