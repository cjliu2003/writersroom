from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional

from app.firebase.config import verify_firebase_token

# HTTP Bearer token security scheme
security = HTTPBearer()

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """
    Dependency that verifies the Firebase ID token and returns the user info.
    
    Args:
        credentials: The HTTP authorization credentials containing the Bearer token.
        
    Returns:
        dict: The decoded Firebase user information.
        
    Raises:
        HTTPException: If the token is invalid, expired, or missing.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization credentials not provided",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    try:
        token = credentials.credentials
        return verify_firebase_token(token)
    except Exception as e:
        error_detail = str(e)
        if "token expired" in error_detail.lower():
            status_code = status.HTTP_401_UNAUTHORIZED
            detail = "Token has expired"
        elif "invalid token" in error_detail.lower():
            status_code = status.HTTP_401_UNAUTHORIZED
            detail = "Invalid authentication token"
        elif "user disabled" in error_detail.lower():
            status_code = status.HTTP_403_FORBIDDEN
            detail = "This user account has been disabled"
        else:
            status_code = status.HTTP_401_UNAUTHORIZED
            detail = "Could not validate credentials"
        
        raise HTTPException(
            status_code=status_code,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )
