"""
AI-powered features endpoints for the WritersRoom API
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import attributes
from typing import List
from uuid import UUID
from datetime import datetime, timezone

from app.models.user import User
from app.models.script import Script
from app.models.scene import Scene
from app.schemas.ai import (
    SceneSummaryRequest, 
    SceneSummaryResponse,
    ChatRequest,
    ChatResponse,
    ChatMessage,
    AIErrorResponse
)
from app.services.openai_service import openai_service
from app.auth.dependencies import get_current_user
from app.db.base import get_db
from app.routers.script_router import get_script_if_user_has_access

router = APIRouter(prefix="/ai", tags=["AI"])


@router.post("/scene-summary", response_model=SceneSummaryResponse)
async def generate_scene_summary(
    request: SceneSummaryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Generate an AI-powered summary for a specific scene.
    """
    try:
        # Verify user has access to the script
        script = await get_script_if_user_has_access(
            request.script_id, 
            user, 
            db, 
            allow_viewer=True
        )
        
        # Generate summary using OpenAI
        summary = await openai_service.generate_scene_summary(
            slugline=request.slugline,
            scene_content=request.scene_text
        )
        print(f"\n🔍 [AI Summary Debug] Generated summary for '{request.slugline}'")
        print(f"   Summary length: {len(summary)} chars")
        print(f"   Script ID: {script.script_id}")
        print(f"   Script has content_blocks: {script.content_blocks is not None}")

        # Determine editor mode based on content_blocks (same logic as GET /content)
        # If script.content_blocks exists → script-level editor (save to script.scene_summaries)
        # If script.content_blocks is null → scene-level editor (save to scene.summary)
        if script.content_blocks is not None:
            # Script-level editor: save to script.scene_summaries
            print(f"   Path: Script-level editor (content_blocks exists)")
            print(f"   Before: scene_summaries = {script.scene_summaries}")

            if script.scene_summaries is None:
                script.scene_summaries = {}
                print(f"   Initialized empty dict")

            script.scene_summaries[request.slugline] = summary
            print(f"   After mutation: scene_summaries has {len(script.scene_summaries)} entries")

            # Mark the JSONB column as modified so SQLAlchemy detects the change
            attributes.flag_modified(script, 'scene_summaries')
            print(f"   Called flag_modified on scene_summaries")

            script.updated_at = datetime.now(timezone.utc)
        else:
            # Scene-level editor: save to scene.summary
            print(f"   Path: Scene-level editor (content_blocks is null)")

            # Get the specific scene record
            scene_query = select(Scene).where(
                Scene.script_id == request.script_id,
                Scene.position == request.scene_index
            )
            result = await db.execute(scene_query)
            scene = result.scalar_one_or_none()

            if not scene:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Scene at index {request.scene_index} not found"
                )

            scene.summary = summary
            scene.updated_at = datetime.now(timezone.utc)
            print(f"   Saved to scene.summary for Scene position {scene.position}")

        print(f"   Committing to database...")
        await db.commit()
        print(f"   ✅ Commit successful!")
        
        return SceneSummaryResponse(
            success=True,
            summary=summary
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate scene summary: {str(e)}"
        )


@router.post("/chat", response_model=ChatResponse)
async def ai_chat(
    request: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Generate AI chat responses with screenplay context.
    """
    try:
        # Verify user has access to the script
        script = await get_script_if_user_has_access(
            request.script_id, 
            user, 
            db, 
            allow_viewer=True
        )
        
        scene_context = None
        
        # Load recent scenes for context if requested
        if request.include_scenes:
            scenes_query = select(Scene).where(
                Scene.script_id == request.script_id
            ).order_by(Scene.position.desc()).limit(10)
            
            result = await db.execute(scenes_query)
            recent_scenes = result.scalars().all()
            
            if recent_scenes:
                scene_summaries = []
                for scene in reversed(recent_scenes):  # Reverse to get chronological order
                    summary_text = scene.summary or "No summary available"
                    scene_summaries.append(f"Scene: {scene.scene_heading}\nSummary: {summary_text}")
                
                scene_context = "\n\n".join(scene_summaries)
        
        # Generate AI response
        assistant_content = await openai_service.generate_chat_response(
            messages=request.messages,
            scene_context=scene_context
        )
        
        # Create response message
        response_message = ChatMessage(
            role="assistant",
            content=assistant_content,
            timestamp=datetime.now(timezone.utc).isoformat()
        )
        
        return ChatResponse(
            success=True,
            message=response_message
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate chat response: {str(e)}"
        )
