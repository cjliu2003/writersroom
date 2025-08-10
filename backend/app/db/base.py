import os
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.pool import NullPool
import logging
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Get async database URL from environment
DB_URL_ASYNC = os.getenv('DB_URL_ASYNC')
if not DB_URL_ASYNC:
    raise ValueError("DB_URL_ASYNC environment variable is not set")

# Configure logging
logging.basicConfig()
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)

# Create async engine
engine = create_async_engine(
    DB_URL_ASYNC,
    echo=True,
    future=True,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    pool_recycle=300,
    pool_timeout=30,
    poolclass=NullPool if 'test' in DB_URL_ASYNC else None
)

# Create async session factory
async_session_maker = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False
)

# Base class for models
Base = declarative_base()

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency function that yields async database sessions.
    Handles session lifecycle including proper closing of the session.
    """
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
