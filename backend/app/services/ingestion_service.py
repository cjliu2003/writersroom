"""
Ingestion Service - Generate scene cards, outlines, and character sheets using Claude

Optimizations:
- Parallel scene summary generation with semaphore (10x faster)
- Pre-fetch existing summaries to eliminate N+1 queries
- Batch commits to reduce transaction overhead

Analytics:
- Per-scene cost tracking via AIOperationMetrics
- Supports cost analysis for script ingestion jobs
"""

import asyncio
import logging
import time
from typing import List, Optional, Callable, Dict, Tuple, Any
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
from app.models.ai_operation_metrics import OperationType
from app.core.config import settings
from app.services.scene_service import SceneService
from app.services.metrics_service import MetricsService

logger = logging.getLogger(__name__)

# Concurrency settings for parallel API calls
# Adjust based on your Claude API tier rate limits
MAX_CONCURRENT_SUMMARY_REQUESTS = getattr(settings, 'MAX_CONCURRENT_SUMMARY_REQUESTS', 10)
MAX_CONCURRENT_CHARACTER_SHEET_REQUESTS = getattr(settings, 'MAX_CONCURRENT_CHARACTER_SHEET_REQUESTS', 5)


class IngestionService:
    """
    Service for generating AI artifacts from screenplay content:
    - Scene summaries (scene cards)
    - Script outlines
    - Character sheets

    Now includes per-operation cost tracking via MetricsService.
    """

    def __init__(self, db: AsyncSession, user_id: Optional[UUID] = None):
        self.db = db
        self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.tokenizer = tiktoken.get_encoding("cl100k_base")
        self.user_id = user_id  # For analytics tracking
        self.metrics_service = MetricsService(db) if user_id else None
        # Deferred metrics for batch operations to avoid session conflicts
        self._deferred_metrics: List[Any] = []

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
        progress_callback: Optional[Callable[[int, int], None]] = None,
        max_concurrent: int = MAX_CONCURRENT_SUMMARY_REQUESTS,
        force_regenerate: bool = False
    ) -> List[SceneSummary]:
        """
        Generate summaries for all scenes in a script using parallel execution.

        Optimizations applied:
        - Pre-fetch existing summaries (eliminates N+1 queries)
        - Parallel API calls with semaphore rate limiting
        - Batch commit at the end (reduces transaction overhead)

        Args:
            script_id: Script ID
            progress_callback: Optional callback function(current, total)
            max_concurrent: Maximum concurrent API calls (default: 10)
            force_regenerate: If True, regenerate all summaries even if they exist

        Returns:
            List of SceneSummary objects
        """
        # Step 1: Get all scenes for script (single query)
        result = await self.db.execute(
            select(Scene)
            .where(Scene.script_id == script_id)
            .order_by(Scene.position)
        )
        scenes = list(result.scalars().all())
        total = len(scenes)

        if total == 0:
            logger.warning(f"No scenes found for script {script_id}")
            return []

        logger.info(f"Starting parallel scene summary generation for {total} scenes (max_concurrent={max_concurrent})")

        # Step 2: Pre-fetch ALL existing summaries in one query (eliminates N+1)
        scene_ids = [scene.scene_id for scene in scenes]
        existing_result = await self.db.execute(
            select(SceneSummary).where(SceneSummary.scene_id.in_(scene_ids))
        )
        existing_map: Dict[UUID, SceneSummary] = {
            summary.scene_id: summary for summary in existing_result.scalars().all()
        }
        logger.info(f"Pre-fetched {len(existing_map)} existing summaries")

        # Step 3: Filter scenes that need processing
        if force_regenerate:
            scenes_to_process = scenes
        else:
            scenes_to_process = [s for s in scenes if s.scene_id not in existing_map]
            logger.info(f"Skipping {len(existing_map)} scenes with existing summaries, processing {len(scenes_to_process)}")

        # Step 4: Parallel generation with semaphore
        semaphore = asyncio.Semaphore(max_concurrent)
        completed_count = len(existing_map) if not force_regenerate else 0
        results: List[Tuple[Scene, Optional[SceneSummary], Optional[Exception]]] = []

        async def generate_one(scene: Scene) -> Tuple[Scene, Optional[SceneSummary], Optional[Exception]]:
            """Generate summary for a single scene with semaphore rate limiting."""
            nonlocal completed_count

            async with semaphore:
                try:
                    existing = existing_map.get(scene.scene_id) if force_regenerate else None
                    summary = await self._generate_scene_summary_no_commit(
                        scene, existing_summary=existing
                    )
                    completed_count += 1

                    if progress_callback:
                        progress_callback(completed_count, total)

                    logger.debug(f"Generated summary for scene {scene.scene_id} ({completed_count}/{total})")
                    return (scene, summary, None)

                except Exception as e:
                    logger.error(f"Failed to generate summary for scene {scene.scene_id}: {str(e)}")
                    return (scene, None, e)

        # Execute all in parallel (semaphore limits concurrency)
        if scenes_to_process:
            results = await asyncio.gather(
                *[generate_one(scene) for scene in scenes_to_process],
                return_exceptions=False  # We handle exceptions in generate_one
            )

        # Step 5: Collect successful summaries and batch add to session
        # IMPORTANT: We add objects here AFTER gather() completes to avoid
        # concurrent session operations that cause "Session is already flushing" errors
        summaries: List[SceneSummary] = []
        new_summaries: List[SceneSummary] = []
        failed_count = 0

        for scene, summary, error in results:
            if summary:
                summaries.append(summary)
                # Check if this is a new summary (not in existing_map)
                if scene.scene_id not in existing_map:
                    new_summaries.append(summary)
            else:
                failed_count += 1

        # Add pre-existing summaries that were skipped
        if not force_regenerate:
            for scene in scenes:
                if scene.scene_id in existing_map:
                    summaries.append(existing_map[scene.scene_id])

        # Now add all new summaries to session (safe - sequential, after parallel work)
        for summary in new_summaries:
            self.db.add(summary)
        logger.info(f"Added {len(new_summaries)} new summaries to session")

        # Add all deferred metrics to session
        if self._deferred_metrics:
            for metric in self._deferred_metrics:
                self.db.add(metric)
            logger.info(f"Added {len(self._deferred_metrics)} deferred metrics to session")
            self._deferred_metrics.clear()  # Reset for next batch

        # Single batch commit for all changes
        try:
            await self.db.commit()
            logger.info(f"Batch committed {len(summaries)} scene summaries")
        except Exception as e:
            logger.error(f"Failed to commit scene summaries: {str(e)}")
            await self.db.rollback()
            raise

        logger.info(
            f"Parallel scene summary generation complete: "
            f"{len(summaries)} successful, {failed_count} failed"
        )

        # Sort by position to maintain order
        summaries.sort(key=lambda s: next(
            (scene.position for scene in scenes if scene.scene_id == s.scene_id), 0
        ))

        return summaries

    async def _generate_scene_summary_no_commit(
        self,
        scene: Scene,
        existing_summary: Optional[SceneSummary] = None
    ) -> SceneSummary:
        """
        Generate scene summary without committing (for batch operations).

        This is an internal method used by batch_generate_scene_summaries
        to enable parallel execution with a single batch commit at the end.

        Args:
            scene: Scene object to summarize
            existing_summary: Pre-fetched existing summary (if any)

        Returns:
            SceneSummary object (not committed)
        """
        # Construct scene text
        scene_text = self._construct_scene_text(scene)

        if not scene_text.strip():
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

        # Call Claude API with timing
        start_time = time.time()
        response = await self.client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )
        latency_ms = int((time.time() - start_time) * 1000)

        summary_text = response.content[0].text
        tokens_estimate = len(self.tokenizer.encode(summary_text))

        # Track metrics if analytics enabled - use defer_add for batch operations
        # to avoid "Session is already flushing" errors during parallel execution
        if self.metrics_service and self.user_id:
            metric = await self.metrics_service.track_operation(
                operation_type=OperationType.INGESTION_SCENE_SUMMARY,
                user_id=self.user_id,
                script_id=scene.script_id,
                scene_id=scene.scene_id,
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                cache_creation_tokens=getattr(response.usage, 'cache_creation_input_tokens', 0),
                cache_read_tokens=getattr(response.usage, 'cache_read_input_tokens', 0),
                model="claude-haiku-4-5",
                latency_ms=latency_ms,
                defer_add=True  # Don't add to session - collect for batch insert
            )
            self._deferred_metrics.append(metric)

        # Update scene hash to mark "this content was analyzed"
        scene.hash = SceneService.compute_scene_hash(scene_text)

        # Create or update summary
        # Note: For batch operations, we return the object but DON'T add new summaries
        # to session here - the caller (batch_generate_scene_summaries) will collect
        # and add them after all parallel coroutines complete
        if existing_summary:
            # Updates to existing objects are tracked automatically by SQLAlchemy
            existing_summary.summary_text = summary_text
            existing_summary.tokens_estimate = tokens_estimate
            existing_summary.version += 1
            existing_summary.last_generated_at = datetime.utcnow()
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
            # Don't add here - return for caller to batch-add after gather()
            return scene_summary

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
            # Call Claude API with timing
            start_time = time.time()
            response = await self.client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=800,
                messages=[{"role": "user", "content": prompt}]
            )
            latency_ms = int((time.time() - start_time) * 1000)

            outline_text = response.content[0].text
            tokens_estimate = len(self.tokenizer.encode(outline_text))

            # Track metrics if analytics enabled
            if self.metrics_service and self.user_id:
                await self.metrics_service.track_operation(
                    operation_type=OperationType.INGESTION_SCRIPT_OUTLINE,
                    user_id=self.user_id,
                    script_id=script_id,
                    input_tokens=response.usage.input_tokens,
                    output_tokens=response.usage.output_tokens,
                    cache_creation_tokens=getattr(response.usage, 'cache_creation_input_tokens', 0),
                    cache_read_tokens=getattr(response.usage, 'cache_read_input_tokens', 0),
                    model="claude-haiku-4-5",
                    latency_ms=latency_ms
                )

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
            # Call Claude API with timing
            start_time = time.time()
            response = await self.client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}]
            )
            latency_ms = int((time.time() - start_time) * 1000)

            sheet_text = response.content[0].text
            tokens_estimate = len(self.tokenizer.encode(sheet_text))

            # Track metrics if analytics enabled
            if self.metrics_service and self.user_id:
                await self.metrics_service.track_operation(
                    operation_type=OperationType.INGESTION_CHARACTER_SHEET,
                    user_id=self.user_id,
                    script_id=script_id,
                    input_tokens=response.usage.input_tokens,
                    output_tokens=response.usage.output_tokens,
                    cache_creation_tokens=getattr(response.usage, 'cache_creation_input_tokens', 0),
                    cache_read_tokens=getattr(response.usage, 'cache_read_input_tokens', 0),
                    model="claude-haiku-4-5",
                    latency_ms=latency_ms
                )

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

    async def _generate_character_sheet_no_commit(
        self,
        script_id: UUID,
        character_name: str,
        existing_sheet: Optional[CharacterSheet] = None,
        scene_data: Optional[List[Tuple[Scene, SceneSummary]]] = None
    ) -> CharacterSheet:
        """
        Generate character sheet without committing (for batch operations).

        This is an internal method used by batch_generate_character_sheets
        to enable parallel execution with a single batch commit at the end.

        Args:
            script_id: Script ID
            character_name: Character name
            existing_sheet: Pre-fetched existing sheet (if any)
            scene_data: Pre-fetched list of (Scene, SceneSummary) tuples for this character

        Returns:
            CharacterSheet object (not committed)
        """
        # Use provided scene_data or fetch it
        if scene_data is None:
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

        # Call Claude API with timing
        start_time = time.time()
        response = await self.client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )
        latency_ms = int((time.time() - start_time) * 1000)

        sheet_text = response.content[0].text
        tokens_estimate = len(self.tokenizer.encode(sheet_text))

        # Track metrics if analytics enabled - use defer_add for batch operations
        if self.metrics_service and self.user_id:
            metric = await self.metrics_service.track_operation(
                operation_type=OperationType.INGESTION_CHARACTER_SHEET,
                user_id=self.user_id,
                script_id=script_id,
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                cache_creation_tokens=getattr(response.usage, 'cache_creation_input_tokens', 0),
                cache_read_tokens=getattr(response.usage, 'cache_read_input_tokens', 0),
                model="claude-haiku-4-5",
                latency_ms=latency_ms,
                defer_add=True  # Don't add to session - collect for batch insert
            )
            self._deferred_metrics.append(metric)

        # Create or update sheet (no commit - caller handles batch commit)
        if existing_sheet:
            existing_sheet.summary_text = sheet_text
            existing_sheet.tokens_estimate = tokens_estimate
            existing_sheet.is_stale = False
            existing_sheet.dirty_scene_count = 0
            existing_sheet.last_generated_at = datetime.utcnow()
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
            # Don't add here - return for caller to batch-add after gather()
            return sheet

    async def batch_generate_character_sheets(
        self,
        script_id: UUID,
        progress_callback: Optional[Callable[[int, int], None]] = None,
        max_concurrent: int = MAX_CONCURRENT_CHARACTER_SHEET_REQUESTS,
        force_regenerate: bool = False
    ) -> List[CharacterSheet]:
        """
        Generate character sheets for all characters in script using parallel execution.

        Optimizations applied:
        - Pre-fetch existing character sheets (eliminates N+1 queries)
        - Pre-fetch scene data for ALL characters (eliminates N+1 scene queries)
        - Parallel API calls with semaphore rate limiting
        - Batch commit at the end (reduces transaction overhead)

        Args:
            script_id: Script ID
            progress_callback: Optional callback function(current, total)
            max_concurrent: Maximum concurrent API calls (default: 5)
            force_regenerate: If True, regenerate all sheets even if they exist

        Returns:
            List of CharacterSheet objects
        """
        # Step 1: Get all unique characters (single query)
        chars_result = await self.db.execute(
            select(SceneCharacter.character_name)
            .join(Scene, SceneCharacter.scene_id == Scene.scene_id)
            .where(Scene.script_id == script_id)
            .distinct()
        )
        character_names = [row[0] for row in chars_result]
        total = len(character_names)

        if total == 0:
            logger.warning(f"No characters found for script {script_id}")
            return []

        logger.info(f"Starting parallel character sheet generation for {total} characters (max_concurrent={max_concurrent})")

        # Step 2: Pre-fetch ALL existing character sheets (eliminates N+1)
        existing_result = await self.db.execute(
            select(CharacterSheet).where(CharacterSheet.script_id == script_id)
        )
        existing_map: Dict[str, CharacterSheet] = {
            sheet.character_name: sheet for sheet in existing_result.scalars().all()
        }
        logger.info(f"Pre-fetched {len(existing_map)} existing character sheets")

        # Step 2.5: Pre-fetch ALL scene data for ALL characters (eliminates N+1 scene queries)
        # This is a single query that gets all (Scene, SceneSummary) pairs for all characters
        scene_data_result = await self.db.execute(
            select(SceneCharacter.character_name, Scene, SceneSummary)
            .join(Scene, SceneCharacter.scene_id == Scene.scene_id)
            .join(SceneSummary, Scene.scene_id == SceneSummary.scene_id)
            .where(Scene.script_id == script_id)
            .order_by(SceneCharacter.character_name, Scene.position)
        )
        # Group scene data by character name
        scene_data_by_character: Dict[str, List[Tuple[Scene, SceneSummary]]] = {}
        for char_name, scene, summary in scene_data_result:
            if char_name not in scene_data_by_character:
                scene_data_by_character[char_name] = []
            scene_data_by_character[char_name].append((scene, summary))
        logger.info(f"Pre-fetched scene data for {len(scene_data_by_character)} characters")

        # Step 3: Filter characters that need processing
        if force_regenerate:
            chars_to_process = character_names
        else:
            chars_to_process = [
                name for name in character_names
                if name not in existing_map or existing_map[name].is_stale
            ]
            skipped = len(character_names) - len(chars_to_process)
            if skipped > 0:
                logger.info(f"Skipping {skipped} characters with fresh sheets, processing {len(chars_to_process)}")

        # Step 4: Parallel generation with semaphore
        semaphore = asyncio.Semaphore(max_concurrent)
        completed_count = len(character_names) - len(chars_to_process)
        results: List[Tuple[str, Optional[CharacterSheet], Optional[Exception]]] = []

        async def generate_one(char_name: str) -> Tuple[str, Optional[CharacterSheet], Optional[Exception]]:
            """Generate sheet for a single character with semaphore rate limiting."""
            nonlocal completed_count

            async with semaphore:
                try:
                    existing = existing_map.get(char_name) if force_regenerate else None
                    # Use pre-fetched scene data (eliminates N+1 queries)
                    char_scene_data = scene_data_by_character.get(char_name, [])
                    sheet = await self._generate_character_sheet_no_commit(
                        script_id,
                        char_name,
                        existing_sheet=existing,
                        scene_data=char_scene_data if char_scene_data else None
                    )
                    completed_count += 1

                    if progress_callback:
                        progress_callback(completed_count, total)

                    logger.debug(f"Generated sheet for {char_name} ({completed_count}/{total})")
                    return (char_name, sheet, None)

                except Exception as e:
                    logger.error(f"Failed to generate sheet for {char_name}: {str(e)}")
                    return (char_name, None, e)

        # Execute all in parallel (semaphore limits concurrency)
        if chars_to_process:
            results = await asyncio.gather(
                *[generate_one(char_name) for char_name in chars_to_process],
                return_exceptions=False  # We handle exceptions in generate_one
            )

        # Step 5: Collect successful sheets and batch add to session
        # IMPORTANT: We add objects here AFTER gather() completes to avoid
        # concurrent session operations that cause "Session is already flushing" errors
        sheets: List[CharacterSheet] = []
        new_sheets: List[CharacterSheet] = []
        failed_count = 0

        for char_name, sheet, error in results:
            if sheet:
                sheets.append(sheet)
                # Check if this is a new sheet (not in existing_map)
                if char_name not in existing_map:
                    new_sheets.append(sheet)
            else:
                failed_count += 1

        # Add pre-existing sheets that were skipped
        if not force_regenerate:
            for char_name in character_names:
                if char_name in existing_map and not existing_map[char_name].is_stale:
                    if existing_map[char_name] not in sheets:
                        sheets.append(existing_map[char_name])

        # Now add all new sheets to session (safe - sequential, after parallel work)
        for sheet in new_sheets:
            self.db.add(sheet)
        logger.info(f"Added {len(new_sheets)} new character sheets to session")

        # Add all deferred metrics to session
        if self._deferred_metrics:
            for metric in self._deferred_metrics:
                self.db.add(metric)
            logger.info(f"Added {len(self._deferred_metrics)} deferred metrics to session")
            self._deferred_metrics.clear()  # Reset for next batch

        # Single batch commit for all changes
        try:
            await self.db.commit()
            logger.info(f"Batch committed {len(sheets)} character sheets")
        except Exception as e:
            logger.error(f"Failed to commit character sheets: {str(e)}")
            await self.db.rollback()
            raise

        logger.info(
            f"Parallel character sheet generation complete: "
            f"{len(sheets)} successful, {failed_count} failed"
        )

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
