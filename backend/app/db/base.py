import os, ssl, logging, certifi
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base  # <- preferred import in SA 2.x

# ENV
DB_HOST = os.getenv('DB_HOST')                # e.g. aws-0-us-west-1.pooler.supabase.com
DB_PORT = os.getenv('DB_PORT', '5432')        # session pooler is usually 5432 (not 6543 for transaction pooler)
DB_USER = os.getenv('DB_USER')                # e.g. postgres.<PROJECT_REF>
DB_PASSWORD = os.getenv('DB_PASSWORD')
DB_NAME = os.getenv('DB_NAME', 'postgres')
DB_URL_ASYNC = os.getenv('DB_URL_ASYNC')

if not ((DB_HOST and DB_PORT and DB_USER and DB_PASSWORD and DB_NAME) or DB_URL_ASYNC):
    raise ValueError("Database connection parameters or DB_URL_ASYNC must be set")

logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)

# Build URL
if DB_HOST and DB_PORT and DB_USER and DB_PASSWORD and DB_NAME:
    # Session pooler supports prepared statements, so we can use a clean URL
    connection_url = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    print(f"✅ Using connection pooler: {DB_HOST}:{DB_PORT}")
else:
    # Use legacy URL as-is
    connection_url = DB_URL_ASYNC
    print(f"⚠️  Using direct connection: {DB_URL_ASYNC[:50]}...")

# Create async engine - session pooler supports prepared statements
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

engine = create_async_engine(
    connection_url,
    echo=False,  # Disable SQL query logging for cleaner output
    future=True,
    pool_pre_ping=True,
    pool_size=20,  # Increased for demo (websockets + HTTP endpoints under high load)
    max_overflow=30,  # Allow bursts during concurrent operations
    pool_recycle=3600,  # Recycle connections after 1 hour
    pool_timeout=10,  # Allow more time for connection acquisition during contention
    connect_args={
        "ssl": ssl_ctx,
        "statement_cache_size": 0,  # Disable prepared statement cache for pooler compatibility
        "command_timeout": 60,  # Query timeout - increased for high-latency connections (Croatia → California)
    },
)

async_session_maker = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

Base = declarative_base()

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
