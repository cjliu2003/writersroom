from sqlalchemy import event
from sqlalchemy.orm import Session

def enable_vector_extension(engine):
    """Enable the pgvector extension if it doesn't exist."""
    with engine.connect() as conn:
        conn.execute('CREATE EXTENSION IF NOT EXISTS vector')
        conn.commit()

def register_vector_events(engine):
    """Register event listeners for vector extension."""
    @event.listens_for(engine, 'connect')
    def on_connect(dbapi_connection, connection_record):
        dbapi_connection.cursor().execute('CREATE EXTENSION IF NOT EXISTS vector')

    @event.listens_for(Session, 'before_commit')
    def before_commit(session):
        # Ensure any vector operations are handled before commit
        pass
