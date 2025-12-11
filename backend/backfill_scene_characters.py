#!/usr/bin/env python3
"""
Backfill Scene Characters - Populate scene_characters junction table from existing Scene.characters data

This script populates the scene_characters junction table from the Scene.characters JSONB field.
Run this once to fix existing data that was imported before the FDX upload logic was updated.
"""

import os
from dotenv import load_dotenv
load_dotenv()

import asyncio
from uuid import UUID
from sqlalchemy import select, text
from app.db.base import async_session_maker
from app.models.scene import Scene
from app.models.scene_character import SceneCharacter

# Script ID to backfill (or None for all scripts)
SCRIPT_ID = UUID('05006f9d-2c40-4ffc-a041-f0c3ac62a4ed')


async def backfill_scene_characters(script_id: UUID = None):
    """
    Backfill scene_characters table from Scene.characters JSONB data.

    Args:
        script_id: Optional script ID to backfill. If None, backfills all scripts.
    """
    print("=" * 70)
    print("BACKFILL SCENE_CHARACTERS JUNCTION TABLE")
    print("=" * 70)

    async with async_session_maker() as db:
        # Build query
        query = select(Scene)
        if script_id:
            query = query.where(Scene.script_id == script_id)
            print(f"\nBackfilling for script: {script_id}")
        else:
            print("\nBackfilling for ALL scripts")

        query = query.order_by(Scene.position)

        # Get scenes
        result = await db.execute(query)
        scenes = result.scalars().all()

        print(f"Found {len(scenes)} scenes to process\n")

        # Track stats
        total_records_created = 0
        scenes_with_characters = 0
        unique_characters = set()

        # Process each scene
        for scene in scenes:
            if scene.characters and len(scene.characters) > 0:
                scenes_with_characters += 1

                for character_name in scene.characters:
                    # Check if record already exists
                    existing = await db.execute(
                        select(SceneCharacter)
                        .where(SceneCharacter.scene_id == scene.scene_id)
                        .where(SceneCharacter.character_name == character_name)
                    )

                    if existing.scalar_one_or_none() is None:
                        # Create new record
                        scene_char = SceneCharacter(
                            scene_id=scene.scene_id,
                            character_name=character_name
                        )
                        db.add(scene_char)
                        total_records_created += 1
                        unique_characters.add(character_name)

        # Commit all changes
        await db.commit()

        # Verify results
        count_result = await db.execute(
            text('SELECT COUNT(*) FROM scene_characters')
        )
        total_count = count_result.scalar()

        print("=" * 70)
        print("BACKFILL RESULTS")
        print("=" * 70)
        print(f"✅ Scenes processed: {len(scenes)}")
        print(f"✅ Scenes with characters: {scenes_with_characters}")
        print(f"✅ New records created: {total_records_created}")
        print(f"✅ Unique characters found: {len(unique_characters)}")
        print(f"✅ Total scene_character records in database: {total_count}")
        print("\nCharacters found:")
        for char in sorted(unique_characters):
            print(f"  - {char}")
        print("=" * 70)


if __name__ == "__main__":
    try:
        asyncio.run(backfill_scene_characters(SCRIPT_ID))
    except KeyboardInterrupt:
        print("\n\nBackfill interrupted")
    except Exception as e:
        print(f"\n❌ Backfill failed: {str(e)}")
        import traceback
        traceback.print_exc()
