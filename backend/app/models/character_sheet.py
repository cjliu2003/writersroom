from datetime import datetime
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, String, Text, DateTime, Boolean, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.script import Script  # noqa: F401


class CharacterSheet(Base):
    """
    Character sheet with arc tracking and key scenes.

    Includes want/need, arc progression, relationships, and pivotal moments.
    Marked stale when scenes featuring this character change.
    """
    __tablename__ = 'character_sheets'

    # Columns
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        index=True
    )

    script_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scripts.script_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )

    character_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment='Character name (case-sensitive)'
    )

    summary_text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment='Want/Need, Arc, Key Relationships, Pivotal Moments'
    )

    tokens_estimate: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment='Estimated token count for budget planning'
    )

    is_stale: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment='True if scenes with this character have changed significantly'
    )

    dirty_scene_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment='Number of scenes with this character that changed since last generation'
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

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )

    # Relationships
    script: Mapped['Script'] = relationship(
        'Script',
        back_populates='character_sheets',
        lazy='selectin'
    )

    # Constraints
    __table_args__ = (
        UniqueConstraint('script_id', 'character_name', name='uq_script_character'),
    )

    def __repr__(self) -> str:
        return f"<CharacterSheet {self.character_name} script_id={self.script_id} stale={self.is_stale}>"

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            'id': str(self.id),
            'script_id': str(self.script_id),
            'character_name': self.character_name,
            'summary_text': self.summary_text,
            'tokens_estimate': self.tokens_estimate,
            'is_stale': self.is_stale,
            'dirty_scene_count': self.dirty_scene_count,
            'last_generated_at': self.last_generated_at.isoformat() if self.last_generated_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
