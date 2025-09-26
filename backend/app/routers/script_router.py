"""
Script management endpoints for the WritersRoom API
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from typing import List, Dict, Any

from uuid import UUID

from app.models.user import User
from app.models.script import Script
from app.models.scene import Scene
from app.models.script_collaborator import ScriptCollaborator, CollaboratorRole
from app.schemas.script import ScriptCreate, ScriptUpdate, ScriptResponse
from app.auth.dependencies import get_current_user
from app.db.base import get_db

router = APIRouter(prefix="/scripts", tags=["Scripts"])


async def get_script_if_user_has_access(
    script_id: UUID, 
    user: User,
    db: AsyncSession,
    allow_viewer: bool = True
) -> Script:
    """
    Helper function to get a script if the user has access to it.
    
    Args:
        script_id: UUID of the script to retrieve
        user: Current authenticated user
        db: Database session
        allow_viewer: Whether to allow users with VIEWER role
        
    Returns:
        Script object if user has access
        
    Raises:
        HTTPException: 404 if script not found or 403 if user doesn't have access
    """
    # First, try to find the script
    script_result = await db.execute(select(Script).where(Script.script_id == script_id))
    script = script_result.scalar_one_or_none()
    
    if not script:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Script with ID {script_id} not found"
        )
    
    # Check if user is the owner
    if script.owner_id == user.user_id:
        return script
        
    # Check if user is a collaborator with sufficient permissions
    collab_query = select(ScriptCollaborator).where(
        ScriptCollaborator.script_id == script_id,
        ScriptCollaborator.user_id == user.user_id
    )
    
    if not allow_viewer:
        # If viewers are not allowed, require EDITOR or OWNER role
        collab_query = collab_query.where(
            ScriptCollaborator.role.in_([CollaboratorRole.EDITOR, CollaboratorRole.OWNER])
        )
        
    collab_result = await db.execute(collab_query)
    collaborator = collab_result.scalar_one_or_none()
    
    if not collaborator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this script"
        )
        
    return script


@router.post("/", response_model=ScriptResponse, status_code=status.HTTP_201_CREATED)
async def create_script(
    script_data: ScriptCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new script.
    
    Requires authentication. The authenticated user will become the owner of the script.
    """
    # Create new script object
    new_script = Script(
        title=script_data.title,
        description=script_data.description,
        owner_id=current_user.user_id
    )
    
    # Add to database and commit
    db.add(new_script)
    await db.commit()
    await db.refresh(new_script)
    
    return new_script


@router.get("/{script_id}", response_model=ScriptResponse)
async def get_script(
    script_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get a script by ID.
    
    Requires authentication and access to the script (owner or collaborator).
    """
    script = await get_script_if_user_has_access(script_id, current_user, db)
    return script


@router.patch("/{script_id}", response_model=ScriptResponse)
async def update_script(
    script_id: UUID,
    script_update: ScriptUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Update a script.
    
    Requires authentication and edit access to the script (owner or editor).
    """
    # Get script if user has edit access (not just viewer)
    script = await get_script_if_user_has_access(
        script_id, 
        current_user, 
        db, 
        allow_viewer=False
    )
    
    # Create update data dictionary with non-None fields
    update_data = {k: v for k, v in script_update.model_dump().items() if v is not None}
    
    if not update_data:
        # No fields to update, return the script as is
        return script
        
    # Update script
    query = (
        update(Script)
        .where(Script.script_id == script_id)
        .values(**update_data)
        .returning(Script)
    )
    
    result = await db.execute(query)
    updated_script = result.scalar_one()
    await db.commit()
    
    return updated_script



@router.get("/{script_id}/scenes", response_model=List[Dict[str, Any]])
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
                "projectTitle": script.title, 
                "contentBlocks": scene.content_blocks,
            }
            scene_data.append(scene_dict)
        
        return scene_data
        
    except Exception as e:
        print(f"Error retrieving script scenes: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve scenes: {str(e)}"
        )