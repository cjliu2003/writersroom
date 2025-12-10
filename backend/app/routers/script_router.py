"""
Script management endpoints for the WritersRoom API
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, desc, func
from typing import List, Dict, Any
import logging

from uuid import UUID

logger = logging.getLogger(__name__)

from app.models.user import User
from app.models.script import Script
from app.models.scene import Scene
from app.models.scene_version import SceneVersion
from app.models.script_version import ScriptVersion
from app.models.script_collaborator import ScriptCollaborator, CollaboratorRole
from app.schemas.script import ScriptCreate, ScriptUpdate, ScriptResponse, ScriptWithContent, AddCollaboratorRequest, CollaboratorResponse
from app.firebase.config import get_firebase_user_by_email
from app.auth.dependencies import get_current_user
from app.db.base import get_db
from app.services.yjs_persistence import YjsPersistence

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
    Get a script by ID (basic metadata only).

    Requires authentication and access to the script (owner or collaborator).
    For script-level editing with full content, use GET /scripts/{script_id}/content
    """
    script = await get_script_if_user_has_access(script_id, current_user, db)
    return script


@router.get("/{script_id}/content", response_model=ScriptWithContent)
async def get_script_with_content(
    script_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get a script with full content blocks for script-level editing.

    This endpoint is optimized for script-level collaborative editing:
    - Returns content_blocks (full script content in Slate format)
    - Returns version for optimistic locking (CAS)
    - Includes migration fallback: rebuilds from scenes if content_blocks is null

    Requires authentication and access to the script (owner or collaborator).
    """
    script = await get_script_if_user_has_access(script_id, current_user, db)

    # Determine content source and build response
    content_blocks = script.content_blocks
    content_source = "script"

    logger.info(f"[GET /content] Script {script_id}: content_blocks={'None' if content_blocks is None else f'{len(content_blocks)} blocks' if content_blocks else 'empty list'}")

    # Migration fallback: rebuild from scenes if content_blocks is null
    if content_blocks is None:
        # Get all scenes ordered by position
        scenes_result = await db.execute(
            select(Scene)
            .where(Scene.script_id == script_id)
            .order_by(Scene.position)
        )
        scenes = scenes_result.scalars().all()

        logger.info(f"[GET /content] Rebuilding from scenes: found {len(scenes)} scenes")

        if scenes:
            # Rebuild full script content from scenes
            content_blocks = []
            for i, scene in enumerate(scenes):
                scene_block_count = len(scene.content_blocks) if scene.content_blocks else 0
                logger.info(f"[GET /content] Scene {i+1}: position={scene.position}, blocks={scene_block_count}, has_content={scene.content_blocks is not None}")
                if scene.content_blocks:
                    content_blocks.extend(scene.content_blocks)

            content_source = "scenes"
            logger.info(f"[GET /content] Rebuilt {len(content_blocks)} total blocks from {len(scenes)} scenes")

            # Optional: Store rebuilt content back to script table for future requests
            # This can be done asynchronously or deferred to first autosave
            # Uncomment below to store immediately:
            # script.content_blocks = content_blocks
            # await db.commit()
        else:
            # No scenes available, return empty content
            logger.warning(f"[GET /content] No scenes found for script {script_id}, returning empty")
            content_blocks = []
            content_source = "empty"

    # Check if Yjs updates exist in script_versions table
    # This tells frontend whether to skip seeding (Yjs will provide content)
    yjs_count_result = await db.execute(
        select(func.count(ScriptVersion.version_id))
        .where(ScriptVersion.script_id == script_id)
    )
    has_yjs_updates = yjs_count_result.scalar_one() > 0

    logger.info(f"[GET /content] Script {script_id}: has_yjs_updates={has_yjs_updates}")

    # Build response with content
    return ScriptWithContent(
        script_id=script.script_id,
        owner_id=script.owner_id,
        title=script.title,
        description=script.description,
        current_version=script.current_version,
        created_at=script.created_at,
        updated_at=script.updated_at,
        imported_fdx_path=script.imported_fdx_path,
        exported_fdx_path=script.exported_fdx_path,
        exported_pdf_path=script.exported_pdf_path,
        content_blocks=content_blocks,
        version=script.version,
        updated_by=script.updated_by,
        scene_summaries=script.scene_summaries,  # Include AI-generated summaries
        content_source=content_source,
        has_yjs_updates=has_yjs_updates
    )


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


@router.delete("/{script_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_script(
    script_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a script.

    Requires authentication and ownership of the script.
    Only the script owner can delete it (not editors or viewers).
    """
    # Get script if user has access
    script = await get_script_if_user_has_access(
        script_id,
        current_user,
        db,
        allow_viewer=False
    )

    # Verify ownership (only owner can delete)
    if script.owner_id != current_user.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the script owner can delete it"
        )

    # Delete script (cascades to related records via DB constraints)
    await db.delete(script)
    await db.commit()

    return None


# ============================================================================
# Collaborator Management Endpoints
# ============================================================================

@router.get("/{script_id}/collaborators", response_model=List[CollaboratorResponse])
async def list_collaborators(
    script_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    List all collaborators for a script.

    Requires authentication and access to the script (owner or collaborator).
    """
    # Verify user has access to this script
    script = await get_script_if_user_has_access(script_id, current_user, db)

    # Get all collaborators for this script
    result = await db.execute(
        select(ScriptCollaborator)
        .where(ScriptCollaborator.script_id == script_id)
        .options()
    )
    collaborators = result.scalars().all()

    # Build response list
    response = []
    for collab in collaborators:
        # Get user info
        user_result = await db.execute(
            select(User).where(User.user_id == collab.user_id)
        )
        user = user_result.scalar_one_or_none()

        response.append(CollaboratorResponse(
            user_id=str(collab.user_id),
            display_name=user.display_name if user else None,
            role=collab.role.value,
            joined_at=collab.joined_at
        ))

    return response


@router.post("/{script_id}/collaborators", response_model=CollaboratorResponse, status_code=status.HTTP_201_CREATED)
async def add_collaborator(
    script_id: UUID,
    request: AddCollaboratorRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Add a collaborator to a script by email address.

    Requires authentication and ownership of the script.
    Only the script owner can add collaborators.
    """
    # Verify script exists and user is the owner
    script_result = await db.execute(select(Script).where(Script.script_id == script_id))
    script = script_result.scalar_one_or_none()

    if not script:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Script with ID {script_id} not found"
        )

    if script.owner_id != current_user.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the script owner can add collaborators"
        )

    # Look up the user in Firebase by email
    firebase_user = get_firebase_user_by_email(request.email)
    if not firebase_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No user found with email {request.email}. They must sign up first."
        )

    # Find the user in our database by Firebase UID
    user_result = await db.execute(
        select(User).where(User.firebase_uid == firebase_user["uid"])
    )
    target_user = user_result.scalar_one_or_none()

    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with email {request.email} has not logged in yet. They must sign in first."
        )

    # Check if user is trying to add themselves
    if target_user.user_id == current_user.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot add yourself as a collaborator"
        )

    # Check if user is already a collaborator
    existing_collab = await db.execute(
        select(ScriptCollaborator).where(
            ScriptCollaborator.script_id == script_id,
            ScriptCollaborator.user_id == target_user.user_id
        )
    )
    if existing_collab.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User {request.email} is already a collaborator on this script"
        )

    # Map role string to enum
    role_map = {
        "editor": CollaboratorRole.EDITOR,
        "viewer": CollaboratorRole.VIEWER
    }
    role = role_map.get(request.role, CollaboratorRole.EDITOR)

    # Create the collaborator record
    collaborator = ScriptCollaborator(
        script_id=script_id,
        user_id=target_user.user_id,
        role=role
    )
    db.add(collaborator)

    # Update script description with both author names (owner & first collaborator)
    owner_name = current_user.display_name or "Writer"
    collaborator_name = target_user.display_name or "Writer"
    script.description = f"{owner_name} & {collaborator_name}"

    await db.commit()
    await db.refresh(collaborator)

    logger.info(f"Added collaborator {target_user.display_name} ({request.email}) to script {script_id} as {role.value}")

    return CollaboratorResponse(
        user_id=str(target_user.user_id),
        display_name=target_user.display_name,
        role=role.value,
        joined_at=collaborator.joined_at
    )


@router.delete("/{script_id}/collaborators/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_collaborator(
    script_id: UUID,
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Remove a collaborator from a script.

    Requires authentication and ownership of the script.
    Only the script owner can remove collaborators.
    """
    # Verify script exists and user is the owner
    script_result = await db.execute(select(Script).where(Script.script_id == script_id))
    script = script_result.scalar_one_or_none()

    if not script:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Script with ID {script_id} not found"
        )

    if script.owner_id != current_user.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the script owner can remove collaborators"
        )

    # Find and delete the collaborator record
    result = await db.execute(
        select(ScriptCollaborator).where(
            ScriptCollaborator.script_id == script_id,
            ScriptCollaborator.user_id == user_id
        )
    )
    collaborator = result.scalar_one_or_none()

    if not collaborator:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collaborator not found"
        )

    await db.delete(collaborator)

    # Revert script description to just the owner's name
    script.description = current_user.display_name or "Writer"

    await db.commit()

    logger.info(f"Removed collaborator {user_id} from script {script_id}")

    return None


@router.get("/{script_id}/scenes", response_model=List[Dict[str, Any]])
async def get_script_scenes(
    script_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all scenes for a script (compatible with Express.js memory API format).

    Yjs-Primary Architecture:
    - Prefers Yjs data if available (source='yjs')
    - Falls back to REST snapshot if no Yjs data (source='rest')
    - Includes metadata for transparency about data source and freshness
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

        # Initialize Yjs persistence service
        yjs_persistence = YjsPersistence(db)

        # Convert to Express.js compatible format with Yjs-primary logic
        scene_data = []
        for scene in scenes:
            # Determine content source and derive content accordingly
            content_blocks = scene.content_blocks
            source = "rest"
            yjs_update_count = 0

            try:
                # Check if Yjs data exists for this scene
                has_yjs = await yjs_persistence.has_updates(scene.scene_id)

                if has_yjs:
                    # Compare timestamps to determine which source is newer
                    # Get latest Yjs update timestamp
                    yjs_stmt = (
                        select(SceneVersion.created_at)
                        .where(SceneVersion.scene_id == scene.scene_id)
                        .order_by(desc(SceneVersion.created_at))
                        .limit(1)
                    )
                    yjs_result = await db.execute(yjs_stmt)
                    latest_yjs_update = yjs_result.scalar_one_or_none()

                    rest_updated_at = scene.updated_at

                    # CRITICAL: If REST is newer than Yjs, use REST (offline saves case)
                    # This handles the case where offline queue saved to REST but Yjs is stale
                    if latest_yjs_update and rest_updated_at > latest_yjs_update:
                        # REST has newer content (likely from offline queue)
                        content_blocks = scene.content_blocks
                        source = "rest"
                        yjs_update_count = await yjs_persistence.get_update_count(scene.scene_id)
                        print(f">>> Using REST content (newer than Yjs): REST={rest_updated_at} > Yjs={latest_yjs_update}")
                    else:
                        # Yjs data is current (PRIMARY SOURCE OF TRUTH for online editing)
                        slate_json = await yjs_persistence.get_scene_snapshot(scene.scene_id)
                        # Extract blocks array from {"blocks": [...]} format
                        content_blocks = slate_json.get("blocks", [])
                        yjs_update_count = await yjs_persistence.get_update_count(scene.scene_id)
                        source = "yjs"
                else:
                    # Use REST snapshot (FALLBACK)
                    content_blocks = scene.content_blocks
                    source = scene.snapshot_source or "rest"

            except Exception as yjs_error:
                # Graceful fallback to REST snapshot on Yjs errors
                print(f"Warning: Yjs retrieval failed for scene {scene.scene_id}, using REST snapshot: {yjs_error}")
                content_blocks = scene.content_blocks
                source = "rest_fallback"

            scene_dict = {
                "projectId": str(script_id),
                "slugline": scene.scene_heading,
                # Legacy sceneId kept for compatibility with older clients
                "sceneId": f"{script_id}_{scene.position}",
                # Real database UUID for this scene (use this for writes/autosave)
                "sceneUUID": str(scene.scene_id),
                # Current version for optimistic concurrency (metadata only in Yjs-primary)
                "version": scene.version,
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
                "contentBlocks": content_blocks,
                # Yjs-Primary Metadata (transparency about data source)
                "metadata": {
                    "source": source,  # 'yjs' | 'rest' | 'migrated' | 'rest_fallback'
                    "snapshot_at": scene.snapshot_at.isoformat() if scene.snapshot_at else None,
                    "yjs_update_count": yjs_update_count,
                    "last_modified": scene.updated_at.isoformat() if scene.updated_at else None
                }
            }
            scene_data.append(scene_dict)

        return scene_data

    except Exception as e:
        print(f"Error retrieving script scenes: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve scenes: {str(e)}"
        )