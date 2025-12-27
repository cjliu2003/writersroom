# Narrative Analysis Service Design

## Overview

This document specifies the design for generating `PlotThread` and `SceneRelationship` records using AI analysis. The service will integrate with the existing AI ingestion pipeline.

## Current State Analysis

### Existing Models (Already Implemented)

**PlotThread** (`app/models/plot_thread.py`)
```python
class PlotThread(Base):
    id: UUID
    script_id: UUID (FK)
    name: str                    # e.g., "Sam's Redemption Arc"
    scenes: List[int]            # Array of 1-based scene indices
    thread_type: PlotThreadType  # CHARACTER_ARC, PLOT, SUBPLOT, THEME
    description: str
```

**SceneRelationship** (`app/models/scene_relationship.py`)
```python
class SceneRelationship(Base):
    id: UUID
    script_id: UUID (FK)
    setup_scene_id: UUID (FK → Scene)
    payoff_scene_id: UUID (FK → Scene)
    relationship_type: SceneRelationshipType  # SETUP_PAYOFF, CALLBACK, PARALLEL, ECHO
    description: str
```

### Existing Pipeline

```
FDX Upload → Scene Creation → [User triggers analysis]
                                      ↓
                    ┌─────────────────┴─────────────────┐
                    ↓                                   ↓
              partial_analysis                    full_analysis
                    ↓                                   ↓
              Scene Summaries              Scene Summaries
              Embeddings                   Script Outline
                                           Character Sheets
                                           Embeddings
                                           [NEW] Narrative Analysis
```

---

## Service Design

### New File: `app/services/narrative_analysis_service.py`

```python
"""
Narrative Analysis Service - Generate plot threads and scene relationships using Claude

Analyzes screenplay structure to identify:
- Plot threads: Longitudinal narrative patterns across scenes
- Scene relationships: Pairwise narrative connections between scenes
"""

import asyncio
import json
import logging
from typing import List, Dict, Optional, Tuple, Any
from uuid import UUID, uuid4
from datetime import datetime

from anthropic import AsyncAnthropic
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scene import Scene
from app.models.scene_summary import SceneSummary
from app.models.plot_thread import PlotThread, PlotThreadType
from app.models.scene_relationship import SceneRelationship, SceneRelationshipType
from app.core.config import settings

logger = logging.getLogger(__name__)


class NarrativeAnalysisService:
    """
    Service for AI-powered narrative structure analysis.

    Generates:
    - Plot threads (character arcs, storylines, themes)
    - Scene relationships (setup/payoff, callbacks, parallels)
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    async def batch_analyze_narrative(
        self,
        script_id: UUID,
        force_regenerate: bool = False
    ) -> Dict[str, Any]:
        """
        Generate both plot threads and scene relationships in a single API call.

        This is more token-efficient than separate calls since we only send
        the scene summaries once.

        Args:
            script_id: Script to analyze
            force_regenerate: If True, regenerate even if data exists

        Returns:
            Dict with counts of generated threads and relationships
        """
        # Check if analysis already exists
        existing_threads = await self._count_existing_threads(script_id)
        existing_rels = await self._count_existing_relationships(script_id)

        if not force_regenerate and (existing_threads > 0 or existing_rels > 0):
            logger.info(f"Narrative analysis exists for {script_id}: {existing_threads} threads, {existing_rels} relationships")
            return {
                "threads_count": existing_threads,
                "relationships_count": existing_rels,
                "regenerated": False
            }

        # Fetch scene summaries with scene data
        scenes, summaries = await self._fetch_scene_summaries(script_id)

        if not summaries:
            logger.warning(f"No scene summaries found for script {script_id}")
            raise ValueError("Scene summaries required for narrative analysis")

        # Build scene context for prompt
        scene_context = self._build_scene_context(scenes, summaries)

        # Generate combined analysis
        response = await self._call_narrative_analysis(scene_context, len(scenes))

        # Parse and validate results
        threads_data, relationships_data = self._parse_combined_response(response)

        # Create scene position → scene mapping for UUID lookup
        scene_map = {scene.position: scene for scene in scenes}

        # Clear existing data
        await self._clear_existing_data(script_id)

        # Insert plot threads
        threads_created = await self._insert_plot_threads(
            script_id, threads_data, len(scenes)
        )

        # Insert scene relationships
        relationships_created = await self._insert_scene_relationships(
            script_id, relationships_data, scene_map
        )

        # Commit all changes
        await self.db.commit()

        logger.info(
            f"Narrative analysis complete for {script_id}: "
            f"{threads_created} threads, {relationships_created} relationships"
        )

        return {
            "threads_count": threads_created,
            "relationships_count": relationships_created,
            "regenerated": True
        }

    async def generate_plot_threads(
        self,
        script_id: UUID,
        force_regenerate: bool = False
    ) -> List[PlotThread]:
        """
        Generate plot threads for a script.

        Plot thread types:
        - CHARACTER_ARC: A character's transformation journey
        - PLOT: Main storyline thread
        - SUBPLOT: Secondary storyline
        - THEME: Recurring thematic element

        Args:
            script_id: Script to analyze
            force_regenerate: If True, regenerate even if threads exist

        Returns:
            List of created PlotThread objects
        """
        # Check existing
        if not force_regenerate:
            existing = await self._get_existing_threads(script_id)
            if existing:
                return existing

        # Fetch scene summaries
        scenes, summaries = await self._fetch_scene_summaries(script_id)
        if not summaries:
            raise ValueError("Scene summaries required for plot thread analysis")

        # Build context and call API
        scene_context = self._build_scene_context(scenes, summaries)
        threads_data = await self._call_plot_threads_analysis(scene_context, len(scenes))

        # Clear and insert
        await self.db.execute(
            delete(PlotThread).where(PlotThread.script_id == script_id)
        )

        threads = []
        for data in threads_data:
            thread = await self._create_plot_thread(script_id, data, len(scenes))
            if thread:
                threads.append(thread)

        await self.db.commit()
        return threads

    async def generate_scene_relationships(
        self,
        script_id: UUID,
        force_regenerate: bool = False
    ) -> List[SceneRelationship]:
        """
        Generate scene relationships for a script.

        Relationship types:
        - SETUP_PAYOFF: Information/object introduced, then pays off
        - CALLBACK: Later scene references earlier scene
        - PARALLEL: Scenes mirror each other structurally
        - ECHO: Thematic or visual connections

        Args:
            script_id: Script to analyze
            force_regenerate: If True, regenerate even if relationships exist

        Returns:
            List of created SceneRelationship objects
        """
        # Check existing
        if not force_regenerate:
            existing = await self._get_existing_relationships(script_id)
            if existing:
                return existing

        # Fetch scene summaries
        scenes, summaries = await self._fetch_scene_summaries(script_id)
        if not summaries:
            raise ValueError("Scene summaries required for relationship analysis")

        # Build context and call API
        scene_context = self._build_scene_context(scenes, summaries)
        relationships_data = await self._call_relationships_analysis(scene_context, len(scenes))

        # Create scene map
        scene_map = {scene.position: scene for scene in scenes}

        # Clear and insert
        await self.db.execute(
            delete(SceneRelationship).where(SceneRelationship.script_id == script_id)
        )

        relationships = []
        for data in relationships_data:
            rel = await self._create_scene_relationship(script_id, data, scene_map)
            if rel:
                relationships.append(rel)

        await self.db.commit()
        return relationships

    # ─────────────────────────────────────────────────────────────────
    # Private Helper Methods
    # ─────────────────────────────────────────────────────────────────

    async def _fetch_scene_summaries(
        self, script_id: UUID
    ) -> Tuple[List[Scene], List[SceneSummary]]:
        """Fetch all scenes and their summaries for a script."""
        result = await self.db.execute(
            select(Scene, SceneSummary)
            .join(SceneSummary, Scene.scene_id == SceneSummary.scene_id)
            .where(Scene.script_id == script_id)
            .order_by(Scene.position)
        )
        rows = result.all()

        scenes = [row[0] for row in rows]
        summaries = [row[1] for row in rows]

        return scenes, summaries

    def _build_scene_context(
        self,
        scenes: List[Scene],
        summaries: List[SceneSummary]
    ) -> str:
        """Build formatted scene context for AI prompt."""
        lines = []
        for scene, summary in zip(scenes, summaries):
            scene_num = scene.position  # 1-based
            heading = scene.scene_heading or "UNTITLED"
            lines.append(f"SCENE {scene_num}: {heading}")
            lines.append(summary.summary_text)
            lines.append("")  # Blank line separator

        return "\n".join(lines)

    async def _call_narrative_analysis(
        self,
        scene_context: str,
        total_scenes: int
    ) -> str:
        """Call Claude API for combined narrative analysis."""
        prompt = f"""Analyze this screenplay and identify narrative structure patterns.

SCENE SUMMARIES:
{scene_context}

TOTAL SCENES: {total_scenes}

Identify TWO types of patterns:

1. PLOT THREADS - Longitudinal patterns spanning multiple scenes:
   - character_arc: A character's transformation journey
   - plot: Main storyline thread
   - subplot: Secondary storyline
   - theme: Recurring thematic element

2. SCENE RELATIONSHIPS - Pairwise connections between specific scenes:
   - setup_payoff: Information/object introduced in one scene pays off in another
   - callback: A later scene references or echoes an earlier scene
   - parallel: Two scenes mirror each other in structure or situation
   - echo: Thematic or visual connections between scenes

Return ONLY valid JSON in this exact format:
{{
  "plot_threads": [
    {{
      "name": "Thread name",
      "type": "character_arc|plot|subplot|theme",
      "scenes": [1, 5, 12],
      "description": "Brief description of this thread"
    }}
  ],
  "scene_relationships": [
    {{
      "setup_scene": 3,
      "payoff_scene": 15,
      "type": "setup_payoff|callback|parallel|echo",
      "description": "Description of the connection"
    }}
  ]
}}

IMPORTANT:
- Scene numbers must be between 1 and {total_scenes}
- Each thread should span at least 2 scenes
- Each relationship connects exactly 2 different scenes
- setup_scene must come before payoff_scene
- Return realistic patterns you can identify, not invented ones"""

        response = await self.client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content[0].text

    async def _call_plot_threads_analysis(
        self,
        scene_context: str,
        total_scenes: int
    ) -> List[Dict]:
        """Call Claude API for plot threads only."""
        prompt = f"""Analyze this screenplay and identify narrative threads.

SCENE SUMMARIES:
{scene_context}

TOTAL SCENES: {total_scenes}

Identify PLOT THREADS - longitudinal patterns spanning multiple scenes:
- character_arc: A character's transformation journey
- plot: Main storyline thread
- subplot: Secondary storyline
- theme: Recurring thematic element

Return ONLY valid JSON:
{{
  "plot_threads": [
    {{
      "name": "Thread name",
      "type": "character_arc|plot|subplot|theme",
      "scenes": [1, 5, 12],
      "description": "Brief description"
    }}
  ]
}}

Scene numbers must be 1-{total_scenes}. Each thread spans at least 2 scenes."""

        response = await self.client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}]
        )

        return self._parse_threads_response(response.content[0].text)

    async def _call_relationships_analysis(
        self,
        scene_context: str,
        total_scenes: int
    ) -> List[Dict]:
        """Call Claude API for scene relationships only."""
        prompt = f"""Analyze this screenplay and identify scene relationships.

SCENE SUMMARIES:
{scene_context}

TOTAL SCENES: {total_scenes}

Identify SCENE RELATIONSHIPS - pairwise connections between scenes:
- setup_payoff: Information introduced in one scene pays off in another
- callback: A later scene references an earlier scene
- parallel: Two scenes mirror each other structurally
- echo: Thematic or visual connections

Return ONLY valid JSON:
{{
  "scene_relationships": [
    {{
      "setup_scene": 3,
      "payoff_scene": 15,
      "type": "setup_payoff|callback|parallel|echo",
      "description": "Description of the connection"
    }}
  ]
}}

Scene numbers must be 1-{total_scenes}. setup_scene must be < payoff_scene."""

        response = await self.client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}]
        )

        return self._parse_relationships_response(response.content[0].text)

    def _parse_combined_response(
        self,
        response: str
    ) -> Tuple[List[Dict], List[Dict]]:
        """Parse combined narrative analysis response."""
        try:
            # Extract JSON from response (handle markdown code blocks)
            json_str = response
            if "```json" in response:
                json_str = response.split("```json")[1].split("```")[0]
            elif "```" in response:
                json_str = response.split("```")[1].split("```")[0]

            data = json.loads(json_str.strip())

            threads = data.get("plot_threads", [])
            relationships = data.get("scene_relationships", [])

            return threads, relationships

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse narrative analysis JSON: {e}")
            logger.debug(f"Raw response: {response[:500]}")
            return [], []

    def _parse_threads_response(self, response: str) -> List[Dict]:
        """Parse plot threads response."""
        threads, _ = self._parse_combined_response(response)
        return threads

    def _parse_relationships_response(self, response: str) -> List[Dict]:
        """Parse scene relationships response."""
        _, relationships = self._parse_combined_response(response)
        return relationships

    async def _create_plot_thread(
        self,
        script_id: UUID,
        data: Dict,
        total_scenes: int
    ) -> Optional[PlotThread]:
        """Create a PlotThread from parsed data with validation."""
        try:
            name = data.get("name", "").strip()
            thread_type = data.get("type", "").lower()
            scenes = data.get("scenes", [])
            description = data.get("description", "")

            # Validate
            if not name:
                logger.warning("Skipping thread with empty name")
                return None

            if thread_type not in ["character_arc", "plot", "subplot", "theme"]:
                logger.warning(f"Invalid thread type: {thread_type}")
                return None

            # Validate and filter scene numbers
            valid_scenes = [
                s for s in scenes
                if isinstance(s, int) and 1 <= s <= total_scenes
            ]

            if len(valid_scenes) < 2:
                logger.warning(f"Thread '{name}' has fewer than 2 valid scenes")
                return None

            thread = PlotThread(
                id=uuid4(),
                script_id=script_id,
                name=name,
                scenes=valid_scenes,
                thread_type=thread_type,
                description=description
            )
            self.db.add(thread)
            return thread

        except Exception as e:
            logger.error(f"Error creating plot thread: {e}")
            return None

    async def _create_scene_relationship(
        self,
        script_id: UUID,
        data: Dict,
        scene_map: Dict[int, Scene]
    ) -> Optional[SceneRelationship]:
        """Create a SceneRelationship from parsed data with validation."""
        try:
            setup_num = data.get("setup_scene")
            payoff_num = data.get("payoff_scene")
            rel_type = data.get("type", "").lower()
            description = data.get("description", "")

            # Validate scene numbers exist
            setup_scene = scene_map.get(setup_num)
            payoff_scene = scene_map.get(payoff_num)

            if not setup_scene:
                logger.warning(f"Setup scene {setup_num} not found")
                return None

            if not payoff_scene:
                logger.warning(f"Payoff scene {payoff_num} not found")
                return None

            if setup_num >= payoff_num:
                logger.warning(f"Setup scene must come before payoff: {setup_num} >= {payoff_num}")
                return None

            if rel_type not in ["setup_payoff", "callback", "parallel", "echo"]:
                logger.warning(f"Invalid relationship type: {rel_type}")
                return None

            relationship = SceneRelationship(
                id=uuid4(),
                script_id=script_id,
                setup_scene_id=setup_scene.scene_id,
                payoff_scene_id=payoff_scene.scene_id,
                relationship_type=rel_type,
                description=description
            )
            self.db.add(relationship)
            return relationship

        except Exception as e:
            logger.error(f"Error creating scene relationship: {e}")
            return None

    async def _count_existing_threads(self, script_id: UUID) -> int:
        """Count existing plot threads for a script."""
        from sqlalchemy import func
        result = await self.db.execute(
            select(func.count()).where(PlotThread.script_id == script_id)
        )
        return result.scalar() or 0

    async def _count_existing_relationships(self, script_id: UUID) -> int:
        """Count existing scene relationships for a script."""
        from sqlalchemy import func
        result = await self.db.execute(
            select(func.count()).where(SceneRelationship.script_id == script_id)
        )
        return result.scalar() or 0

    async def _get_existing_threads(self, script_id: UUID) -> List[PlotThread]:
        """Get existing plot threads for a script."""
        result = await self.db.execute(
            select(PlotThread).where(PlotThread.script_id == script_id)
        )
        return list(result.scalars().all())

    async def _get_existing_relationships(self, script_id: UUID) -> List[SceneRelationship]:
        """Get existing scene relationships for a script."""
        result = await self.db.execute(
            select(SceneRelationship).where(SceneRelationship.script_id == script_id)
        )
        return list(result.scalars().all())

    async def _clear_existing_data(self, script_id: UUID) -> None:
        """Clear existing plot threads and relationships for regeneration."""
        await self.db.execute(
            delete(PlotThread).where(PlotThread.script_id == script_id)
        )
        await self.db.execute(
            delete(SceneRelationship).where(SceneRelationship.script_id == script_id)
        )

    async def _insert_plot_threads(
        self,
        script_id: UUID,
        threads_data: List[Dict],
        total_scenes: int
    ) -> int:
        """Insert plot threads and return count created."""
        count = 0
        for data in threads_data:
            thread = await self._create_plot_thread(script_id, data, total_scenes)
            if thread:
                count += 1
        return count

    async def _insert_scene_relationships(
        self,
        script_id: UUID,
        relationships_data: List[Dict],
        scene_map: Dict[int, Scene]
    ) -> int:
        """Insert scene relationships and return count created."""
        count = 0
        for data in relationships_data:
            rel = await self._create_scene_relationship(script_id, data, scene_map)
            if rel:
                count += 1
        return count
```

---

## Integration Points

### 1. Worker Integration (`ai_ingestion_worker.py`)

Add to `_analyze_script_full_async`:

```python
from app.services.narrative_analysis_service import NarrativeAnalysisService

async def _analyze_script_full_async(script_id: UUID) -> dict:
    async with AsyncSessionLocal() as db:
        try:
            logger.info(f"Starting full analysis for script {script_id}")

            state_service = ScriptStateService(db)
            ingestion_service = IngestionService(db)
            embedding_service = EmbeddingService(db)
            narrative_service = NarrativeAnalysisService(db)  # NEW

            # Existing: Generate scene summaries
            await ingestion_service.batch_generate_scene_summaries(script_id)

            # Run outline, character sheets, and narrative analysis in parallel
            await asyncio.gather(
                ingestion_service.generate_script_outline(script_id),
                ingestion_service.batch_generate_character_sheets(script_id),
                narrative_service.batch_analyze_narrative(script_id),  # NEW
            )

            # Generate embeddings
            await embedding_service.batch_generate_embeddings(script_id)

            # Update state
            await state_service.mark_analysis_complete(script_id)

            return {"success": True, "script_id": str(script_id)}
```

### 2. New Worker Task

```python
def refresh_narrative_analysis(script_id: str) -> dict:
    """
    Regenerate plot threads and scene relationships.

    Args:
        script_id: Script ID (string UUID)

    Returns:
        Dict with success status and counts
    """
    return asyncio.run(_refresh_narrative_analysis_async(UUID(script_id)))


async def _refresh_narrative_analysis_async(script_id: UUID) -> dict:
    async with AsyncSessionLocal() as db:
        try:
            logger.info(f"Refreshing narrative analysis for {script_id}")

            narrative_service = NarrativeAnalysisService(db)
            result = await narrative_service.batch_analyze_narrative(
                script_id,
                force_regenerate=True
            )

            return {
                "success": True,
                "script_id": str(script_id),
                **result
            }

        except Exception as e:
            logger.error(f"Error refreshing narrative analysis: {e}")
            return {"success": False, "error": str(e)}
```

### 3. MCP Tool Addition (`mcp_tools.py`)

Add `get_scene_relationships` tool:

```python
# In SCREENPLAY_TOOLS list
{
    "name": "get_scene_relationships",
    "description": "Get narrative relationships between scenes (setup/payoff, callbacks, parallels)",
    "input_schema": {
        "type": "object",
        "properties": {
            "relationship_type": {
                "type": "string",
                "enum": ["setup_payoff", "callback", "parallel", "echo"],
                "description": "Optional: Filter by relationship type"
            }
        }
    }
}

# In execute_tool
elif tool_name == "get_scene_relationships":
    return await self._get_scene_relationships(
        script_id=script_id,
        relationship_type=tool_input.get("relationship_type")
    )

# Implementation
async def _get_scene_relationships(
    self,
    script_id: UUID,
    relationship_type: Optional[str] = None
) -> str:
    """Get scene relationships for the script."""
    from app.models.scene_relationship import SceneRelationship

    query = (
        select(SceneRelationship, Scene.position)
        .join(Scene, SceneRelationship.setup_scene_id == Scene.scene_id)
        .where(SceneRelationship.script_id == script_id)
    )

    if relationship_type:
        query = query.where(SceneRelationship.relationship_type == relationship_type)

    result = await self.db.execute(query)
    rows = result.all()

    if not rows:
        type_msg = f" of type '{relationship_type}'" if relationship_type else ""
        return f"No scene relationships found{type_msg}"

    output = f"SCENE RELATIONSHIPS ({len(rows)} found):\n\n"

    for rel, setup_pos in rows:
        # Get payoff scene position
        payoff_result = await self.db.execute(
            select(Scene.position).where(Scene.scene_id == rel.payoff_scene_id)
        )
        payoff_pos = payoff_result.scalar()

        output += f"TYPE: {rel.relationship_type}\n"
        output += f"SETUP: Scene {setup_pos}\n"
        output += f"PAYOFF: Scene {payoff_pos}\n"
        output += f"DESCRIPTION: {rel.description}\n\n"

    return output.strip()
```

---

## API Prompts Design

### Combined Analysis Prompt

The prompt is designed to:
1. Provide clear scene context with numbering
2. Define each thread/relationship type clearly
3. Request structured JSON output
4. Include validation constraints in the prompt
5. Ask for "realistic patterns" to reduce hallucination

### Token Estimation

| Component | Tokens |
|-----------|--------|
| Prompt template | ~300 |
| Scene summaries (30 scenes × 150 tokens) | ~4,500 |
| Response (threads + relationships) | ~800 |
| **Total per analysis** | ~5,600 |

For a 100-scene script:
- Scene summaries: ~15,000 tokens
- May need chunking strategy for very large scripts

---

## Error Handling

| Error | Handling |
|-------|----------|
| No scene summaries | Raise ValueError - require summaries first |
| JSON parse failure | Return empty lists, log error |
| Invalid scene numbers | Skip individual items, log warning |
| Invalid relationship type | Skip item, log warning |
| API failure | Raise exception for retry |

---

## Testing Strategy

### Unit Tests

```python
class TestNarrativeAnalysisService:

    async def test_batch_analyze_narrative_creates_threads(self):
        """Test that batch analysis creates plot threads."""

    async def test_batch_analyze_narrative_creates_relationships(self):
        """Test that batch analysis creates scene relationships."""

    async def test_invalid_scene_numbers_filtered(self):
        """Test that invalid scene numbers are filtered out."""

    async def test_invalid_relationship_types_skipped(self):
        """Test that invalid relationship types are skipped."""

    async def test_setup_must_precede_payoff(self):
        """Test that setup_scene < payoff_scene is enforced."""

    async def test_force_regenerate_clears_existing(self):
        """Test that force_regenerate=True clears existing data."""
```

### Integration Tests

```python
class TestNarrativeAnalysisIntegration:

    async def test_full_pipeline_includes_narrative(self):
        """Test that analyze_script_full includes narrative analysis."""

    async def test_mcp_tool_returns_relationships(self):
        """Test get_scene_relationships MCP tool."""
```

---

## Future Enhancements

1. **Staleness Tracking**: Add `is_stale` and `dirty_scene_count` to models
2. **Incremental Updates**: Update only affected threads when scenes change
3. **Confidence Scores**: Have AI provide confidence for each identified pattern
4. **Manual Override**: Allow users to edit/confirm AI-generated patterns
5. **Visualization**: Frontend component to visualize thread timelines
6. **Chunking**: For scripts > 100 scenes, analyze in chunks and merge

---

## Implementation Checklist

- [ ] Create `app/services/narrative_analysis_service.py`
- [ ] Add `get_scene_relationships` to `mcp_tools.py`
- [ ] Update `ai_ingestion_worker.py` to include narrative analysis
- [ ] Add `refresh_narrative_analysis` worker task
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Update context_builder to include narrative data (optional)
- [ ] Add API endpoint for manual refresh (optional)
