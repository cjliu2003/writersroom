"""
AI Ingestion Worker

Background tasks for AI-powered script analysis and artifact generation.

Tasks:
- analyze_scene: Generate scene summary and embedding for a single scene
- analyze_script_partial: Partial ingestion (scene cards + embeddings)
- analyze_script_full: Full analysis (scene cards + outline + character sheets + embeddings)
- refresh_outline: Regenerate stale script outline
- refresh_character_sheet: Regenerate stale character sheet

Usage with RQ:
    from redis import Redis
    from rq import Queue
    from app.tasks.ai_ingestion_worker import analyze_script_full

    redis_conn = Redis.from_url(settings.REDIS_URL)
    queue = Queue('ai_ingestion', connection=redis_conn)

    job = queue.enqueue(analyze_script_full, script_id=str(script_id))
"""

import asyncio
import logging
import traceback
from uuid import UUID
from typing import Optional

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.services.script_state_service import ScriptStateService
from app.services.ingestion_service import IngestionService
from app.services.embedding_service import EmbeddingService
from app.services.ai_scene_service import AISceneService
from app.services.narrative_analysis_service import NarrativeAnalysisService

# Import all models explicitly to ensure they're registered with SQLAlchemy's mapper registry
# This prevents "failed to locate a name" errors when resolving model relationships in background workers
from app.models import (
    Script, ScriptVersion, Scene, SceneVersion, User, ScriptCollaborator,
    SceneSummary, ScriptOutline, CharacterSheet, SceneCharacter,
    SceneEmbedding, ScriptState
)

logger = logging.getLogger(__name__)


# Create async engine for background jobs
engine = create_async_engine(
    settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://"),
    echo=False,
    pool_pre_ping=True
)

AsyncSessionLocal = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)


def analyze_scene(scene_id: str) -> dict:
    """
    Generate scene summary and embedding for a single scene.

    Args:
        scene_id: Scene ID (string UUID)

    Returns:
        Dict with success status and details
    """
    return asyncio.run(_analyze_scene_async(UUID(scene_id)))


async def _analyze_scene_async(scene_id: UUID) -> dict:
    """
    Async implementation of scene analysis.
    """
    async with AsyncSessionLocal() as db:
        try:
            logger.info(f"Starting scene analysis for {scene_id}")

            ingestion_service = IngestionService(db)
            embedding_service = EmbeddingService(db)

            # Get scene
            from sqlalchemy import select
            from app.models.scene import Scene

            result = await db.execute(
                select(Scene).where(Scene.scene_id == scene_id)
            )
            scene = result.scalar_one_or_none()

            if not scene:
                logger.error(f"Scene {scene_id} not found")
                return {"success": False, "error": "Scene not found"}

            # Generate scene summary
            summary = await ingestion_service.generate_scene_summary(scene, force_regenerate=True)

            # Generate embedding
            embedding = await embedding_service.embed_scene_summary(summary, force_regenerate=True)

            logger.info(f"Scene analysis complete for {scene_id}")

            return {
                "success": True,
                "scene_id": str(scene_id),
                "summary_tokens": summary.tokens_estimate,
                "embedding_dimensions": len(embedding.embedding)
            }

        except Exception as e:
            logger.error(f"Error analyzing scene {scene_id}: {str(e)}")
            return {"success": False, "error": str(e)}


def analyze_script_partial(script_id: str) -> dict:
    """
    Partial ingestion: scene cards + embeddings.

    Args:
        script_id: Script ID (string UUID)

    Returns:
        Dict with success status and details
    """
    return asyncio.run(_analyze_script_partial_async(UUID(script_id)))


async def _analyze_script_partial_async(script_id: UUID) -> dict:
    """
    Async implementation of partial script analysis.
    """
    async with AsyncSessionLocal() as db:
        try:
            logger.info(f"Starting partial analysis for script {script_id}")

            state_service = ScriptStateService(db)

            # Trigger partial ingestion
            await state_service.trigger_partial_ingestion(script_id)

            logger.info(f"Partial analysis complete for script {script_id}")

            return {
                "success": True,
                "script_id": str(script_id),
                "analysis_type": "partial"
            }

        except Exception as e:
            logger.error(f"Error in partial analysis for script {script_id}: {str(e)}")
            logger.error("Full traceback:")
            logger.error(traceback.format_exc())
            return {"success": False, "error": str(e)}


def analyze_script_full(script_id: str) -> dict:
    """
    Full analysis: scene cards + outline + character sheets + embeddings.

    Args:
        script_id: Script ID (string UUID)

    Returns:
        Dict with success status and details
    """
    return asyncio.run(_analyze_script_full_async(UUID(script_id)))


async def _analyze_script_full_async(script_id: UUID) -> dict:
    """
    Async implementation of full script analysis.
    """
    async with AsyncSessionLocal() as db:
        try:
            logger.info(f"Starting full analysis for script {script_id}")

            state_service = ScriptStateService(db)

            # Trigger full analysis
            await state_service.trigger_full_analysis(script_id)

            logger.info(f"Full analysis complete for script {script_id}")

            return {
                "success": True,
                "script_id": str(script_id),
                "analysis_type": "full"
            }

        except Exception as e:
            logger.error(f"Error in full analysis for script {script_id}: {str(e)}")
            return {"success": False, "error": str(e)}


def refresh_outline(script_id: str) -> dict:
    """
    Regenerate script outline if stale.

    Args:
        script_id: Script ID (string UUID)

    Returns:
        Dict with success status and details
    """
    return asyncio.run(_refresh_outline_async(UUID(script_id)))


async def _refresh_outline_async(script_id: UUID) -> dict:
    """
    Async implementation of outline refresh.
    """
    async with AsyncSessionLocal() as db:
        try:
            logger.info(f"Refreshing outline for script {script_id}")

            ingestion_service = IngestionService(db)

            # Regenerate outline
            outline = await ingestion_service.generate_script_outline(
                script_id,
                force_regenerate=True
            )

            logger.info(f"Outline refresh complete for script {script_id}")

            return {
                "success": True,
                "script_id": str(script_id),
                "tokens": outline.tokens_estimate,
                "version": outline.version
            }

        except Exception as e:
            logger.error(f"Error refreshing outline for script {script_id}: {str(e)}")
            return {"success": False, "error": str(e)}


def refresh_character_sheet(script_id: str, character_name: str) -> dict:
    """
    Regenerate character sheet if stale.

    Args:
        script_id: Script ID (string UUID)
        character_name: Character name

    Returns:
        Dict with success status and details
    """
    return asyncio.run(_refresh_character_sheet_async(UUID(script_id), character_name))


async def _refresh_character_sheet_async(script_id: UUID, character_name: str) -> dict:
    """
    Async implementation of character sheet refresh.
    """
    async with AsyncSessionLocal() as db:
        try:
            logger.info(f"Refreshing character sheet for {character_name} in script {script_id}")

            ingestion_service = IngestionService(db)

            # Regenerate character sheet
            sheet = await ingestion_service.generate_character_sheet(
                script_id,
                character_name,
                force_regenerate=True
            )

            logger.info(f"Character sheet refresh complete for {character_name}")

            return {
                "success": True,
                "script_id": str(script_id),
                "character_name": character_name,
                "tokens": sheet.tokens_estimate
            }

        except Exception as e:
            logger.error(f"Error refreshing character sheet for {character_name}: {str(e)}")
            return {"success": False, "error": str(e)}


def refresh_narrative_analysis(script_id: str) -> dict:
    """
    Regenerate plot threads and scene relationships.

    Args:
        script_id: Script ID (string UUID)

    Returns:
        Dict with success status and counts
    """
    return asyncio.run(_refresh_narrative_analysis_async(UUID(script_id)))


async def _refresh_narrative_analysis_async(script_id: UUID) -> dict:
    """
    Async implementation of narrative analysis refresh.
    """
    async with AsyncSessionLocal() as db:
        try:
            logger.info(f"Refreshing narrative analysis for script {script_id}")

            narrative_service = NarrativeAnalysisService(db)
            result = await narrative_service.batch_analyze_narrative(
                script_id,
                force_regenerate=True
            )

            logger.info(f"Narrative analysis refresh complete for script {script_id}")

            return {
                "success": True,
                "script_id": str(script_id),
                **result
            }

        except Exception as e:
            logger.error(f"Error refreshing narrative analysis for script {script_id}: {str(e)}")
            return {"success": False, "error": str(e)}


def check_state_transitions() -> dict:
    """
    Check all scripts for state transitions and trigger analysis if needed.

    This can be run periodically (e.g., every hour) to automatically
    detect scripts that have crossed thresholds.

    Returns:
        Dict with transition statistics
    """
    return asyncio.run(_check_state_transitions_async())


async def _check_state_transitions_async() -> dict:
    """
    Async implementation of state transition check.
    """
    async with AsyncSessionLocal() as db:
        try:
            logger.info("Checking for script state transitions")

            from sqlalchemy import select
            from app.models.script import Script

            # Get all scripts not in ANALYZED state
            result = await db.execute(
                select(Script).where(
                    Script.state.in_([ScriptState.EMPTY.value, ScriptState.PARTIAL.value])
                )
            )
            scripts = result.scalars().all()

            state_service = ScriptStateService(db)
            transitions = []

            for script in scripts:
                new_state = await state_service.check_state_transition(script)

                if new_state:
                    await state_service.transition_script_state(
                        script,
                        new_state,
                        user_initiated=False
                    )
                    transitions.append({
                        "script_id": str(script.script_id),
                        "old_state": script.state,
                        "new_state": new_state.value
                    })

            logger.info(f"State transition check complete: {len(transitions)} transitions")

            return {
                "success": True,
                "transitions_count": len(transitions),
                "transitions": transitions
            }

        except Exception as e:
            logger.error(f"Error checking state transitions: {str(e)}")
            return {"success": False, "error": str(e)}
