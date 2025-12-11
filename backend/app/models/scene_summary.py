from datetime import datetime
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, String, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.scene import Scene  # noqa: F401


class SceneSummary(Base):
    """
    Scene summary (scene card) for AI retrieval.

    Stores concise 5-7 line summaries of scenes for token-efficient RAG.
    Updated incrementally when scenes change significantly.
    """
    __tablename__ = 'scene_summaries'

    # Columns
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        index=True
    )

    scene_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scenes.scene_id', ondelete='CASCADE'),
        nullable=False,
        unique=True,  # One summary per scene
        index=True
    )

    summary_text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment='Structured scene summary (5-7 lines): Action, Conflict, Character Changes, Plot Progression, Tone'
    )

    tokens_estimate: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment='Estimated token count for budget planning'
    )

    version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        comment='Incremented on each regeneration'
    )

    last_generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    # Relationships
    scene: Mapped['Scene'] = relationship(
        'Scene',
        back_populates='scene_summary',
        lazy='selectin'
    )

    def __repr__(self) -> str:
        return f"<SceneSummary scene_id={self.scene_id} v{self.version}>"

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            'id': str(self.id),
            'scene_id': str(self.scene_id),
            'summary_text': self.summary_text,
            'tokens_estimate': self.tokens_estimate,
            'version': self.version,
            'last_generated_at': self.last_generated_at.isoformat() if self.last_generated_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
