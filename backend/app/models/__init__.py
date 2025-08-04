"""
Models package for the WritersRoom application.

This package contains all the SQLAlchemy models for the application.
"""

# Import Base first to avoid circular imports
from app.db.base import Base

# Import all models to ensure they are registered with SQLAlchemy
from app.models.user import User
from app.models.script import Script
from app.models.script_collaborator import ScriptCollaborator, CollaboratorRole
from app.models.scene import Scene
from app.models.scene_embedding import SceneEmbedding
from app.models.scene_version import SceneVersion
from app.models.chat_conversation import ChatConversation
from app.models.chat_message import ChatMessage, MessageRole

# This ensures that all models are properly registered with SQLAlchemy's metadata
# and will be picked up by Alembic for migrations
__all__ = [
    # Base class for SQLAlchemy models
    'Base',
    
    # Models
    'User',
    'Script',
    'Scene',
    'SceneVersion',
    'SceneEmbedding',
    'ScriptCollaborator',
    'ChatConversation',
    'ChatMessage',
    
    # Enums
    'CollaboratorRole',
    'MessageRole',
]
