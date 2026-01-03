"""
Script-level Yjs Persistence Service

Stores and loads Yjs updates for entire scripts using the `script_versions` table.
This is the script-level equivalent of YjsPersistence, designed for the new
script-level editing architecture.
"""

import logging
from typing import Optional, Tuple
from uuid import UUID

from sqlalchemy import select, asc, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

import y_py as Y
from y_py import YDoc

from app.models.script_version import ScriptVersion

logger = logging.getLogger(__name__)

# Threshold for triggering automatic compaction of Yjs updates
# Scripts with more updates than this will be compacted on load
COMPACTION_THRESHOLD = 100


class ScriptYjsPersistence:
    """Service to persist and load Yjs updates for scripts."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def store_update(
        self,
        script_id: UUID,
        update: bytes,
        user_id: Optional[UUID] = None
    ) -> ScriptVersion:
        """
        Store a single Yjs update for a script.

        Args:
            script_id: The script UUID
            update: Raw Yjs update bytes (from SYNC_STEP2 or SYNC_UPDATE)
            user_id: Optional UUID of the user who created this update

        Returns:
            The created ScriptVersion instance
        """
        version = ScriptVersion(
            script_id=script_id,
            update=update,
            created_by=user_id
        )
        self.db.add(version)
        await self.db.flush()

        logger.debug(
            "Stored Yjs update for script %s (size=%d bytes) version_id=%s",
            script_id,
            len(update),
            version.version_id,
        )
        return version

    async def load_persisted_updates(self, script_id: UUID, ydoc: YDoc) -> int:
        """
        Load all persisted updates for a script and apply them to the provided YDoc.

        Args:
            script_id: The script UUID
            ydoc: Target YDoc to apply updates into

        Returns:
            The number of updates applied
        """
        stmt = (
            select(ScriptVersion.update)
            .where(ScriptVersion.script_id == script_id)
            .order_by(asc(ScriptVersion.created_at))
        )
        result = await self.db.execute(stmt)
        updates = result.scalars().all()

        applied = 0
        for update_bytes in updates:
            try:
                Y.apply_update(ydoc, update_bytes)
                applied += 1
            except Exception as e:
                logger.error(
                    "Failed to apply persisted Yjs update for script %s: %s",
                    script_id,
                    e
                )

        logger.info("Applied %d persisted update(s) for script %s", applied, script_id)
        return applied

    async def get_update_count(self, script_id: UUID) -> int:
        """
        Get count of Yjs updates for a script.

        Args:
            script_id: Script UUID

        Returns:
            Number of updates stored for this script
        """
        stmt = (
            select(func.count(ScriptVersion.version_id))
            .where(ScriptVersion.script_id == script_id)
        )
        result = await self.db.execute(stmt)
        count = result.scalar_one()
        return count

    async def has_updates(self, script_id: UUID) -> bool:
        """
        Check if script has any Yjs updates.

        Args:
            script_id: Script UUID

        Returns:
            True if script has at least one update
        """
        stmt = (
            select(ScriptVersion.version_id)
            .where(ScriptVersion.script_id == script_id)
            .limit(1)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def load_and_compact_if_needed(
        self,
        script_id: UUID,
        ydoc: YDoc,
        compaction_threshold: int = COMPACTION_THRESHOLD
    ) -> Tuple[int, bool]:
        """
        Load all persisted updates and compact if count exceeds threshold.

        This handles the SYNC_STEP2 pollution issue where thousands of redundant
        entries were created. By compacting, we replace N updates with a single
        compacted state update, improving load performance.

        Args:
            script_id: The script UUID
            ydoc: Target YDoc to apply updates into
            compaction_threshold: Trigger compaction if update count exceeds this

        Returns:
            Tuple of (updates_applied_count, was_compacted)
        """
        # Get all updates ordered by creation time
        stmt = (
            select(ScriptVersion)
            .where(ScriptVersion.script_id == script_id)
            .order_by(asc(ScriptVersion.created_at))
        )
        result = await self.db.execute(stmt)
        versions = result.scalars().all()

        update_count = len(versions)

        if update_count == 0:
            logger.debug(f"No Yjs updates found for script {script_id}")
            return 0, False

        # Apply all updates to the document
        applied = 0
        for version in versions:
            try:
                Y.apply_update(ydoc, version.update)
                applied += 1
            except Exception as e:
                logger.error(
                    f"Failed to apply Yjs update {version.version_id} for script {script_id}: {e}"
                )

        # Check if compaction is needed
        if update_count > compaction_threshold:
            logger.info(
                f"Script {script_id} has {update_count} updates (threshold={compaction_threshold}) - compacting"
            )

            try:
                # Get single compacted state from the document
                compacted_state = Y.encode_state_as_update(ydoc)

                # Delete all old versions
                await self.db.execute(
                    delete(ScriptVersion).where(ScriptVersion.script_id == script_id)
                )

                # Store single compacted update
                compacted_version = ScriptVersion(
                    script_id=script_id,
                    update=compacted_state,
                    created_by=None  # System compaction, no specific user
                )
                self.db.add(compacted_version)
                await self.db.flush()

                logger.info(
                    f"Compacted {update_count} updates into 1 for script {script_id} "
                    f"({len(compacted_state)} bytes)"
                )
                return 1, True

            except Exception as e:
                logger.error(f"Failed to compact updates for script {script_id}: {e}")
                # Compaction failed but document is still loaded correctly
                return applied, False

        logger.info(f"Applied {applied} Yjs update(s) for script {script_id}")
        return applied, False
