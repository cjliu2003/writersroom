"""
Background Refresh Jobs

RQ jobs for refreshing AI artifacts (outlines, character sheets, scene summaries).
These jobs run asynchronously to keep artifacts fresh without blocking user requests.

Jobs:
- refresh_script_outline: Regenerate script outline when 5+ scenes changed
- refresh_character_sheet: Regenerate character sheet when 3+ scenes with character changed
- refresh_scene_summary: Regenerate scene summary after edit (detects semantic changes)

Usage:
    from app.workers import queue_low
    queue_low.enqueue('refresh_script_outline', script_id, job_timeout='5m')
"""

import asyncio
from uuid import UUID
from datetime import datetime
from rq import get_current_job
from sqlalchemy import select, update

from app.db.base import async_session_maker
from app.models.script_outline import ScriptOutline
from app.models.character_sheet import CharacterSheet
from app.models.scene import Scene
from app.models.scene_summary import SceneSummary
from app.models.scene_embedding import SceneEmbedding
from app.services.ingestion_service import IngestionService
from app.services.embedding_service import EmbeddingService
from app.services.staleness_service import StalenessService


def refresh_script_outline(script_id: str):
    """
    Background job to refresh script outline.

    Triggered when outline is stale and user requests global context.

    Args:
        script_id: Script UUID as string

    Returns:
        dict: {"status": "success", "script_id": str}
    """
    job = get_current_job()

    async def _refresh():
        async with async_session_maker() as db:
            ingestion_service = IngestionService(db=db)
            staleness_service = StalenessService(db=db)

            # Regenerate outline
            outline = await ingestion_service.generate_script_outline(UUID(script_id))

            # Save to database
            await db.execute(
                update(ScriptOutline)
                .where(ScriptOutline.script_id == UUID(script_id))
                .values(
                    summary_text=outline.summary_text,
                    tokens_estimate=outline.tokens_estimate,
                    version=ScriptOutline.version + 1,
                    is_stale=False,
                    dirty_scene_count=0,
                    last_generated_at=datetime.utcnow()
                )
            )

            await db.commit()

            return {"status": "success", "script_id": script_id}

    # Run async function in event loop
    return asyncio.run(_refresh())


def refresh_character_sheet(script_id: str, character_name: str):
    """
    Background job to refresh character sheet.

    Triggered when character sheet is stale (3+ scenes with character changed).

    Args:
        script_id: Script UUID as string
        character_name: Character name

    Returns:
        dict: {"status": "success", "character": str}
    """
    async def _refresh():
        async with async_session_maker() as db:
            ingestion_service = IngestionService(db=db)
            staleness_service = StalenessService(db=db)

            # Regenerate character sheet
            sheet = await ingestion_service.generate_character_sheet(
                script_id=UUID(script_id),
                character_name=character_name
            )

            # Update database
            await db.execute(
                update(CharacterSheet)
                .where(
                    CharacterSheet.script_id == UUID(script_id),
                    CharacterSheet.character_name == character_name
                )
                .values(
                    summary_text=sheet.summary_text,
                    tokens_estimate=sheet.tokens_estimate,
                    is_stale=False,
                    dirty_scene_count=0,
                    last_generated_at=datetime.utcnow()
                )
            )

            await db.commit()

            return {"status": "success", "character": character_name}

    return asyncio.run(_refresh())


def refresh_scene_summary(scene_id: str):
    """
    Background job to refresh scene summary after edit.

    Regenerates scene summary and re-embeds if semantic changes detected.

    Args:
        scene_id: Scene UUID as string

    Returns:
        dict: {"status": "success", "reembedded": bool}
    """
    async def _refresh():
        async with async_session_maker() as db:
            scene = await db.get(Scene, UUID(scene_id))

            if not scene:
                return {"status": "error", "message": "Scene not found"}

            ingestion_service = IngestionService(db=db)
            embedding_service = EmbeddingService(db=db)

            # Regenerate scene summary
            new_summary = await ingestion_service.generate_scene_summary(scene)

            # Check if we need to re-embed using hash-based change detection
            should_reembed = await embedding_service.should_reembed(scene)

            # Get existing summary to update it
            old_summary = await db.scalar(
                select(SceneSummary)
                .where(SceneSummary.scene_id == UUID(scene_id))
            )

            # Update summary
            if old_summary:
                old_summary.summary_text = new_summary.summary_text
                old_summary.tokens_estimate = new_summary.tokens_estimate
                old_summary.version += 1
                old_summary.last_generated_at = datetime.utcnow()
            else:
                db.add(new_summary)

            # Re-embed if needed
            if should_reembed:
                embedding_vector = await embedding_service.generate_scene_embedding(
                    new_summary.summary_text
                )

                # Update or create embedding
                scene_embedding = await db.scalar(
                    select(SceneEmbedding)
                    .where(SceneEmbedding.scene_id == UUID(scene_id))
                )

                if scene_embedding:
                    scene_embedding.embedding_vector = embedding_vector
                    scene_embedding.last_generated_at = datetime.utcnow()
                else:
                    scene_embedding = SceneEmbedding(
                        scene_id=UUID(scene_id),
                        embedding_vector=embedding_vector,
                        model_name="text-embedding-3-small"
                    )
                    db.add(scene_embedding)

            await db.commit()

            return {
                "status": "success",
                "reembedded": should_reembed
            }

    return asyncio.run(_refresh())
