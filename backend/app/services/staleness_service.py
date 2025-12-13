"""
Staleness Tracking Service

Tracks and manages artifact staleness for incremental AI updates.
Marks outlines, character sheets, and summaries as stale when scenes change.
"""

from uuid import UUID
from datetime import datetime
from typing import List
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scene import Scene
from app.models.script_outline import ScriptOutline
from app.models.character_sheet import CharacterSheet
from app.models.scene_character import SceneCharacter
from app.models.scene_summary import SceneSummary
from app.services.scene_service import SceneService


class StalenessService:
    """
    Track and manage artifact staleness.

    Features:
    - Incremental dirty count tracking per artifact
    - Threshold-based staleness marking
    - Integration with background refresh jobs
    """

    # Thresholds for marking artifacts stale
    OUTLINE_REFRESH_THRESHOLD = 5  # scenes changed
    CHARACTER_REFRESH_THRESHOLD = 3  # scenes changed with this character

    def __init__(self, db: AsyncSession):
        self.db = db

    async def mark_scene_changed(self, scene: Scene) -> dict:
        """
        Mark artifacts as potentially stale after scene change.

        Called on every scene save/update via autosave webhook.

        Args:
            scene: Scene object that was modified

        Returns:
            dict with staleness status:
            {
                "outline_marked_stale": bool,
                "characters_marked_stale": List[str],
                "dirty_counts": {
                    "outline": int,
                    "characters": {name: count}
                }
            }
        """
        result = {
            "outline_marked_stale": False,
            "characters_marked_stale": [],
            "dirty_counts": {
                "outline": 0,
                "characters": {}
            }
        }

        # 1. Increment outline dirty count
        await self.db.execute(
            update(ScriptOutline)
            .where(ScriptOutline.script_id == scene.script_id)
            .values(dirty_scene_count=ScriptOutline.dirty_scene_count + 1)
        )

        # Check if outline should be marked stale
        outline = await self.db.scalar(
            select(ScriptOutline)
            .where(ScriptOutline.script_id == scene.script_id)
        )

        if outline:
            result["dirty_counts"]["outline"] = outline.dirty_scene_count + 1  # +1 from update above

            if outline.dirty_scene_count + 1 >= self.OUTLINE_REFRESH_THRESHOLD:
                outline.is_stale = True
                result["outline_marked_stale"] = True

        # 2. Increment character sheets for characters in this scene
        scene_chars = await self.db.execute(
            select(SceneCharacter.character_name)
            .where(SceneCharacter.scene_id == scene.scene_id)
        )

        for char_name in scene_chars.scalars().all():
            # Increment dirty count
            await self.db.execute(
                update(CharacterSheet)
                .where(
                    CharacterSheet.script_id == scene.script_id,
                    CharacterSheet.character_name == char_name
                )
                .values(dirty_scene_count=CharacterSheet.dirty_scene_count + 1)
            )

            # Check if should mark stale
            char_sheet = await self.db.scalar(
                select(CharacterSheet)
                .where(
                    CharacterSheet.script_id == scene.script_id,
                    CharacterSheet.character_name == char_name
                )
            )

            if char_sheet:
                new_dirty_count = char_sheet.dirty_scene_count + 1
                result["dirty_counts"]["characters"][char_name] = new_dirty_count

                if new_dirty_count >= self.CHARACTER_REFRESH_THRESHOLD:
                    char_sheet.is_stale = True
                    result["characters_marked_stale"].append(char_name)

        await self.db.commit()

        return result

    async def should_refresh_outline(self, script_id: UUID) -> bool:
        """
        Check if outline needs refresh.

        Args:
            script_id: Script UUID

        Returns:
            bool: True if outline should be refreshed
        """
        outline = await self.db.scalar(
            select(ScriptOutline)
            .where(ScriptOutline.script_id == script_id)
        )

        if not outline:
            return False

        return outline.is_stale and outline.dirty_scene_count >= self.OUTLINE_REFRESH_THRESHOLD

    async def should_refresh_character(
        self,
        script_id: UUID,
        character_name: str
    ) -> bool:
        """
        Check if character sheet needs refresh.

        Args:
            script_id: Script UUID
            character_name: Character name to check

        Returns:
            bool: True if character sheet should be refreshed
        """
        char_sheet = await self.db.scalar(
            select(CharacterSheet)
            .where(
                CharacterSheet.script_id == script_id,
                CharacterSheet.character_name == character_name
            )
        )

        if not char_sheet:
            return False

        return char_sheet.is_stale and \
               char_sheet.dirty_scene_count >= self.CHARACTER_REFRESH_THRESHOLD

    async def reset_outline_staleness(self, script_id: UUID):
        """
        Reset outline staleness after successful refresh.

        Args:
            script_id: Script UUID
        """
        await self.db.execute(
            update(ScriptOutline)
            .where(ScriptOutline.script_id == script_id)
            .values(
                is_stale=False,
                dirty_scene_count=0,
                last_generated_at=datetime.utcnow()
            )
        )
        await self.db.commit()

    async def reset_character_staleness(self, script_id: UUID, character_name: str):
        """
        Reset character sheet staleness after successful refresh.

        Args:
            script_id: Script UUID
            character_name: Character name
        """
        await self.db.execute(
            update(CharacterSheet)
            .where(
                CharacterSheet.script_id == script_id,
                CharacterSheet.character_name == character_name
            )
            .values(
                is_stale=False,
                dirty_scene_count=0,
                last_generated_at=datetime.utcnow()
            )
        )
        await self.db.commit()

    async def check_scene_staleness(self, scene_id: UUID) -> bool:
        """
        Check if scene needs re-analysis due to content changes.

        Uses hash-based content change detection to determine if scene
        content has changed since last AI analysis.

        Args:
            scene_id: Scene to check

        Returns:
            True if scene is stale (content changed), False otherwise
        """
        scene_service = SceneService(self.db)

        # Get scene
        scene = await self.db.get(Scene, scene_id)

        if not scene:
            return False

        # Check if content changed since last analysis
        return await scene_service.detect_scene_changes(scene)
