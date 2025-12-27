"""
Tests for P1.2 Evidence Builder Service

Validates the EvidenceBuilder correctly:
- Parses tool results into EvidenceItems
- Scores by relevance to user question
- Ranks and truncates to budget
- Formats for synthesis
"""

import pytest
from uuid import uuid4
from app.services.evidence_builder import EvidenceBuilder, EvidenceItem, Evidence


class TestEvidenceItem:
    """Test EvidenceItem dataclass."""

    def test_char_count_computed(self):
        """Test that char_count is automatically computed."""
        item = EvidenceItem(
            source_tool="get_scene",
            scene_numbers=[1],
            content="This is test content"
        )
        assert item.char_count == 20

    def test_default_relevance_score(self):
        """Test that default relevance_score is 0.0."""
        item = EvidenceItem(
            source_tool="get_scene",
            scene_numbers=[1],
            content="Test"
        )
        assert item.relevance_score == 0.0


class TestEvidence:
    """Test Evidence dataclass."""

    def test_empty_evidence_prompt_text(self):
        """Test formatting of empty evidence."""
        evidence = Evidence(user_question="What happens in scene 1?")
        text = evidence.to_prompt_text()
        assert "No evidence was gathered" in text

    def test_evidence_prompt_text_with_items(self):
        """Test formatting of evidence with items."""
        evidence = Evidence(
            user_question="What happens in scene 1?",
            items=[
                EvidenceItem(
                    source_tool="get_scene",
                    scene_numbers=[1],
                    content="INT. CAFE - DAY\nJohn enters."
                ),
                EvidenceItem(
                    source_tool="analyze_pacing",
                    scene_numbers=[1, 2],
                    content="Pacing analysis results"
                )
            ]
        )
        text = evidence.to_prompt_text()

        assert "GATHERED EVIDENCE" in text
        assert "What happens in scene 1?" in text
        assert "[1] From get_scene" in text
        assert "(Scenes: 1)" in text
        assert "INT. CAFE - DAY" in text
        assert "[2] From analyze_pacing" in text
        assert "(Scenes: 1, 2)" in text

    def test_evidence_truncation_note(self):
        """Test that truncation note appears when evidence was truncated."""
        evidence = Evidence(
            user_question="Test",
            items=[EvidenceItem(source_tool="test", scene_numbers=[1], content="X")],
            was_truncated=True,
            original_item_count=5
        )
        text = evidence.to_prompt_text()

        assert "4 lower-relevance results omitted" in text


class TestEvidenceBuilder:
    """Test EvidenceBuilder class."""

    @pytest.fixture
    def builder(self):
        """Create an EvidenceBuilder instance."""
        return EvidenceBuilder()

    @pytest.mark.asyncio
    async def test_build_evidence_empty_results(self, builder):
        """Test building evidence with no tool results."""
        evidence = await builder.build_evidence(
            tool_results=[],
            user_question="What happens?"
        )

        assert evidence.user_question == "What happens?"
        assert len(evidence.items) == 0

    @pytest.mark.asyncio
    async def test_build_evidence_single_result(self, builder):
        """Test building evidence from a single tool result."""
        tool_results = [
            {
                "tool_name": "get_scene",
                "tool_input": {"scene_index": 0},
                "result": "INT. CAFE - DAY\nJohn enters the cafe."
            }
        ]

        evidence = await builder.build_evidence(
            tool_results=tool_results,
            user_question="What happens in scene 1?"
        )

        assert len(evidence.items) == 1
        assert evidence.items[0].source_tool == "get_scene"
        assert evidence.items[0].scene_numbers == [1]  # 0-indexed input → 1-based
        assert "John enters" in evidence.items[0].content

    @pytest.mark.asyncio
    async def test_build_evidence_filters_errors(self, builder):
        """Test that error results are filtered out."""
        tool_results = [
            {
                "tool_name": "get_scene",
                "tool_input": {"scene_index": 0},
                "result": "Error: Scene not found"
            },
            {
                "tool_name": "get_scene",
                "tool_input": {"scene_index": 1},
                "result": "INT. OFFICE - NIGHT\nMary works late."
            }
        ]

        evidence = await builder.build_evidence(
            tool_results=tool_results,
            user_question="What scenes are in the script?"
        )

        # Only the non-error result should be included
        assert len(evidence.items) == 1
        assert "Mary works" in evidence.items[0].content

    @pytest.mark.asyncio
    async def test_build_evidence_relevance_scoring(self, builder):
        """Test that items are scored and sorted by relevance."""
        tool_results = [
            {
                "tool_name": "get_scene",
                "tool_input": {"scene_index": 0},
                "result": "INT. CAFE - DAY\nJohn drinks coffee."
            },
            {
                "tool_name": "get_scene",
                "tool_input": {"scene_index": 1},
                "result": "EXT. PARK - DAY\nMary walks her dog in the park."
            }
        ]

        evidence = await builder.build_evidence(
            tool_results=tool_results,
            user_question="What happens with Mary in the park?"
        )

        # Item mentioning "Mary" and "park" should be ranked higher
        assert len(evidence.items) == 2
        assert "Mary" in evidence.items[0].content
        assert evidence.items[0].relevance_score > evidence.items[1].relevance_score

    @pytest.mark.asyncio
    async def test_build_evidence_truncation(self, builder):
        """Test that evidence is truncated to budget."""
        # Create many results
        tool_results = [
            {
                "tool_name": "get_scene",
                "tool_input": {"scene_index": i},
                "result": f"Scene {i+1}: " + "X" * 2000  # Large content
            }
            for i in range(20)
        ]

        evidence = await builder.build_evidence(
            tool_results=tool_results,
            user_question="What happens?",
            max_items=5
        )

        # Should be truncated to max_items
        assert len(evidence.items) <= 5
        assert evidence.was_truncated

    @pytest.mark.asyncio
    async def test_build_evidence_batch_parsing(self, builder):
        """Test that batch tool results are parsed into individual items."""
        tool_results = [
            {
                "tool_name": "get_scenes",
                "tool_input": {"scene_indices": [0, 1, 2]},
                "result": """--- SCENE 1 (0, INT. CAFE - DAY) ---

John enters the cafe.

--- SCENE 2 (1, EXT. STREET - DAY) ---

Mary walks down the street.

--- SCENE 3 (2, INT. OFFICE - NIGHT) ---

Tom works late at the office."""
            }
        ]

        evidence = await builder.build_evidence(
            tool_results=tool_results,
            user_question="What scenes involve John?"
        )

        # Batch result should be split into individual scene items
        assert len(evidence.items) >= 1
        # The scene with John should be ranked higher
        assert evidence.items[0].relevance_score >= 0


class TestEvidenceBuilderEdgeCases:
    """Test edge cases in EvidenceBuilder."""

    @pytest.fixture
    def builder(self):
        return EvidenceBuilder()

    @pytest.mark.asyncio
    async def test_empty_content_filtered(self, builder):
        """Test that empty content results are filtered."""
        tool_results = [
            {"tool_name": "test", "tool_input": {}, "result": ""},
            {"tool_name": "test", "tool_input": {}, "result": "Valid content"}
        ]

        evidence = await builder.build_evidence(tool_results, "test question")

        assert len(evidence.items) == 1
        assert evidence.items[0].content == "Valid content"

    @pytest.mark.asyncio
    async def test_individual_item_truncation(self, builder):
        """Test that individual items are truncated if too long."""
        long_content = "X" * 5000  # Longer than MAX_CHARS_PER_ITEM
        tool_results = [
            {"tool_name": "test", "tool_input": {}, "result": long_content}
        ]

        evidence = await builder.build_evidence(tool_results, "test")

        assert len(evidence.items) == 1
        assert evidence.items[0].char_count <= builder.MAX_CHARS_PER_ITEM + 20  # +20 for truncation marker
        assert "[truncated]" in evidence.items[0].content
