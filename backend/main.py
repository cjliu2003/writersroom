from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

# Load environment variables from .env file
load_dotenv()

from app.routers import health_router, auth_router, script_router
from app.firebase.config import initialize_firebase

# Initialize Firebase
initialize_firebase()

app = FastAPI(
    title="WritersRoom API",
    description="Backend API for WritersRoom application",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health_router.router, prefix="/api", tags=["health"])
app.include_router(auth_router.router, prefix="/api")
app.include_router(script_router.router, prefix="/api")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
