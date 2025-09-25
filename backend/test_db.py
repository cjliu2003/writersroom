# Save as test_db.py in your backend directory
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()
db_url = os.environ.get("DB_URL_SYNC")
print(f"Connecting with: {db_url}")

try:
    # Extract connection parameters from URL
    # Format: postgresql+psycopg2://username:password@host:port/database
    parts = db_url.replace("postgresql+psycopg2://", "").split("@")
    user_pass = parts[0].split(":")
    host_port_db = parts[1].split("/")
    host_port = host_port_db[0].split(":")
    
    conn = psycopg2.connect(
        user=user_pass[0],
        password=user_pass[1],
        host=host_port[0],
        port=host_port[1] if len(host_port) > 1 else 5432,
        database=host_port_db[1]
    )
    print("Connection successful!")
    conn.close()
except Exception as e:
    print(f"Connection failed: {e}")