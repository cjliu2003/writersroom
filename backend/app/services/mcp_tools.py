"""
MCP Tool Definitions and Execution

Provides Claude with tools to interact with screenplay data:
- get_scene: Get full text of a specific scene
- get_scene_context: Get scene plus neighboring scenes
- get_character_scenes: Get all scenes for a character
- search_script: Semantic search across scenes
- analyze_pacing: Quantitative pacing metrics (no LLM tokens)
- get_plot_threads: Get plot threads and their scenes

These tools enable Claude to provide more accurate, context-aware responses
by allowing it to dynamically retrieve exactly the information it needs.
"""

from uuid import UUID


# User-friendly status messages for each tool
# These are shown to non-technical users while the AI works
TOOL_STATUS_MESSAGES = {
    "get_scene": {
        "active": "Reading scene {scene_index}...",
        "active_default": "Reading the scene...",
        "complete": "Finished reading scene"
    },
    "get_scene_context": {
        "active": "Looking at scene {scene_index} and surrounding scenes...",
        "active_default": "Looking at the scene and its context...",
        "complete": "Finished reviewing scene context"
    },
    "get_character_scenes": {
        "active": "Tracking {character_name}'s appearances...",
        "active_default": "Tracking character appearances...",
        "complete": "Finished tracking character"
    },
    "search_script": {
        "active": "Searching the screenplay...",
        "active_default": "Searching the screenplay...",
        "complete": "Finished searching"
    },
    "analyze_pacing": {
        "active": "Analyzing the pacing and structure...",
        "active_default": "Analyzing the pacing and structure...",
        "complete": "Finished pacing analysis"
    },
    "get_plot_threads": {
        "active": "Reviewing storylines and plot threads...",
        "active_default": "Reviewing storylines and plot threads...",
        "complete": "Finished reviewing storylines"
    },
    "get_scene_relationships": {
        "active": "Analyzing narrative connections between scenes...",
        "active_default": "Analyzing narrative connections between scenes...",
        "complete": "Finished analyzing scene relationships"
    },
    # P1.1: Batch tools status messages
    "get_scenes": {
        "active": "Reading scenes {scene_indices}...",
        "active_default": "Reading multiple scenes...",
        "complete": "Finished reading scenes"
    },
    "get_scenes_context": {
        "active": "Reviewing scenes {scene_indices} and surrounding context...",
        "active_default": "Reviewing multiple scenes with context...",
        "complete": "Finished reviewing scene contexts"
    }
}


def get_tool_status_message(tool_name: str, tool_input: dict, status: str = "active") -> str:
    """
    Get a user-friendly status message for a tool execution.

    Args:
        tool_name: Name of the tool being executed
        tool_input: Input parameters for the tool
        status: "active" for in-progress, "complete" for finished

    Returns:
        User-friendly status message string
    """
    messages = TOOL_STATUS_MESSAGES.get(tool_name, {
        "active": "Analyzing your screenplay...",
        "active_default": "Analyzing your screenplay...",
        "complete": "Analysis complete"
    })

    if status == "complete":
        return messages["complete"]

    # Try to format with tool input parameters
    try:
        # Handle scene_index - convert to 1-based for users
        if "scene_index" in tool_input:
            formatted_input = {**tool_input, "scene_index": tool_input["scene_index"] + 1}
        else:
            formatted_input = tool_input

        return messages["active"].format(**formatted_input)
    except (KeyError, TypeError):
        return messages["active_default"]


from typing import Optional, List, Dict, Any
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from app.models.scene import Scene
from app.models.scene_character import SceneCharacter
from app.models.plot_thread import PlotThread, PlotThreadType
from app.models.scene_relationship import SceneRelationship, SceneRelationshipType
from app.models.character_sheet import CharacterSheet
from app.services.retrieval_service import RetrievalService


# MCP Tool Definitions for Claude API
SCREENPLAY_TOOLS = [
    {
        "name": "get_scene",
        "description": "Get full text of a specific scene. Use this when you need the complete dialogue and action lines.",
        "input_schema": {
            "type": "object",
            "properties": {
                "scene_index": {
                    "type": "integer",
                    "description": "0-based index: Scene 1 = 0, Scene 5 = 4, Scene 10 = 9. Subtract 1 from the user's scene number."
                }
            },
            "required": ["scene_index"]
        }
    },
    {
        "name": "get_scene_context",
        "description": "Get a scene plus N neighboring scenes for narrative context. Better than multiple get_scene calls.",
        "input_schema": {
            "type": "object",
            "properties": {
                "scene_index": {
                    "type": "integer",
                    "description": "0-based index: Scene 1 = 0, Scene 5 = 4. Subtract 1 from user's scene number."
                },
                "neighbor_count": {
                    "type": "integer",
                    "default": 1,
                    "description": "How many scenes before and after to include"
                }
            },
            "required": ["scene_index"]
        }
    },
    {
        "name": "get_character_scenes",
        "description": "Get all scenes where a specific character appears, with their arc timeline.",
        "input_schema": {
            "type": "object",
            "properties": {
                "character_name": {
                    "type": "string",
                    "description": "Character name to search for. IMPORTANT: Screenplay character names are typically stored as FIRST NAME ONLY in caps (e.g., 'SAM' not 'Sam Carter', 'JOHN' not 'John Smith'). Use just the first name for best results. The search will try flexible matching if exact match fails."
                },
                "include_full_text": {
                    "type": "boolean",
                    "default": False,
                    "description": "Whether to include full scene text or just summaries"
                }
            },
            "required": ["character_name"]
        }
    },
    {
        "name": "search_script",
        "description": "Search scenes by keyword and semantic similarity with optional filters.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query (keywords or semantic description)"
                },
                "filters": {
                    "type": "object",
                    "properties": {
                        "characters": {
                            "type": "array",
                            "items": {"type": "string"}
                        }
                    }
                },
                "limit": {
                    "type": "integer",
                    "default": 10,
                    "description": "Max results to return"
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "analyze_pacing",
        "description": "Get quantitative pacing metrics (no LLM tokens used). Returns scene lengths, act distributions, dialogue ratios.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "get_plot_threads",
        "description": "Get plot threads and their associated scenes. Useful for tracking storylines.",
        "input_schema": {
            "type": "object",
            "properties": {
                "thread_type": {
                    "type": "string",
                    "enum": ["character_arc", "plot", "subplot", "theme"],
                    "description": "Filter by thread type (optional)"
                }
            },
            "required": []
        }
    },
    {
        "name": "get_scene_relationships",
        "description": "Get narrative relationships between scenes (setup/payoff, callbacks, parallels, echoes). Useful for understanding story structure and foreshadowing.",
        "input_schema": {
            "type": "object",
            "properties": {
                "relationship_type": {
                    "type": "string",
                    "enum": ["setup_payoff", "callback", "parallel", "echo"],
                    "description": "Filter by relationship type: setup_payoff (foreshadowing), callback (references), parallel (mirrored scenes), echo (thematic connections)"
                }
            },
            "required": []
        }
    },
    # P1.1: Batch tools for efficiency
    {
        "name": "get_scenes",
        "description": "Get full text of multiple scenes at once. More efficient than multiple get_scene calls. Use when comparing scenes or analyzing multiple parts of the script.",
        "input_schema": {
            "type": "object",
            "properties": {
                "scene_indices": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "Array of 0-based scene indices. Scene 1 = 0, Scene 5 = 4. Maximum 10 scenes per call."
                },
                "include_summaries": {
                    "type": "boolean",
                    "default": True,
                    "description": "Include scene summaries in addition to full text"
                },
                "max_chars_per_scene": {
                    "type": "integer",
                    "default": 3000,
                    "description": "Max characters per scene to prevent huge responses"
                }
            },
            "required": ["scene_indices"]
        }
    },
    {
        "name": "get_scenes_context",
        "description": "Get multiple scenes with their surrounding context. Batch version of get_scene_context. Deduplicates overlapping neighbors automatically.",
        "input_schema": {
            "type": "object",
            "properties": {
                "scene_indices": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "Array of 0-based target scene indices"
                },
                "neighbor_count": {
                    "type": "integer",
                    "default": 1,
                    "description": "How many scenes before/after each target to include"
                },
                "max_chars_per_scene": {
                    "type": "integer",
                    "default": 2000,
                    "description": "Max characters per scene"
                }
            },
            "required": ["scene_indices"]
        }
    }
]


class MCPToolExecutor:
    """
    Execute MCP tool calls from LLM.

    Handles all screenplay-specific tools and returns formatted results
    for Claude to use in generating responses.
    """

    def __init__(self, db: AsyncSession, script_id: UUID):
        self.db = db
        self.script_id = script_id

    async def execute_tool(
        self,
        tool_name: str,
        tool_input: dict
    ) -> str:
        """
        Execute tool and return result as string.

        Args:
            tool_name: Name of the tool to execute
            tool_input: Input parameters for the tool

        Returns:
            str: Formatted result for Claude to process
        """
        if tool_name == "get_scene":
            return await self._get_scene(
                script_id=self.script_id,
                scene_index=tool_input["scene_index"]
            )

        elif tool_name == "get_scene_context":
            return await self._get_scene_context(
                script_id=self.script_id,
                scene_index=tool_input["scene_index"],
                neighbor_count=tool_input.get("neighbor_count", 1)
            )

        elif tool_name == "get_character_scenes":
            return await self._get_character_scenes(
                script_id=self.script_id,
                character_name=tool_input["character_name"],
                include_full_text=tool_input.get("include_full_text", False)
            )

        elif tool_name == "search_script":
            return await self._search_script(
                script_id=self.script_id,
                query=tool_input["query"],
                filters=tool_input.get("filters"),
                limit=tool_input.get("limit", 10)
            )

        elif tool_name == "analyze_pacing":
            return await self._analyze_pacing(
                script_id=self.script_id
            )

        elif tool_name == "get_plot_threads":
            return await self._get_plot_threads(
                script_id=self.script_id,
                thread_type=tool_input.get("thread_type")
            )

        elif tool_name == "get_scene_relationships":
            return await self._get_scene_relationships(
                script_id=self.script_id,
                relationship_type=tool_input.get("relationship_type")
            )

        # P1.1: Batch tools
        elif tool_name == "get_scenes":
            return await self._get_scenes_batch(
                script_id=self.script_id,
                scene_indices=tool_input["scene_indices"],
                include_summaries=tool_input.get("include_summaries", True),
                max_chars_per_scene=tool_input.get("max_chars_per_scene", 3000)
            )

        elif tool_name == "get_scenes_context":
            return await self._get_scenes_context_batch(
                script_id=self.script_id,
                scene_indices=tool_input["scene_indices"],
                neighbor_count=tool_input.get("neighbor_count", 1),
                max_chars_per_scene=tool_input.get("max_chars_per_scene", 2000)
            )

        else:
            return f"Unknown tool: {tool_name}"

    async def _get_scene(
        self,
        script_id: UUID,
        scene_index: int
    ) -> str:
        """
        Get full scene text by index.

        Returns structured output with scene_number (1-based for users) and scene_index (0-based)
        to help Claude maintain clarity when synthesizing multiple tool results.
        """
        # OPTIMIZATION: noload prevents eager loading of Scene's 8 relationships
        # Scene has selectin relationships that cascade to Script->ALL scenes
        scene = await self.db.scalar(
            select(Scene)
            .options(noload('*'))
            .where(
                Scene.script_id == script_id,
                Scene.position == scene_index
            )
        )

        if not scene:
            return f"Scene not found: scene_index={scene_index} (Scene {scene_index + 1} in user terms)"

        # Extract key quotes for structured output (first 3 dialogue lines)
        key_quotes = []
        if scene.content_blocks:
            for block in scene.content_blocks[:20]:  # Scan first 20 blocks
                if block.get("type") == "dialogue" and len(key_quotes) < 3:
                    text = block.get("text", "").strip()
                    if text and len(text) > 10:
                        key_quotes.append(text[:100])  # Truncate long quotes

        # Build structured output that helps Claude identify which scene this is
        result = f"""=== SCENE DATA ===
scene_number: {scene_index + 1}  (user-facing, 1-based)
scene_index: {scene_index}  (internal, 0-based)
scene_heading: {scene.scene_heading}
==================

"""
        if scene.full_content:
            result += scene.full_content
        elif scene.summary:
            result += f"[Summary]: {scene.summary}"
        else:
            result += "[No content available for this scene]"

        # Append key quotes section if available
        if key_quotes:
            result += "\n\n--- KEY QUOTES ---\n"
            for i, quote in enumerate(key_quotes, 1):
                result += f"{i}. \"{quote}\"\n"

        return result

    async def _get_scene_context(
        self,
        script_id: UUID,
        scene_index: int,
        neighbor_count: int = 1
    ) -> str:
        """
        Get a scene plus N neighboring scenes for narrative context.

        Returns structured output with clear scene_number/scene_index mapping
        to help Claude maintain clarity when synthesizing results.
        """
        # Calculate range
        start_index = max(0, scene_index - neighbor_count)
        end_index = scene_index + neighbor_count

        # Query scenes in range
        # OPTIMIZATION: noload prevents eager loading of Scene's 8 relationships
        scenes = await self.db.execute(
            select(Scene)
            .options(noload('*'))
            .where(
                Scene.script_id == script_id,
                Scene.position >= start_index,
                Scene.position <= end_index
            )
            .order_by(Scene.position)
        )
        scenes_list = scenes.scalars().all()

        if not scenes_list:
            return f"No scenes found: scene_index range {start_index}-{end_index} (Scenes {start_index + 1}-{end_index + 1} in user terms)"

        # Format all scenes with context markers and structured metadata
        result = f"""=== SCENE CONTEXT DATA ===
target_scene_number: {scene_index + 1}  (user-facing, 1-based)
target_scene_index: {scene_index}  (internal, 0-based)
range: Scenes {start_index + 1}-{end_index + 1} (indices {start_index}-{end_index})
===========================

"""

        for scene in scenes_list:
            is_target = scene.position == scene_index
            marker = " [TARGET - THIS IS THE SCENE USER ASKED ABOUT]" if is_target else ""
            result += f"--- SCENE {scene.position + 1} (index {scene.position}): {scene.scene_heading}{marker} ---\n\n"

            if scene.full_content:
                result += scene.full_content + "\n\n"
            elif scene.summary:
                result += f"[Summary]: {scene.summary}\n\n"

        return result.strip()

    async def _get_character_scenes(
        self,
        script_id: UUID,
        character_name: str,
        include_full_text: bool = False
    ) -> str:
        """
        Get all scenes where a character appears.

        Uses flexible matching strategy:
        1. Exact match (fastest)
        2. Case-insensitive match
        3. Partial match (for "Sam Carter" -> matches "SAM")
        """
        from sqlalchemy import func

        matched_name = character_name  # Track what we actually matched
        char_scenes = None

        # Strategy 1: Exact match
        scene_chars = await self.db.execute(
            select(SceneCharacter)
            .options(noload('*'))
            .join(Scene, SceneCharacter.scene_id == Scene.scene_id)
            .where(
                Scene.script_id == script_id,
                SceneCharacter.character_name == character_name
            )
            .order_by(Scene.position)
        )
        char_scenes = scene_chars.scalars().all()

        # Strategy 2: Case-insensitive match
        if not char_scenes:
            scene_chars = await self.db.execute(
                select(SceneCharacter)
                .options(noload('*'))
                .join(Scene, SceneCharacter.scene_id == Scene.scene_id)
                .where(
                    Scene.script_id == script_id,
                    func.upper(SceneCharacter.character_name) == character_name.upper()
                )
                .order_by(Scene.position)
            )
            char_scenes = scene_chars.scalars().all()
            if char_scenes:
                matched_name = char_scenes[0].character_name

        # Strategy 3: Partial match (first name extraction)
        # If user searched "Sam Carter", try matching just "SAM"
        if not char_scenes:
            first_name = character_name.split()[0] if ' ' in character_name else character_name
            scene_chars = await self.db.execute(
                select(SceneCharacter)
                .options(noload('*'))
                .join(Scene, SceneCharacter.scene_id == Scene.scene_id)
                .where(
                    Scene.script_id == script_id,
                    func.upper(SceneCharacter.character_name) == first_name.upper()
                )
                .order_by(Scene.position)
            )
            char_scenes = scene_chars.scalars().all()
            if char_scenes:
                matched_name = char_scenes[0].character_name

        # Strategy 4: Contains match (partial string)
        if not char_scenes:
            first_name = character_name.split()[0] if ' ' in character_name else character_name
            scene_chars = await self.db.execute(
                select(SceneCharacter)
                .options(noload('*'))
                .join(Scene, SceneCharacter.scene_id == Scene.scene_id)
                .where(
                    Scene.script_id == script_id,
                    func.upper(SceneCharacter.character_name).contains(first_name.upper())
                )
                .order_by(Scene.position)
            )
            char_scenes = scene_chars.scalars().all()
            if char_scenes:
                matched_name = char_scenes[0].character_name

        if not char_scenes:
            # Get list of available characters to help the AI
            all_chars = await self.db.execute(
                select(SceneCharacter.character_name)
                .join(Scene, SceneCharacter.scene_id == Scene.scene_id)
                .where(Scene.script_id == script_id)
                .distinct()
            )
            available_chars = [c[0] for c in all_chars.fetchall()]

            return (
                f"Character '{character_name}' not found in any scenes.\n"
                f"Available characters in this script: {', '.join(sorted(set(available_chars)))}\n"
                f"TIP: Screenplay character names are usually first names in caps (e.g., 'SAM' not 'Sam Carter')."
            )

        # Get actual scenes
        # OPTIMIZATION: noload prevents eager loading of Scene's 8 relationships
        scene_ids = [sc.scene_id for sc in char_scenes]
        scenes = await self.db.execute(
            select(Scene)
            .options(noload('*'))
            .where(Scene.scene_id.in_(scene_ids))
            .order_by(Scene.position)
        )
        scenes_list = scenes.scalars().all()

        # Format result - use matched_name to show what was actually found
        result = f"CHARACTER ARC: {matched_name}\n"
        if matched_name != character_name:
            result += f"(Matched from search: '{character_name}')\n"
        result += f"Appears in {len(scenes_list)} scenes\n\n"

        for scene in scenes_list:
            result += f"SCENE {scene.position + 1} (index {scene.position}): {scene.scene_heading}\n"

            if include_full_text and scene.full_content:
                result += scene.full_content + "\n\n"
            elif scene.summary:
                result += f"  {scene.summary}\n\n"
            else:
                result += "  [No summary available]\n\n"

        return result.strip()

    async def _search_script(
        self,
        script_id: UUID,
        query: str,
        filters: Optional[Dict[str, Any]] = None,
        limit: int = 10
    ) -> str:
        """
        Search scenes by keyword and semantic similarity.

        Uses RetrievalService for semantic search via vector_search.
        """
        # Use RetrievalService for semantic search
        retrieval_service = RetrievalService(db=self.db)

        # Retrieve relevant scenes using vector_search
        # Returns List[Tuple[Scene, SceneSummary, float]]
        search_results = await retrieval_service.vector_search(
            script_id=script_id,
            query=query,
            limit=limit,
            filters=filters
        )

        if not search_results:
            return f"No scenes found matching query: '{query}'"

        # Format results
        result = f"SEARCH RESULTS for '{query}' (found {len(search_results)} scenes):\n\n"

        for i, (scene, summary, similarity) in enumerate(search_results, 1):
            result += f"{i}. SCENE {scene.position}: {scene.scene_heading}\n"
            if summary and summary.summary_text:
                result += f"   {summary.summary_text}\n"
            elif scene.full_content:
                # Show first 200 chars if no summary
                preview = scene.full_content[:200]
                result += f"   {preview}...\n"
            result += f"   (Relevance: {similarity:.2f})\n\n"

        return result.strip()

    async def _analyze_pacing(
        self,
        script_id: UUID
    ) -> str:
        """
        Quantitative pacing analysis (no LLM tokens).

        Analyzes scene lengths, dialogue ratios, and act distribution.
        """
        # OPTIMIZATION: noload prevents eager loading of Scene's 8 relationships
        # This query could load ALL scenes + relationships = massive cascade
        scenes = await self.db.execute(
            select(Scene)
            .options(noload('*'))
            .where(Scene.script_id == script_id)
            .order_by(Scene.position)
        )
        scenes_list = scenes.scalars().all()

        if not scenes_list:
            return "No scenes found in script"

        # Calculate metrics
        total_scenes = len(scenes_list)

        # Scene length distribution (based on content_blocks or full_content)
        scene_lengths = []
        for s in scenes_list:
            if s.full_content:
                scene_lengths.append(len(s.full_content.split('\n')))
            elif s.content_blocks:
                scene_lengths.append(len(s.content_blocks))
            else:
                scene_lengths.append(0)

        avg_length = sum(scene_lengths) / max(total_scenes, 1)
        min_length = min(scene_lengths) if scene_lengths else 0
        max_length = max(scene_lengths) if scene_lengths else 0

        # Dialogue vs action ratio (simple heuristic from content_blocks)
        dialogue_blocks = 0
        action_blocks = 0
        total_blocks = 0

        for scene in scenes_list:
            if scene.content_blocks:
                for block in scene.content_blocks:
                    block_type = block.get("type", "")
                    total_blocks += 1
                    if block_type in ["dialogue", "character"]:
                        dialogue_blocks += 1
                    elif block_type in ["action", "scene_heading"]:
                        action_blocks += 1

        dialogue_ratio = dialogue_blocks / max(total_blocks, 1) if total_blocks > 0 else 0

        # Word count stats
        total_words = sum(s.word_count or 0 for s in scenes_list)
        avg_words_per_scene = total_words / max(total_scenes, 1)

        # Format report
        report = f"""PACING ANALYSIS:

Total Scenes: {total_scenes}
Total Words: {total_words:,}

Scene Length Distribution:
- Average: {avg_length:.1f} blocks/lines
- Shortest: {min_length} blocks/lines
- Longest: {max_length} blocks/lines
- Avg Words per Scene: {avg_words_per_scene:.0f}

Content Distribution:
- Dialogue: {dialogue_ratio*100:.1f}%
- Action/Description: {(1-dialogue_ratio)*100:.1f}%

Pacing Notes:
"""

        # Pacing insights
        if avg_words_per_scene < 100:
            report += "- Very short scenes - fast pacing, potentially choppy\n"
        elif avg_words_per_scene > 400:
            report += "- Long scenes - slower pacing, more detailed\n"
        else:
            report += "- Moderate scene length - balanced pacing\n"

        if dialogue_ratio > 0.6:
            report += "- Dialogue-heavy - character-driven, conversational\n"
        elif dialogue_ratio < 0.3:
            report += "- Action-heavy - visual storytelling, sparse dialogue\n"
        else:
            report += "- Balanced dialogue/action ratio\n"

        return report

    async def _get_plot_threads(
        self,
        script_id: UUID,
        thread_type: Optional[str] = None
    ) -> str:
        """Get plot threads and their associated scenes."""
        # Build query
        # OPTIMIZATION: noload prevents eager loading of PlotThread relationships
        query = (
            select(PlotThread)
            .options(noload('*'))
            .where(PlotThread.script_id == script_id)
        )

        if thread_type:
            query = query.where(PlotThread.thread_type == thread_type)

        # Execute
        result_obj = await self.db.execute(query.order_by(PlotThread.name))
        threads = result_obj.scalars().all()

        if not threads:
            type_msg = f" of type '{thread_type}'" if thread_type else ""
            return f"No plot threads found{type_msg}"

        # Format results
        result = f"PLOT THREADS ({len(threads)} found):\n\n"

        for thread in threads:
            result += f"NAME: {thread.name}\n"
            result += f"TYPE: {thread.thread_type}\n"
            result += f"SCENES: {', '.join(map(str, thread.scenes))}\n"

            if thread.description:
                result += f"DESCRIPTION: {thread.description}\n"

            result += "\n"

        return result.strip()

    async def _get_scene_relationships(
        self,
        script_id: UUID,
        relationship_type: Optional[str] = None
    ) -> str:
        """
        Get scene relationships for the script.

        Returns narrative connections between scenes:
        - setup_payoff: Information/object introduced in one scene pays off in another
        - callback: A later scene references or echoes an earlier scene
        - parallel: Two scenes mirror each other in structure or situation
        - echo: Thematic or visual connections between scenes
        """
        from sqlalchemy.orm import aliased

        # Create aliases for the two Scene joins (setup and payoff)
        SetupScene = aliased(Scene, name="setup_scene")
        PayoffScene = aliased(Scene, name="payoff_scene")

        # Build query with BOTH scene positions in a single query (no N+1)
        query = (
            select(
                SceneRelationship,
                SetupScene.position.label("setup_position"),
                PayoffScene.position.label("payoff_position")
            )
            .join(SetupScene, SceneRelationship.setup_scene_id == SetupScene.scene_id)
            .join(PayoffScene, SceneRelationship.payoff_scene_id == PayoffScene.scene_id)
            .where(SceneRelationship.script_id == script_id)
        )

        if relationship_type:
            query = query.where(SceneRelationship.relationship_type == relationship_type)

        # Execute single query - no N+1 issue
        result_obj = await self.db.execute(query.order_by(SetupScene.position))
        rows = result_obj.all()

        if not rows:
            type_msg = f" of type '{relationship_type}'" if relationship_type else ""
            return f"No scene relationships found{type_msg}"

        # Format results
        result = f"SCENE RELATIONSHIPS ({len(rows)} found):\n\n"

        for rel, setup_position, payoff_position in rows:
            result += f"TYPE: {rel.relationship_type}\n"
            result += f"SETUP: Scene {setup_position} (scene_index: {setup_position - 1})\n"
            result += f"PAYOFF: Scene {payoff_position} (scene_index: {payoff_position - 1})\n"

            if rel.description:
                result += f"DESCRIPTION: {rel.description}\n"

            result += "\n"

        return result.strip()

    # =========================================================================
    # P1.1: Batch Tool Implementations
    # =========================================================================

    async def _get_scenes_batch(
        self,
        script_id: UUID,
        scene_indices: List[int],
        include_summaries: bool = True,
        max_chars_per_scene: int = 3000
    ) -> str:
        """
        Batch fetch multiple scenes efficiently.

        Returns unified structured output to reduce recency bias and
        provide clear scene identification for synthesis.

        Args:
            script_id: Script UUID
            scene_indices: List of 0-based scene indices
            include_summaries: Whether to include summaries when full text unavailable
            max_chars_per_scene: Maximum characters per scene to prevent huge responses

        Returns:
            Formatted string with all requested scenes
        """
        if not scene_indices:
            return "Error: No scene indices provided"

        if len(scene_indices) > 10:
            return f"Error: Maximum 10 scenes per batch (requested {len(scene_indices)}). Please split into multiple calls."

        # Deduplicate and sort
        scene_indices = sorted(set(scene_indices))

        # Single query for all scenes
        scenes = await self.db.execute(
            select(Scene)
            .options(noload('*'))
            .where(
                Scene.script_id == script_id,
                Scene.position.in_(scene_indices)
            )
            .order_by(Scene.position)
        )
        scenes_list = scenes.scalars().all()

        # Build unified response with clear metadata
        result = f"""=== BATCH SCENE DATA ===
requested_scenes: {[i + 1 for i in scene_indices]} (user-facing, 1-based)
scene_indices: {scene_indices} (internal, 0-based)
found_count: {len(scenes_list)}
===========================

"""

        for scene in scenes_list:
            result += f"--- SCENE {scene.position + 1} (index {scene.position}): {scene.scene_heading} ---\n\n"

            content = scene.full_content or ""
            if len(content) > max_chars_per_scene:
                content = content[:max_chars_per_scene] + "\n...[TRUNCATED - scene continues]..."

            if content:
                result += content + "\n\n"
            elif scene.summary and include_summaries:
                result += f"[Summary only - full text unavailable]: {scene.summary}\n\n"
            else:
                result += "[No content available for this scene]\n\n"

        # Report missing scenes
        found_positions = {s.position for s in scenes_list}
        missing = [i for i in scene_indices if i not in found_positions]
        if missing:
            result += f"\n⚠️ Scenes not found (indices): {missing}\n"
            result += f"   (Scene numbers: {[i + 1 for i in missing]})\n"

        return result.strip()

    async def _get_scenes_context_batch(
        self,
        script_id: UUID,
        scene_indices: List[int],
        neighbor_count: int = 1,
        max_chars_per_scene: int = 2000
    ) -> str:
        """
        Batch fetch scenes with context, deduplicating overlapping neighbors.

        More efficient than multiple get_scene_context calls when analyzing
        related scenes (e.g., comparing Scene 5 and Scene 7 with context).

        Args:
            script_id: Script UUID
            scene_indices: List of 0-based target scene indices
            neighbor_count: How many scenes before/after each target
            max_chars_per_scene: Maximum characters per scene

        Returns:
            Formatted string with all scenes, targets clearly marked
        """
        if not scene_indices:
            return "Error: No scene indices provided"

        if len(scene_indices) > 5:
            return f"Error: Maximum 5 target scenes per batch (requested {len(scene_indices)}). Please split into multiple calls."

        # Deduplicate targets
        scene_indices = sorted(set(scene_indices))

        # Calculate full range including all neighbors (automatically deduplicated)
        all_positions = set()
        for idx in scene_indices:
            for offset in range(-neighbor_count, neighbor_count + 1):
                pos = idx + offset
                if pos >= 0:  # Don't go negative
                    all_positions.add(pos)

        # Single efficient query
        scenes = await self.db.execute(
            select(Scene)
            .options(noload('*'))
            .where(
                Scene.script_id == script_id,
                Scene.position.in_(list(all_positions))
            )
            .order_by(Scene.position)
        )
        scenes_list = scenes.scalars().all()

        if not scenes_list:
            return f"No scenes found for indices: {scene_indices}"

        # Build response with clear target markers
        target_set = set(scene_indices)

        result = f"""=== BATCH SCENE CONTEXT DATA ===
target_scenes: {[i + 1 for i in scene_indices]} (user-facing, 1-based)
target_indices: {scene_indices} (internal, 0-based)
context_window: ±{neighbor_count} scenes
total_scenes_returned: {len(scenes_list)}
================================

"""

        for scene in scenes_list:
            is_target = scene.position in target_set
            marker = " [TARGET]" if is_target else " [context]"

            result += f"--- SCENE {scene.position + 1}{marker}: {scene.scene_heading} ---\n\n"

            content = scene.full_content or ""
            if len(content) > max_chars_per_scene:
                content = content[:max_chars_per_scene] + "\n...[TRUNCATED]..."

            if content:
                result += content + "\n\n"
            elif scene.summary:
                result += f"[Summary]: {scene.summary}\n\n"
            else:
                result += "[No content available]\n\n"

        return result.strip()
