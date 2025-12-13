#!/usr/bin/env python3
"""
Add missing database indexes for performance optimization.
Run this script to create indexes that speed up RAG context building and chat operations.
"""
import asyncio
import sys
import os
from pathlib import Path

# Load environment variables BEFORE importing app modules
from dotenv import load_dotenv
env_path = Path(__file__).parent / ".env"
if env_path.exists():
    load_dotenv(env_path)
    print(f"✓ Loaded environment from {env_path}")
else:
    print(f"⚠️ No .env file found at {env_path}")

from sqlalchemy import text
from app.db.base import engine

async def check_and_create_indexes():
    """Check for existing indexes and create missing ones."""
    async with engine.begin() as conn:
        print("=" * 60)
        print("Checking existing indexes...")
        print("=" * 60)

        # Check existing indexes
        result = await conn.execute(text("""
            SELECT tablename, indexname
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND tablename IN ('scene_embeddings', 'scene_summaries', 'scenes', 'chat_conversations', 'chat_messages')
            ORDER BY tablename, indexname
        """))

        existing_indexes = {}
        for row in result:
            table = row[0]
            index = row[1]
            if table not in existing_indexes:
                existing_indexes[table] = []
            existing_indexes[table].append(index)

        print("\nExisting indexes:")
        for table, indexes in sorted(existing_indexes.items()):
            print(f"\n  {table}:")
            for idx in sorted(indexes):
                print(f"    - {idx}")

        print("\n" + "=" * 60)
        print("Creating missing indexes...")
        print("=" * 60)

        # Create indexes - only ones that don't already exist
        # Note: scene_summaries doesn't have script_id column, uses scene_id -> scenes -> script_id
        indexes_to_create = [
            ("idx_scenes_script_id_position", "scenes(script_id, position)"),  # Compound index for sorted retrieval
        ]

        created_count = 0
        skipped_count = 0

        for index_name, index_def in indexes_to_create:
            # Check if index exists
            table_name = index_def.split('(')[0]
            if table_name in existing_indexes and index_name in existing_indexes[table_name]:
                print(f"✓ SKIP: {index_name} already exists")
                skipped_count += 1
                continue

            # Create index
            try:
                await conn.execute(text(f"CREATE INDEX IF NOT EXISTS {index_name} ON {index_def}"))
                print(f"✅ CREATED: {index_name} on {index_def}")
                created_count += 1
            except Exception as e:
                print(f"❌ ERROR creating {index_name}: {e}")

        print("\n" + "=" * 60)
        print(f"Summary: {created_count} created, {skipped_count} skipped")
        print("=" * 60)

        # Verify all critical indexes now exist
        print("\nVerifying all indexes...")
        result = await conn.execute(text("""
            SELECT tablename, indexname
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND indexname LIKE 'idx_%'
            AND tablename IN ('scene_embeddings', 'scene_summaries', 'scenes', 'chat_conversations', 'chat_messages')
            ORDER BY tablename, indexname
        """))

        final_indexes = {}
        for row in result:
            table = row[0]
            index = row[1]
            if table not in final_indexes:
                final_indexes[table] = []
            final_indexes[table].append(index)

        print("\nFinal indexed tables:")
        for table, indexes in sorted(final_indexes.items()):
            print(f"\n  {table}:")
            for idx in sorted(indexes):
                print(f"    ✓ {idx}")

        print("\n" + "=" * 60)
        print("Index creation complete!")
        print("=" * 60)

if __name__ == "__main__":
    try:
        asyncio.run(check_and_create_indexes())
        print("\n✅ Success! Backend is ready for improved performance.")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
