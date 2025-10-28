"""
Clear corrupted Yjs data for script
"""
import asyncio
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

from app.db.base import async_session_maker
from sqlalchemy import text

async def clear_corrupted_data():
    script_id = 'd0253e04-c5ce-4128-98d7-690b589c5850'

    async with async_session_maker() as db:
        print(f"Clearing corrupted Yjs data for script: {script_id}")

        # Delete all script_versions
        result = await db.execute(
            text("DELETE FROM script_versions WHERE script_id = :script_id"),
            {"script_id": script_id}
        )
        await db.commit()

        deleted_count = result.rowcount
        print(f"Deleted {deleted_count} corrupted script_version records")

        # Verify deletion
        result = await db.execute(
            text("SELECT COUNT(*) FROM script_versions WHERE script_id = :script_id"),
            {"script_id": script_id}
        )
        remaining = result.scalar()
        print(f"Remaining script_version records: {remaining}")

        if remaining == 0:
            print("✅ Successfully cleared all corrupted Yjs data")
            print("\nNext WebSocket connection will rebuild from scenes table.")
        else:
            print("⚠️  Warning: Some records remain")

if __name__ == '__main__':
    asyncio.run(clear_corrupted_data())
