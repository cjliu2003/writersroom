"""
Yjs Persistence Service

Stores and loads Yjs updates for scenes using the `scene_versions` table.
This enables reconstructing document state on reconnects and persisting
incoming updates for history/compaction later.

Yjs-Primary Architecture:
- Yjs updates in scene_versions are the PRIMARY SOURCE OF TRUTH
- REST snapshots in scenes table are DERIVED/FALLBACK
- All scene state reconstruction happens from Yjs updates

Enhanced API (Phase 2.3):
- store_update(scene_id, update) → version_id
- load_persisted_updates(scene_id, ydoc) → count
- get_scene_state(scene_id) → merged Yjs update bytes
- get_scene_snapshot(scene_id) → Slate JSON dict
- get_update_count(scene_id) → int
- has_updates(scene_id) → bool
- compact_updates(scene_id, before) → count merged
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional, List, Tuple, Dict, Any
from uuid import UUID

from sqlalchemy import select, asc, func
from sqlalchemy.ext.asyncio import AsyncSession

import y_py as Y
from y_py import YDoc

from app.models.scene_version import SceneVersion

logger = logging.getLogger(__name__)


class YjsPersistence:
    """Service to persist and load Yjs updates for scenes."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def store_update(self, scene_id: UUID, update: bytes) -> UUID:
        """
        Store a single Yjs update for a scene.

        Args:
            scene_id: The scene UUID
            update: Raw Yjs update bytes (from SYNC_STEP2 or SYNC_UPDATE)
        Returns:
            The version_id (UUID) of the created SceneVersion row
        """
        version = SceneVersion.create_version(scene_id=scene_id, yjs_update=update)
        self.db.add(version)
        # Flush to get generated IDs without committing the whole transaction
        await self.db.flush()
        logger.debug(
            "Stored Yjs update for scene %s (size=%d bytes) version_id=%s",
            scene_id, len(update), version.version_id,
        )
        return version.version_id

    async def load_persisted_updates(self, scene_id: UUID, ydoc: YDoc) -> int:
        """
        Load all persisted updates for a scene and apply them to the provided YDoc.

        Args:
            scene_id: The scene UUID
            ydoc: Target YDoc to apply updates into
        Returns:
            The number of updates applied
        """
        stmt = (
            select(SceneVersion.yjs_update)
            .where(SceneVersion.scene_id == scene_id)
            .order_by(asc(SceneVersion.created_at))
        )
        result = await self.db.execute(stmt)
        rows: List[Tuple[bytes]] = result.all()

        applied = 0
        for (upd,) in rows:
            try:
                Y.apply_update(ydoc, upd)
                applied += 1
            except Exception as e:
                logger.error("Failed to apply persisted Yjs update for scene %s: %s", scene_id, e)
        logger.info("Applied %d persisted update(s) for scene %s", applied, scene_id)
        return applied

    async def get_scene_state(self, scene_id: UUID) -> bytes:
        """
        Get merged Yjs state as single update.

        Reconstructs full document state from all persisted updates
        and encodes as a single Yjs update. This is efficient for
        sending initial state to new clients.

        Args:
            scene_id: Scene UUID

        Returns:
            Bytes representing merged Yjs state as update

        Raises:
            ValueError: If no updates exist for scene
        """
        # Build YDoc from persisted updates
        ydoc = YDoc()
        count = await self.load_persisted_updates(scene_id, ydoc)

        if count == 0:
            raise ValueError(f"No Yjs updates found for scene {scene_id}")

        # Encode full state as update
        # y-py encodes the entire document state relative to empty state
        update_bytes = Y.encode_state_as_update(ydoc)
        logger.debug(
            "Encoded scene %s state: %d updates → %d bytes",
            scene_id, count, len(update_bytes)
        )
        return update_bytes

    async def get_scene_snapshot(self, scene_id: UUID) -> Dict[str, Any]:
        """
        Convert Yjs state to Slate JSON format.

        Reconstructs Yjs document and converts to Slate JSON using
        the YjsToSlateConverter service.

        Args:
            scene_id: Scene UUID

        Returns:
            Slate JSON dict: {"blocks": [...]}

        Raises:
            ValueError: If no updates exist for scene
        """
        # Lazy import to avoid circular dependency
        from app.services.yjs_to_slate_converter import converter

        # Build YDoc from persisted updates
        ydoc = YDoc()
        count = await self.load_persisted_updates(scene_id, ydoc)

        if count == 0:
            raise ValueError(f"No Yjs updates found for scene {scene_id}")

        # Convert to Slate JSON
        slate_json = converter.convert_to_slate(ydoc)
        logger.debug(
            "Converted scene %s to Slate: %d updates → %d blocks",
            scene_id, count, len(slate_json.get('blocks', []))
        )
        return slate_json

    async def get_update_count(self, scene_id: UUID) -> int:
        """
        Get count of Yjs updates for a scene.

        Useful for migration validation and monitoring.

        Args:
            scene_id: Scene UUID

        Returns:
            Number of updates stored for this scene
        """
        stmt = (
            select(func.count(SceneVersion.version_id))
            .where(SceneVersion.scene_id == scene_id)
        )
        result = await self.db.execute(stmt)
        count = result.scalar_one()
        return count

    async def has_updates(self, scene_id: UUID) -> bool:
        """
        Check if scene has any Yjs updates.

        Fast check for migration validation.

        Args:
            scene_id: Scene UUID

        Returns:
            True if scene has at least one update
        """
        stmt = (
            select(SceneVersion.version_id)
            .where(SceneVersion.scene_id == scene_id)
            .limit(1)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def compact_updates(
        self,
        scene_id: UUID,
        before: datetime,
        created_by: Optional[UUID] = None
    ) -> int:
        """
        Merge old updates into compacted snapshot.

        Combines all non-compacted updates older than the threshold
        into a single compacted update. Original updates are marked
        with compacted_by reference but not deleted (for audit trail).

        Args:
            scene_id: Scene UUID
            before: Compact updates created before this timestamp
            created_by: User performing compaction (None for system)

        Returns:
            Number of updates compacted

        Algorithm:
            1. Find all non-compacted updates before threshold
            2. If count < MIN_UPDATE_COUNT, skip compaction
            3. Build YDoc from those updates
            4. Encode as single update
            5. Store as compacted version
            6. Mark originals with compacted_by reference
        """
        MIN_UPDATE_COUNT = 100  # Don't compact if fewer updates

        # Find non-compacted updates before threshold
        stmt = (
            select(SceneVersion)
            .where(
                SceneVersion.scene_id == scene_id,
                SceneVersion.created_at < before,
                SceneVersion.is_compacted == False  # noqa: E712
            )
            .order_by(asc(SceneVersion.created_at))
        )
        result = await self.db.execute(stmt)
        old_versions = result.scalars().all()

        if len(old_versions) < MIN_UPDATE_COUNT:
            logger.info(
                "Skipping compaction for scene %s: only %d updates (minimum %d)",
                scene_id, len(old_versions), MIN_UPDATE_COUNT
            )
            return 0

        # Build YDoc from old updates
        ydoc = YDoc()
        for version in old_versions:
            try:
                Y.apply_update(ydoc, version.yjs_update)
            except Exception as e:
                logger.error(
                    "Failed to apply update %s during compaction: %s",
                    version.version_id, e
                )
                raise

        # Encode as single compacted update
        compacted_update = Y.encode_state_as_update(ydoc)

        # Store compacted version
        compacted_version = SceneVersion(
            scene_id=scene_id,
            yjs_update=compacted_update,
            is_compacted=True,
            compacted_count=len(old_versions),
            created_by=created_by
        )
        self.db.add(compacted_version)
        await self.db.flush()  # Get version_id

        # Mark originals as compacted
        for version in old_versions:
            version.compacted_by = compacted_version.version_id

        logger.info(
            "Compacted %d updates for scene %s into version %s (%d bytes)",
            len(old_versions), scene_id, compacted_version.version_id,
            len(compacted_update)
        )
        return len(old_versions)
