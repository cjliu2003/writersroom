"""
Yjs Persistence Service

Stores and loads Yjs updates for scenes using the `scene_versions` table.
This enables reconstructing document state on reconnects and persisting
incoming updates for history/compaction later.

Phase 2.2 Task 1 (initial implementation):
- store_update(scene_id, update)
- load_persisted_updates(scene_id, ydoc)  # applies updates to provided YDoc

Notes:
- We apply updates sequentially to reconstruct the YDoc. This is sufficient
  for initial persistence. Compaction/merging can be added later.
- We only flush; the outer request lifecycle may commit at disconnect.
"""
from __future__ import annotations

import logging
from typing import Optional, List, Tuple
from uuid import UUID

from sqlalchemy import select, asc
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

    # Placeholders for Phase 2.2 expanded API (to be implemented later)
    async def get_scene_state(self, scene_id: UUID) -> bytes:
        """
        Return a merged Yjs update representing the current scene state.
        For initial implementation, build a YDoc and encode full state.
        """
        # Build YDoc from persisted updates
        ydoc = YDoc()
        await self.load_persisted_updates(scene_id, ydoc)
        # Encode full state relative to empty client
        try:
            # In y-py, encode_state_as_update(doc) encodes the full state
            update_bytes = Y.encode_state_as_update(ydoc)
            return update_bytes
        except TypeError:
            # Fallback if older signature requires a state vector
            sv = Y.encode_state_vector(ydoc)
            return Y.encode_state_as_update(ydoc, sv)

    async def get_updates_since(self, scene_id: UUID, since) -> List[bytes]:  # type: ignore[override]
        raise NotImplementedError()

    async def compact_updates(self, scene_id: UUID, before) -> None:  # type: ignore[override]
        raise NotImplementedError()
