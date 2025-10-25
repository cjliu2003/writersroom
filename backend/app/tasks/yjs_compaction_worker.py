"""
Yjs Compaction Worker

Background task for merging old Yjs updates to prevent unbounded database growth.

Architecture:
- Runs periodically (daily recommended)
- Compacts updates older than 24 hours with >100 updates per scene
- Preserves history via compaction metadata
- Cleans up old compacted updates after 30 day retention

Compaction Strategy:
- MIN_UPDATE_COUNT = 100 (don't compact if fewer)
- COMPACTION_AGE = 24 hours (compact updates older than this)
- RETENTION_PERIOD = 30 days (delete compacted originals after this)
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scene_version import SceneVersion
from app.services.yjs_persistence import YjsPersistence

logger = logging.getLogger(__name__)


class CompactionWorker:
    """
    Worker for compacting Yjs updates to prevent database bloat.

    Implements periodic compaction strategy:
    - Finds scenes with many old updates
    - Merges updates into single compacted version
    - Cleans up old compacted updates after retention period
    """

    # Compaction thresholds (from design spec)
    MIN_UPDATE_COUNT = 100  # Don't compact if fewer updates
    COMPACTION_AGE = timedelta(hours=24)  # Compact updates older than this
    RETENTION_PERIOD = timedelta(days=30)  # Delete compacted originals after this

    def __init__(self, db: AsyncSession):
        self.db = db
        self.persistence = YjsPersistence(db)

    async def find_scenes_needing_compaction(
        self,
        batch_size: int = 50
    ) -> List[UUID]:
        """
        Find scenes with many old updates needing compaction.

        Args:
            batch_size: Maximum number of scenes to return

        Returns:
            List of scene_ids needing compaction

        Query Logic:
            - Count non-compacted updates per scene
            - Filter to updates older than COMPACTION_AGE
            - Only return scenes with >= MIN_UPDATE_COUNT updates
        """
        cutoff_time = datetime.utcnow() - self.COMPACTION_AGE

        # Query for scenes with many old updates
        stmt = (
            select(SceneVersion.scene_id, func.count(SceneVersion.version_id).label('update_count'))
            .where(
                SceneVersion.created_at < cutoff_time,
                SceneVersion.is_compacted == False,  # noqa: E712
                SceneVersion.compacted_by.is_(None)  # Not already marked as compacted
            )
            .group_by(SceneVersion.scene_id)
            .having(func.count(SceneVersion.version_id) >= self.MIN_UPDATE_COUNT)
            .order_by(func.count(SceneVersion.version_id).desc())
            .limit(batch_size)
        )

        result = await self.db.execute(stmt)
        rows = result.all()

        scene_ids = [row[0] for row in rows]

        if scene_ids:
            logger.info(
                "Found %d scene(s) needing compaction (>= %d updates older than %s)",
                len(scene_ids), self.MIN_UPDATE_COUNT, self.COMPACTION_AGE
            )

        return scene_ids

    async def compact_scene(
        self,
        scene_id: UUID,
        created_by: Optional[UUID] = None
    ) -> int:
        """
        Compact old updates for a single scene.

        Args:
            scene_id: Scene UUID
            created_by: User performing compaction (None for system)

        Returns:
            Number of updates compacted (0 if skipped)

        Raises:
            Exception: If compaction fails
        """
        cutoff_time = datetime.utcnow() - self.COMPACTION_AGE

        try:
            # Use YjsPersistence.compact_updates() which implements the core logic
            compacted_count = await self.persistence.compact_updates(
                scene_id=scene_id,
                before=cutoff_time,
                created_by=created_by
            )

            if compacted_count > 0:
                logger.info(
                    "Compacted %d update(s) for scene %s",
                    compacted_count, scene_id
                )

            return compacted_count

        except Exception as e:
            logger.error(
                "Failed to compact scene %s: %s",
                scene_id, e
            )
            raise

    async def cleanup_old_compacted_updates(self) -> int:
        """
        Delete old compacted updates after retention period.

        Deletes updates where:
        - compacted_by is not NULL (marked as compacted)
        - created_at < NOW() - RETENTION_PERIOD

        Returns:
            Number of updates deleted
        """
        cutoff_time = datetime.utcnow() - self.RETENTION_PERIOD

        # Delete old compacted updates
        stmt = (
            delete(SceneVersion)
            .where(
                SceneVersion.compacted_by.is_not(None),
                SceneVersion.created_at < cutoff_time
            )
        )

        result = await self.db.execute(stmt)
        deleted_count = result.rowcount

        if deleted_count > 0:
            logger.info(
                "Deleted %d old compacted update(s) (older than %s)",
                deleted_count, self.RETENTION_PERIOD
            )
            await self.db.commit()

        return deleted_count

    async def run_compaction_cycle(
        self,
        batch_size: int = 50,
        max_compactions: int = 100
    ) -> dict:
        """
        Run a single compaction cycle.

        Args:
            batch_size: Number of scenes to process per batch
            max_compactions: Maximum scenes to compact in this cycle

        Returns:
            Statistics about compaction cycle
        """
        start_time = time.time()

        # Find scenes needing compaction
        scene_ids = await self.find_scenes_needing_compaction(batch_size=batch_size)

        if not scene_ids:
            logger.debug("No scenes need compaction")
            return {
                'scenes_checked': 0,
                'scenes_compacted': 0,
                'total_updates_compacted': 0,
                'updates_deleted': 0,
                'duration_seconds': 0,
                'errors': []
            }

        # Compact scenes (up to max_compactions)
        scenes_to_compact = scene_ids[:max_compactions]
        compacted_scenes = 0
        total_updates = 0
        errors = []

        for scene_id in scenes_to_compact:
            try:
                count = await self.compact_scene(scene_id)
                if count > 0:
                    compacted_scenes += 1
                    total_updates += count

                # Commit after each scene to avoid large transactions
                await self.db.commit()

            except Exception as e:
                logger.error("Error compacting scene %s: %s", scene_id, e)
                errors.append(str(scene_id))
                # Continue with other scenes despite errors
                await self.db.rollback()

        # Cleanup old compacted updates
        deleted_count = 0
        try:
            deleted_count = await self.cleanup_old_compacted_updates()
        except Exception as e:
            logger.error("Error cleaning up old updates: %s", e)
            errors.append(f"cleanup: {e}")

        duration = time.time() - start_time

        return {
            'scenes_checked': len(scene_ids),
            'scenes_compacted': compacted_scenes,
            'total_updates_compacted': total_updates,
            'updates_deleted': deleted_count,
            'duration_seconds': duration,
            'errors': errors
        }

    async def schedule_periodic_compaction(
        self,
        interval_hours: int = 24,
        batch_size: int = 50,
        max_compactions: int = 100
    ):
        """
        Background task for periodic compaction.

        Args:
            interval_hours: Hours between compaction runs (default 24 = daily)
            batch_size: Number of scenes to process per cycle
            max_compactions: Maximum scenes to compact per cycle

        Note: This is an infinite loop - should run in background task
        """
        logger.info(
            "Starting compaction scheduler: interval=%d hours, batch_size=%d, max_compactions=%d",
            interval_hours, batch_size, max_compactions
        )

        while True:
            try:
                # Wait for interval
                await asyncio.sleep(interval_hours * 3600)

                # Run compaction cycle
                stats = await self.run_compaction_cycle(
                    batch_size=batch_size,
                    max_compactions=max_compactions
                )

                logger.info(
                    "Compaction cycle complete: checked=%d, compacted=%d scenes, "
                    "merged=%d updates, deleted=%d old updates, duration=%.2fs, errors=%d",
                    stats['scenes_checked'],
                    stats['scenes_compacted'],
                    stats['total_updates_compacted'],
                    stats['updates_deleted'],
                    stats['duration_seconds'],
                    len(stats['errors'])
                )

            except asyncio.CancelledError:
                logger.info("Compaction scheduler cancelled")
                break
            except Exception as e:
                logger.error("Error in compaction scheduler: %s", e)
                # Continue running despite errors
                continue
