from datetime import datetime
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4
from enum import Enum

from sqlalchemy import ForeignKey, String, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.script import Script  # noqa: F401
    from app.models.scene import Scene  # noqa: F401


class SceneRelationshipType(str, Enum):
    """Types of scene relationships."""
    SETUP_PAYOFF = "setup_payoff"
    CALLBACK = "callback"
    PARALLEL = "parallel"
    ECHO = "echo"


class SceneRelationship(Base):
    """
    Explicit relationships between scenes (setup/payoff, callbacks, etc.).

    Tracks narrative connections like setups that pay off later,
    callbacks to earlier scenes, parallel scenes, and thematic echoes.
    """
    __tablename__ = 'scene_relationships'

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

    setup_scene_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scenes.scene_id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        comment='Source scene (setup, original, etc.)'
    )

    payoff_scene_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scenes.scene_id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        comment='Target scene (payoff, callback, parallel, echo)'
    )

    relationship_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment='Type: setup_payoff, callback, parallel, echo'
    )

    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment='Optional description of the relationship'
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    # Relationships
    script: Mapped['Script'] = relationship(
        'Script',
        back_populates='scene_relationships',
        lazy='selectin'
    )

    setup_scene: Mapped['Scene'] = relationship(
        'Scene',
        foreign_keys=[setup_scene_id],
        lazy='selectin'
    )

    payoff_scene: Mapped['Scene'] = relationship(
        'Scene',
        foreign_keys=[payoff_scene_id],
        lazy='selectin'
    )

    def __repr__(self) -> str:
        return f"<SceneRelationship {self.relationship_type} {self.setup_scene_id}->{self.payoff_scene_id}>"

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            'id': str(self.id),
            'script_id': str(self.script_id),
            'setup_scene_id': str(self.setup_scene_id),
            'payoff_scene_id': str(self.payoff_scene_id),
            'relationship_type': self.relationship_type,
            'description': self.description,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
