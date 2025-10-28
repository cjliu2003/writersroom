"""
ScriptVersion model for storing Yjs updates for full scripts.

This is the script-level equivalent of SceneVersion, designed for
the script-level editing architecture where one Y.Doc represents
an entire screenplay.
"""

from datetime import datetime
from typing import Optional, List, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, LargeBinary, DateTime, Index, select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.sql import func

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.script import Script  # noqa: F401
    from app.models.user import User  # noqa: F401


class ScriptVersion(Base):
    """
    ScriptVersion model for storing version history of scripts using Yjs updates.
    Each version represents a Yjs document update in the append-only event log.

    In script-level architecture, this table stores Yjs updates for entire
    screenplays (not individual scenes).
    """
    __tablename__ = 'script_versions'
    __table_args__ = (
        # Index for faster lookup of versions by script and chronological order
        Index('idx_script_versions_script_created', 'script_id', 'created_at'),
    )

    # Identity
    version_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        nullable=False
    )

    script_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scripts.script_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )

    # Yjs Data
    update: Mapped[bytes] = mapped_column(
        LargeBinary,
        nullable=False,
        comment='Yjs binary update'
    )

    # Audit Trail
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    created_by: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('users.user_id'),
        nullable=True,
        comment='User who created this update (null for system/migration)'
    )

    # Relationships
    script: Mapped['Script'] = relationship(
        'Script',
        back_populates='versions',
        lazy='selectin'
    )

    creator: Mapped[Optional['User']] = relationship(
        'User',
        foreign_keys=[created_by],
        lazy='selectin'
    )

    def __repr__(self) -> str:
        return f"<ScriptVersion {self.version_id} for script {self.script_id} at {self.created_at}>"

    def to_dict(self) -> dict:
        """Convert ScriptVersion instance to dictionary."""
        return {
            'version_id': str(self.version_id),
            'script_id': str(self.script_id),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'update_size': len(self.update) if self.update else 0,
            'created_by': str(self.created_by) if self.created_by else None
        }

    @classmethod
    async def get_latest_version(
        cls,
        session: AsyncSession,
        script_id: UUID
    ) -> Optional['ScriptVersion']:
        """Get the most recent version for a script."""
        stmt = (
            select(cls)
            .where(cls.script_id == script_id)
            .order_by(desc(cls.created_at))
            .limit(1)
        )
        result = await session.execute(stmt)
        return result.scalars().first()

    @classmethod
    async def get_version_history(
        cls,
        session: AsyncSession,
        script_id: UUID,
        limit: int = 10
    ) -> List['ScriptVersion']:
        """Get version history for a script, most recent first."""
        stmt = (
            select(cls)
            .where(cls.script_id == script_id)
            .order_by(desc(cls.created_at))
            .limit(limit)
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())
