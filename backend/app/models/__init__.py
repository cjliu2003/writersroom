"""
Models package for the WritersRoom application.

This package contains all the SQLAlchemy models for the application.
"""

# Import Base first to avoid circular imports
from app.models.base import Base

# Import all models to ensure they are registered with SQLAlchemy
from app.models.user import User
from app.models.script_version import ScriptVersion
from app.models.script import Script
from app.models.script_collaborator import ScriptCollaborator, CollaboratorRole
from app.models.chat_message import ChatMessage, MessageRole
from app.models.scene_snapshot_metadata import SceneSnapshotMetadata
from app.models.scene import Scene
from app.models.scene_version import SceneVersion
from app.models.scene_snapshot import SceneSnapshot
from app.models.scene_write_op import SceneWriteOp
from app.models.chat_conversation import ChatConversation
from app.models.scene_embedding import SceneEmbedding

# AI system models (Phase 0)
from app.models.scene_summary import SceneSummary
from app.models.script_outline import ScriptOutline
from app.models.character_sheet import CharacterSheet
from app.models.scene_character import SceneCharacter
from app.models.plot_thread import PlotThread, PlotThreadType
from app.models.scene_relationship import SceneRelationship, SceneRelationshipType
from app.models.conversation_summary import ConversationSummary
from app.models.script_state import ScriptState
from app.models.token_usage import TokenUsage

# This ensures that all models are properly registered with SQLAlchemy's metadata
# and will be picked up by Alembic for migrations
__all__ = [
    # Base class for SQLAlchemy models
    'Base',

    # Core Models
    'User',
    'Script',
    'ScriptVersion',
    'Scene',
    'SceneVersion',
    'SceneSnapshot',
    'SceneSnapshotMetadata',
    'SceneWriteOp',
    'SceneEmbedding',
    'ScriptCollaborator',
    'ChatConversation',
    'ChatMessage',

    # AI System Models
    'SceneSummary',
    'ScriptOutline',
    'CharacterSheet',
    'SceneCharacter',
    'PlotThread',
    'SceneRelationship',
    'ConversationSummary',
    'TokenUsage',

    # Enums
    'CollaboratorRole',
    'MessageRole',
    'PlotThreadType',
    'SceneRelationshipType',
    'ScriptState',
]
