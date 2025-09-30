from datetime import datetime
from typing import Dict, Any, Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Body, Header, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from pydantic import BaseModel, Field, validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import get_db
from app.auth.dependencies import get_current_user
from app.models.scene import Scene
from app.models.scene_snapshot import SceneSnapshot
from app.models.scene_write_op import SceneWriteOp
from app.models.user import User
from app.services.scene_service import SceneService

router = APIRouter(prefix="/scenes", tags=["scenes"])

# Local limiter instance for this router
limiter = Limiter(key_func=get_remote_address)

# Function to generate a key based on auth header + scene ID (read from path params)
def get_user_scene_key(request: Request):
    auth = request.headers.get("authorization", "")
    scene_id = request.path_params.get("scene_id", "unknown") if hasattr(request, "path_params") else "unknown"
    return f"{auth}:{scene_id}"

# Function to generate a key based on auth header (fallback to client IP)
def get_user_key(request: Request):
    auth = request.headers.get("authorization", "")
    return auth or (request.client.host if request.client else "unknown")

# Pydantic models for request/response
class SceneUpdateRequest(BaseModel):
    position: int = Field(..., ge=0, description="Scene position in the script")
    scene_heading: str = Field(..., max_length=200, description="Scene heading")
    blocks: List[Dict[str, Any]] = Field(..., description="Content blocks")
    full_content: Optional[str] = Field(None, description="Rich JSON content for proper formatting")
    updated_at_client: datetime = Field(..., description="Client timestamp when edit was made")
    base_version: int = Field(..., ge=0, description="Base version for compare-and-swap")
    op_id: UUID = Field(..., description="Client-generated operation ID for idempotency")

class SceneResponse(BaseModel):
    scene_id: UUID
    version: int
    updated_at: datetime

class SaveSuccessResponse(BaseModel):
    scene: SceneResponse
    new_version: int
    conflict: bool = False

class ConflictResponse(BaseModel):
    latest: Dict[str, Any]
    your_base_version: int
    conflict: bool = True

@router.patch("/{scene_id}", response_model=SaveSuccessResponse, status_code=200)
# Rate limit by user+scene: 10 requests per 10 seconds; by user total: 100/min
@limiter.limit("10/10second", key_func=get_user_scene_key)
@limiter.limit("100/1minute", key_func=get_user_key)
async def update_scene(
    request: Request,
    scene_id: UUID,
    payload: SceneUpdateRequest,
    idempotency_key: Optional[str] = Header(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Update a scene with optimistic concurrency control.
    
    Uses compare-and-swap with base_version to prevent lost updates.
    Supports idempotency via op_id or Idempotency-Key header.
    """
    # Use op_id for idempotency
    op_id = UUID(idempotency_key) if idempotency_key else payload.op_id
    
    # Check for existing operation
    existing_op = await SceneWriteOp.find_by_op_id(db, op_id)
    if existing_op:
        # Operation already processed, return cached result
        return existing_op.result
    
    # Get scene service
    scene_service = SceneService(db)
    
    # Validate access rights
    await scene_service.validate_scene_access(scene_id, current_user.user_id)
    
    # Prepare scene data
    scene_data = {
        "position": payload.position,
        "scene_heading": payload.scene_heading,
        "content_blocks": payload.blocks,  # map blocks to content_blocks
    }
    
    # Include full_content if provided
    if payload.full_content:
        scene_data["full_content"] = payload.full_content
    
    try:
        # Attempt to update with compare-and-swap
        result = await scene_service.update_scene_with_cas(
            scene_id=scene_id,
            user_id=current_user.user_id,
            base_version=payload.base_version,
            data=scene_data,
            op_id=op_id
        )
        
        # Return success response
        return SaveSuccessResponse(
            scene=SceneResponse(
                scene_id=scene_id,
                version=result["new_version"],
                updated_at=result["updated_at"]
            ),
            new_version=result["new_version"],
            conflict=False
        )
        
    except scene_service.VersionConflictError as e:
        # Return 409 Conflict with latest version info
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ConflictResponse(
                latest=e.latest_version,
                your_base_version=payload.base_version,
                conflict=True
            ).dict()
        )
