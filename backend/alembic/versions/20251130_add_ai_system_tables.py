"""add_ai_system_tables

Revision ID: 20251130_ai_system
Revises: d8d070b7e795
Create Date: 2025-11-30 00:00:00.000000

Phase 0: AI System Foundation

Adds database tables and columns for the AI assistant system:
- Scene summaries (scene cards) for RAG retrieval
- Script outlines with staleness tracking
- Character sheets with arc tracking
- Scene-character relationships
- Plot threads for cross-scene story tracking
- Scene relationships (setup/payoff, callbacks)
- Conversation summaries for long conversations
- Script state tracking (empty/partial/analyzed)
- Scene hash for change detection
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20251130_ai_system'
down_revision = 'd8d070b7e795'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ========================================================================
    # Add columns to existing tables
    # ========================================================================

    # Add AI system columns to scripts table
    op.add_column('scripts', sa.Column(
        'state',
        sa.String(20),
        nullable=False,
        server_default='empty',
        comment='Script analysis state: empty, partial, analyzed'
    ))

    op.add_column('scripts', sa.Column(
        'last_state_transition',
        sa.DateTime(timezone=True),
        nullable=True,
        comment='When the state last changed'
    ))

    op.add_column('scripts', sa.Column(
        'hash',
        sa.String(64),
        nullable=True,
        comment='SHA-256 hash for change detection'
    ))

    # Add hash column to scenes table for change detection
    op.add_column('scenes', sa.Column(
        'hash',
        sa.String(64),
        nullable=True,
        comment='SHA-256 hash for change detection'
    ))

    op.add_column('scenes', sa.Column(
        'is_key_scene',
        sa.Boolean,
        nullable=False,
        server_default='false',
        comment='True if this is a pivotal scene (inciting incident, midpoint, climax)'
    ))

    # Create index on scenes.hash
    op.create_index('idx_scenes_hash', 'scenes', ['hash'])
    op.create_index('idx_scenes_is_key', 'scenes', ['is_key_scene'], postgresql_where=sa.text('is_key_scene = true'))

    # ========================================================================
    # Create new tables
    # ========================================================================

    # Scene summaries (scene cards)
    op.create_table(
        'scene_summaries',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('scene_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('scenes.scene_id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('summary_text', sa.Text, nullable=False, comment='Structured scene summary (5-7 lines): Action, Conflict, Character Changes, Plot Progression, Tone'),
        sa.Column('tokens_estimate', sa.Integer, nullable=False, comment='Estimated token count for budget planning'),
        sa.Column('version', sa.Integer, nullable=False, server_default='1', comment='Incremented on each regeneration'),
        sa.Column('last_generated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    )
    op.create_index('idx_scene_summaries_scene_id', 'scene_summaries', ['scene_id'])

    # Script outlines
    op.create_table(
        'script_outlines',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('script_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('scripts.script_id', ondelete='CASCADE'), nullable=False),
        sa.Column('version', sa.Integer, nullable=False, server_default='1', comment='Incremented on each regeneration'),
        sa.Column('summary_text', sa.Text, nullable=False, comment='Global summary + act-by-act breakdown + key turning points'),
        sa.Column('tokens_estimate', sa.Integer, nullable=False, comment='Estimated token count for budget planning'),
        sa.Column('is_stale', sa.Boolean, nullable=False, server_default='false', comment='True if scenes have changed significantly since last generation'),
        sa.Column('dirty_scene_count', sa.Integer, nullable=False, server_default='0', comment='Number of scenes changed since last generation'),
        sa.Column('last_generated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now())
    )
    op.create_index('idx_script_outlines_script_id', 'script_outlines', ['script_id'])

    # Character sheets
    op.create_table(
        'character_sheets',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('script_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('scripts.script_id', ondelete='CASCADE'), nullable=False),
        sa.Column('character_name', sa.String(255), nullable=False, comment='Character name (case-sensitive)'),
        sa.Column('summary_text', sa.Text, nullable=False, comment='Want/Need, Arc, Key Relationships, Pivotal Moments'),
        sa.Column('tokens_estimate', sa.Integer, nullable=False, comment='Estimated token count for budget planning'),
        sa.Column('is_stale', sa.Boolean, nullable=False, server_default='false', comment='True if scenes with this character have changed significantly'),
        sa.Column('dirty_scene_count', sa.Integer, nullable=False, server_default='0', comment='Number of scenes with this character that changed since last generation'),
        sa.Column('last_generated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.UniqueConstraint('script_id', 'character_name', name='uq_script_character')
    )
    op.create_index('idx_character_sheets_script_id', 'character_sheets', ['script_id'])
    op.create_index('idx_character_sheets_character_name', 'character_sheets', ['character_name'])

    # Scene-character relationships
    op.create_table(
        'scene_characters',
        sa.Column('scene_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('scenes.scene_id', ondelete='CASCADE'), nullable=False),
        sa.Column('character_name', sa.String(255), nullable=False, comment='Character name (should match character_sheets.character_name)'),
        sa.PrimaryKeyConstraint('scene_id', 'character_name')
    )
    op.create_index('idx_scene_characters_character', 'scene_characters', ['character_name'])

    # Plot threads
    op.create_table(
        'plot_threads',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('script_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('scripts.script_id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False, comment='Thread name (e.g., "Protagonist\'s lie", "MacGuffin chase")'),
        sa.Column('scenes', postgresql.ARRAY(sa.Integer), nullable=False, comment='Array of scene indices in this thread'),
        sa.Column('thread_type', sa.String(50), nullable=False, comment='Type: character_arc, plot, subplot, theme'),
        sa.Column('description', sa.Text, nullable=True, comment='Optional description of this thread'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now())
    )
    op.create_index('idx_plot_threads_script_id', 'plot_threads', ['script_id'])

    # Scene relationships
    op.create_table(
        'scene_relationships',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('script_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('scripts.script_id', ondelete='CASCADE'), nullable=False),
        sa.Column('setup_scene_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('scenes.scene_id', ondelete='CASCADE'), nullable=False, comment='Source scene (setup, original, etc.)'),
        sa.Column('payoff_scene_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('scenes.scene_id', ondelete='CASCADE'), nullable=False, comment='Target scene (payoff, callback, parallel, echo)'),
        sa.Column('relationship_type', sa.String(50), nullable=False, comment='Type: setup_payoff, callback, parallel, echo'),
        sa.Column('description', sa.Text, nullable=True, comment='Optional description of the relationship'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    )
    op.create_index('idx_scene_relationships_script_id', 'scene_relationships', ['script_id'])
    op.create_index('idx_scene_relationships_setup', 'scene_relationships', ['setup_scene_id'])
    op.create_index('idx_scene_relationships_payoff', 'scene_relationships', ['payoff_scene_id'])

    # Conversation summaries
    op.create_table(
        'conversation_summaries',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('conversation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('chat_conversations.conversation_id', ondelete='CASCADE'), nullable=False),
        sa.Column('summary_text', sa.Text, nullable=False, comment='Summary of topics discussed, edits made, user preferences'),
        sa.Column('tokens_estimate', sa.Integer, nullable=False, comment='Estimated token count for budget planning'),
        sa.Column('messages_covered', sa.Integer, nullable=False, comment='Number of messages this summary covers'),
        sa.Column('last_message_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('chat_messages.message_id'), nullable=True, comment='Last message included in this summary'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
    )
    op.create_index('idx_conversation_summaries_conversation_id', 'conversation_summaries', ['conversation_id'])


def downgrade() -> None:
    # Drop new tables
    op.drop_table('conversation_summaries')
    op.drop_table('scene_relationships')
    op.drop_table('plot_threads')
    op.drop_table('scene_characters')
    op.drop_table('character_sheets')
    op.drop_table('script_outlines')
    op.drop_table('scene_summaries')

    # Drop indexes from scenes
    op.drop_index('idx_scenes_is_key', 'scenes')
    op.drop_index('idx_scenes_hash', 'scenes')

    # Drop columns from scenes
    op.drop_column('scenes', 'is_key_scene')
    op.drop_column('scenes', 'hash')

    # Drop columns from scripts
    op.drop_column('scripts', 'hash')
    op.drop_column('scripts', 'last_state_transition')
    op.drop_column('scripts', 'state')
