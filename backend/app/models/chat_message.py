from datetime import datetime
from enum import Enum
from typing import Optional, Dict, Any, List, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Text, JSON, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.chat_conversation import ChatConversation  # noqa: F401

class MessageRole(str, Enum):
    """Role of the message sender in the conversation."""
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class MessageSender(str, Enum):
    """Type of message sender."""
    USER = "user"
    ASSISTANT = "assistant"

class ChatMessage(Base):
    """
    ChatMessage model representing individual messages within a conversation.
    """
    __tablename__ = 'chat_messages'

    # Columns
    message_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        index=True,
        unique=True,
        nullable=False
    )
    
    conversation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('chat_conversations.conversation_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )
    
    sender: Mapped[MessageSender] = mapped_column(
        nullable=False,
        index=True
    )
    
    # For backward compatibility
    role: Mapped[Optional[MessageRole]] = mapped_column(
        nullable=True,
        index=True
    )
    
    content: Mapped[str] = mapped_column(
        Text,
        nullable=False
    )
    
    # Vector embedding of the message content (1536 dimensions for OpenAI's text-embedding-ada-002)
    embedding_vector: Mapped[Optional[List[float]]] = mapped_column(
        Vector(1536),
        nullable=True
    )
    
    # Flag indicating if this message has been included in a summary
    summarized: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        index=True
    )
    
    # Message metadata (avoid shadowing built-in 'metadata')
    message_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        default=dict,
        name='metadata'  # Keep the column name as 'metadata' in the database
    )
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True
    )
    
    # Relationships
    conversation: Mapped['ChatConversation'] = relationship(
        'ChatConversation',
        back_populates='messages',
        lazy='selectin'
    )
    
    def __repr__(self) -> str:
        role = self.role.value if self.role else 'unknown'
        content_preview = (self.content[:50] + '...') if len(self.content) > 50 else self.content
        return f"<ChatMessage {role}: {content_preview}>"
    
    def to_dict(self) -> dict:
        """Convert ChatMessage instance to dictionary."""
        return {
            'message_id': str(self.message_id),
            'conversation_id': str(self.conversation_id),
            'sender': self.sender.value,
            'role': self.role.value if self.role else None,  # For backward compatibility
            'content': self.content,
            'embedding_vector': self.embedding_vector.tolist() if self.embedding_vector else None,
            'summarized': self.summarized,
            'metadata': self.metadata or {},
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
        
    @classmethod
    def find_similar_messages(cls, session, query_embedding: List[float], conversation_id: UUID = None, 
                             limit: int = 5, min_similarity: float = 0.7):
        """
        Find messages with similar embeddings to the query.
        
        Args:
            session: SQLAlchemy session
            query_embedding: The embedding vector to compare against
            conversation_id: Optional filter by conversation_id
            limit: Maximum number of results to return
            min_similarity: Minimum cosine similarity score (0-1)
            
        Returns:
            List of (ChatMessage, similarity_score) tuples
        """
        from sqlalchemy import text
        
        query = """
        SELECT m.*, 1 - (embedding_vector <=> :embedding) as similarity
        FROM chat_messages m
        WHERE embedding_vector IS NOT NULL
          AND (1 - (embedding_vector <=> :embedding)) >= :min_similarity
          {conversation_filter}
        ORDER BY embedding_vector <=> :embedding
        LIMIT :limit
        """.format(
            conversation_filter="AND conversation_id = :conversation_id" if conversation_id else ""
        )
        
        params = {
            'embedding': query_embedding,
            'min_similarity': min_similarity,
            'limit': limit
        }
        if conversation_id:
            params['conversation_id'] = conversation_id
            
        result = session.execute(text(query), params)
        
        # Map results to model instances
        return [
            (cls(**dict(row._mapping)), float(row._mapping['similarity']))
            for row in result
        ]
