import os
import json
from dotenv import load_dotenv
from app.firebase.config import initialize_firebase, verify_firebase_token

# Load environment variables
load_dotenv()

def test_firebase_connection():
    print("Testing Firebase connection...")
    try:
        # Initialize Firebase
        firebase_app = initialize_firebase()
        print("✅ Successfully initialized Firebase Admin SDK")
        
        # Get a test ID token (you'll need to generate this from your frontend)
        test_token = os.getenv("TEST_FIREBASE_TOKEN")
        
        if test_token:
            print("\nTesting token verification...")
            try:
                decoded_token = verify_firebase_token(test_token)
                print(f"✅ Token is valid")
                print(f"User ID: {decoded_token.get('uid')}")
                print(f"Email: {decoded_token.get('email')}")
            except Exception as e:
                print(f"❌ Token verification failed: {str(e)}")
                print("Note: This might be expected if you haven't set a test token")
        else:
            print("\nℹ️  No test token provided. To test token verification, set TEST_FIREBASE_TOKEN in your .env file")
        
        return True
    except Exception as e:
        print(f"❌ Firebase connection failed: {str(e)}")
        return False

if __name__ == "__main__":
    test_firebase_connection()
