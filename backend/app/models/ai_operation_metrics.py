"""
AI Operation Metrics Model

Detailed tracking of AI API operations for analytics and cost optimization.
Tracks both chat operations (tool calls vs synthesis) and ingestion operations (per-scene).
"""

from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4
from typing import Optional
from sqlalchemy import ForeignKey, Integer, Numeric, DateTime, String, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.sql import func

from app.models.base import Base


class OperationType(str, Enum):
    """Type of AI operation being tracked."""
    # Chat operations
    CHAT_TOOL_CALL = "chat_tool_call"      # Intermediate tool call iteration
    CHAT_SYNTHESIS = "chat_synthesis"       # Final synthesis after tool calls
    CHAT_RAG_ONLY = "chat_rag_only"        # RAG-only response (no tools)

    # Ingestion operations
    INGESTION_SCENE_SUMMARY = "ingestion_scene_summary"
    INGESTION_SCRIPT_OUTLINE = "ingestion_script_outline"
    INGESTION_CHARACTER_SHEET = "ingestion_character_sheet"
    INGESTION_EMBEDDING = "ingestion_embedding"


class AIOperationMetrics(Base):
    """
    Detailed AI operation tracking for analytics and cost optimization.

    Use cases:
    1. Chat cost breakdown: tool_call iterations vs final synthesis
       - Enables evaluation of multi-model strategies (cheap model for tools, expensive for synthesis)
    2. Script ingestion cost tracking: per-scene and aggregate costs
       - Enables understanding of ingestion cost scaling
    3. Model performance comparison: if/when switching models
    """
    __tablename__ = 'ai_operation_metrics'

    # Primary key
    metric_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        index=True,
        unique=True,
        nullable=False
    )

    # Operation classification
    operation_type: Mapped[OperationType] = mapped_column(
        SQLEnum(OperationType, name='operation_type_enum', create_type=True),
        nullable=False,
        index=True
    )

    model_used: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="claude-haiku-4-5",
        comment="Model used for this operation (for multi-model analytics)"
    )

    # Ownership and context
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

    # Optional context links
    conversation_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('chat_conversations.conversation_id', ondelete='CASCADE'),
        nullable=True,
        index=True,
        comment="For chat operations"
    )

    message_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('chat_messages.message_id', ondelete='CASCADE'),
        nullable=True,
        index=True,
        comment="For chat operations - links to specific message"
    )

    scene_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scenes.scene_id', ondelete='SET NULL'),
        nullable=True,
        index=True,
        comment="For per-scene ingestion tracking"
    )

    # For tool call iterations
    iteration_number: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="Tool call iteration (1, 2, 3...) for CHAT_TOOL_CALL operations"
    )

    tool_name: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="Tool used in this iteration (get_scene, search_scenes, etc.)"
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

    # Cost tracking (in USD) - calculated based on model pricing
    total_cost: Mapped[float] = mapped_column(
        Numeric(10, 6),
        nullable=False,
        default=0.0
    )

    # Timing
    latency_ms: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="Operation latency in milliseconds"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True
    )

    # Relationships (lazy to avoid cascade loading issues)
    user: Mapped['User'] = relationship('User', lazy='noload')
    script: Mapped['Script'] = relationship('Script', lazy='noload')
    conversation: Mapped[Optional['ChatConversation']] = relationship('ChatConversation', lazy='noload')
    message: Mapped[Optional['ChatMessage']] = relationship('ChatMessage', lazy='noload')
    scene: Mapped[Optional['Scene']] = relationship('Scene', lazy='noload')

    def __repr__(self) -> str:
        return (
            f"<AIOperationMetrics {self.operation_type.value} "
            f"in={self.input_tokens} out={self.output_tokens} cost=${float(self.total_cost):.6f}>"
        )

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        return {
            'metric_id': str(self.metric_id),
            'operation_type': self.operation_type.value,
            'model_used': self.model_used,
            'user_id': str(self.user_id),
            'script_id': str(self.script_id),
            'conversation_id': str(self.conversation_id) if self.conversation_id else None,
            'message_id': str(self.message_id) if self.message_id else None,
            'scene_id': str(self.scene_id) if self.scene_id else None,
            'iteration_number': self.iteration_number,
            'tool_name': self.tool_name,
            'input_tokens': self.input_tokens,
            'cache_creation_tokens': self.cache_creation_tokens,
            'cache_read_tokens': self.cache_read_tokens,
            'output_tokens': self.output_tokens,
            'total_cost': float(self.total_cost),
            'latency_ms': self.latency_ms,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


# Pricing constants for cost calculation
# Haiku 4.5 pricing (current default model)
HAIKU_PRICING = {
    'input_per_mtok': 1.0,           # $1/MTok
    'cache_write_per_mtok': 1.25,    # $1.25/MTok
    'cache_read_per_mtok': 0.10,     # $0.10/MTok
    'output_per_mtok': 5.0,          # $5/MTok
}

# Sonnet 4 pricing (for future multi-model)
SONNET_PRICING = {
    'input_per_mtok': 3.0,           # $3/MTok
    'cache_write_per_mtok': 3.75,    # $3.75/MTok
    'cache_read_per_mtok': 0.30,     # $0.30/MTok
    'output_per_mtok': 15.0,         # $15/MTok
}

MODEL_PRICING = {
    'claude-haiku-4-5': HAIKU_PRICING,
    'claude-sonnet-4-5': SONNET_PRICING,
    'claude-3-5-sonnet-20241022': SONNET_PRICING,  # Legacy name
}


def calculate_cost(
    input_tokens: int,
    output_tokens: int,
    cache_creation_tokens: int = 0,
    cache_read_tokens: int = 0,
    model: str = "claude-haiku-4-5"
) -> float:
    """
    Calculate cost for an AI operation.

    Args:
        input_tokens: Number of input tokens
        output_tokens: Number of output tokens
        cache_creation_tokens: Tokens written to cache
        cache_read_tokens: Tokens read from cache
        model: Model identifier

    Returns:
        Cost in USD
    """
    pricing = MODEL_PRICING.get(model, HAIKU_PRICING)

    input_cost = (
        input_tokens * pricing['input_per_mtok'] / 1_000_000 +
        cache_creation_tokens * pricing['cache_write_per_mtok'] / 1_000_000 +
        cache_read_tokens * pricing['cache_read_per_mtok'] / 1_000_000
    )
    output_cost = output_tokens * pricing['output_per_mtok'] / 1_000_000

    return input_cost + output_cost
