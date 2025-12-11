#!/usr/bin/env python3
"""
Comprehensive Workflow Test - Tests all job workflow components functionally
Tests services and job functions directly without using RQ worker queue
"""

import os
from dotenv import load_dotenv
load_dotenv()

import asyncio
from uuid import UUID
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

# Import all services
from app.models.scene import Scene
from app.models.scene_summary import SceneSummary
from app.models.scene_embedding import SceneEmbedding
from app.models.script_outline import ScriptOutline
from app.models.character_sheet import CharacterSheet
from app.models.scene_character import SceneCharacter
from app.services.ingestion_service import IngestionService
from app.services.embedding_service import EmbeddingService

# Import job functions
from app.workers.refresh_jobs import (
    refresh_script_outline,
    refresh_character_sheet,
    refresh_scene_summary
)

SCRIPT_ID = UUID('05006f9d-2c40-4ffc-a041-f0c3ac62a4ed')

# Database connection
db_url = f"postgresql+asyncpg://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}"

# Test tracking
test_results = []

def log_test(name, status, details=""):
    test_results.append({"name": name, "status": status, "details": details})
    symbol = "✓" if status == "PASS" else "❌"
    print(f"   {symbol} {name}")
    if details:
        print(f"      {details}")


async def main():
    """Run comprehensive workflow tests."""
    print("=" * 70)
    print("COMPREHENSIVE WORKFLOW TEST")
    print("=" * 70)

    engine = create_async_engine(db_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        # ================================================================
        # PHASE 1: INGESTION SERVICE TESTS
        # ================================================================
        print("\n[PHASE 1] INGESTION SERVICE TESTS")
        print("=" * 70)

        ingestion_service = IngestionService(db)

        # Get test scenes
        scenes_result = await db.execute(
            select(Scene).where(Scene.script_id == SCRIPT_ID).limit(5)
        )
        test_scenes = scenes_result.scalars().all()

        if not test_scenes:
            print("   ❌ CRITICAL: No scenes found in database")
            return

        print(f"\n[1.1] Testing with {len(test_scenes)} scenes")

        # Test 1.1: Generate single scene summary
        print("\n[1.2] generate_scene_summary()")
        try:
            summary = await ingestion_service.generate_scene_summary(
                test_scenes[0],
                force_regenerate=True
            )
            log_test(
                "generate_scene_summary",
                "PASS",
                f"Generated {summary.tokens_estimate} tokens"
            )
        except Exception as e:
            log_test("generate_scene_summary", "FAIL", str(e))

        # Test 1.2: Batch generate scene summaries
        print("\n[1.3] batch_generate_scene_summaries()")
        try:
            summaries = await ingestion_service.batch_generate_scene_summaries(
                SCRIPT_ID,
                progress_callback=lambda c, t: print(f"      Progress: {c}/{t}")
            )
            log_test(
                "batch_generate_scene_summaries",
                "PASS",
                f"Generated {len(summaries)} summaries"
            )
        except Exception as e:
            log_test("batch_generate_scene_summaries", "FAIL", str(e))

        # Test 1.3: Generate script outline
        print("\n[1.4] generate_script_outline()")
        try:
            outline = await ingestion_service.generate_script_outline(SCRIPT_ID)
            log_test(
                "generate_script_outline",
                "PASS",
                f"Generated outline ({outline.tokens_estimate} tokens, version {outline.version})"
            )
        except Exception as e:
            log_test("generate_script_outline", "FAIL", str(e))

        # Test 1.4: Get characters
        print("\n[1.5] Finding characters for character sheet tests...")
        chars_result = await db.execute(
            select(SceneCharacter.character_name)
            .join(Scene, SceneCharacter.scene_id == Scene.scene_id)
            .where(Scene.script_id == SCRIPT_ID)
            .distinct()
            .limit(3)
        )
        test_characters = [row[0] for row in chars_result]

        if test_characters:
            print(f"      Found {len(test_characters)} characters: {', '.join(test_characters)}")

            # Test 1.5: Generate character sheet
            print("\n[1.6] generate_character_sheet()")
            try:
                sheet = await ingestion_service.generate_character_sheet(
                    SCRIPT_ID,
                    test_characters[0]
                )
                log_test(
                    "generate_character_sheet",
                    "PASS",
                    f"Generated sheet for {test_characters[0]} ({sheet.tokens_estimate} tokens)"
                )
            except Exception as e:
                log_test("generate_character_sheet", "FAIL", str(e))

            # Test 1.6: Batch generate character sheets
            print("\n[1.7] batch_generate_character_sheets()")
            try:
                sheets = await ingestion_service.batch_generate_character_sheets(
                    SCRIPT_ID,
                    progress_callback=lambda c, t: print(f"      Progress: {c}/{t}")
                )
                log_test(
                    "batch_generate_character_sheets",
                    "PASS",
                    f"Generated {len(sheets)} character sheets"
                )
            except Exception as e:
                log_test("batch_generate_character_sheets", "FAIL", str(e))
        else:
            print("      ⚠️  No characters found - skipping character sheet tests")
            log_test("generate_character_sheet", "SKIP", "No characters found")
            log_test("batch_generate_character_sheets", "SKIP", "No characters found")

        # ================================================================
        # PHASE 2: EMBEDDING SERVICE TESTS
        # ================================================================
        print("\n[PHASE 2] EMBEDDING SERVICE TESTS")
        print("=" * 70)

        embedding_service = EmbeddingService(db)

        # Test 2.1: Generate single scene embedding
        print("\n[2.1] generate_scene_embedding()")
        try:
            # Get a scene summary
            summary_result = await db.execute(
                select(SceneSummary)
                .join(Scene, SceneSummary.scene_id == Scene.scene_id)
                .where(Scene.script_id == SCRIPT_ID)
                .limit(1)
            )
            test_summary = summary_result.scalar_one_or_none()

            if test_summary:
                embedding = await embedding_service.generate_scene_embedding(
                    test_summary.summary_text
                )
                log_test(
                    "generate_scene_embedding",
                    "PASS",
                    f"Generated embedding vector (dim: {len(embedding)})"
                )
            else:
                log_test("generate_scene_embedding", "SKIP", "No summaries available")
        except Exception as e:
            log_test("generate_scene_embedding", "FAIL", str(e))

        # Test 2.2: should_reembed
        print("\n[2.2] should_reembed()")
        try:
            old_card = "**Action:** Original scene content here."
            new_card = "**Action:** Significantly different scene content here."
            should_reembed = await embedding_service.should_reembed(old_card, new_card)
            log_test(
                "should_reembed",
                "PASS",
                f"Decision: {should_reembed}"
            )
        except Exception as e:
            log_test("should_reembed", "FAIL", str(e))

        # Test 2.3: Batch generate embeddings
        print("\n[2.3] batch_generate_scene_embeddings()")
        try:
            embeddings = await embedding_service.batch_generate_scene_embeddings(
                SCRIPT_ID,
                db
            )
            log_test(
                "batch_generate_scene_embeddings",
                "PASS",
                f"Generated {len(embeddings)} embeddings"
            )
        except Exception as e:
            log_test("batch_generate_scene_embeddings", "FAIL", str(e))

        # ================================================================
        # PHASE 3: JOB FUNCTION TESTS (Direct Call)
        # ================================================================
        print("\n[PHASE 3] JOB FUNCTION TESTS (Direct Call)")
        print("=" * 70)

        # Test 3.1: refresh_script_outline job
        print("\n[3.1] refresh_script_outline()")
        try:
            result = refresh_script_outline(str(SCRIPT_ID))
            log_test(
                "refresh_script_outline",
                "PASS" if result["status"] == "success" else "FAIL",
                f"Result: {result}"
            )
        except Exception as e:
            log_test("refresh_script_outline", "FAIL", str(e))

        # Test 3.2: refresh_character_sheet job
        if test_characters:
            print("\n[3.2] refresh_character_sheet()")
            try:
                result = refresh_character_sheet(str(SCRIPT_ID), test_characters[0])
                log_test(
                    "refresh_character_sheet",
                    "PASS" if result["status"] == "success" else "FAIL",
                    f"Character: {test_characters[0]}, Result: {result}"
                )
            except Exception as e:
                log_test("refresh_character_sheet", "FAIL", str(e))
        else:
            log_test("refresh_character_sheet", "SKIP", "No characters available")

        # Test 3.3: refresh_scene_summary job
        print("\n[3.3] refresh_scene_summary()")
        try:
            result = refresh_scene_summary(str(test_scenes[0].scene_id))
            log_test(
                "refresh_scene_summary",
                "PASS" if result["status"] == "success" else "FAIL",
                f"Result: {result}"
            )
        except Exception as e:
            log_test("refresh_scene_summary", "FAIL", str(e))

        # ================================================================
        # PHASE 4: DATABASE VERIFICATION
        # ================================================================
        print("\n[PHASE 4] DATABASE VERIFICATION")
        print("=" * 70)

        # Verify summaries
        print("\n[4.1] Verifying scene summaries in database...")
        summaries_count = await db.scalar(
            select(func.count(SceneSummary.id))
            .join(Scene, SceneSummary.scene_id == Scene.scene_id)
            .where(Scene.script_id == SCRIPT_ID)
        )
        log_test(
            "scene_summaries_persisted",
            "PASS" if summaries_count > 0 else "FAIL",
            f"Found {summaries_count} summaries"
        )

        # Verify embeddings
        print("\n[4.2] Verifying scene embeddings in database...")
        embeddings_count = await db.scalar(
            select(func.count(SceneEmbedding.id))
            .join(Scene, SceneEmbedding.scene_id == Scene.scene_id)
            .where(Scene.script_id == SCRIPT_ID)
        )
        log_test(
            "scene_embeddings_persisted",
            "PASS" if embeddings_count > 0 else "FAIL",
            f"Found {embeddings_count} embeddings"
        )

        # Verify outline
        print("\n[4.3] Verifying script outline in database...")
        outline_count = await db.scalar(
            select(func.count(ScriptOutline.id))
            .where(ScriptOutline.script_id == SCRIPT_ID)
        )
        log_test(
            "script_outline_persisted",
            "PASS" if outline_count > 0 else "FAIL",
            f"Found {outline_count} outline(s)"
        )

        # Verify character sheets
        if test_characters:
            print("\n[4.4] Verifying character sheets in database...")
            sheets_count = await db.scalar(
                select(func.count(CharacterSheet.id))
                .where(CharacterSheet.script_id == SCRIPT_ID)
            )
            log_test(
                "character_sheets_persisted",
                "PASS" if sheets_count > 0 else "FAIL",
                f"Found {sheets_count} character sheet(s)"
            )
        else:
            log_test("character_sheets_persisted", "SKIP", "No characters")

    await engine.dispose()

    # ================================================================
    # FINAL SUMMARY
    # ================================================================
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)

    passed = len([r for r in test_results if r["status"] == "PASS"])
    failed = len([r for r in test_results if r["status"] == "FAIL"])
    skipped = len([r for r in test_results if r["status"] == "SKIP"])
    total = len(test_results)

    print(f"\n✓ Passed:  {passed}/{total}")
    print(f"❌ Failed:  {failed}/{total}")
    print(f"⏭  Skipped: {skipped}/{total}")

    if failed > 0:
        print("\n❌ FAILED TESTS:")
        for result in test_results:
            if result["status"] == "FAIL":
                print(f"   • {result['name']}: {result['details']}")

    print("\n" + "=" * 70)
    if failed == 0:
        print("✅ ALL TESTS PASSED! Workflow is fully functional.")
    else:
        print(f"❌ {failed} TEST(S) FAILED - Review errors above")
    print("=" * 70)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nTest interrupted")
    except Exception as e:
        print(f"\n❌ Test suite failed: {str(e)}")
        import traceback
        traceback.print_exc()
