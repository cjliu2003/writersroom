from datetime import datetime, timedelta
from typing import Dict, Any, Optional, TYPE_CHECKING, List
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, DateTime, Index, select, func as sqlfunc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.sql import func

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.scene import Scene  # noqa: F401
    from app.models.user import User  # noqa: F401

class SceneWriteOp(Base):
    """
    SceneWriteOp model for idempotency tracking of scene write operations.
    Stores operation IDs, users, and results to prevent duplicate processing.
    """
    __tablename__ = 'scene_write_ops'
    __table_args__ = (
        # Indexes for lookups and cleanup
        Index('idx_scene_write_ops_scene_id_created_at', 'scene_id', 'created_at'),
        Index('idx_scene_write_ops_user_id_created_at', 'user_id', 'created_at'),
    )

    # Columns
    op_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        index=True,
        nullable=False
    )
    
    scene_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('scenes.scene_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )
    
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('users.user_id'),
        nullable=False,
        index=True
    )
    
    # Operation result as JSON
    result: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False
    )
    
    # When this operation was performed
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True
    )
    
    # Relationships
    scene: Mapped['Scene'] = relationship(
        'Scene',
        lazy='selectin'
    )
    
    user: Mapped['User'] = relationship(
        'User',
        lazy='selectin'
    )
    
    def __repr__(self) -> str:
        return f"<SceneWriteOp {self.op_id} for scene {self.scene_id} by user {self.user_id}>"
    
    @classmethod
    async def find_by_op_id(
        cls, 
        session: AsyncSession, 
        op_id: UUID
    ) -> Optional['SceneWriteOp']:
        """Find a write operation by its operation ID."""
        stmt = select(cls).where(cls.op_id == op_id)
        result = await session.execute(stmt)
        return result.scalars().first()
    
    @classmethod
    async def find_by_user_scene_recent(
        cls, 
        session: AsyncSession, 
        user_id: UUID,
        scene_id: UUID,
        age_hours: int = 24
    ) -> List['SceneWriteOp']:
        """Find recent write operations by user and scene."""
        cutoff = datetime.utcnow() - timedelta(hours=age_hours)
        stmt = (
            select(cls)
            .where(
                cls.user_id == user_id,
                cls.scene_id == scene_id,
                cls.created_at >= cutoff
            )
            .order_by(cls.created_at.desc())
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())
    
    @classmethod
    async def cleanup_old_ops(
        cls,
        session: AsyncSession,
        age_days: int = 30
    ) -> int:
        """Delete write operations older than specified days. Returns count of deleted rows."""
        cutoff = datetime.utcnow() - timedelta(days=age_days)
        stmt = (
            cls.__table__.delete()
            .where(cls.created_at < cutoff)
            .returning(sqlfunc.count())
        )
        result = await session.execute(stmt)
        await session.commit()
        return result.scalar_one() or 0
