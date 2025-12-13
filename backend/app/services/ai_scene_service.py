"""
AI Scene Service - Hash computation and change detection for scenes
"""

import hashlib
from typing import Optional, List
from uuid import UUID
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scene import Scene
from app.models.scene_summary import SceneSummary
from app.models.scene_character import SceneCharacter
from app.models.script_outline import ScriptOutline
from app.models.character_sheet import CharacterSheet
from app.core.config import settings


class AISceneService:
    """
    Service for AI-specific scene operations including hash computation,
    change detection, and staleness tracking.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def normalize_scene_text(text: str) -> str:
        """
        Normalize scene text for consistent hashing.
        Removes formatting variations but preserves content.

        Args:
            text: Raw scene text

        Returns:
            Normalized text suitable for hashing
        """
        if not text:
            return ""

        # Remove excessive whitespace but preserve line structure
        lines = [line.strip() for line in text.split('\n')]
        normalized = '\n'.join(line for line in lines if line)

        # Lowercase for case-insensitive comparison
        return normalized.lower()

    @staticmethod
    def compute_scene_hash(scene_text: str) -> str:
        """
        Compute SHA-256 hash of normalized scene text.
        Used for change detection.

        Args:
            scene_text: Scene text to hash

        Returns:
            64-character hex SHA-256 hash
        """
        normalized = AISceneService.normalize_scene_text(scene_text)
        return hashlib.sha256(normalized.encode('utf-8')).hexdigest()

    async def detect_scene_change(self, scene: Scene) -> bool:
        """
        Detect if scene content has changed since last analysis.

        Args:
            scene: Scene object to check

        Returns:
            True if scene has changed, False otherwise
        """
        # Construct full scene text from content_blocks
        scene_text = self._construct_scene_text(scene)
        new_hash = self.compute_scene_hash(scene_text)

        if scene.hash is None or scene.hash != new_hash:
            # Scene changed - update hash
            scene.hash = new_hash
            await self.db.commit()
            return True

        return False

    async def mark_scenes_changed(
        self,
        scene_ids: List[UUID],
        script_id: UUID
    ) -> None:
        """
        Mark multiple scenes as changed and trigger staleness updates.

        Args:
            scene_ids: List of scene IDs that changed
            script_id: Parent script ID
        """
        # Update scene hashes
        scenes = await self.db.execute(
            select(Scene).where(Scene.scene_id.in_(scene_ids))
        )

        for scene in scenes.scalars():
            scene_text = self._construct_scene_text(scene)
            scene.hash = self.compute_scene_hash(scene_text)

        await self.db.commit()

        # Trigger staleness updates
        await self._mark_outline_stale(script_id, len(scene_ids))
        await self._mark_character_sheets_stale(scene_ids, script_id)

    async def _mark_outline_stale(
        self,
        script_id: UUID,
        scene_change_count: int
    ) -> None:
        """
        Mark script outline as stale if threshold exceeded.

        Args:
            script_id: Script ID
            scene_change_count: Number of scenes that changed
        """
        outline = await self.db.execute(
            select(ScriptOutline).where(ScriptOutline.script_id == script_id)
        )
        outline = outline.scalar_one_or_none()

        if outline:
            outline.dirty_scene_count += scene_change_count

            # Mark as stale if threshold exceeded
            if outline.dirty_scene_count >= settings.OUTLINE_STALE_THRESHOLD:
                outline.is_stale = True

            await self.db.commit()

    async def _mark_character_sheets_stale(
        self,
        scene_ids: List[UUID],
        script_id: UUID
    ) -> None:
        """
        Mark character sheets as stale for characters appearing in changed scenes.

        Args:
            scene_ids: List of changed scene IDs
            script_id: Parent script ID
        """
        # Get all characters appearing in changed scenes
        scene_chars = await self.db.execute(
            select(SceneCharacter.character_name)
            .where(SceneCharacter.scene_id.in_(scene_ids))
            .distinct()
        )

        character_names = [row[0] for row in scene_chars]

        if not character_names:
            return

        # Update character sheets
        sheets = await self.db.execute(
            select(CharacterSheet)
            .where(CharacterSheet.script_id == script_id)
            .where(CharacterSheet.character_name.in_(character_names))
        )

        for sheet in sheets.scalars():
            sheet.dirty_scene_count += 1

            # Mark as stale if threshold exceeded
            if sheet.dirty_scene_count >= settings.CHARACTER_STALE_THRESHOLD:
                sheet.is_stale = True

        await self.db.commit()

    async def get_changed_scenes_since(
        self,
        script_id: UUID,
        since: datetime
    ) -> List[Scene]:
        """
        Get all scenes that changed since a given timestamp.

        Args:
            script_id: Script ID
            since: Timestamp to check against

        Returns:
            List of changed scenes
        """
        result = await self.db.execute(
            select(Scene)
            .where(Scene.script_id == script_id)
            .where(Scene.updated_at > since)
            .order_by(Scene.position)
        )

        return result.scalars().all()

    async def extract_character_names(self, scene: Scene) -> List[str]:
        """
        Extract character names from scene content.
        This is a simplified version - could be enhanced with NLP.

        Args:
            scene: Scene object

        Returns:
            List of character names found in scene
        """
        # For now, get existing scene_characters
        # In future, could use NLP to detect from dialogue blocks
        result = await self.db.execute(
            select(SceneCharacter.character_name)
            .where(SceneCharacter.scene_id == scene.scene_id)
        )

        return [row[0] for row in result]

    async def update_scene_characters(
        self,
        scene_id: UUID,
        character_names: List[str]
    ) -> None:
        """
        Update the scene_characters junction table.

        Args:
            scene_id: Scene ID
            character_names: List of character names appearing in scene
        """
        # Remove existing entries
        await self.db.execute(
            select(SceneCharacter)
            .where(SceneCharacter.scene_id == scene_id)
        )

        # Add new entries
        for name in character_names:
            scene_char = SceneCharacter(
                scene_id=scene_id,
                character_name=name
            )
            self.db.add(scene_char)

        await self.db.commit()

    @staticmethod
    def _construct_scene_text(scene: Scene) -> str:
        """
        Construct full scene text from content_blocks or raw_text.

        Args:
            scene: Scene object

        Returns:
            Full scene text as string
        """
        # Try content_blocks first (structured format)
        if scene.content_blocks:
            lines = []
            for block in scene.content_blocks:
                if isinstance(block, dict) and 'text' in block:
                    lines.append(block['text'])
            return '\n'.join(lines)

        # Fall back to raw_text if available
        if hasattr(scene, 'raw_text') and scene.raw_text:
            return scene.raw_text

        # Last resort: scene_heading only
        return scene.scene_heading or ""
