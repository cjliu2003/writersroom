"""
Ingestion Service - Generate scene cards, outlines, and character sheets using Claude
"""

import logging
from typing import List, Optional, Callable
from uuid import UUID, uuid4
from datetime import datetime

from anthropic import AsyncAnthropic
import tiktoken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scene import Scene
from app.models.scene_summary import SceneSummary
from app.models.script_outline import ScriptOutline
from app.models.character_sheet import CharacterSheet
from app.models.scene_character import SceneCharacter
from app.core.config import settings
from app.services.scene_service import SceneService

logger = logging.getLogger(__name__)


class IngestionService:
    """
    Service for generating AI artifacts from screenplay content:
    - Scene summaries (scene cards)
    - Script outlines
    - Character sheets
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.tokenizer = tiktoken.get_encoding("cl100k_base")

    async def generate_scene_summary(
        self,
        scene: Scene,
        force_regenerate: bool = False
    ) -> SceneSummary:
        """
        Generate structured scene card from scene text.

        Scene card structure (5-7 lines, ~150 tokens):
        - Action: 1-2 sentence plot summary
        - Conflict: Core tension or obstacle
        - Character Changes: Emotional/relational shifts
        - Plot Progression: How this advances story
        - Tone: Pacing and emotional register

        Args:
            scene: Scene object to summarize
            force_regenerate: If True, regenerate even if summary exists

        Returns:
            SceneSummary object
        """
        # Check if summary already exists
        existing = await self.db.execute(
            select(SceneSummary).where(SceneSummary.scene_id == scene.scene_id)
        )
        existing_summary = existing.scalar_one_or_none()

        if existing_summary and not force_regenerate:
            logger.info(f"Scene summary already exists for scene {scene.scene_id}")
            return existing_summary

        # Construct scene text
        scene_text = self._construct_scene_text(scene)

        if not scene_text.strip():
            logger.warning(f"Scene {scene.scene_id} has no content, skipping summary generation")
            raise ValueError(f"Scene {scene.scene_id} has no content")

        # Create prompt
        prompt = f"""Analyze this screenplay scene and create a concise scene card.

Scene {scene.position}: {scene.scene_heading or 'UNTITLED SCENE'}

{scene_text}

Create a structured summary with these sections:

**Action:** (1-2 sentences summarizing what happens)
**Conflict:** (The core tension, obstacle, or question)
**Character Changes:** (Emotional or relational shifts)
**Plot Progression:** (How this advances the story)
**Tone:** (Pacing and emotional register)

Keep total length to 5-7 lines (~150 tokens)."""

        try:
            # Call Claude API
            response = await self.client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}]
            )

            summary_text = response.content[0].text
            tokens_estimate = len(self.tokenizer.encode(summary_text))

            # Create or update summary
            if existing_summary:
                existing_summary.summary_text = summary_text
                existing_summary.tokens_estimate = tokens_estimate
                existing_summary.version += 1
                existing_summary.last_generated_at = datetime.utcnow()

                # Update scene hash to mark "this content was analyzed"
                scene.hash = SceneService.compute_scene_hash(scene_text)

                await self.db.commit()
                return existing_summary
            else:
                scene_summary = SceneSummary(
                    id=uuid4(),
                    scene_id=scene.scene_id,
                    summary_text=summary_text,
                    tokens_estimate=tokens_estimate,
                    version=1,
                    last_generated_at=datetime.utcnow()
                )
                self.db.add(scene_summary)

                # Update scene hash to mark "this content was analyzed"
                scene.hash = SceneService.compute_scene_hash(scene_text)

                await self.db.commit()
                return scene_summary

        except Exception as e:
            logger.error(f"Error generating scene summary for scene {scene.scene_id}: {str(e)}")
            raise

    async def batch_generate_scene_summaries(
        self,
        script_id: UUID,
        progress_callback: Optional[Callable[[int, int], None]] = None
    ) -> List[SceneSummary]:
        """
        Generate summaries for all scenes in a script.

        Args:
            script_id: Script ID
            progress_callback: Optional callback function(current, total)

        Returns:
            List of SceneSummary objects
        """
        # Get all scenes for script
        result = await self.db.execute(
            select(Scene)
            .where(Scene.script_id == script_id)
            .order_by(Scene.position)
        )
        scenes = result.scalars().all()

        summaries = []
        total = len(scenes)

        for idx, scene in enumerate(scenes):
            try:
                summary = await self.generate_scene_summary(scene)
                summaries.append(summary)

                if progress_callback:
                    progress_callback(idx + 1, total)

                logger.info(f"Generated summary {idx + 1}/{total} for scene {scene.scene_id}")

            except Exception as e:
                logger.error(f"Failed to generate summary for scene {scene.scene_id}: {str(e)}")
                # Continue with other scenes
                continue

        return summaries

    async def generate_script_outline(
        self,
        script_id: UUID,
        force_regenerate: bool = False
    ) -> ScriptOutline:
        """
        Generate global outline from all scene summaries.

        Includes:
        - High-level story summary
        - Act-by-act breakdown
        - Key turning points

        Args:
            script_id: Script ID
            force_regenerate: If True, regenerate even if outline exists

        Returns:
            ScriptOutline object
        """
        # Check if outline already exists
        existing = await self.db.execute(
            select(ScriptOutline).where(ScriptOutline.script_id == script_id)
        )
        existing_outline = existing.scalar_one_or_none()

        if existing_outline and not force_regenerate and not existing_outline.is_stale:
            logger.info(f"Script outline already exists and is fresh for script {script_id}")
            return existing_outline

        # Fetch all scene summaries
        summaries_result = await self.db.execute(
            select(SceneSummary)
            .join(Scene, SceneSummary.scene_id == Scene.scene_id)
            .where(Scene.script_id == script_id)
            .order_by(Scene.position)
        )
        summaries = summaries_result.scalars().all()

        if not summaries:
            logger.warning(f"No scene summaries found for script {script_id}, cannot generate outline")
            raise ValueError(f"No scene summaries available for script {script_id}")

        # Concatenate scene cards
        scene_cards = "\n\n".join([
            f"Scene {idx + 1}: {summary.summary_text}"
            for idx, summary in enumerate(summaries)
        ])

        # Create prompt
        prompt = f"""Analyze this screenplay and create a comprehensive outline.

SCENE CARDS:
{scene_cards}

Create an outline with:

1. **LOGLINE:** One-sentence story summary
2. **ACT STRUCTURE:** Break scenes into acts and identify key beats
3. **MAJOR TURNING POINTS:** Inciting incident, midpoint, climax
4. **CENTRAL CONFLICT:** What's the core story engine?

Keep total length under 500 tokens."""

        try:
            # Call Claude API
            response = await self.client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=800,
                messages=[{"role": "user", "content": prompt}]
            )

            outline_text = response.content[0].text
            tokens_estimate = len(self.tokenizer.encode(outline_text))

            # Create or update outline
            if existing_outline:
                existing_outline.summary_text = outline_text
                existing_outline.tokens_estimate = tokens_estimate
                existing_outline.version += 1
                existing_outline.is_stale = False
                existing_outline.dirty_scene_count = 0
                existing_outline.last_generated_at = datetime.utcnow()
                await self.db.commit()
                return existing_outline
            else:
                outline = ScriptOutline(
                    id=uuid4(),
                    script_id=script_id,
                    version=1,
                    summary_text=outline_text,
                    tokens_estimate=tokens_estimate,
                    is_stale=False,
                    dirty_scene_count=0,
                    last_generated_at=datetime.utcnow()
                )
                self.db.add(outline)
                await self.db.commit()
                return outline

        except Exception as e:
            logger.error(f"Error generating script outline for script {script_id}: {str(e)}")
            raise

    async def generate_character_sheet(
        self,
        script_id: UUID,
        character_name: str,
        force_regenerate: bool = False
    ) -> CharacterSheet:
        """
        Generate character sheet for a specific character.

        Includes:
        - Want/Need (external goal vs internal need)
        - Character arc progression
        - Key scenes and relationships

        Args:
            script_id: Script ID
            character_name: Character name
            force_regenerate: If True, regenerate even if sheet exists

        Returns:
            CharacterSheet object
        """
        # Check if sheet already exists
        existing = await self.db.execute(
            select(CharacterSheet)
            .where(CharacterSheet.script_id == script_id)
            .where(CharacterSheet.character_name == character_name)
        )
        existing_sheet = existing.scalar_one_or_none()

        if existing_sheet and not force_regenerate and not existing_sheet.is_stale:
            logger.info(f"Character sheet already exists and is fresh for {character_name}")
            return existing_sheet

        # Get all scenes where character appears
        scenes_result = await self.db.execute(
            select(Scene, SceneSummary)
            .join(SceneCharacter, Scene.scene_id == SceneCharacter.scene_id)
            .join(SceneSummary, Scene.scene_id == SceneSummary.scene_id)
            .where(SceneCharacter.character_name == character_name)
            .where(Scene.script_id == script_id)
            .order_by(Scene.position)
        )

        scene_data = scenes_result.all()

        if not scene_data:
            logger.warning(f"No scenes found for character {character_name}")
            raise ValueError(f"No scenes found for character {character_name}")

        # Build character timeline
        timeline = "\n".join([
            f"Scene {scene.position}: {summary.summary_text}"
            for scene, summary in scene_data
        ])

        # Create prompt
        prompt = f"""Analyze {character_name}'s arc across these scenes:

{timeline}

Create a character sheet with:

1. **WANT:** External goal (what they think they need)
2. **NEED:** Internal need (what they actually need)
3. **ARC:** How they change from beginning to end
4. **KEY RELATIONSHIPS:** Important connections to other characters
5. **PIVOTAL MOMENTS:** 3-5 defining scenes

Keep under 300 tokens."""

        try:
            # Call Claude API
            response = await self.client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}]
            )

            sheet_text = response.content[0].text
            tokens_estimate = len(self.tokenizer.encode(sheet_text))

            # Create or update sheet
            if existing_sheet:
                existing_sheet.summary_text = sheet_text
                existing_sheet.tokens_estimate = tokens_estimate
                existing_sheet.is_stale = False
                existing_sheet.dirty_scene_count = 0
                existing_sheet.last_generated_at = datetime.utcnow()
                await self.db.commit()
                return existing_sheet
            else:
                sheet = CharacterSheet(
                    id=uuid4(),
                    script_id=script_id,
                    character_name=character_name,
                    summary_text=sheet_text,
                    tokens_estimate=tokens_estimate,
                    is_stale=False,
                    dirty_scene_count=0,
                    last_generated_at=datetime.utcnow()
                )
                self.db.add(sheet)
                await self.db.commit()
                return sheet

        except Exception as e:
            logger.error(f"Error generating character sheet for {character_name}: {str(e)}")
            raise

    async def batch_generate_character_sheets(
        self,
        script_id: UUID,
        progress_callback: Optional[Callable[[int, int], None]] = None
    ) -> List[CharacterSheet]:
        """
        Generate character sheets for all characters in script.

        Args:
            script_id: Script ID
            progress_callback: Optional callback function(current, total)

        Returns:
            List of CharacterSheet objects
        """
        # Get all unique characters
        chars_result = await self.db.execute(
            select(SceneCharacter.character_name)
            .join(Scene, SceneCharacter.scene_id == Scene.scene_id)
            .where(Scene.script_id == script_id)
            .distinct()
        )

        character_names = [row[0] for row in chars_result]
        sheets = []
        total = len(character_names)

        for idx, char_name in enumerate(character_names):
            try:
                sheet = await self.generate_character_sheet(script_id, char_name)
                sheets.append(sheet)

                if progress_callback:
                    progress_callback(idx + 1, total)

                logger.info(f"Generated character sheet {idx + 1}/{total} for {char_name}")

            except Exception as e:
                logger.error(f"Failed to generate character sheet for {char_name}: {str(e)}")
                # Continue with other characters
                continue

        return sheets

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
