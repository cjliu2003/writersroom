from datetime import datetime
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, String, Text, DateTime, Boolean
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.script import Script  # noqa: F401


class ScriptOutline(Base):
    """
    Global script outline with act structure and key turning points.

    Generated from all scene summaries. Marked stale when scenes change.
    Refreshed lazily when needed and threshold exceeded.
    """
    __tablename__ = 'script_outlines'

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

    version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        comment='Incremented on each regeneration'
    )

    summary_text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment='Global summary + act-by-act breakdown + key turning points'
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
        comment='True if scenes have changed significantly since last generation'
    )

    dirty_scene_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment='Number of scenes changed since last generation'
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
        back_populates='outline',
        lazy='selectin'
    )

    def __repr__(self) -> str:
        return f"<ScriptOutline script_id={self.script_id} v{self.version} stale={self.is_stale}>"

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            'id': str(self.id),
            'script_id': str(self.script_id),
            'version': self.version,
            'summary_text': self.summary_text,
            'tokens_estimate': self.tokens_estimate,
            'is_stale': self.is_stale,
            'dirty_scene_count': self.dirty_scene_count,
            'last_generated_at': self.last_generated_at.isoformat() if self.last_generated_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
