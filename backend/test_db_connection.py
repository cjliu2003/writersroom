import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

def test_connection():
    # Load environment variables
    load_dotenv()
    
    # Get database URL
    db_url = os.getenv('DB_URL')
    if not db_url:
        print("Error: DB_URL not found in environment variables")
        return False
    
    try:
        # Create engine and test connection
        engine = create_engine(db_url)
        with engine.connect() as conn:
            result = conn.execute(text("SELECT version()"))
            version = result.scalar()
            print(f"Successfully connected to database!\nVersion: {version}")
            return True
    except Exception as e:
        print(f"Error connecting to database: {e}")
        return False

if __name__ == "__main__":
    test_connection()
