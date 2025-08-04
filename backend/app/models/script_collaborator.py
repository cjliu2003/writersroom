from datetime import datetime
from enum import Enum
from sqlalchemy import Integer, String, ForeignKey, DateTime, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base

class CollaboratorRole(str, Enum):
    OWNER = 'owner'
    EDITOR = 'editor'
    VIEWER = 'viewer'

class ScriptCollaborator(Base):
    """
    ScriptCollaborator model representing the many-to-many relationship
    between users and scripts with an additional role attribute.
    """
    __tablename__ = 'script_collaborators'

    # Columns
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True
    )
    
    script_id: Mapped[str] = mapped_column(
        ForeignKey('scripts.script_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )
    
    user_id: Mapped[str] = mapped_column(
        ForeignKey('users.user_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )
    
    role: Mapped[CollaboratorRole] = mapped_column(
        SQLEnum(CollaboratorRole),
        nullable=False,
        default=CollaboratorRole.VIEWER
    )
    
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    
    # Relationships
    script: Mapped['Script'] = relationship(
        'Script',
        back_populates='collaborators',
        lazy='joined'
    )
    
    user: Mapped['User'] = relationship(
        'User',
        back_populates='collaborations',
        lazy='joined'
    )
    
    def __repr__(self) -> str:
        return f"<ScriptCollaborator user_id={self.user_id} script_id={self.script_id} role={self.role}>"
    
    def to_dict(self) -> dict:
        """Convert ScriptCollaborator instance to dictionary."""
        return {
            'id': self.id,
            'script_id': str(self.script_id),
            'user_id': str(self.user_id),
            'role': self.role.value,
            'joined_at': self.joined_at.isoformat() if self.joined_at else None,
            'user': self.user.to_dict() if self.user else None
        }
