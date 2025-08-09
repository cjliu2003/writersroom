from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.firebase.config import verify_firebase_token
from app.db.session import get_db
from app.models.user import User

# HTTP Bearer token security scheme
security = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    Dependency that verifies the Firebase ID token, looks up the user in the database,
    creates the user if they don't exist, and returns the user object.
    
    Args:
        credentials: The HTTP authorization credentials containing the Bearer token.
        db: Async database session.
        
    Returns:
        User: The authenticated user model instance.
        
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
        # Verify the token
        token = credentials.credentials
        decoded_token = verify_firebase_token(token)
        
        # Extract Firebase UID from token
        firebase_uid = decoded_token.get('uid')
        if not firebase_uid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token - missing UID",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        # Look up user by Firebase UID
        result = await db.execute(
            User.__table__.select().where(User.firebase_uid == firebase_uid)
        )
        user = result.scalar_one_or_none()
        
        # If user doesn't exist, create a new one
        if not user:
            # Extract display name from token claims if available
            display_name = decoded_token.get('name')
            if not display_name and 'email' in decoded_token:
                # Use part of email as display name if available
                display_name = decoded_token['email'].split('@')[0]
            if not display_name:
                display_name = 'New User'
            
            # Create new user record
            user = User(firebase_uid=firebase_uid, display_name=display_name)
            db.add(user)
            await db.commit()
            await db.refresh(user)
        
        return user
        
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
