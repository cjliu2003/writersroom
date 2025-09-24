from datetime import datetime
from typing import List, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from app.models.base import Base

class User(Base):
    """
    User model representing a user in the system.
    """
    __tablename__ = 'users'

    # Columns
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        index=True,
        unique=True,
        nullable=False
    )
    
    # Alias 'id' to point to 'user_id' for backward compatibility
    @property
    def id(self):
        return self.user_id
    
    firebase_uid: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        index=True
    )
    
    display_name: Mapped[str] = mapped_column(
        String(100),
        nullable=True
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
    
    def __repr__(self) -> str:
        return f"<User {self.display_name} ({self.user_id})>"
    
    # Relationships
    scripts: Mapped[List["Script"]] = relationship(
        "Script", 
        back_populates="owner",
        cascade="all, delete-orphan"
    )
    
    # Collaborations where this user is a collaborator (not owner)
    collaborations: Mapped[List["ScriptCollaborator"]] = relationship(
        "ScriptCollaborator",
        back_populates="user",
        cascade="all, delete-orphan"
    )
    
    # Chat conversations initiated by this user
    chat_conversations: Mapped[List["ChatConversation"]] = relationship(
        "ChatConversation",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy='dynamic'
    )
    
    def to_dict(self) -> dict:
        """Convert User instance to dictionary."""
        return {
            'user_id': str(self.user_id),
            'firebase_uid': self.firebase_uid,
            'display_name': self.display_name,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
