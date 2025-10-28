"""
Pytest configuration and shared fixtures for FDX parser tests and database tests.
"""
from pathlib import Path
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import NullPool
from uuid import uuid4

from app.models.base import Base
from app.models.user import User
from app.models.script import Script
from app.models.script_version import ScriptVersion

# Import all models to ensure relationships resolve correctly
# This is needed for SQLAlchemy to properly create all tables
import app.models.scene
import app.models.scene_version
import app.models.scene_snapshot
import app.models.scene_snapshot_metadata
import app.models.script_collaborator
import app.models.chat_conversation
import app.models.chat_message
import app.models.scene_embedding

# Make repo root easily accessible
@pytest.fixture(scope="session")
def repo_root():
    """Return the repository root directory."""
    return Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def test_assets_dir(repo_root):
    """Return the test_assets directory."""
    return repo_root / "test_assets"


@pytest.fixture(scope="session")
def all_fdx_files(test_assets_dir):
    """Return list of all .fdx files in test_assets."""
    return sorted(list(test_assets_dir.glob("*.fdx")))


# Database fixtures for integration tests
@pytest.fixture
async def db_session():
    """Create a test database session."""
    # Use in-memory SQLite for testing
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=NullPool,
        echo=False
    )

    # Create all tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Create session
    async_session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False
    )

    async with async_session_factory() as session:
        yield session

    # Cleanup
    await engine.dispose()


@pytest.fixture
async def test_user(db_session):
    """Create a test user."""
    user = User(
        user_id=uuid4(),
        firebase_uid="test_firebase_uid",
        display_name="Test User"
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_script(db_session, test_user):
    """Create a test script."""
    script = Script(
        script_id=uuid4(),
        owner_id=test_user.user_id,
        title="Test Script",
        description="A test screenplay"
    )
    db_session.add(script)
    await db_session.commit()
    await db_session.refresh(script)
    return script
