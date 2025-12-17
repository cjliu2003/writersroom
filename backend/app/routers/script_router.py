"""
Script management endpoints for the WritersRoom API
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, desc, func, and_
from typing import List, Dict, Any
import logging

from uuid import UUID

logger = logging.getLogger(__name__)

from app.models.user import User
from app.models.script import Script
from app.models.scene import Scene
from app.models.script_version import ScriptVersion
from app.models.script_collaborator import ScriptCollaborator, CollaboratorRole
from app.schemas.script import ScriptCreate, ScriptUpdate, ScriptResponse, ScriptWithContent, AddCollaboratorRequest, CollaboratorResponse
from app.firebase.config import get_firebase_user_by_email
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

    OPTIMIZATION: Selects only the columns actually used in get_script_with_content()
    to prevent loading 8 unnecessary relationships via lazy='selectin'.
    Reduces 9 queries (1 main + 8 relationships) to 1 lightweight query.

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
    # First, try to find the script - select only the columns we actually use
    # This prevents loading 8 eager-loaded relationships (scenes, collaborators, etc.)
    script_result = await db.execute(
        select(
            Script.script_id,
            Script.owner_id,
            Script.title,
            Script.description,
            Script.current_version,
            Script.created_at,
            Script.updated_at,
            Script.imported_fdx_path,
            Script.exported_fdx_path,
            Script.exported_pdf_path,
            Script.content_blocks,
            Script.version,
            Script.updated_by,
            Script.scene_summaries
        ).where(Script.script_id == script_id)
    )
    row = script_result.one_or_none()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Script with ID {script_id} not found"
        )

    # Check if user is the owner
    if row.owner_id == user.user_id:
        # Reconstruct a Script-like object from the row
        class ScriptData:
            def __init__(self, row):
                self.script_id = row.script_id
                self.owner_id = row.owner_id
                self.title = row.title
                self.description = row.description
                self.current_version = row.current_version
                self.created_at = row.created_at
                self.updated_at = row.updated_at
                self.imported_fdx_path = row.imported_fdx_path
                self.exported_fdx_path = row.exported_fdx_path
                self.exported_pdf_path = row.exported_pdf_path
                self.content_blocks = row.content_blocks
                self.version = row.version
                self.updated_by = row.updated_by
                self.scene_summaries = row.scene_summaries

        return ScriptData(row)
        
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

    # User is a collaborator - return the script data
    class ScriptData:
        def __init__(self, row):
            self.script_id = row.script_id
            self.owner_id = row.owner_id
            self.title = row.title
            self.description = row.description
            self.current_version = row.current_version
            self.created_at = row.created_at
            self.updated_at = row.updated_at
            self.imported_fdx_path = row.imported_fdx_path
            self.exported_fdx_path = row.exported_fdx_path
            self.exported_pdf_path = row.exported_pdf_path
            self.content_blocks = row.content_blocks
            self.version = row.version
            self.updated_by = row.updated_by
            self.scene_summaries = row.scene_summaries

    return ScriptData(row)


async def validate_script_access(
    script_id: UUID,
    user: User,
    db: AsyncSession,
    allow_viewer: bool = True
) -> None:
    """
    Validate user has access to script without loading script data.

    Optimized for authorization-only checks where script data is not needed.
    Uses single LEFT JOIN query instead of 2 separate queries.

    Security: Checks both ownership and collaborator permissions.
    Performance: Loads only 3 columns instead of 13, single query instead of 2.

    Args:
        script_id: UUID of script to validate access for
        user: Currently authenticated user
        db: Async database session
        allow_viewer: If True, VIEWER role has access. If False, requires EDITOR+ role.

    Returns:
        None (returns void on success)

    Raises:
        HTTPException 404: Script not found
        HTTPException 403: User does not have permission to access script
    """
    # Single optimized query with LEFT JOIN
    # Only load minimal columns needed for access check
    query = (
        select(
            Script.script_id,
            Script.owner_id,
            ScriptCollaborator.role
        )
        .outerjoin(
            ScriptCollaborator,
            and_(
                ScriptCollaborator.script_id == Script.script_id,
                ScriptCollaborator.user_id == user.user_id
            )
        )
        .where(Script.script_id == script_id)
    )

    result = await db.execute(query)
    row = result.one_or_none()

    # Script doesn't exist
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Script with ID {script_id} not found"
        )

    # User is owner - always has access
    if row.owner_id == user.user_id:
        return

    # User is collaborator - check role permissions
    if row.role is not None:
        if allow_viewer:
            # All roles have access when viewers allowed
            return
        else:
            # Only EDITOR and OWNER roles have access
            if row.role in [CollaboratorRole.EDITOR, CollaboratorRole.OWNER]:
                return

    # No access
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to access this script"
    )


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
        # OPTIMIZATION: Select only the columns we need (position, content_blocks)
        # This prevents loading 3 eager-loaded relationships per scene (script, last_editor, versions)
        # For 10 scenes: reduces from 31 queries (1 main + 10 scenes × 3 relationships) to 1 query
        scenes_result = await db.execute(
            select(
                Scene.position,
                Scene.content_blocks
            )
            .where(Scene.script_id == script_id)
            .order_by(Scene.position)
        )
        scene_rows = scenes_result.all()

        logger.info(f"[GET /content] Rebuilding from scenes: found {len(scene_rows)} scenes")

        if scene_rows:
            # Rebuild full script content from scenes
            content_blocks = []
            for i, row in enumerate(scene_rows):
                scene_block_count = len(row.content_blocks) if row.content_blocks else 0
                logger.info(f"[GET /content] Scene {i+1}: position={row.position}, blocks={scene_block_count}, has_content={row.content_blocks is not None}")
                if row.content_blocks:
                    content_blocks.extend(row.content_blocks)

            content_source = "scenes"
            logger.info(f"[GET /content] Rebuilt {len(content_blocks)} total blocks from {len(scene_rows)} scenes")

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

    # Delete script using direct SQL (script is a ScriptData object, not ORM instance)
    # Cascades to related records via DB constraints
    await db.execute(delete(Script).where(Script.script_id == script_id))
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


