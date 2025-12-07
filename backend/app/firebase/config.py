import firebase_admin
from firebase_admin import credentials, auth
from typing import Optional
import json
import os
from pathlib import Path

# Initialize Firebase Admin SDK
firebase_app = None

def initialize_firebase():
    """
    Initialize Firebase Admin SDK with credentials from environment variable.
    The FIREBASE_CREDENTIALS_JSON should contain the service account key as a JSON string.
    """
    global firebase_app
    
    if firebase_app is None:
        # Get the Firebase credentials from environment variable
        creds_json = os.getenv("FIREBASE_CREDENTIALS_JSON")
        
        if not creds_json:
            raise ValueError("FIREBASE_CREDENTIALS_JSON environment variable not set")
        
        try:
            # Parse the JSON string to a dictionary
            cred_dict = json.loads(creds_json)
            cred = credentials.Certificate(cred_dict)
            firebase_app = firebase_admin.initialize_app(cred)
        except json.JSONDecodeError:
            raise ValueError("Invalid JSON in FIREBASE_CREDENTIALS_JSON")
        except Exception as e:
            raise Exception(f"Failed to initialize Firebase: {str(e)}")
    
    return firebase_app

def verify_firebase_token(id_token: str) -> dict:
    """
    Verify a Firebase ID token and return the decoded token.
    
    Args:
        id_token (str): The Firebase ID token string from the client.
        
    Returns:
        dict: The decoded Firebase token containing user information.
        
    Raises:
        firebase_auth.InvalidIdTokenError: If the token is invalid.
        firebase_auth.ExpiredIdTokenError: If the token is expired.
        firebase_auth.RevokedIdTokenError: If the token has been revoked.
        firebase_auth.CertificateFetchError: If the Firebase certificates could not be fetched.
        firebase_auth.UserDisabledError: If the user account is disabled.
    """
    if firebase_app is None:
        initialize_firebase()

    return auth.verify_id_token(id_token)


def get_firebase_user_by_email(email: str) -> Optional[dict]:
    """
    Look up a Firebase user by their email address.

    Args:
        email: The email address to look up.

    Returns:
        dict with uid, email, display_name if found, None if not found.

    Raises:
        Exception: If Firebase lookup fails for reasons other than user not found.
    """
    if firebase_app is None:
        initialize_firebase()

    try:
        user = auth.get_user_by_email(email)
        return {
            "uid": user.uid,
            "email": user.email,
            "display_name": user.display_name
        }
    except auth.UserNotFoundError:
        return None
