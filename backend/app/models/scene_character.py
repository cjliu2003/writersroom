from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import ForeignKey, String, PrimaryKeyConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.scene import Scene  # noqa: F401


class SceneCharacter(Base):
    """
    Many-to-many relationship between scenes and characters.

    Enables queries like "get all scenes where CHARACTER X appears".
    """
    __tablename__ = 'scene_characters'

    # Columns
    scene_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scenes.scene_id', ondelete='CASCADE'),
        nullable=False
    )

    character_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment='Character name (should match character_sheets.character_name)'
    )

    # Relationships
    scene: Mapped['Scene'] = relationship(
        'Scene',
        back_populates='scene_characters',
        lazy='selectin'
    )

    # Constraints
    __table_args__ = (
        PrimaryKeyConstraint('scene_id', 'character_name'),
    )

    def __repr__(self) -> str:
        return f"<SceneCharacter scene_id={self.scene_id} character={self.character_name}>"

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            'scene_id': str(self.scene_id),
            'character_name': self.character_name
        }
