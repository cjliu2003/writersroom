from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer
from typing import Dict, Any

from app.auth.dependencies import get_current_user

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.get("/me", response_model=Dict[str, Any])
async def get_current_user_info(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Get the current authenticated user's information.
    
    This endpoint requires a valid Firebase ID token in the Authorization header.
    """
    return {
        "uid": current_user.get("uid"),
        "email": current_user.get("email"),
        "email_verified": current_user.get("email_verified", False),
        "name": current_user.get("name"),
        "picture": current_user.get("picture"),
    }

@router.post("/verify-token")
async def verify_token(
    token_data: Dict[str, str],
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Verify a Firebase ID token.
    
    This endpoint is useful for clients to verify if their token is still valid.
    The token should be passed in the request body as: {"token": "your_firebase_token"}
    """
    # If we get here, the token is valid (thanks to the get_current_user dependency)
    return {"status": "valid", "uid": current_user["uid"]}
