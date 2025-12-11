"""
Unit tests for AI services
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch
from uuid import uuid4
from datetime import datetime

from app.services.ai_scene_service import AISceneService
from app.services.ingestion_service import IngestionService
from app.services.embedding_service import EmbeddingService
from app.services.script_state_service import ScriptStateService
from app.models.scene import Scene
from app.models.script import Script
from app.models.script_state import ScriptState


class TestAISceneService:
    """Tests for AISceneService"""

    def test_normalize_scene_text(self):
        """Test scene text normalization"""
        # Test with excessive whitespace
        text = "  Line 1  \n\n  Line 2  \n  "
        normalized = AISceneService.normalize_scene_text(text)
        assert normalized == "line 1\nline 2"

        # Test empty string
        assert AISceneService.normalize_scene_text("") == ""

        # Test with only whitespace
        assert AISceneService.normalize_scene_text("   \n  \n  ") == ""

    def test_compute_scene_hash(self):
        """Test scene hash computation"""
        text1 = "INT. COFFEE SHOP - DAY"
        text2 = "INT. COFFEE SHOP - DAY"  # Same content
        text3 = "EXT. PARK - NIGHT"  # Different content

        hash1 = AISceneService.compute_scene_hash(text1)
        hash2 = AISceneService.compute_scene_hash(text2)
        hash3 = AISceneService.compute_scene_hash(text3)

        # Same content should produce same hash
        assert hash1 == hash2

        # Different content should produce different hash
        assert hash1 != hash3

        # Hash should be 64 characters (SHA-256 hex)
        assert len(hash1) == 64

    def test_construct_scene_text_from_blocks(self):
        """Test constructing scene text from content_blocks"""
        scene = Mock()
        scene.content_blocks = [
            {"text": "INT. COFFEE SHOP - DAY", "type": "scene_heading"},
            {"text": "John enters.", "type": "action"}
        ]
        scene.raw_text = None
        scene.scene_heading = "INT. COFFEE SHOP - DAY"

        text = AISceneService._construct_scene_text(scene)
        assert text == "INT. COFFEE SHOP - DAY\nJohn enters."

    def test_construct_scene_text_fallback(self):
        """Test fallback to raw_text and scene_heading"""
        # Test with raw_text
        scene = Mock()
        scene.content_blocks = None
        scene.raw_text = "Scene content"
        scene.scene_heading = "INT. ROOM - DAY"

        text = AISceneService._construct_scene_text(scene)
        assert text == "Scene content"

        # Test with only scene_heading
        scene.raw_text = None
        text = AISceneService._construct_scene_text(scene)
        assert text == "INT. ROOM - DAY"


class TestIngestionService:
    """Tests for IngestionService"""

    @pytest.mark.asyncio
    async def test_generate_scene_summary_creates_prompt(self):
        """Test that scene summary generation creates proper prompt"""
        db_mock = AsyncMock()
        service = IngestionService(db_mock)

        # Mock the Anthropic client
        with patch.object(service.client.messages, 'create', new_callable=AsyncMock) as mock_create:
            mock_create.return_value = Mock(
                content=[Mock(text="**Action:** Test summary\n**Conflict:** Test conflict")]
            )

            scene = Mock()
            scene.scene_id = uuid4()
            scene.scene_index = 1
            scene.scene_heading = "INT. TEST - DAY"
            scene.content_blocks = [{"text": "Test scene content"}]

            # Mock database query for existing summary
            db_mock.execute = AsyncMock(return_value=Mock(
                scalar_one_or_none=Mock(return_value=None)
            ))

            summary = await service.generate_scene_summary(scene)

            # Verify API was called
            assert mock_create.called

            # Verify summary was created
            assert summary.summary_text.startswith("**Action:**")
            assert summary.tokens_estimate > 0

    def test_construct_scene_text(self):
        """Test scene text construction"""
        scene = Mock()
        scene.content_blocks = [
            {"text": "Line 1"},
            {"text": "Line 2"}
        ]

        text = IngestionService._construct_scene_text(scene)
        assert text == "Line 1\nLine 2"


class TestEmbeddingService:
    """Tests for EmbeddingService"""

    def test_cosine_similarity(self):
        """Test cosine similarity calculation"""
        vec1 = [1.0, 0.0, 0.0]
        vec2 = [1.0, 0.0, 0.0]
        vec3 = [0.0, 1.0, 0.0]

        # Identical vectors should have similarity 1.0
        similarity = EmbeddingService.cosine_similarity(vec1, vec2)
        assert abs(similarity - 1.0) < 0.001

        # Orthogonal vectors should have similarity 0.0
        similarity = EmbeddingService.cosine_similarity(vec1, vec3)
        assert abs(similarity - 0.0) < 0.001

    def test_cosine_similarity_different_dimensions(self):
        """Test that different dimension vectors raise error"""
        vec1 = [1.0, 0.0]
        vec2 = [1.0, 0.0, 0.0]

        with pytest.raises(ValueError, match="same dimensions"):
            EmbeddingService.cosine_similarity(vec1, vec2)

    @pytest.mark.asyncio
    async def test_should_reembed_length_change(self):
        """Test re-embedding decision based on length change"""
        db_mock = AsyncMock()
        service = EmbeddingService(db_mock)

        old_card = "Short summary"
        new_card = "This is a much longer summary that exceeds the 20% threshold"

        # Should trigger re-embedding due to >20% length change
        should_reembed = await service.should_reembed(old_card, new_card)
        assert should_reembed is True

    @pytest.mark.asyncio
    async def test_should_reembed_identical(self):
        """Test that identical text doesn't trigger re-embedding"""
        db_mock = AsyncMock()
        service = EmbeddingService(db_mock)

        text = "Same summary"

        should_reembed = await service.should_reembed(text, text)
        assert should_reembed is False


class TestScriptStateService:
    """Tests for ScriptStateService"""

    @pytest.mark.asyncio
    async def test_check_state_transition_empty_to_partial(self):
        """Test state transition from empty to partial"""
        db_mock = AsyncMock()
        service = ScriptStateService(db_mock)

        script = Mock()
        script.script_id = uuid4()
        script.state = ScriptState.EMPTY

        # Mock scene count to meet threshold
        with patch.object(service, 'count_scenes', return_value=5):
            with patch.object(service, 'estimate_page_count', return_value=8):
                new_state = await service.check_state_transition(script)
                assert new_state == ScriptState.PARTIAL

    @pytest.mark.asyncio
    async def test_check_state_transition_partial_to_analyzed(self):
        """Test state transition from partial to analyzed"""
        db_mock = AsyncMock()
        service = ScriptStateService(db_mock)

        script = Mock()
        script.script_id = uuid4()
        script.state = ScriptState.PARTIAL

        # Mock scene count to meet threshold
        with patch.object(service, 'count_scenes', return_value=35):
            with patch.object(service, 'estimate_page_count', return_value=65):
                new_state = await service.check_state_transition(script)
                assert new_state == ScriptState.ANALYZED

    @pytest.mark.asyncio
    async def test_check_state_transition_no_transition(self):
        """Test when no state transition is needed"""
        db_mock = AsyncMock()
        service = ScriptStateService(db_mock)

        script = Mock()
        script.script_id = uuid4()
        script.state = ScriptState.EMPTY

        # Mock counts below threshold
        with patch.object(service, 'count_scenes', return_value=1):
            with patch.object(service, 'estimate_page_count', return_value=5):
                new_state = await service.check_state_transition(script)
                assert new_state is None

    def test_construct_scene_text(self):
        """Test scene text construction"""
        scene = Mock()
        scene.content_blocks = [{"text": "Content"}]

        text = ScriptStateService._construct_scene_text(scene)
        assert text == "Content"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
