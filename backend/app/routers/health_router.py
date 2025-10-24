from fastapi import APIRouter, status, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timedelta
from typing import Optional
import time

from app.db.base import get_db
from app.models.scene import Scene
from app.models.scene_version import SceneVersion
from app.models.scene_snapshot_metadata import SceneSnapshotMetadata
from app.services.yjs_persistence import YjsPersistence

router = APIRouter()

class HealthResponse(BaseModel):
    status: str

@router.get(
    "/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
    summary="Health check endpoint",
    description="Returns the health status of the API"
)
async def health_check():
    """Health check endpoint to verify the API is running."""
    return {"status": "ok"}


# Persistence Health Check Models
class YjsPersistenceHealth(BaseModel):
    operational: bool
    avg_load_time_ms: Optional[float]
    scenes_with_updates: int


class SnapshotServiceHealth(BaseModel):
    operational: bool
    snapshots_behind_threshold: int
    avg_snapshot_age_minutes: Optional[float]


class DivergenceDetectionHealth(BaseModel):
    enabled: bool
    divergence_rate: Optional[float]
    scenes_diverged: int


class CompactionHealth(BaseModel):
    last_run: Optional[str]
    scenes_compacted: int
    storage_saved_mb: Optional[float]


class PersistenceHealthResponse(BaseModel):
    status: str  # 'healthy' | 'degraded' | 'unhealthy'
    yjs_persistence: YjsPersistenceHealth
    snapshot_service: SnapshotServiceHealth
    divergence_detection: DivergenceDetectionHealth
    compaction: CompactionHealth


@router.get(
    "/health/persistence",
    response_model=PersistenceHealthResponse,
    summary="Persistence layer health check",
    description="Returns health status of Yjs persistence, snapshots, divergence detection, and compaction"
)
async def persistence_health_check(db: AsyncSession = Depends(get_db)):
    """
    Health check for Yjs-primary persistence layer.

    Checks:
    - Yjs persistence operational status and performance
    - Snapshot service freshness and coverage
    - Divergence detection metrics
    - Compaction worker status and effectiveness
    """
    # Initialize services
    yjs_persistence = YjsPersistence(db)

    # 1. Check Yjs Persistence Health
    yjs_health = await _check_yjs_persistence_health(db, yjs_persistence)

    # 2. Check Snapshot Service Health
    snapshot_health = await _check_snapshot_service_health(db)

    # 3. Check Divergence Detection Health
    divergence_health = await _check_divergence_detection_health(db)

    # 4. Check Compaction Health
    compaction_health = await _check_compaction_health(db)

    # Determine overall status
    overall_status = _determine_overall_status(
        yjs_health, snapshot_health, divergence_health, compaction_health
    )

    return {
        "status": overall_status,
        "yjs_persistence": yjs_health,
        "snapshot_service": snapshot_health,
        "divergence_detection": divergence_health,
        "compaction": compaction_health
    }


async def _check_yjs_persistence_health(
    db: AsyncSession,
    yjs_persistence: YjsPersistence
) -> YjsPersistenceHealth:
    """Check Yjs persistence operational status and performance."""
    try:
        # Count scenes with Yjs updates
        stmt = select(func.count(func.distinct(SceneVersion.scene_id)))
        result = await db.execute(stmt)
        scenes_with_updates = result.scalar() or 0

        # Test load performance with a sample scene
        avg_load_time_ms = None
        if scenes_with_updates > 0:
            # Get a random scene with updates
            stmt = (
                select(SceneVersion.scene_id)
                .distinct()
                .limit(1)
            )
            result = await db.execute(stmt)
            sample_scene_id = result.scalar_one_or_none()

            if sample_scene_id:
                try:
                    start_time = time.time()
                    await yjs_persistence.get_scene_snapshot(sample_scene_id)
                    elapsed_ms = (time.time() - start_time) * 1000
                    avg_load_time_ms = round(elapsed_ms, 2)
                except Exception:
                    # If load fails, set to None but mark as operational
                    avg_load_time_ms = None

        return YjsPersistenceHealth(
            operational=True,
            avg_load_time_ms=avg_load_time_ms,
            scenes_with_updates=scenes_with_updates
        )

    except Exception as e:
        return YjsPersistenceHealth(
            operational=False,
            avg_load_time_ms=None,
            scenes_with_updates=0
        )


async def _check_snapshot_service_health(db: AsyncSession) -> SnapshotServiceHealth:
    """Check snapshot service freshness and coverage."""
    try:
        # Count scenes with stale snapshots (>10 minutes old)
        threshold_time = datetime.utcnow() - timedelta(minutes=10)

        stmt = (
            select(func.count(Scene.scene_id))
            .where(
                (Scene.snapshot_at < threshold_time) |
                (Scene.snapshot_at.is_(None)) |
                (Scene.yjs_derived == False)  # noqa: E712
            )
        )
        result = await db.execute(stmt)
        snapshots_behind = result.scalar() or 0

        # Calculate average snapshot age
        stmt = (
            select(func.avg(
                func.extract('epoch', datetime.utcnow() - Scene.snapshot_at) / 60
            ))
            .where(Scene.snapshot_at.is_not(None))
        )
        result = await db.execute(stmt)
        avg_age_minutes = result.scalar()

        return SnapshotServiceHealth(
            operational=True,
            snapshots_behind_threshold=snapshots_behind,
            avg_snapshot_age_minutes=round(avg_age_minutes, 2) if avg_age_minutes else None
        )

    except Exception:
        return SnapshotServiceHealth(
            operational=False,
            snapshots_behind_threshold=0,
            avg_snapshot_age_minutes=None
        )


async def _check_divergence_detection_health(db: AsyncSession) -> DivergenceDetectionHealth:
    """Check divergence detection metrics."""
    try:
        # Count total scenes with Yjs data
        stmt = select(func.count(func.distinct(SceneVersion.scene_id)))
        result = await db.execute(stmt)
        total_scenes = result.scalar() or 0

        # Count scenes with potential divergence
        # (scenes where snapshot is stale by >30 minutes)
        threshold_time = datetime.utcnow() - timedelta(minutes=30)

        stmt = (
            select(func.count(Scene.scene_id))
            .where(
                Scene.yjs_derived == True,  # noqa: E712
                Scene.snapshot_at < threshold_time
            )
        )
        result = await db.execute(stmt)
        scenes_diverged = result.scalar() or 0

        # Calculate divergence rate
        divergence_rate = None
        if total_scenes > 0:
            divergence_rate = round(scenes_diverged / total_scenes, 4)

        return DivergenceDetectionHealth(
            enabled=True,
            divergence_rate=divergence_rate,
            scenes_diverged=scenes_diverged
        )

    except Exception:
        return DivergenceDetectionHealth(
            enabled=False,
            divergence_rate=None,
            scenes_diverged=0
        )


async def _check_compaction_health(db: AsyncSession) -> CompactionHealth:
    """Check compaction worker status and effectiveness."""
    try:
        # Get most recent compacted version
        stmt = (
            select(
                SceneVersion.created_at,
                func.count(func.distinct(SceneVersion.scene_id)).label('scene_count'),
                func.sum(SceneVersion.compacted_count).label('total_compacted')
            )
            .where(SceneVersion.is_compacted == True)  # noqa: E712
            .order_by(SceneVersion.created_at.desc())
            .limit(1)
        )
        result = await db.execute(stmt)
        row = result.first()

        last_run = None
        scenes_compacted = 0
        total_updates_compacted = 0

        if row:
            last_run = row[0].isoformat() if row[0] else None
            scenes_compacted = row[1] or 0
            total_updates_compacted = row[2] or 0

        # Estimate storage saved (rough estimate: 200 bytes per update, 20:1 compression)
        storage_saved_mb = None
        if total_updates_compacted > 0:
            # Original size: updates * 200 bytes
            # Compacted size: scenes * 10KB (approx)
            original_size_mb = (total_updates_compacted * 200) / (1024 * 1024)
            compacted_size_mb = (scenes_compacted * 10 * 1024) / (1024 * 1024)
            storage_saved_mb = round(max(0, original_size_mb - compacted_size_mb), 2)

        return CompactionHealth(
            last_run=last_run,
            scenes_compacted=scenes_compacted,
            storage_saved_mb=storage_saved_mb
        )

    except Exception:
        return CompactionHealth(
            last_run=None,
            scenes_compacted=0,
            storage_saved_mb=None
        )


def _determine_overall_status(
    yjs_health: YjsPersistenceHealth,
    snapshot_health: SnapshotServiceHealth,
    divergence_health: DivergenceDetectionHealth,
    compaction_health: CompactionHealth
) -> str:
    """Determine overall persistence health status."""
    # Critical: Yjs persistence must be operational
    if not yjs_health.operational:
        return "unhealthy"

    # Degraded conditions
    degraded_conditions = []

    # Snapshot service issues
    if not snapshot_health.operational:
        degraded_conditions.append("snapshot_service_down")
    elif snapshot_health.snapshots_behind_threshold > 50:
        degraded_conditions.append("many_stale_snapshots")

    # Divergence issues
    if divergence_health.divergence_rate and divergence_health.divergence_rate > 0.01:  # >1%
        degraded_conditions.append("high_divergence_rate")

    # Performance issues
    if yjs_health.avg_load_time_ms and yjs_health.avg_load_time_ms > 500:  # >500ms
        degraded_conditions.append("slow_load_performance")

    # Determine status
    if len(degraded_conditions) >= 2:
        return "unhealthy"
    elif len(degraded_conditions) == 1:
        return "degraded"
    else:
        return "healthy"
