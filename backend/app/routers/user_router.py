from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.models.user import User
from app.models.script import Script
from app.db.base import get_db
from app.auth.dependencies import get_current_user

# Pydantic schemas for request/response models
from pydantic import BaseModel, Field

class UserProfileResponse(BaseModel):
    user_id: str
    firebase_uid: str
    display_name: str
    created_at: str
    updated_at: str
    
class UserProfileUpdate(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=100)
    
class ScriptSummary(BaseModel):
    script_id: str
    title: str
    description: str | None = None
    created_at: str
    updated_at: str
    
router = APIRouter(
    prefix="/users",
    tags=["users"],
    responses={404: {"description": "User not found"}}
)

@router.get("/me", response_model=UserProfileResponse)
async def get_current_user_profile(
    current_user: User = Depends(get_current_user)
):
    """
    Get the current authenticated user's profile information.
    """
    return current_user.to_dict()

@router.patch("/me", response_model=UserProfileResponse)
async def update_user_profile(
    profile_update: UserProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Update the current authenticated user's profile information.
    """
    # Update user fields
    current_user.display_name = profile_update.display_name
    
    # Save changes
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    
    return current_user.to_dict()

@router.get("/me/scripts", response_model=List[ScriptSummary])
async def get_user_scripts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all scripts owned by the current authenticated user.
    """
    # The relationship is already defined in the User model, so we can use it directly
    scripts = await db.execute(
        select(Script).where(Script.owner_id == current_user.user_id)
    )
    
    script_list = scripts.scalars().all()
    
    return [
        {
            "script_id": str(script.script_id),
            "title": script.title,
            "description": script.description,
            "created_at": script.created_at.isoformat() if script.created_at else None,
            "updated_at": script.updated_at.isoformat() if script.updated_at else None
        }
        for script in script_list
    ]

@router.get("/me/collaborations", response_model=List[ScriptSummary])
async def get_user_collaborations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all scripts where the current authenticated user is a collaborator.
    """
    # Using a join to get all scripts where the user is a collaborator
    # This requires a more complex query through the ScriptCollaborator model
    from app.models.script_collaborator import ScriptCollaborator
    
    result = await db.execute(
        select(Script)
        .join(ScriptCollaborator, ScriptCollaborator.script_id == Script.script_id)
        .where(ScriptCollaborator.user_id == current_user.user_id)
    )
    
    script_list = result.scalars().all()
    
    return [
        {
            "script_id": str(script.script_id),
            "title": script.title,
            "description": script.description,
            "created_at": script.created_at.isoformat() if script.created_at else None,
            "updated_at": script.updated_at.isoformat() if script.updated_at else None
        }
        for script in script_list
    ]
