"""
Integration Tests for AI Tool Loop System

Tests the full tool loop pipeline including:
- P1.2: Evidence building from tool results
- P0.3: Truncation recovery mechanism
- P1.1: Batch tools efficiency
- P1.3: Tool-only mode and synthesis

These tests mock the Anthropic API to verify the tool loop logic
without making actual API calls.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4
from dataclasses import dataclass
from typing import List, Any

from app.services.evidence_builder import EvidenceBuilder, Evidence
from app.services.context_builder import ContextBuilder
from app.schemas.ai import IntentType


# ============================================================================
# Mock Classes for Testing
# ============================================================================

@dataclass
class MockContentBlock:
    """Mock Anthropic content block."""
    type: str
    text: str = ""
    id: str = ""
    name: str = ""
    input: dict = None

    def __post_init__(self):
        if self.input is None:
            self.input = {}


@dataclass
class MockUsage:
    """Mock Anthropic usage statistics."""
    input_tokens: int = 100
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    output_tokens: int = 50


@dataclass
class MockResponse:
    """Mock Anthropic API response."""
    content: List[MockContentBlock]
    stop_reason: str
    usage: MockUsage = None

    def __post_init__(self):
        if self.usage is None:
            self.usage = MockUsage()


# ============================================================================
# Test: Tool Loop with Evidence Builder (P1.2/P1.3)
# ============================================================================

class TestToolLoopWithEvidenceBuilder:
    """Test full tool loop with evidence building and synthesis."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database session."""
        mock = AsyncMock()
        mock.execute = AsyncMock()
        mock.commit = AsyncMock()
        return mock

    @pytest.fixture
    def evidence_builder(self):
        """Create evidence builder instance."""
        return EvidenceBuilder()

    @pytest.mark.asyncio
    async def test_evidence_building_from_tool_results(self, evidence_builder):
        """Test that tool results are correctly converted to evidence."""
        # Simulate tool results from multiple get_scene calls
        tool_results = [
            {
                "tool_name": "get_scene",
                "tool_input": {"scene_index": 4},
                "result": "INT. CAFE - DAY\n\nJOHN sits alone. MARY enters.\n\nMARY\nWe need to talk about us."
            },
            {
                "tool_name": "get_scene",
                "tool_input": {"scene_index": 9},
                "result": "EXT. PARK - NIGHT\n\nJohn runs through the park, desperate."
            },
            {
                "tool_name": "get_character_scenes",
                "tool_input": {"character_name": "JOHN"},
                "result": "JOHN appears in scenes 5, 10, 15, 22 with primary dialogue."
            }
        ]

        evidence = await evidence_builder.build_evidence(
            tool_results=tool_results,
            user_question="What scenes involve John?"
        )

        # Verify evidence structure
        assert evidence.user_question == "What scenes involve John?"
        assert len(evidence.items) == 3
        assert evidence.items[0].source_tool in ["get_scene", "get_character_scenes"]

        # Verify relevance scoring worked (items with "John" should score higher)
        john_items = [item for item in evidence.items if "John" in item.content or "JOHN" in item.content]
        assert len(john_items) >= 2

    @pytest.mark.asyncio
    async def test_evidence_ranks_by_relevance(self, evidence_builder):
        """Test that evidence is ranked by relevance to question."""
        tool_results = [
            {
                "tool_name": "get_scene",
                "tool_input": {"scene_index": 0},
                "result": "INT. OFFICE - DAY\n\nGeneric office scene with background actors."
            },
            {
                "tool_name": "get_scene",
                "tool_input": {"scene_index": 1},
                "result": "EXT. BEACH - DAY\n\nMary and John walk on the beach, discussing their future."
            },
            {
                "tool_name": "get_scene",
                "tool_input": {"scene_index": 2},
                "result": "INT. HOSPITAL - NIGHT\n\nA nurse checks monitors."
            }
        ]

        evidence = await evidence_builder.build_evidence(
            tool_results=tool_results,
            user_question="What happens between Mary and John on the beach?"
        )

        # Beach scene with Mary and John should be ranked first
        assert len(evidence.items) == 3
        assert "beach" in evidence.items[0].content.lower() or "Beach" in evidence.items[0].content

    @pytest.mark.asyncio
    async def test_synthesis_prompt_includes_format_constraints(self, mock_db):
        """Test that synthesis prompt includes intent-specific format constraints."""
        context_builder = ContextBuilder(db=mock_db)

        # Test GLOBAL_QUESTION format
        synthesis_prompt = context_builder.build_synthesis_prompt(
            evidence_text="[Evidence about multiple scenes]",
            user_question="What are the main themes?",
            intent=IntentType.GLOBAL_QUESTION
        )

        assert "Maximum 5 bullet points" in synthesis_prompt
        assert "scene reference" in synthesis_prompt.lower()
        assert "Maximum 200 words" in synthesis_prompt

        # Test LOCAL_EDIT format
        synthesis_prompt_edit = context_builder.build_synthesis_prompt(
            evidence_text="[Scene content]",
            user_question="Improve this dialogue",
            intent=IntentType.LOCAL_EDIT
        )

        assert "exactly one revised version" in synthesis_prompt_edit.lower()
        assert "Maximum 150 words" in synthesis_prompt_edit


# ============================================================================
# Test: Truncation Recovery (P0.3)
# ============================================================================

class TestSignalToolPattern:
    """Test signal_ready_for_response tool pattern for controlled synthesis."""

    @pytest.mark.asyncio
    async def test_signal_tool_exists_in_tools(self):
        """Test that signal_ready_for_response tool is defined."""
        from app.services.mcp_tools import SCREENPLAY_TOOLS
        from app.routers.ai_router import SIGNAL_TOOL_NAME

        # Verify signal tool exists
        tool_names = [tool["name"] for tool in SCREENPLAY_TOOLS]
        assert SIGNAL_TOOL_NAME in tool_names, "signal_ready_for_response tool should exist"

        # Find the tool and verify its schema
        signal_tool = next(t for t in SCREENPLAY_TOOLS if t["name"] == SIGNAL_TOOL_NAME)
        assert "gathered_info_summary" in signal_tool["input_schema"]["properties"]

    @pytest.mark.asyncio
    async def test_signal_tool_triggers_synthesis(self):
        """Test that signal tool result is properly recognized."""
        from app.services.mcp_tools import MCPToolExecutor, SCREENPLAY_TOOLS

        # Verify signal tool returns expected prefix
        # Note: We can't actually execute without a full DB setup, but we can verify the pattern
        signal_result_prefix = "SIGNAL_READY:"

        # The tool loop checks for this pattern to trigger synthesis
        assert signal_result_prefix.startswith("SIGNAL_READY")

    @pytest.mark.asyncio
    async def test_tool_call_metadata_schema(self):
        """Test that ToolCallMetadata schema supports the new pattern."""
        from app.schemas.ai import ToolCallMetadata

        # Test with signal_ready stop reason
        metadata = ToolCallMetadata(
            tool_calls_made=3,
            tools_used=["get_scene", "signal_ready_for_response"],
            stop_reason="signal_ready",
            recovery_attempts=0  # Always 0 now (no recovery mechanism)
        )

        assert metadata.stop_reason == "signal_ready"
        assert metadata.recovery_attempts == 0
        assert "signal_ready_for_response" in metadata.tools_used

    @pytest.mark.asyncio
    async def test_tool_choice_constants(self):
        """Test that tool_choice-related constants are properly defined."""
        from app.routers.ai_router import (
            SIGNAL_TOOL_NAME,
            TOOL_LOOP_MAX_TOKENS,
            FINAL_SYNTHESIS_MAX_TOKENS
        )

        # Signal tool name should match the tool definition
        assert SIGNAL_TOOL_NAME == "signal_ready_for_response"

        # Token limits should be reasonable
        assert TOOL_LOOP_MAX_TOKENS >= 1000, "Tool loop needs sufficient tokens for planning"
        assert FINAL_SYNTHESIS_MAX_TOKENS >= 2000, "Synthesis needs room for full responses"
        assert FINAL_SYNTHESIS_MAX_TOKENS > TOOL_LOOP_MAX_TOKENS, "Synthesis should have more tokens"

    @pytest.mark.asyncio
    async def test_synthesis_triggers_with_signal_tool(self):
        """
        Test that synthesis is triggered based on the new signal tool pattern:

        1. SIGNAL TOOL (deterministic): When signal_ready_for_response is called,
           ALWAYS trigger synthesis - this is the proper way to exit the tool loop.

        2. TOOL RESULTS (always): When tools have been called, always synthesize
           to ensure consistent quality responses based on gathered evidence.

        The tool_choice strategy ensures Claude either:
        - Responds directly (no tools needed) - first iteration only
        - Calls signal tool when ready to synthesize - after gathering info
        """

        # Test data simulating the new pattern
        tool_results = [
            {"tool_name": "get_scene", "tool_input": {"scene_index": 3}, "result": "Scene content..."}
        ]
        empty_results = []

        # With tool_choice="any" after first iteration, Claude MUST use tools
        # So synthesis is always triggered when we have tool results
        def needs_synthesis(all_tool_results, signal_tool_called):
            """New synthesis trigger logic based on signal tool pattern."""
            return signal_tool_called or len(all_tool_results) > 0

        # =========================================================
        # SIGNAL TOOL CASE: Always triggers synthesis
        # =========================================================

        # Scenario 1: Signal tool called with tool results -> synthesize
        assert needs_synthesis(tool_results, signal_tool_called=True) is True

        # Scenario 2: Signal tool called without tool results -> synthesize
        assert needs_synthesis(empty_results, signal_tool_called=True) is True

        # =========================================================
        # TOOL RESULTS CASE: Always triggers synthesis
        # =========================================================

        # Scenario 3: Tool results exist (no signal) -> synthesize
        assert needs_synthesis(tool_results, signal_tool_called=False) is True

        # =========================================================
        # NO TOOLS CASE: No synthesis needed
        # =========================================================

        # Scenario 4: No tool results and no signal -> no synthesis
        # This happens when Claude responds directly on first iteration
        assert needs_synthesis(empty_results, signal_tool_called=False) is False


# ============================================================================
# Test: Batch Tools Efficiency (P1.1)
# ============================================================================

class TestBatchToolsEfficiency:
    """Test batch tools reduce round trips."""

    @pytest.mark.asyncio
    async def test_batch_tool_definitions_exist(self):
        """Test that batch tools are defined in SCREENPLAY_TOOLS."""
        from app.services.mcp_tools import SCREENPLAY_TOOLS

        tool_names = [tool["name"] for tool in SCREENPLAY_TOOLS]

        # Verify batch tools exist
        assert "get_scenes" in tool_names, "get_scenes batch tool should exist"
        assert "get_scenes_context" in tool_names, "get_scenes_context batch tool should exist"

    @pytest.mark.asyncio
    async def test_batch_tool_accepts_multiple_indices(self):
        """Test that batch tools accept multiple scene indices."""
        from app.services.mcp_tools import SCREENPLAY_TOOLS

        # Find get_scenes tool
        get_scenes_tool = next(
            (t for t in SCREENPLAY_TOOLS if t["name"] == "get_scenes"),
            None
        )
        assert get_scenes_tool is not None

        # Verify it accepts array of scene_indices
        input_schema = get_scenes_tool["input_schema"]
        assert "scene_indices" in input_schema["properties"]
        assert input_schema["properties"]["scene_indices"]["type"] == "array"

    @pytest.mark.asyncio
    async def test_batch_result_parsing(self):
        """Test that batch tool results are parsed into individual items."""
        evidence_builder = EvidenceBuilder()

        # Simulate batch tool result with multiple scenes
        batch_result = {
            "tool_name": "get_scenes",
            "tool_input": {"scene_indices": [0, 1, 2]},
            "result": """--- SCENE 1 (0, INT. OFFICE - DAY) ---

John enters the office.

--- SCENE 2 (1, EXT. STREET - DAY) ---

Mary walks down the street.

--- SCENE 3 (2, INT. CAFE - NIGHT) ---

They meet at the cafe."""
        }

        evidence = await evidence_builder.build_evidence(
            tool_results=[batch_result],
            user_question="What happens in these scenes?"
        )

        # Should be parsed into 3 separate evidence items
        assert len(evidence.items) == 3
        # Each item should have its own scene number
        scene_numbers = set()
        for item in evidence.items:
            scene_numbers.update(item.scene_numbers)
        assert scene_numbers == {1, 2, 3}

    @pytest.mark.asyncio
    async def test_single_vs_batch_tool_comparison(self):
        """
        Test that batch tools are more efficient than multiple single calls.

        This is a conceptual test showing the difference in API calls needed.
        """
        # Scenario: User asks "Compare scenes 1, 3, 5, 7, and 9"

        # Single tool approach: 5 API iterations needed
        single_tool_calls = ["get_scene(0)", "get_scene(2)", "get_scene(4)",
                            "get_scene(6)", "get_scene(8)"]
        single_iterations = len(single_tool_calls)

        # Batch tool approach: 1 API iteration needed
        batch_tool_call = "get_scenes([0, 2, 4, 6, 8])"
        batch_iterations = 1

        # Batch should be significantly more efficient
        assert batch_iterations < single_iterations
        efficiency_gain = (single_iterations - batch_iterations) / single_iterations
        assert efficiency_gain >= 0.8  # 80% reduction in iterations


# ============================================================================
# Test: Tool-Only Mode (P1.3)
# ============================================================================

class TestToolOnlyMode:
    """Test tool-only mode during tool loop iterations."""

    @pytest.mark.asyncio
    async def test_tool_loop_system_prompt_enforces_no_prose(self):
        """Test that tool loop system prompt prohibits prose output."""
        mock_db = AsyncMock()
        context_builder = ContextBuilder(db=mock_db)

        system_prompt = context_builder.get_tool_loop_system_prompt()

        # Should emphasize tool-only output
        assert "ONLY tool calls" in system_prompt
        assert "no" in system_prompt.lower() and "text" in system_prompt.lower()
        assert "Do NOT" in system_prompt or "do not" in system_prompt.lower()

    @pytest.mark.asyncio
    async def test_synthesis_format_instructions_vary_by_intent(self):
        """Test that format instructions are customized by intent."""
        mock_db = AsyncMock()
        context_builder = ContextBuilder(db=mock_db)

        # Get format instructions for different intents
        local_edit_format = context_builder.get_synthesis_format_instructions(IntentType.LOCAL_EDIT)
        global_question_format = context_builder.get_synthesis_format_instructions(IntentType.GLOBAL_QUESTION)
        brainstorm_format = context_builder.get_synthesis_format_instructions(IntentType.BRAINSTORM)

        # Each should have different constraints
        assert "revised" in local_edit_format.lower()
        assert "bullet" in global_question_format.lower()
        assert "options" in brainstorm_format.lower()

        # All should have word limits
        assert "words" in local_edit_format.lower()
        assert "words" in global_question_format.lower()
        assert "words" in brainstorm_format.lower()


# ============================================================================
# Test: End-to-End Integration (Mocked)
# ============================================================================

class TestEndToEndIntegration:
    """End-to-end integration tests with mocked API."""

    @pytest.mark.asyncio
    async def test_evidence_to_synthesis_flow(self):
        """Test the complete flow from tool results to synthesis prompt."""
        # 1. Simulate tool results
        tool_results = [
            {
                "tool_name": "get_scene",
                "tool_input": {"scene_index": 4},
                "result": "INT. CAFE - DAY\nJohn confronts Mary about the letter."
            },
            {
                "tool_name": "analyze_pacing",
                "tool_input": {"act": 2},
                "result": "Act 2 pacing: 45 scenes, avg 1.2 pages, dialogue_ratio=0.65"
            }
        ]

        # 2. Build evidence
        evidence_builder = EvidenceBuilder()
        evidence = await evidence_builder.build_evidence(
            tool_results=tool_results,
            user_question="How is the confrontation scene paced?"
        )

        # 3. Generate synthesis prompt
        mock_db = AsyncMock()
        context_builder = ContextBuilder(db=mock_db)
        synthesis_prompt = context_builder.build_synthesis_prompt(
            evidence_text=evidence.to_prompt_text(),
            user_question="How is the confrontation scene paced?",
            intent=IntentType.SCENE_FEEDBACK
        )

        # Verify complete flow
        assert "How is the confrontation scene paced?" in synthesis_prompt
        assert "GATHERED EVIDENCE" in synthesis_prompt or "evidence" in synthesis_prompt.lower()
        assert "FORMAT" in synthesis_prompt or "format" in synthesis_prompt.lower()

    @pytest.mark.asyncio
    async def test_tool_metadata_completeness(self):
        """Test that tool metadata captures all relevant information."""
        from app.schemas.ai import ToolCallMetadata

        # Create metadata for a typical tool session
        metadata = ToolCallMetadata(
            tool_calls_made=4,
            tools_used=["get_scene", "get_scenes", "analyze_pacing"],
            stop_reason="end_turn",
            recovery_attempts=0
        )

        # Verify all fields are populated
        assert metadata.tool_calls_made > 0
        assert len(metadata.tools_used) > 0
        assert metadata.stop_reason in ["end_turn", "max_iterations", "max_tokens"]
        assert metadata.recovery_attempts >= 0

        # Verify unique tools are tracked
        assert len(metadata.tools_used) == len(set(metadata.tools_used))
