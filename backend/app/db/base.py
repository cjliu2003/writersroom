import os
from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator
import logging
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Get database URL from environment
SQLALCHEMY_DATABASE_URL = os.getenv('DB_URL')
if not SQLALCHEMY_DATABASE_URL:
    raise ValueError("DB_URL environment variable is not set")

# Configure logging
logging.basicConfig()
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)

# Create database engine
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    pool_recycle=300,
    pool_timeout=30,
    echo=True  # Enable SQL query logging
)

# Enable vector extension on connection
@event.listens_for(engine, 'connect')
def on_connect(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute('CREATE EXTENSION IF NOT EXISTS vector')
    dbapi_connection.commit()
    cursor.close()

# Also ensure the extension is created when the engine first connects
with engine.connect() as conn:
    conn.execute('CREATE EXTENSION IF NOT EXISTS vector')
    conn.commit()

# Create session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Base class for models
Base = declarative_base()

def get_db() -> Generator:
    """
    Dependency function that yields database sessions.
    Handles session lifecycle including proper closing of the session.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
