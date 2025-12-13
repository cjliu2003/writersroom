#!/usr/bin/env python3
"""
Manual test to verify worker functionality step by step.
"""

import os
from dotenv import load_dotenv
load_dotenv()

import asyncio
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.models.scene import Scene
from app.models.scene_summary import SceneSummary
from app.services.ingestion_service import IngestionService
from app.services.embedding_service import EmbeddingService

SCRIPT_ID = UUID('05006f9d-2c40-4ffc-a041-f0c3ac62a4ed')

# Use pooler connection
db_url = f"postgresql+asyncpg://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}"


async def main():
    """Test the ingestion pipeline manually."""
    print("=" * 70)
    print("MANUAL WORKER TEST - Step by Step")
    print("=" * 70)

    engine = create_async_engine(db_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        # Step 1: Check scenes
        print("\n[1/5] Checking scenes in database...")
        scenes_result = await db.execute(
            select(Scene).where(Scene.script_id == SCRIPT_ID)
        )
        scenes = scenes_result.scalars().all()
        print(f"   ✓ Found {len(scenes)} scenes")

        # Check if scenes have content
        scenes_with_content = [s for s in scenes if s.content_blocks and len(s.content_blocks) > 0]
        print(f"   ✓ Scenes with content: {len(scenes_with_content)}")

        if len(scenes_with_content) == 0:
            print("\n   ⚠️  WARNING: No scenes have content!")
            print("   This might be why summaries aren't generated.")
            return

        # Step 2: Check existing summaries
        print("\n[2/5] Checking existing scene summaries...")
        summaries_result = await db.execute(
            select(SceneSummary)
            .join(Scene, SceneSummary.scene_id == Scene.scene_id)
            .where(Scene.script_id == SCRIPT_ID)
        )
        existing_summaries = summaries_result.scalars().all()
        print(f"   ✓ Found {len(existing_summaries)} existing summaries")

        # Step 3: Test generating a single scene summary
        print("\n[3/5] Testing single scene summary generation...")
        first_scene_with_content = scenes_with_content[0]
        print(f"   Testing scene: {first_scene_with_content.scene_heading}")
        print(f"   Scene ID: {first_scene_with_content.scene_id}")
        print(f"   Position: {first_scene_with_content.position}")

        ingestion_service = IngestionService(db)

        try:
            print(f"   Calling generate_scene_summary...")
            summary = await ingestion_service.generate_scene_summary(
                first_scene_with_content,
                force_regenerate=True  # Force regeneration
            )
            print(f"   ✓ SUCCESS! Generated summary:")
            print(f"     - ID: {summary.id}")
            print(f"     - Tokens: {summary.tokens_estimate}")
            print(f"     - Preview: {summary.summary_text[:150]}...")
        except Exception as e:
            print(f"   ❌ FAILED: {str(e)}")
            import traceback
            traceback.print_exc()
            return

        # Step 4: Verify summary was saved
        print("\n[4/5] Verifying summary was saved to database...")
        check_result = await db.execute(
            select(SceneSummary).where(SceneSummary.scene_id == first_scene_with_content.scene_id)
        )
        saved_summary = check_result.scalar_one_or_none()

        if saved_summary:
            print(f"   ✓ Summary found in database!")
            print(f"     - Tokens: {saved_summary.tokens_estimate}")
            print(f"     - Version: {saved_summary.version}")
        else:
            print(f"   ❌ Summary NOT found in database!")

        # Step 5: Test batch generation
        print("\n[5/5] Testing batch generation for first 3 scenes...")
        print(f"   Generating summaries for 3 scenes...")

        batch_count = 0
        for i, scene in enumerate(scenes_with_content[:3]):
            try:
                await ingestion_service.generate_scene_summary(scene, force_regenerate=True)
                batch_count += 1
                print(f"   ✓ Scene {i+1}/3 completed")
            except Exception as e:
                print(f"   ❌ Scene {i+1}/3 failed: {str(e)}")

        print(f"\n   Generated {batch_count}/3 summaries")

        # Final count
        final_result = await db.execute(
            select(SceneSummary)
            .join(Scene, SceneSummary.scene_id == Scene.scene_id)
            .where(Scene.script_id == SCRIPT_ID)
        )
        final_summaries = final_result.scalars().all()

        print("\n" + "=" * 70)
        print(f"FINAL RESULT: {len(final_summaries)} total summaries in database")
        print("=" * 70)

        if len(final_summaries) > 0:
            print("\n✅ SUCCESS! Worker pipeline is functional!")
            print(f"   Anthropic API is working correctly")
            print(f"   Summaries are being generated and saved")
        else:
            print("\n❌ FAILED! No summaries were saved")

    await engine.dispose()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nTest interrupted")
    except Exception as e:
        print(f"\n❌ Test failed: {str(e)}")
        import traceback
        traceback.print_exc()
