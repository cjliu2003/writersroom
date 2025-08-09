from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer
from typing import Dict, Any

from app.auth.dependencies import get_current_user
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.get("/me", response_model=Dict[str, Any])
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    """
    Get the current authenticated user's information.
    
    This endpoint requires a valid Firebase ID token in the Authorization header.
    Returns the database User object information.
    """
    # Convert User model to dictionary and return
    user_dict = current_user.to_dict()
    
    return {
        "user": user_dict,
        "message": "Authentication successful"
    }

@router.post("/verify-token")
async def verify_token(
    token_data: Dict[str, str],
    current_user: User = Depends(get_current_user)
):
    """
    Verify a Firebase ID token.
    
    This endpoint is useful for clients to verify if their token is still valid.
    The token should be passed in the request body as: {"token": "your_firebase_token"}
    """
    # If we get here, the token is valid (thanks to the get_current_user dependency)
    return {
        "status": "valid", 
        "user_id": str(current_user.user_id),
        "firebase_uid": current_user.firebase_uid
    }
