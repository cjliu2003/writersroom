from datetime import datetime
from uuid import UUID, uuid4
from typing import Optional
from sqlalchemy import ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

# Import vector type after setting up the extension
from sqlalchemy_utils.types.vector import VectorType

from app.db.base import Base

class SceneEmbedding(Base):
    """
    SceneEmbedding model for storing vector embeddings of scenes.
    Uses pgvector for efficient similarity search.
    """
    __tablename__ = 'scene_embeddings'

    # Columns
    id: Mapped[UUID] = mapped_column(
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
    
    scene_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scenes.scene_id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        unique=True  # One embedding per scene
    )
    
    # Vector embedding (1536 dimensions for OpenAI's text-embedding-ada-002)
    embedding: Mapped[VectorType] = mapped_column(
        VectorType(1536),
        nullable=False
    )
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    
    # Relationships
    script: Mapped['Script'] = relationship(
        'Script',
        back_populates='scene_embeddings',
        lazy='selectin'
    )
    
    scene: Mapped['Scene'] = relationship(
        'Scene',
        back_populates='embedding',
        lazy='selectin'
    )
    
    def __repr__(self) -> str:
        return f"<SceneEmbedding scene_id={self.scene_id} dims={len(self.embedding) if self.embedding else 0}>"
    
    def to_dict(self) -> dict:
        """Convert SceneEmbedding instance to dictionary."""
        return {
            'id': str(self.id),
            'script_id': str(self.script_id),
            'scene_id': str(self.scene_id),
            'embedding': self.embedding.tolist() if self.embedding else None,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
    
    @classmethod
    def get_nearest_neighbors(cls, session, query_embedding, script_id=None, limit=5):
        """
        Find the most similar scene embeddings to the query embedding.
        
        Args:
            session: SQLAlchemy session
            query_embedding: The embedding vector to compare against
            script_id: Optional filter by script_id
            limit: Maximum number of results to return
            
        Returns:
            List of (SceneEmbedding, similarity_score) tuples
        """
        from sqlalchemy import text
        
        query = """
        SELECT se.*, 1 - (embedding <=> :embedding) as similarity
        FROM scene_embeddings se
        {script_filter}
        ORDER BY embedding <=> :embedding
        LIMIT :limit
        """.format(
            script_filter="WHERE script_id = :script_id" if script_id else ""
        )
        
        params = {'embedding': query_embedding, 'limit': limit}
        if script_id:
            params['script_id'] = script_id
            
        result = session.execute(text(query), params)
        
        # Map results to model instances
        return [
            (cls(**dict(row._mapping)), row._mapping['similarity'])
            for row in result
        ]
