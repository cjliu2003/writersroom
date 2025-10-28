from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
import os
import asyncio
from typing import Optional

# Rate limiting imports
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Load environment variables from .env file
load_dotenv()

from app.routers import health_router, auth_router, script_router, fdx_router, user_router, ai_router, scene_autosave_router, script_autosave_router, websocket, script_websocket
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
app.include_router(script_autosave_router.router, prefix="/api")
app.include_router(fdx_router.router, prefix="/api")
app.include_router(user_router.router, prefix="/api")
app.include_router(ai_router.router, prefix="/api")
app.include_router(websocket.router, prefix="/api", tags=["websocket"])
app.include_router(script_websocket.router, prefix="/api", tags=["websocket"])

# Background task handles
snapshot_task: Optional[asyncio.Task] = None
compaction_task: Optional[asyncio.Task] = None

# Application lifecycle events
@app.on_event("startup")
async def startup_event():
    """Initialize services on application startup."""
    global snapshot_task, compaction_task

    # Initialize Redis for real-time collaboration
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    try:
        manager = initialize_redis_manager(redis_url)
        await manager.connect()
        print(f"✅ Redis connected at {redis_url}")
    except Exception as e:
        print(f"⚠️  Redis connection failed: {e}")
        print("   Running in single-server mode (WebSocket collaboration will work locally)")

    # Start periodic snapshot creation
    try:
        from app.services.yjs_snapshot_service import YjsSnapshotService
        from app.db.base import async_session_maker
        import logging

        logger = logging.getLogger(__name__)

        async def run_snapshot_scheduler():
            """
            Background task for periodic snapshot creation.

            Creates REST snapshots from Yjs state every 5 minutes.
            Runs indefinitely until application shutdown.
            """
            logger.info("Snapshot scheduler starting...")

            while True:
                try:
                    # Create new session for each iteration
                    async with async_session_maker() as session:
                        service = YjsSnapshotService(session)

                        # Refresh stale snapshots (scenes with Yjs updates but stale REST snapshots)
                        refreshed = await service.refresh_stale_snapshots(
                            max_age_minutes=5,
                            batch_size=10
                        )

                        if refreshed > 0:
                            logger.info(f"Snapshot scheduler: refreshed {refreshed} stale snapshot(s)")

                        # Commit changes
                        await session.commit()

                except asyncio.CancelledError:
                    logger.info("Snapshot scheduler cancelled")
                    raise  # Re-raise to exit loop
                except Exception as e:
                    logger.error(f"Error in snapshot scheduler: {e}")
                    # Continue running despite errors

                # Wait 5 minutes before next run
                await asyncio.sleep(5 * 60)

        snapshot_task = asyncio.create_task(run_snapshot_scheduler())
        print("✅ Snapshot scheduler started (5 minute interval)")

    except Exception as e:
        print(f"⚠️  Failed to start snapshot scheduler: {e}")
        print("   Snapshots will not be automatically created")

    # Start periodic compaction worker
    try:
        from app.tasks.yjs_compaction_worker import CompactionWorker
        from app.db.base import async_session_maker
        import logging

        logger = logging.getLogger(__name__)

        async def run_compaction_scheduler():
            """
            Background task for periodic Yjs update compaction.

            Compacts old Yjs updates (>24h old, >100 updates) daily.
            Runs indefinitely until application shutdown.
            """
            logger.info("Compaction scheduler starting...")

            while True:
                try:
                    # Create new session for each iteration
                    async with async_session_maker() as session:
                        worker = CompactionWorker(session)

                        # Run compaction cycle
                        stats = await worker.run_compaction_cycle(
                            batch_size=50,
                            max_compactions=100
                        )

                        if stats['scenes_compacted'] > 0:
                            logger.info(
                                f"Compaction cycle: compacted {stats['scenes_compacted']} scene(s), "
                                f"merged {stats['total_updates_compacted']} updates, "
                                f"deleted {stats['updates_deleted']} old updates"
                            )

                except asyncio.CancelledError:
                    logger.info("Compaction scheduler cancelled")
                    raise  # Re-raise to exit loop
                except Exception as e:
                    logger.error(f"Error in compaction scheduler: {e}")
                    # Continue running despite errors

                # Wait 24 hours before next run (daily compaction)
                await asyncio.sleep(24 * 60 * 60)

        compaction_task = asyncio.create_task(run_compaction_scheduler())
        print("✅ Compaction scheduler started (24 hour interval)")

    except Exception as e:
        print(f"⚠️  Failed to start compaction scheduler: {e}")
        print("   Compaction will not run automatically")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on application shutdown."""
    global snapshot_task, compaction_task

    # Cancel snapshot scheduler
    if snapshot_task:
        snapshot_task.cancel()
        try:
            await snapshot_task
        except asyncio.CancelledError:
            print("✅ Snapshot scheduler stopped")
        except Exception as e:
            print(f"Error stopping snapshot scheduler: {e}")

    # Cancel compaction scheduler
    if compaction_task:
        compaction_task.cancel()
        try:
            await compaction_task
        except asyncio.CancelledError:
            print("✅ Compaction scheduler stopped")
        except Exception as e:
            print(f"Error stopping compaction scheduler: {e}")

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
