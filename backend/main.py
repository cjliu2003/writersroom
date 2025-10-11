from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
import os

# Rate limiting imports
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Load environment variables from .env file
load_dotenv()

from app.routers import health_router, auth_router, script_router, fdx_router, user_router, ai_router, scene_autosave_router, websocket
from app.firebase.config import initialize_firebase
from app.middleware.payload_size_limiter import PayloadSizeLimiter
from app.services.redis_pubsub import initialize_redis_manager, redis_pubsub_manager

# Initialize Firebase
initialize_firebase()

# Create limiter instance with default key function
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="WritersRoom API",
    description="Backend API for WritersRoom application",
    version="1.0.0"
)

# Add limiter to app state
app.state.limiter = limiter

# Register rate limit exceeded handler
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Payload size limiter middleware (256KB limit for scene endpoints)
# Add this first (inner middleware)
app.add_middleware(
    PayloadSizeLimiter,
    path_limits={
        "/api/scenes": 256 * 1024,  # 256KB for scene content as per spec
    }
)

# CORS middleware - add last so it's outermost and always applies headers
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3102",
        "http://127.0.0.1:3102",
        "http://localhost:3000",  # Common Next.js dev port
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Requested-With"],
    expose_headers=["Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    max_age=600,
)

# Include routers
app.include_router(health_router.router, prefix="/api", tags=["health"])
app.include_router(auth_router.router, prefix="/api")
app.include_router(script_router.router, prefix="/api")
app.include_router(scene_autosave_router.router, prefix="/api")
app.include_router(fdx_router.router, prefix="/api")
app.include_router(user_router.router, prefix="/api")
app.include_router(ai_router.router, prefix="/api")
app.include_router(websocket.router, prefix="/api", tags=["websocket"])

# Application lifecycle events
@app.on_event("startup")
async def startup_event():
    """Initialize services on application startup."""
    # Initialize Redis for real-time collaboration
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    try:
        manager = initialize_redis_manager(redis_url)
        await manager.connect()
        print(f"✅ Redis connected at {redis_url}")
    except Exception as e:
        print(f"⚠️  Redis connection failed: {e}")
        print("   Running in single-server mode (WebSocket collaboration will work locally)")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on application shutdown."""
    # Disconnect Redis
    if redis_pubsub_manager:
        try:
            await redis_pubsub_manager.disconnect()
            print("✅ Redis disconnected")
        except Exception as e:
            print(f"Error disconnecting Redis: {e}")

# Custom response middleware for rate limit headers
@app.middleware("http")
async def add_rate_limit_headers(request: Request, call_next):
    response = await call_next(request)
    # Add remaining requests info to headers if available
    if hasattr(request.state, "view_rate_limit"):
        # Handle both object and tuple formats for compatibility
        try:
            # SlowAPI newer versions may store as tuple (limit, remaining, reset_at)
            if isinstance(request.state.view_rate_limit, tuple) and len(request.state.view_rate_limit) == 3:
                limit, remaining, reset_at = request.state.view_rate_limit
                response.headers["X-RateLimit-Limit"] = str(limit)
                response.headers["X-RateLimit-Remaining"] = str(remaining)
                response.headers["X-RateLimit-Reset"] = str(reset_at)
            # Object format with attributes
            elif hasattr(request.state.view_rate_limit, "limit"):
                response.headers["X-RateLimit-Limit"] = str(request.state.view_rate_limit.limit)
                response.headers["X-RateLimit-Remaining"] = str(request.state.view_rate_limit.remaining)
                response.headers["X-RateLimit-Reset"] = str(request.state.view_rate_limit.reset_at)
        except (AttributeError, IndexError, ValueError) as e:
            # Log but don't fail if rate limit structure is unexpected
            print(f"Warning: Could not add rate limit headers: {e}")
    return response

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
