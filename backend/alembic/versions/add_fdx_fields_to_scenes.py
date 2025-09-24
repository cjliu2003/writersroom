"""Add FDX fields to scenes table

Revision ID: add_fdx_fields_to_scenes
Revises: 
Create Date: 2024-09-24 15:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_fdx_fields_to_scenes'
down_revision = None  # Update this to the previous revision ID
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns to scenes table
    op.add_column('scenes', sa.Column('characters', postgresql.ARRAY(sa.String()), nullable=True))
    op.add_column('scenes', sa.Column('themes', postgresql.ARRAY(sa.String()), nullable=True))
    op.add_column('scenes', sa.Column('tokens', sa.Integer(), nullable=True))
    op.add_column('scenes', sa.Column('word_count', sa.Integer(), nullable=True))
    op.add_column('scenes', sa.Column('full_content', sa.Text(), nullable=True))


def downgrade() -> None:
    # Remove the added columns
    op.drop_column('scenes', 'full_content')
    op.drop_column('scenes', 'word_count')
    op.drop_column('scenes', 'tokens')
    op.drop_column('scenes', 'themes')
    op.drop_column('scenes', 'characters')
