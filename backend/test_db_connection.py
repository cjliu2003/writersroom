import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
host = os.getenv('DB_HOST')
port = os.getenv('DB_PORT')
user = os.getenv('DB_USER')
password = os.getenv('DB_PASSWORD')
dbname = os.getenv('DB_NAME')


def test_connection():
    # Load environment variables
    load_dotenv()
    
    # Get sync database URL
    db_url = os.getenv('DB_URL_SYNC')
    if not db_url:
        print("Error: DB_URL_SYNC not found in environment variables")
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

def test_connection2():
    import psycopg2
    conn = psycopg2.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        dbname=dbname,
        sslmode="require",
    )
    with conn.cursor() as cur:
        cur.execute("select 1;")
        print(cur.fetchone())
    conn.close()
if __name__ == "__main__":
    #test_connection()
    test_connection2()


