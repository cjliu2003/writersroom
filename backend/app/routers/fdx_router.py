"""
FDX Router

Handles FDX file upload, parsing, and integration with the database.
"""

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Dict, Any
from uuid import UUID

from app.models.user import User
from app.models.script import Script
from app.models.scene import Scene
from app.schemas.fdx import (
    FDXUploadResponse, 
    FDXParseRequest, 
    FDXParseResponse,
    SceneDataSchema,
    ScreenplayElementSchema,
    ErrorResponse
)
from app.auth.dependencies import get_current_user
from app.db.base import get_db
from app.services.fdx_parser import FDXParser, ParsedFDXResult
from app.services.supabase_storage import storage_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/fdx", tags=["FDX"])


@router.post("/upload", response_model=FDXUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_fdx_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload and parse an FDX file, creating a new script and scenes in the database.
    """
    try:
        # Validate file type
        if not file.filename or not file.filename.lower().endswith(('.fdx', '.xml')):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File must be an FDX or XML file"
            )
        
        # Read file content
        file_content = await file.read()
        file_content_str = file_content.decode('utf-8')
        
        # Parse FDX content
        logger.info(f"Parsing FDX file: {file.filename}")
        parsed_result = FDXParser.parse_fdx_content(file_content_str, file.filename)
        
        # Create new script in database
        new_script = Script(
            title=parsed_result.title,
            description=f"Imported from {file.filename}",
            owner_id=current_user.user_id
        )
        
        db.add(new_script)
        await db.flush()  # Get the script_id
        
        # Upload file to Supabase storage
        logger.info(f"Uploading file to Supabase storage")
        # Reset file position for upload
        await file.seek(0)
        file_info = await storage_service.upload_fdx_file(
            file, 
            str(current_user.user_id), 
            str(new_script.script_id)
        )
        
        # Update script with file path
        new_script.imported_fdx_path = file_info["file_path"]
        
        # Create scenes in database
        logger.info(f"Creating {len(parsed_result.scenes)} scenes in database")
        db_scenes = []
        
        for position, scene_data in enumerate(parsed_result.scenes):
            # Convert content blocks to JSON format for storage
            content_blocks_json = [
                {
                    "type": block.type.value,
                    "text": block.text,
                    "metadata": block.metadata
                }
                for block in scene_data.content_blocks
            ]
            
            db_scene = Scene(
                script_id=new_script.script_id,
                position=position,
                scene_heading=scene_data.slugline,
                content_blocks=content_blocks_json,
                summary=scene_data.summary,
                characters=scene_data.characters,
                themes=scene_data.themes,
                tokens=scene_data.tokens,
                word_count=scene_data.word_count,
                full_content=scene_data.full_content
            )
            
            db.add(db_scene)
            db_scenes.append(db_scene)
        
        # Commit all changes
        await db.commit()
        await db.refresh(new_script)
        
        # Convert scenes to response format
        scene_schemas = []
        for scene_data in parsed_result.scenes:
            content_blocks_schemas = [
                ScreenplayElementSchema(
                    type=block.type.value,
                    text=block.text,
                    metadata=block.metadata
                )
                for block in scene_data.content_blocks
            ]
            
            scene_schema = SceneDataSchema(
                slugline=scene_data.slugline,
                summary=scene_data.summary,
                tokens=scene_data.tokens,
                characters=scene_data.characters,
                themes=scene_data.themes,
                word_count=scene_data.word_count,
                full_content=scene_data.full_content,
                content_blocks=content_blocks_schemas
            )
            scene_schemas.append(scene_schema)
        
        logger.info(f"Successfully processed FDX file: {file.filename}")
        
        return FDXUploadResponse(
            success=True,
            script_id=new_script.script_id,
            title=parsed_result.title,
            scene_count=len(parsed_result.scenes),
            scenes=scene_schemas,
            file_info=file_info
        )
        
    except ValueError as e:
        logger.error(f"FDX parsing error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid FDX file: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Unexpected error during FDX upload: {str(e)}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process FDX file: {str(e)}"
        )


@router.post("/parse", response_model=FDXParseResponse)
async def parse_fdx_content(
    request: FDXParseRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Parse FDX content without creating a script (for preview/validation).
    """
    try:
        logger.info("Parsing FDX content for preview")
        parsed_result = FDXParser.parse_fdx_content(request.content, request.filename)
        
        # Convert to response schemas
        element_schemas = [
            ScreenplayElementSchema(
                type=element.type.value,
                text=element.text,
                metadata=element.metadata
            )
            for element in parsed_result.elements
        ]
        
        scene_schemas = []
        for scene_data in parsed_result.scenes:
            content_blocks_schemas = [
                ScreenplayElementSchema(
                    type=block.type.value,
                    text=block.text,
                    metadata=block.metadata
                )
                for block in scene_data.content_blocks
            ]
            
            scene_schema = SceneDataSchema(
                slugline=scene_data.slugline,
                summary=scene_data.summary,
                tokens=scene_data.tokens,
                characters=scene_data.characters,
                themes=scene_data.themes,
                word_count=scene_data.word_count,
                full_content=scene_data.full_content,
                content_blocks=content_blocks_schemas
            )
            scene_schemas.append(scene_schema)
        
        return FDXParseResponse(
            success=True,
            title=parsed_result.title,
            elements=element_schemas,
            scenes=scene_schemas,
            scene_count=len(parsed_result.scenes)
        )
        
    except ValueError as e:
        logger.error(f"FDX parsing error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid FDX content: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Unexpected error during FDX parsing: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to parse FDX content: {str(e)}"
        )


@router.get("/scripts/{script_id}/scenes", response_model=List[Dict[str, Any]])
async def get_script_scenes(
    script_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all scenes for a script (compatible with Express.js memory API format).
    """
    try:
        # Verify script access
        script_result = await db.execute(
            select(Script).where(Script.script_id == script_id, Script.owner_id == current_user.user_id)
        )
        script = script_result.scalar_one_or_none()
        
        if not script:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Script not found or access denied"
            )
        
        # Get scenes
        scenes_result = await db.execute(
            select(Scene)
            .where(Scene.script_id == script_id)
            .order_by(Scene.position)
        )
        scenes = scenes_result.scalars().all()
        
        # Convert to Express.js compatible format
        scene_data = []
        for scene in scenes:
            scene_dict = {
                "projectId": str(script_id),
                "slugline": scene.scene_heading,
                "sceneId": f"{script_id}_{scene.position}",
                "sceneIndex": scene.position,
                "characters": scene.characters or [],
                "summary": scene.summary or "",
                "tone": None,  # Could be extracted from themes
                "themeTags": scene.themes or [],
                "tokens": scene.tokens or 0,
                "timestamp": scene.created_at.isoformat() if scene.created_at else None,
                "wordCount": scene.word_count or 0,
                "fullContent": scene.full_content,
                "projectTitle": script.title
            }
            scene_data.append(scene_dict)
        
        return scene_data
        
    except Exception as e:
        logger.error(f"Error retrieving script scenes: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve scenes: {str(e)}"
        )
