#!/usr/bin/env python3
"""
Migrate existing scene_characters and Scene.characters data to use normalized names.

This script:
1. Updates Scene.characters JSONB arrays to use normalized names
2. Deletes all SceneCharacter records
3. Recreates SceneCharacter records with normalized names
"""

import os
from dotenv import load_dotenv
load_dotenv()

import asyncio
from uuid import UUID
from sqlalchemy import select, delete
from app.db.base import async_session_maker
from app.models.scene import Scene
from app.models.scene_character import SceneCharacter
from app.utils.character_normalization import normalize_character_list, normalize_character_name


async def migrate_normalize_characters(script_id: str = None):
    """
    Normalize all character names in database.

    Steps:
    1. Update Scene.characters JSONB arrays to use normalized names
    2. Delete all SceneCharacter records
    3. Recreate SceneCharacter records with normalized names

    Args:
        script_id: Optional script ID to migrate. If None, migrates all scripts.
    """
    print("=" * 70)
    print("MIGRATE CHARACTER NORMALIZATION")
    print("=" * 70)

    async with async_session_maker() as db:
        # Get scenes to update
        query = select(Scene)
        if script_id:
            script_uuid = UUID(script_id)
            query = query.where(Scene.script_id == script_uuid)
            print(f"\nMigrating script: {script_id}")
        else:
            print("\nMigrating ALL scripts")

        result = await db.execute(query)
        scenes = result.scalars().all()

        print(f"Found {len(scenes)} scenes to migrate\n")

        # Track stats
        scenes_updated = 0
        characters_before = set()
        characters_after = set()
        records_deleted = 0
        records_created = 0

        # Step 1: Update Scene.characters JSONB arrays
        print("Step 1: Normalizing Scene.characters arrays...")
        for scene in scenes:
            if scene.characters:
                # Collect original character names for stats
                for char in scene.characters:
                    characters_before.add(char)

                # Normalize the character list
                normalized = normalize_character_list(scene.characters)

                # Update if changed
                if set(normalized) != set(scene.characters):
                    scene.characters = normalized
                    scenes_updated += 1

                # Collect normalized names for stats
                for char in normalized:
                    characters_after.add(char)

        await db.commit()
        print(f"✅ Updated {scenes_updated} scenes with normalized character arrays")

        # Step 2: Delete existing SceneCharacter records
        print("\nStep 2: Deleting old SceneCharacter records...")
        delete_query = delete(SceneCharacter)
        if script_id:
            scene_ids = [s.scene_id for s in scenes]
            delete_query = delete_query.where(SceneCharacter.scene_id.in_(scene_ids))

        result = await db.execute(delete_query)
        records_deleted = result.rowcount
        await db.commit()
        print(f"✅ Deleted {records_deleted} old SceneCharacter records")

        # Step 3: Recreate SceneCharacter records with normalized names
        print("\nStep 3: Creating new normalized SceneCharacter records...")
        for scene in scenes:
            if scene.characters:
                for char_name in scene.characters:
                    scene_char = SceneCharacter(
                        scene_id=scene.scene_id,
                        character_name=char_name  # Already normalized
                    )
                    db.add(scene_char)
                    records_created += 1

        await db.commit()
        print(f"✅ Created {records_created} new normalized SceneCharacter records")

        # Print results
        print("\n" + "=" * 70)
        print("MIGRATION RESULTS")
        print("=" * 70)
        print(f"Scenes processed: {len(scenes)}")
        print(f"Scenes updated: {scenes_updated}")
        print(f"Characters before normalization: {len(characters_before)}")
        print(f"Characters after normalization: {len(characters_after)}")
        print(f"Characters deduplicated: {len(characters_before) - len(characters_after)}")
        print(f"SceneCharacter records deleted: {records_deleted}")
        print(f"SceneCharacter records created: {records_created}")
        print("\nDeduplicated characters (examples of normalization):")

        # Show some examples of characters that were normalized
        sample_before = sorted(list(characters_before))[:10]
        sample_after = sorted(list(characters_after))[:10]

        print("\nBefore normalization (sample):")
        for char in sample_before:
            print(f"  - {char}")

        print("\nAfter normalization (sample):")
        for char in sample_after:
            print(f"  - {char}")

        print("=" * 70)
        print("✅ Migration complete!")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Migrate character normalization')
    parser.add_argument('--script-id', type=str, help='Optional script ID to migrate (UUID)')
    args = parser.parse_args()

    try:
        asyncio.run(migrate_normalize_characters(args.script_id))
    except KeyboardInterrupt:
        print("\n\nMigration interrupted")
    except Exception as e:
        print(f"\n❌ Migration failed: {str(e)}")
        import traceback
        traceback.print_exc()
