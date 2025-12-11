from datetime import datetime
from typing import Optional, List, TYPE_CHECKING
from uuid import UUID, uuid4
from enum import Enum

from sqlalchemy import ForeignKey, String, Text, DateTime, ARRAY, Integer
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.script import Script  # noqa: F401


class PlotThreadType(str, Enum):
    """Types of plot threads."""
    CHARACTER_ARC = "character_arc"
    PLOT = "plot"
    SUBPLOT = "subplot"
    THEME = "theme"


class PlotThread(Base):
    """
    Plot thread tracking for cross-scene relationships.

    Tracks storylines, character arcs, subplots, and thematic elements
    across multiple scenes.
    """
    __tablename__ = 'plot_threads'

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

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment='Thread name (e.g., "Protagonist\'s lie", "MacGuffin chase")'
    )

    scenes: Mapped[List[int]] = mapped_column(
        ARRAY(Integer),
        nullable=False,
        comment='Array of scene indices in this thread'
    )

    thread_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment='Type: character_arc, plot, subplot, theme'
    )

    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment='Optional description of this thread'
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
        back_populates='plot_threads',
        lazy='selectin'
    )

    def __repr__(self) -> str:
        return f"<PlotThread {self.name} ({self.thread_type}) scenes={len(self.scenes)}>"

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            'id': str(self.id),
            'script_id': str(self.script_id),
            'name': self.name,
            'scenes': self.scenes,
            'thread_type': self.thread_type,
            'description': self.description,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
