"""
Script State Service - Manage script analysis state machine and trigger ingestion
"""

import logging
from typing import Optional
from uuid import UUID
from datetime import datetime

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.script import Script
from app.models.scene import Scene
from app.models.script_state import ScriptState
from app.services.ai_scene_service import AISceneService
from app.services.ingestion_service import IngestionService
from app.services.embedding_service import EmbeddingService
from app.core.config import settings

logger = logging.getLogger(__name__)


class ScriptStateService:
    """
    Service for managing script analysis state transitions and triggering
    appropriate ingestion pipelines.

    State transitions:
    - empty → partial: When script reaches minimum threshold (3 scenes or 10 pages)
    - partial → analyzed: When script is substantially complete (30 scenes or 60 pages)
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.ai_scene_service = AISceneService(db)
        self.ingestion_service = IngestionService(db)
        self.embedding_service = EmbeddingService(db)

    async def check_state_transition(self, script: Script) -> Optional[ScriptState]:
        """
        Check if script should transition to a new state.

        Args:
            script: Script object to check

        Returns:
            New state if transition should occur, None otherwise
        """
        scene_count = await self.count_scenes(script.script_id)
        page_count = await self.estimate_page_count(script.script_id)

        logger.info(
            f"Script {script.script_id} state={script.state}, "
            f"scenes={scene_count}, pages={page_count}"
        )

        if script.state == ScriptState.EMPTY:
            if (scene_count >= settings.EMPTY_TO_PARTIAL_MIN_SCENES or
                    page_count >= settings.EMPTY_TO_PARTIAL_MIN_PAGES):
                return ScriptState.PARTIAL

        elif script.state == ScriptState.PARTIAL:
            if (scene_count >= settings.PARTIAL_TO_ANALYZED_MIN_SCENES or
                    page_count >= settings.PARTIAL_TO_ANALYZED_MIN_PAGES):
                return ScriptState.ANALYZED

        return None

    async def transition_script_state(
        self,
        script: Script,
        new_state: ScriptState,
        user_initiated: bool = False
    ) -> None:
        """
        Transition script to new state and trigger appropriate analysis.

        Args:
            script: Script object
            new_state: Target state
            user_initiated: Whether transition was manually requested
        """
        old_state = script.state
        script.state = new_state.value
        script.last_state_transition = datetime.utcnow()
        await self.db.commit()

        logger.info(
            f"Script {script.script_id} transitioned {old_state} → {new_state.value}"
        )

        # Trigger analysis based on new state
        try:
            if new_state == ScriptState.PARTIAL:
                # Partial ingestion: scene cards + embeddings
                await self.trigger_partial_ingestion(script.script_id)

            elif new_state == ScriptState.ANALYZED:
                # Full analysis: scene cards + outline + character sheets + embeddings
                await self.trigger_full_analysis(script.script_id)

        except Exception as e:
            logger.error(
                f"Error during {new_state.value} ingestion for script {script.script_id}: {str(e)}"
            )
            raise

    async def trigger_partial_ingestion(self, script_id: UUID) -> None:
        """
        Trigger partial ingestion pipeline:
        1. Generate scene summaries (scene cards)
        2. Generate embeddings

        Args:
            script_id: Script ID
        """
        logger.info(f"Starting partial ingestion for script {script_id}")

        # Step 1: Generate scene summaries
        logger.info("Generating scene summaries...")
        summaries = await self.ingestion_service.batch_generate_scene_summaries(
            script_id,
            progress_callback=self._log_progress("Scene summaries")
        )

        logger.info(f"Generated {len(summaries)} scene summaries")

        # Step 2: Generate embeddings
        logger.info("Generating embeddings...")
        embeddings = await self.embedding_service.batch_embed_scene_summaries(script_id)

        logger.info(f"Generated {len(embeddings)} embeddings")
        logger.info(f"Partial ingestion complete for script {script_id}")

    async def trigger_full_analysis(self, script_id: UUID) -> None:
        """
        Trigger full analysis pipeline:
        1. Generate scene summaries (if not already done)
        2. Generate script outline
        3. Generate character sheets
        4. Generate embeddings (if not already done)

        Args:
            script_id: Script ID
        """
        logger.info(f"Starting full analysis for script {script_id}")

        # Step 1: Ensure scene summaries exist
        logger.info("Ensuring scene summaries exist...")
        summaries = await self.ingestion_service.batch_generate_scene_summaries(
            script_id,
            progress_callback=self._log_progress("Scene summaries")
        )

        logger.info(f"Scene summaries: {len(summaries)}")

        # Step 2: Generate script outline
        logger.info("Generating script outline...")
        outline = await self.ingestion_service.generate_script_outline(script_id)

        logger.info(f"Script outline generated ({outline.tokens_estimate} tokens)")

        # Step 3: Generate character sheets
        logger.info("Generating character sheets...")
        sheets = await self.ingestion_service.batch_generate_character_sheets(
            script_id,
            progress_callback=self._log_progress("Character sheets")
        )

        logger.info(f"Generated {len(sheets)} character sheets")

        # Step 4: Generate embeddings
        logger.info("Generating embeddings...")
        embeddings = await self.embedding_service.batch_embed_scene_summaries(script_id)

        logger.info(f"Generated {len(embeddings)} embeddings")
        logger.info(f"Full analysis complete for script {script_id}")

    async def count_scenes(self, script_id: UUID) -> int:
        """
        Count number of scenes in script.

        Args:
            script_id: Script ID

        Returns:
            Scene count
        """
        result = await self.db.execute(
            select(func.count(Scene.scene_id))
            .where(Scene.script_id == script_id)
        )

        return result.scalar() or 0

    async def estimate_page_count(self, script_id: UUID) -> int:
        """
        Estimate page count based on content.

        Screenplay standard: ~55 lines per page

        Args:
            script_id: Script ID

        Returns:
            Estimated page count
        """
        scenes = await self.db.execute(
            select(Scene).where(Scene.script_id == script_id)
        )

        total_lines = 0
        for scene in scenes.scalars():
            scene_text = self._construct_scene_text(scene)
            total_lines += len(scene_text.split('\n'))

        return total_lines // 55

    async def check_and_transition_if_needed(
        self,
        script_id: UUID
    ) -> Optional[ScriptState]:
        """
        Check if script should transition and perform transition if needed.

        Args:
            script_id: Script ID

        Returns:
            New state if transition occurred, None otherwise
        """
        # Get script
        result = await self.db.execute(
            select(Script).where(Script.script_id == script_id)
        )
        script = result.scalar_one_or_none()

        if not script:
            raise ValueError(f"Script {script_id} not found")

        # Check if transition is needed
        new_state = await self.check_state_transition(script)

        if new_state:
            await self.transition_script_state(script, new_state, user_initiated=False)
            return new_state

        return None

    async def force_reanalysis(
        self,
        script_id: UUID,
        target_state: ScriptState = ScriptState.ANALYZED
    ) -> None:
        """
        Force complete reanalysis of script regardless of current state.

        Args:
            script_id: Script ID
            target_state: State to transition to (default: ANALYZED)
        """
        logger.info(f"Forcing reanalysis for script {script_id} to state {target_state.value}")

        # Get script
        result = await self.db.execute(
            select(Script).where(Script.script_id == script_id)
        )
        script = result.scalar_one_or_none()

        if not script:
            raise ValueError(f"Script {script_id} not found")

        # Transition to target state
        await self.transition_script_state(script, target_state, user_initiated=True)

    @staticmethod
    def _log_progress(task_name: str):
        """
        Create progress callback function for batch operations.

        Args:
            task_name: Name of task for logging

        Returns:
            Progress callback function
        """
        def callback(current: int, total: int):
            logger.info(f"{task_name}: {current}/{total}")

        return callback

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
