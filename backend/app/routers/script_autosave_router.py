from datetime import datetime
from typing import Dict, Any, Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import get_db
from app.auth.dependencies import get_current_user
from app.models.user import User
from app.services.script_autosave_service import ScriptAutosaveService

router = APIRouter(prefix="/scripts", tags=["scripts"])

# Local limiter instance for this router
limiter = Limiter(key_func=get_remote_address)


# Function to generate a key based on auth header + script ID
def get_user_script_key(request: Request):
    auth = request.headers.get("authorization", "")
    script_id = request.path_params.get("script_id", "unknown") if hasattr(request, "path_params") else "unknown"
    return f"{auth}:{script_id}"


# Function to generate a key based on auth header (fallback to client IP)
def get_user_key(request: Request):
    auth = request.headers.get("authorization", "")
    return auth or (request.client.host if request.client else "unknown")


# Pydantic models for request/response
class ScriptUpdateRequest(BaseModel):
    content_blocks: List[Dict[str, Any]] = Field(..., description="Full script content blocks")
    base_version: int = Field(..., ge=0, description="Base version for compare-and-swap")
    scene_deltas: Optional[List[Dict[str, Any]]] = Field(
        None,
        description="Optional scene-level updates to apply"
    )


class ScriptResponse(BaseModel):
    script_id: UUID
    version: int
    updated_at: datetime
    updated_by: UUID


class SaveSuccessResponse(BaseModel):
    script: ScriptResponse
    conflict: bool = False


class ConflictResponse(BaseModel):
    latest: Dict[str, Any]
    your_base_version: int
    conflict: bool = True


@router.patch("/{script_id}", response_model=SaveSuccessResponse, status_code=200)
# Rate limit by user+script: 10 requests per 10 seconds; by user total: 100/min
@limiter.limit("10/10second", key_func=get_user_script_key)
@limiter.limit("100/1minute", key_func=get_user_key)
async def update_script(
    request: Request,
    script_id: UUID,
    payload: ScriptUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Update a script with optimistic concurrency control.

    Uses compare-and-swap with base_version to prevent lost updates.
    Optionally applies scene-level deltas for scene table synchronization.

    Returns 409 Conflict if version mismatch occurs.
    """
    # Get script autosave service
    script_service = ScriptAutosaveService(db)

    # Validate access rights
    await script_service.validate_script_access(script_id, current_user.user_id)

    try:
        # Attempt to update with compare-and-swap
        result = await script_service.update_script_with_cas(
            script_id=script_id,
            user_id=current_user.user_id,
            base_version=payload.base_version,
            content_blocks=payload.content_blocks,
            scene_deltas=payload.scene_deltas
        )

        # Return success response
        return SaveSuccessResponse(
            script=ScriptResponse(
                script_id=script_id,
                version=result["version"],
                updated_at=datetime.fromisoformat(result["updated_at"]),
                updated_by=UUID(result["updated_by"])
            ),
            conflict=False
        )

    except script_service.VersionConflictError as e:
        # Return 409 Conflict with latest version info
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ConflictResponse(
                latest=e.latest_version,
                your_base_version=payload.base_version,
                conflict=True
            ).dict()
        )


@router.get("/{script_id}/version", response_model=Dict[str, Any])
async def get_script_version(
    script_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get script with current version information.

    Useful for checking current version before autosave or after conflict.
    """
    script_service = ScriptAutosaveService(db)

    # Validate access rights
    await script_service.validate_script_access(script_id, current_user.user_id)

    # Get script with version info
    result = await script_service.get_script_with_version(script_id)

    return result
