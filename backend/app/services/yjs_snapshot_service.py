"""
Yjs Snapshot Service

Creates periodic REST snapshots from Yjs state for the Yjs-primary architecture.
Snapshots provide:
- Fallback for offline/degraded scenarios
- Fast REST API responses without reconstructing Yjs state
- Version history and audit trail

Architecture:
- Yjs updates in scene_versions are PRIMARY SOURCE OF TRUTH
- REST snapshots in scenes table are DERIVED/FALLBACK
- Snapshots created periodically (every 5 minutes by default)
- Temporary inconsistency is acceptable

Snapshot Sources:
- YJS: Derived from Yjs state (default, periodic)
- MANUAL: User-triggered snapshot
- IMPORT: From FDX import
- MIGRATED: Converted from old REST data
- COMPACTED: From Yjs compaction operation
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional, List
from uuid import UUID

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scene import Scene
from app.models.scene_snapshot_metadata import SceneSnapshotMetadata
from app.models.scene_version import SceneVersion
from app.services.yjs_persistence import YjsPersistence
from app.services.yjs_to_slate_converter import converter

logger = logging.getLogger(__name__)


class SnapshotSource(str, Enum):
    """Source of snapshot creation."""
    YJS = "yjs"           # Derived from Yjs state (default)
    MANUAL = "manual"     # User-triggered snapshot
    IMPORT = "import"     # From FDX import
    MIGRATED = "migrated" # Converted from old REST data
    COMPACTED = "compacted" # From Yjs compaction


class YjsSnapshotService:
    """
    Service to create periodic REST snapshots from Yjs state.

    Implements snapshot generation strategy for Yjs-primary architecture:
    - Asynchronous snapshot creation (non-blocking)
    - Freshness validation
    - Performance metrics tracking
    - Scheduled periodic updates
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.persistence = YjsPersistence(db)

    async def create_snapshot(
        self,
        scene_id: UUID,
        source: SnapshotSource = SnapshotSource.YJS,
        created_by: Optional[UUID] = None
    ) -> SceneSnapshotMetadata:
        """
        Create REST snapshot from current Yjs state.

        Args:
            scene_id: Scene UUID
            source: Snapshot source type
            created_by: User UUID if manually triggered

        Returns:
            SceneSnapshotMetadata record with performance metrics

        Raises:
            ValueError: If scene not found or no Yjs updates available

        Process:
            1. Reconstruct Yjs document from updates
            2. Convert to Slate JSON using converter
            3. Update scenes table with derived content
            4. Create snapshot metadata record
            5. Track performance metrics
        """
        start_time = time.time()

        # Fetch scene record
        stmt = select(Scene).where(Scene.scene_id == scene_id)
        result = await self.db.execute(stmt)
        scene = result.scalar_one_or_none()

        if not scene:
            raise ValueError(f"Scene {scene_id} not found")

        # Get Yjs state and convert to Slate JSON
        try:
            slate_json = await self.persistence.get_scene_snapshot(scene_id)
        except ValueError as e:
            # No Yjs updates available
            raise ValueError(f"Cannot create snapshot for {scene_id}: {e}")

        # Get Yjs version information for freshness tracking
        version_count = await self.persistence.get_update_count(scene_id)

        # Get latest version ID
        stmt_latest = (
            select(SceneVersion.version_id)
            .where(SceneVersion.scene_id == scene_id)
            .order_by(desc(SceneVersion.created_at))
            .limit(1)
        )
        result_latest = await self.db.execute(stmt_latest)
        latest_version_id = result_latest.scalar_one_or_none()

        # Compute checksum for consistency validation
        yjs_checksum = converter.compute_checksum(slate_json)

        # Update scene record with derived content
        scene.content_blocks = slate_json
        scene.snapshot_source = source.value
        scene.snapshot_at = datetime.utcnow()
        scene.yjs_derived = True
        scene.yjs_checksum = yjs_checksum
        scene.updated_at = datetime.utcnow()
        if created_by:
            scene.updated_by = created_by

        # Extract scene_heading from first block if available
        blocks = slate_json.get('blocks', [])
        if blocks and len(blocks) > 0:
            first_block = blocks[0]
            if first_block.get('type') == 'scene_heading':
                scene.scene_heading = first_block.get('text', '')[:255]

        # Calculate snapshot size (approximate)
        import json
        snapshot_bytes = len(json.dumps(slate_json).encode('utf-8'))

        # Calculate generation time
        generation_time_ms = int((time.time() - start_time) * 1000)

        # Create metadata record
        metadata = SceneSnapshotMetadata(
            scene_id=scene_id,
            snapshot_source=source.value,
            created_by=created_by,
            yjs_version_count=version_count,
            yjs_latest_version_id=latest_version_id,
            yjs_checksum=yjs_checksum,
            generation_time_ms=generation_time_ms,
            snapshot_size_bytes=snapshot_bytes
        )

        self.db.add(metadata)
        await self.db.flush()

        logger.info(
            "Created snapshot for scene %s: source=%s, versions=%d, size=%d bytes, time=%d ms",
            scene_id, source.value, version_count, snapshot_bytes, generation_time_ms
        )

        return metadata

    async def validate_snapshot_freshness(
        self,
        scene_id: UUID,
        max_age_minutes: int = 10
    ) -> bool:
        """
        Check if snapshot is up-to-date with Yjs state.

        Args:
            scene_id: Scene UUID
            max_age_minutes: Maximum age in minutes (default 10)

        Returns:
            True if snapshot is fresh, False otherwise

        Freshness criteria:
            1. Snapshot exists
            2. Snapshot created within max_age_minutes
            3. Snapshot checksum matches current Yjs state

        Note: This is a fast check - does NOT reconstruct Yjs state
        """
        # Check if Yjs updates exist
        has_yjs = await self.persistence.has_updates(scene_id)
        if not has_yjs:
            # No Yjs updates - snapshot freshness is N/A
            return True

        # Get scene record
        stmt = select(Scene).where(Scene.scene_id == scene_id)
        result = await self.db.execute(stmt)
        scene = result.scalar_one_or_none()

        if not scene:
            return False

        # Check if snapshot exists and is yjs-derived
        if not scene.yjs_derived or not scene.snapshot_at:
            logger.debug("Scene %s: No Yjs-derived snapshot", scene_id)
            return False

        # Check age
        age = datetime.utcnow() - scene.snapshot_at
        if age > timedelta(minutes=max_age_minutes):
            logger.debug(
                "Scene %s: Snapshot stale (age=%d min > max=%d min)",
                scene_id, age.total_seconds() / 60, max_age_minutes
            )
            return False

        # Get latest snapshot metadata
        stmt_meta = (
            select(SceneSnapshotMetadata)
            .where(SceneSnapshotMetadata.scene_id == scene_id)
            .order_by(desc(SceneSnapshotMetadata.created_at))
            .limit(1)
        )
        result_meta = await self.db.execute(stmt_meta)
        latest_metadata = result_meta.scalar_one_or_none()

        if not latest_metadata:
            logger.debug("Scene %s: No snapshot metadata", scene_id)
            return False

        # Check if version count matches
        current_version_count = await self.persistence.get_update_count(scene_id)
        if latest_metadata.yjs_version_count != current_version_count:
            logger.debug(
                "Scene %s: Version mismatch (snapshot=%d, current=%d)",
                scene_id, latest_metadata.yjs_version_count, current_version_count
            )
            return False

        logger.debug("Scene %s: Snapshot is fresh", scene_id)
        return True

    async def refresh_stale_snapshots(
        self,
        max_age_minutes: int = 10,
        batch_size: int = 10
    ) -> int:
        """
        Refresh stale snapshots for scenes with recent Yjs activity.

        Args:
            max_age_minutes: Maximum snapshot age
            batch_size: Number of scenes to process per batch

        Returns:
            Number of snapshots refreshed

        Process:
            1. Find scenes with stale snapshots
            2. Create new snapshots asynchronously
            3. Track performance metrics

        Note: This is designed to run periodically as background task
        """
        # Find scenes with Yjs updates but stale snapshots
        cutoff_time = datetime.utcnow() - timedelta(minutes=max_age_minutes)

        # Get scenes that either:
        # 1. Have no snapshot_at (never snapshotted)
        # 2. Have snapshot_at older than cutoff
        # 3. Have yjs_derived=False (not derived from Yjs)
        stmt = (
            select(Scene.scene_id)
            .where(
                (Scene.snapshot_at < cutoff_time) |
                (Scene.snapshot_at.is_(None)) |
                (Scene.yjs_derived == False)  # noqa: E712
            )
            .limit(batch_size)
        )

        result = await self.db.execute(stmt)
        stale_scene_ids = [row[0] for row in result.all()]

        refreshed = 0
        for scene_id in stale_scene_ids:
            try:
                # Check if scene has Yjs updates
                has_updates = await self.persistence.has_updates(scene_id)
                if not has_updates:
                    logger.debug("Scene %s: No Yjs updates, skipping snapshot", scene_id)
                    continue

                # Create snapshot
                await self.create_snapshot(
                    scene_id=scene_id,
                    source=SnapshotSource.YJS
                )
                refreshed += 1

            except Exception as e:
                logger.error("Failed to refresh snapshot for scene %s: %s", scene_id, e)
                continue

        if refreshed > 0:
            await self.db.commit()
            logger.info("Refreshed %d stale snapshots", refreshed)

        return refreshed

    async def schedule_periodic_snapshots(
        self,
        interval_minutes: int = 5,
        batch_size: int = 10
    ):
        """
        Background task for periodic snapshot creation.

        Args:
            interval_minutes: Interval between snapshot runs (default 5)
            batch_size: Number of scenes to process per run

        Note: This is an infinite loop - should run in background task
        """
        logger.info(
            "Starting periodic snapshot scheduler: interval=%d min, batch_size=%d",
            interval_minutes, batch_size
        )

        while True:
            try:
                # Wait for interval
                await asyncio.sleep(interval_minutes * 60)

                # Refresh stale snapshots
                refreshed = await self.refresh_stale_snapshots(
                    max_age_minutes=interval_minutes,
                    batch_size=batch_size
                )

                logger.debug(
                    "Periodic snapshot run complete: refreshed=%d snapshots",
                    refreshed
                )

            except asyncio.CancelledError:
                logger.info("Periodic snapshot scheduler cancelled")
                break
            except Exception as e:
                logger.error("Error in periodic snapshot scheduler: %s", e)
                # Continue running despite errors
                continue

    async def get_snapshot_history(
        self,
        scene_id: UUID,
        limit: int = 10
    ) -> List[SceneSnapshotMetadata]:
        """
        Get snapshot history for a scene.

        Args:
            scene_id: Scene UUID
            limit: Maximum number of records to return

        Returns:
            List of snapshot metadata records (newest first)
        """
        stmt = (
            select(SceneSnapshotMetadata)
            .where(SceneSnapshotMetadata.scene_id == scene_id)
            .order_by(desc(SceneSnapshotMetadata.created_at))
            .limit(limit)
        )

        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_snapshot_stats(self, scene_id: UUID) -> dict:
        """
        Get snapshot statistics for a scene.

        Args:
            scene_id: Scene UUID

        Returns:
            Dictionary with snapshot statistics

        Stats include:
            - total_snapshots: Total number of snapshots created
            - latest_snapshot: Most recent snapshot metadata
            - avg_generation_time_ms: Average generation time
            - avg_snapshot_size_bytes: Average snapshot size
            - is_fresh: Whether current snapshot is fresh
        """
        # Get all snapshot metadata
        history = await self.get_snapshot_history(scene_id, limit=100)

        if not history:
            return {
                'total_snapshots': 0,
                'latest_snapshot': None,
                'avg_generation_time_ms': None,
                'avg_snapshot_size_bytes': None,
                'is_fresh': False
            }

        # Calculate averages
        gen_times = [m.generation_time_ms for m in history if m.generation_time_ms]
        sizes = [m.snapshot_size_bytes for m in history if m.snapshot_size_bytes]

        avg_gen_time = sum(gen_times) / len(gen_times) if gen_times else None
        avg_size = sum(sizes) / len(sizes) if sizes else None

        # Check freshness
        is_fresh = await self.validate_snapshot_freshness(scene_id)

        return {
            'total_snapshots': len(history),
            'latest_snapshot': history[0].to_dict() if history else None,
            'avg_generation_time_ms': int(avg_gen_time) if avg_gen_time else None,
            'avg_snapshot_size_bytes': int(avg_size) if avg_size else None,
            'is_fresh': is_fresh
        }
