"""
AI Ingestion Router - Endpoints for script analysis and artifact generation
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.models.user import User
from app.models.script import Script
from app.models.script_state import ScriptState
from app.schemas.ai import (
    AnalyzeScriptRequest,
    AnalyzeScriptResponse,
    RefreshArtifactRequest,
    RefreshArtifactResponse,
    ScriptState as ScriptStateEnum
)
from app.services.script_state_service import ScriptStateService
from app.services.ingestion_service import IngestionService
from app.auth.dependencies import get_current_user
from app.db.base import get_db
from app.routers.script_router import get_script_if_user_has_access

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai/ingestion", tags=["AI Ingestion"])


@router.post("/analyze-script", response_model=AnalyzeScriptResponse)
async def analyze_script(
    request: AnalyzeScriptRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Trigger script analysis and artifact generation.

    This endpoint will:
    1. Check current script state
    2. Determine if analysis is needed
    3. Queue background job for analysis
    4. Return immediate response with job status

    Analysis is performed asynchronously to avoid blocking the request.
    """
    try:
        # Verify user has access to the script
        script = await get_script_if_user_has_access(
            request.script_id,
            user,
            db,
            allow_viewer=False  # Need editor permissions to trigger analysis
        )

        state_service = ScriptStateService(db)

        # Check if force reanalysis requested
        if request.force_full_analysis:
            logger.info(f"Force reanalysis requested for script {script.script_id}")

            # Queue background job
            try:
                from redis import Redis
                from rq import Queue
                from app.core.config import settings
                from app.tasks.ai_ingestion_worker import analyze_script_full

                redis_conn = Redis.from_url(settings.REDIS_URL)
                queue = Queue('ai_ingestion', connection=redis_conn)

                job = queue.enqueue(
                    analyze_script_full,
                    str(script.script_id),
                    job_timeout='30m'
                )

                return AnalyzeScriptResponse(
                    script_id=script.script_id,
                    state=ScriptStateEnum.ANALYZED,
                    scenes_analyzed=0,
                    outline_generated=False,
                    character_sheets_generated=0,
                    tokens_used=0,
                    job_id=job.id,
                    status="queued"
                )

            except Exception as e:
                logger.error(f"Failed to queue background job: {str(e)}")
                # Fall back to synchronous analysis
                logger.info("Falling back to synchronous analysis")
                await state_service.force_reanalysis(script.script_id)

                return AnalyzeScriptResponse(
                    script_id=script.script_id,
                    state=ScriptStateEnum.ANALYZED,
                    scenes_analyzed=await state_service.count_scenes(script.script_id),
                    outline_generated=True,
                    character_sheets_generated=0,  # Would need to query
                    tokens_used=0,  # Would need to track
                    status="completed"
                )

        # Check if automatic state transition is needed
        new_state = await state_service.check_state_transition(script)

        if new_state:
            logger.info(f"Script {script.script_id} needs transition to {new_state.value}")

            # Queue background job
            try:
                from redis import Redis
                from rq import Queue
                from app.core.config import settings
                from app.tasks.ai_ingestion_worker import (
                    analyze_script_partial,
                    analyze_script_full
                )

                redis_conn = Redis.from_url(settings.REDIS_URL)
                queue = Queue('ai_ingestion', connection=redis_conn)

                if new_state == ScriptState.PARTIAL:
                    job = queue.enqueue(
                        analyze_script_partial,
                        str(script.script_id),
                        job_timeout='15m'
                    )
                else:  # ANALYZED
                    job = queue.enqueue(
                        analyze_script_full,
                        str(script.script_id),
                        job_timeout='30m'
                    )

                return AnalyzeScriptResponse(
                    script_id=script.script_id,
                    state=new_state,
                    scenes_analyzed=0,
                    outline_generated=False,
                    character_sheets_generated=0,
                    tokens_used=0,
                    job_id=job.id,
                    status="queued"
                )

            except Exception as e:
                logger.error(f"Failed to queue background job: {str(e)}")
                # Fall back to synchronous analysis
                logger.info("Falling back to synchronous transition")
                await state_service.transition_script_state(script, new_state)

                return AnalyzeScriptResponse(
                    script_id=script.script_id,
                    state=new_state,
                    scenes_analyzed=await state_service.count_scenes(script.script_id),
                    outline_generated=new_state == ScriptState.ANALYZED,
                    character_sheets_generated=0,
                    tokens_used=0,
                    status="completed"
                )

        else:
            # No transition needed
            return AnalyzeScriptResponse(
                script_id=script.script_id,
                state=ScriptStateEnum(script.state),
                scenes_analyzed=await state_service.count_scenes(script.script_id),
                outline_generated=script.state == ScriptState.ANALYZED.value,
                character_sheets_generated=0,
                tokens_used=0,
                status="up_to_date"
            )

    except Exception as e:
        logger.error(f"Error analyzing script: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error analyzing script: {str(e)}"
        )


@router.get("/analysis-status/{script_id}")
async def get_analysis_status(
    script_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get current analysis status for a script.

    Returns:
    - Current state
    - Number of scenes analyzed
    - Whether outline exists
    - Number of character sheets
    - Staleness indicators
    """
    try:
        # Verify user has access
        script = await get_script_if_user_has_access(
            script_id,
            user,
            db,
            allow_viewer=True
        )

        state_service = ScriptStateService(db)

        # Get counts
        scene_count = await state_service.count_scenes(script_id)

        # Check if outline exists
        from app.models.script_outline import ScriptOutline
        outline_result = await db.execute(
            select(ScriptOutline).where(ScriptOutline.script_id == script_id)
        )
        outline = outline_result.scalar_one_or_none()

        # Check character sheets
        from app.models.character_sheet import CharacterSheet
        sheets_result = await db.execute(
            select(CharacterSheet).where(CharacterSheet.script_id == script_id)
        )
        sheets = sheets_result.scalars().all()

        return {
            "script_id": str(script_id),
            "state": script.state,
            "scene_count": scene_count,
            "outline": {
                "exists": outline is not None,
                "is_stale": outline.is_stale if outline else None,
                "dirty_scene_count": outline.dirty_scene_count if outline else None
            } if outline else None,
            "character_sheets": {
                "count": len(sheets),
                "characters": [
                    {
                        "name": sheet.character_name,
                        "is_stale": sheet.is_stale,
                        "dirty_scene_count": sheet.dirty_scene_count
                    }
                    for sheet in sheets
                ]
            }
        }

    except Exception as e:
        logger.error(f"Error getting analysis status: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error getting analysis status: {str(e)}"
        )


@router.post("/refresh-artifacts", response_model=RefreshArtifactResponse)
async def refresh_artifacts(
    request: RefreshArtifactRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Refresh stale artifacts (outline or character sheets).

    This endpoint regenerates artifacts that have become stale due to
    scene changes exceeding the staleness threshold.
    """
    try:
        # Verify user has access
        script = await get_script_if_user_has_access(
            request.script_id,
            user,
            db,
            allow_viewer=False
        )

        ingestion_service = IngestionService(db)
        refreshed = []
        total_tokens = 0

        if request.artifact_type == "outline":
            # Refresh outline
            logger.info(f"Refreshing outline for script {request.script_id}")
            outline = await ingestion_service.generate_script_outline(
                request.script_id,
                force_regenerate=True
            )
            refreshed.append("outline")
            total_tokens += outline.tokens_estimate

        elif request.artifact_type == "character_sheet":
            if not request.character_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="character_name required for character_sheet refresh"
                )

            # Refresh specific character sheet
            logger.info(f"Refreshing character sheet for {request.character_name}")
            sheet = await ingestion_service.generate_character_sheet(
                request.script_id,
                request.character_name,
                force_regenerate=True
            )
            refreshed.append(f"character_sheet:{request.character_name}")
            total_tokens += sheet.tokens_estimate

        elif request.artifact_type == "all":
            # Refresh all stale artifacts
            logger.info(f"Refreshing all stale artifacts for script {request.script_id}")

            # Check and refresh outline
            from app.models.script_outline import ScriptOutline
            outline_result = await db.execute(
                select(ScriptOutline)
                .where(ScriptOutline.script_id == request.script_id)
                .where(ScriptOutline.is_stale == True)
            )
            stale_outline = outline_result.scalar_one_or_none()

            if stale_outline:
                outline = await ingestion_service.generate_script_outline(
                    request.script_id,
                    force_regenerate=True
                )
                refreshed.append("outline")
                total_tokens += outline.tokens_estimate

            # Check and refresh character sheets
            from app.models.character_sheet import CharacterSheet
            sheets_result = await db.execute(
                select(CharacterSheet)
                .where(CharacterSheet.script_id == request.script_id)
                .where(CharacterSheet.is_stale == True)
            )
            stale_sheets = sheets_result.scalars().all()

            for sheet in stale_sheets:
                refreshed_sheet = await ingestion_service.generate_character_sheet(
                    request.script_id,
                    sheet.character_name,
                    force_regenerate=True
                )
                refreshed.append(f"character_sheet:{sheet.character_name}")
                total_tokens += refreshed_sheet.tokens_estimate

        return RefreshArtifactResponse(
            script_id=request.script_id,
            artifacts_refreshed=refreshed,
            tokens_used=total_tokens
        )

    except Exception as e:
        logger.error(f"Error refreshing artifacts: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error refreshing artifacts: {str(e)}"
        )
