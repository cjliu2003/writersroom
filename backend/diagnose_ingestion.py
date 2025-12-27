#!/usr/bin/env python
"""
Diagnostic script for AI ingestion job flow.

Tests:
1. Timing of each phase
2. Narrative analysis specifically
3. Database verification

Usage:
    OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES python diagnose_ingestion.py <script_id>
"""

import asyncio
import sys
import time
import logging
from uuid import UUID
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("diagnose")

# Timing decorator
def timed_section(name):
    """Context manager for timing sections."""
    class Timer:
        def __init__(self, name):
            self.name = name
            self.start = None
            self.elapsed = None

        def __enter__(self):
            self.start = time.time()
            logger.info(f"⏱️  Starting: {self.name}")
            return self

        def __exit__(self, *args):
            self.elapsed = time.time() - self.start
            logger.info(f"✅ Completed: {self.name} in {self.elapsed:.2f}s")

    return Timer(name)


async def diagnose_script(script_id: UUID):
    """Run diagnostics on a script."""

    from app.db.base import async_session_maker
    from sqlalchemy import select, func
    from app.models.scene import Scene
    from app.models.scene_summary import SceneSummary
    from app.models.script_outline import ScriptOutline
    from app.models.character_sheet import CharacterSheet
    from app.models.scene_embedding import SceneEmbedding
    from app.models.plot_thread import PlotThread
    from app.models.scene_relationship import SceneRelationship

    timings = {}

    async with async_session_maker() as db:
        # ========================================
        # 1. Check existing data
        # ========================================
        logger.info("\n" + "="*60)
        logger.info("PHASE 0: Checking existing data")
        logger.info("="*60)

        # Count scenes
        result = await db.execute(
            select(func.count()).select_from(Scene).where(Scene.script_id == script_id)
        )
        scene_count = result.scalar()
        logger.info(f"Scenes: {scene_count}")

        # Count summaries
        result = await db.execute(
            select(func.count()).select_from(SceneSummary)
            .join(Scene, SceneSummary.scene_id == Scene.scene_id)
            .where(Scene.script_id == script_id)
        )
        summary_count = result.scalar()
        logger.info(f"Scene Summaries: {summary_count}")

        # Count outline
        result = await db.execute(
            select(func.count()).select_from(ScriptOutline).where(ScriptOutline.script_id == script_id)
        )
        outline_count = result.scalar()
        logger.info(f"Script Outline: {outline_count}")

        # Count character sheets
        result = await db.execute(
            select(func.count()).select_from(CharacterSheet).where(CharacterSheet.script_id == script_id)
        )
        char_sheet_count = result.scalar()
        logger.info(f"Character Sheets: {char_sheet_count}")

        # Count embeddings
        result = await db.execute(
            select(func.count()).select_from(SceneEmbedding)
            .join(Scene, SceneEmbedding.scene_id == Scene.scene_id)
            .where(Scene.script_id == script_id)
        )
        embedding_count = result.scalar()
        logger.info(f"Scene Embeddings: {embedding_count}")

        # Count plot threads
        result = await db.execute(
            select(func.count()).select_from(PlotThread).where(PlotThread.script_id == script_id)
        )
        thread_count = result.scalar()
        logger.info(f"Plot Threads: {thread_count}")

        # Count scene relationships
        result = await db.execute(
            select(func.count()).select_from(SceneRelationship).where(SceneRelationship.script_id == script_id)
        )
        rel_count = result.scalar()
        logger.info(f"Scene Relationships: {rel_count}")

        # ========================================
        # 2. Test Narrative Analysis Specifically
        # ========================================
        if summary_count > 0:
            logger.info("\n" + "="*60)
            logger.info("PHASE 1: Testing Narrative Analysis")
            logger.info("="*60)

            from app.services.narrative_analysis_service import NarrativeAnalysisService

            with timed_section("Narrative Analysis") as t:
                try:
                    service = NarrativeAnalysisService(db)

                    # Step 1: Fetch scene summaries
                    with timed_section("  1. Fetch scene summaries"):
                        scenes, summaries = await service._fetch_scene_summaries(script_id)
                        logger.info(f"     Found {len(scenes)} scenes, {len(summaries)} summaries")

                    # Step 2: Build context
                    with timed_section("  2. Build scene context"):
                        context = service._build_scene_context(scenes, summaries)
                        logger.info(f"     Context length: {len(context)} chars")

                    # Step 3: Call Claude API
                    with timed_section("  3. Call Claude API"):
                        response = await service._call_narrative_analysis(context, len(scenes))
                        logger.info(f"     Response length: {len(response)} chars")
                        logger.info(f"     Response preview: {response[:500]}...")

                    # Step 4: Parse response
                    with timed_section("  4. Parse response"):
                        threads_data, rels_data = service._parse_combined_response(response)
                        logger.info(f"     Parsed {len(threads_data)} threads, {len(rels_data)} relationships")

                        if threads_data:
                            logger.info(f"     Sample thread: {threads_data[0]}")
                        if rels_data:
                            logger.info(f"     Sample relationship: {rels_data[0]}")

                    # Step 5: Create objects (without commit)
                    with timed_section("  5. Create plot threads"):
                        scene_map = {scene.position: scene for scene in scenes}
                        created_threads = 0
                        for data in threads_data:
                            thread = await service._create_plot_thread(script_id, data, len(scenes))
                            if thread:
                                created_threads += 1
                                logger.info(f"     Created: {thread.name} ({thread.thread_type})")
                            else:
                                logger.warning(f"     Failed to create thread from: {data}")
                        logger.info(f"     Total created: {created_threads}")

                    with timed_section("  6. Create scene relationships"):
                        created_rels = 0
                        for data in rels_data:
                            rel = await service._create_scene_relationship(script_id, data, scene_map)
                            if rel:
                                created_rels += 1
                                logger.info(f"     Created: {rel.relationship_type}")
                            else:
                                logger.warning(f"     Failed to create relationship from: {data}")
                        logger.info(f"     Total created: {created_rels}")

                    # Step 6: Commit
                    with timed_section("  7. Commit to database"):
                        await db.commit()
                        logger.info("     Committed successfully")

                    # Verify
                    with timed_section("  8. Verify in database"):
                        result = await db.execute(
                            select(func.count()).select_from(PlotThread).where(PlotThread.script_id == script_id)
                        )
                        final_threads = result.scalar()

                        result = await db.execute(
                            select(func.count()).select_from(SceneRelationship).where(SceneRelationship.script_id == script_id)
                        )
                        final_rels = result.scalar()

                        logger.info(f"     Final plot threads in DB: {final_threads}")
                        logger.info(f"     Final scene relationships in DB: {final_rels}")

                except Exception as e:
                    logger.error(f"Narrative analysis failed: {e}", exc_info=True)
                    await db.rollback()

            timings["narrative_analysis"] = t.elapsed

        else:
            logger.warning("No scene summaries found - cannot test narrative analysis")
            logger.warning("Run scene summary generation first")

        # ========================================
        # Summary
        # ========================================
        logger.info("\n" + "="*60)
        logger.info("SUMMARY")
        logger.info("="*60)

        for name, elapsed in timings.items():
            logger.info(f"{name}: {elapsed:.2f}s")


async def main():
    if len(sys.argv) < 2:
        print("Usage: python diagnose_ingestion.py <script_id>")
        print("Example: python diagnose_ingestion.py 42251273-cc29-4cb4-a6cd-b2f813e57a7f")
        sys.exit(1)

    script_id = UUID(sys.argv[1])
    logger.info(f"Diagnosing script: {script_id}")

    await diagnose_script(script_id)


if __name__ == "__main__":
    asyncio.run(main())
