"""Add conversation_states table

Revision ID: a1b2c3d4e5f6
Revises: dcedc562b2d2
Create Date: 2025-12-28

Phase 2: Working Set State for conversation continuity.
Tracks active entities and last assistant commitment for pronoun resolution.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = 'dcedc562b2d2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'conversation_states',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'conversation_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('chat_conversations.conversation_id', ondelete='CASCADE'),
            nullable=False,
            unique=True,
            index=True
        ),
        sa.Column(
            'active_scene_ids',
            postgresql.ARRAY(sa.Integer),
            nullable=False,
            server_default='{}'
        ),
        sa.Column(
            'active_characters',
            postgresql.ARRAY(sa.String(100)),
            nullable=False,
            server_default='{}'
        ),
        sa.Column(
            'active_threads',
            postgresql.ARRAY(sa.String(200)),
            nullable=False,
            server_default='{}'
        ),
        sa.Column('last_user_intent', sa.String(50), nullable=True),
        sa.Column('last_assistant_commitment', sa.Text, nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False
        ),
    )

    # Note: Index is automatically created by unique=True and index=True in column definition


def downgrade() -> None:
    op.drop_table('conversation_states')
