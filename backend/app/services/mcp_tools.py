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
from app.models.character_sheet import CharacterSheet
from app.services.retrieval_service import RetrievalService


# MCP Tool Definitions for Claude API
SCREENPLAY_TOOLS = [
    {
        "name": "get_scene",
        "description": "Get full text of a specific scene by index. Use this when you need the complete dialogue and action lines.",
        "input_schema": {
            "type": "object",
            "properties": {
                "scene_index": {
                    "type": "integer",
                    "description": "The scene number (0-indexed)"
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
                "scene_index": {"type": "integer"},
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
                    "description": "Character name (case-sensitive)"
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

        else:
            return f"Unknown tool: {tool_name}"

    async def _get_scene(
        self,
        script_id: UUID,
        scene_index: int
    ) -> str:
        """Get full scene text by index."""
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
            return f"Scene {scene_index} not found in script"

        # Format scene with heading and full content
        result = f"SCENE {scene_index}: {scene.scene_heading}\n\n"

        if scene.full_content:
            result += scene.full_content
        elif scene.summary:
            result += f"[Summary]: {scene.summary}"
        else:
            result += "[No content available for this scene]"

        return result

    async def _get_scene_context(
        self,
        script_id: UUID,
        scene_index: int,
        neighbor_count: int = 1
    ) -> str:
        """Get a scene plus N neighboring scenes for narrative context."""
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
            return f"No scenes found in range {start_index}-{end_index}"

        # Format all scenes with context markers
        result = f"CONTEXT: Scenes {start_index}-{end_index} (target: {scene_index})\n\n"

        for scene in scenes_list:
            marker = " [TARGET SCENE]" if scene.position == scene_index else ""
            result += f"--- SCENE {scene.position}: {scene.scene_heading}{marker} ---\n\n"

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
        """Get all scenes where a character appears."""
        # Query scenes with this character
        # OPTIMIZATION: noload prevents eager loading of SceneCharacter relationships
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

        if not char_scenes:
            return f"Character '{character_name}' not found in any scenes"

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

        # Format result
        result = f"CHARACTER ARC: {character_name}\n"
        result += f"Appears in {len(scenes_list)} scenes\n\n"

        for scene in scenes_list:
            result += f"SCENE {scene.position}: {scene.scene_heading}\n"

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
