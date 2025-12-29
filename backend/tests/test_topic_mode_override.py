"""
Tests for Phase B: Topic Mode Override API Support

Validates that the topic_mode override field in ChatMessageRequest
correctly bypasses automatic topic detection.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.schemas.ai import (
    TopicMode, TopicModeOverride, ChatMessageRequest,
    IntentType, BudgetTier
)
from app.services.context_builder import ContextBuilder


class TestTopicModeOverrideSchema:
    """Test the TopicModeOverride schema."""

    def test_override_enum_values(self):
        """TopicModeOverride should have 'continue' and 'new_topic' values."""
        assert TopicModeOverride.CONTINUE.value == "continue"
        assert TopicModeOverride.NEW_TOPIC.value == "new_topic"

    def test_chat_request_accepts_override(self):
        """ChatMessageRequest should accept topic_mode field."""
        request = ChatMessageRequest(
            script_id=uuid4(),
            message="Test message",
            topic_mode=TopicModeOverride.CONTINUE
        )
        assert request.topic_mode == TopicModeOverride.CONTINUE

    def test_chat_request_optional_override(self):
        """ChatMessageRequest should work without topic_mode (None default)."""
        request = ChatMessageRequest(
            script_id=uuid4(),
            message="Test message"
        )
        assert request.topic_mode is None

    def test_chat_request_new_topic_override(self):
        """ChatMessageRequest should accept NEW_TOPIC override."""
        request = ChatMessageRequest(
            script_id=uuid4(),
            message="Test message",
            topic_mode=TopicModeOverride.NEW_TOPIC
        )
        assert request.topic_mode == TopicModeOverride.NEW_TOPIC


class TestContextBuilderOverride:
    """Test ContextBuilder behavior with topic_mode_override."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        mock = MagicMock()
        mock.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))
        return mock

    def _create_mock_builder(self, mock_db):
        """Create a fully mocked ContextBuilder."""
        with patch.object(ContextBuilder, '__init__', lambda self, db: None):
            builder = ContextBuilder.__new__(ContextBuilder)
            builder.db = mock_db
            builder.BUDGET_TIERS = {BudgetTier.STANDARD: 5000}

            # Mock all methods that need to be async
            builder._count_tokens = MagicMock(return_value=10)
            builder._get_global_context = AsyncMock(return_value="")
            builder._get_system_prompt = MagicMock(return_value="System prompt")
            builder._format_scene_cards = MagicMock(return_value="")

            # Mock retrieval service
            builder.retrieval_service = MagicMock()
            builder.retrieval_service.retrieve_for_intent = AsyncMock(return_value={"scenes": []})

            # Mock conversation service
            builder.conversation_service = MagicMock()
            builder.conversation_service.get_conversation_context = AsyncMock(return_value={
                "recent_messages": [
                    {"role": MagicMock(value="user"), "content": "Previous question"},
                    {"role": MagicMock(value="assistant"), "content": "Previous answer"}
                ]
            })

            # Mock topic detector
            builder.topic_detector = MagicMock()
            builder.topic_detector.detect_mode = AsyncMock(return_value=(TopicMode.FOLLOW_UP, 0.8))

            return builder

    @pytest.mark.asyncio
    async def test_continue_override_forces_follow_up(self, mock_db):
        """topic_mode_override=CONTINUE should force FOLLOW_UP mode."""
        builder = self._create_mock_builder(mock_db)

        # Build prompt with CONTINUE override
        result = await builder.build_prompt(
            script_id=uuid4(),
            message="Test message",
            intent=IntentType.SCENE_FEEDBACK,
            conversation_id=uuid4(),
            topic_mode_override=TopicModeOverride.CONTINUE
        )

        # Verify topic mode is FOLLOW_UP with 1.0 confidence
        assert result["metadata"]["topic_mode"] == TopicMode.FOLLOW_UP
        assert result["metadata"]["topic_confidence"] == 1.0

        # Verify topic_detector was NOT called (override bypasses it)
        builder.topic_detector.detect_mode.assert_not_called()

    @pytest.mark.asyncio
    async def test_new_topic_override_forces_new_topic(self, mock_db):
        """topic_mode_override=NEW_TOPIC should force NEW_TOPIC mode."""
        builder = self._create_mock_builder(mock_db)

        # Build prompt with NEW_TOPIC override
        result = await builder.build_prompt(
            script_id=uuid4(),
            message="Tell me more about it",  # Would normally be FOLLOW_UP
            intent=IntentType.SCENE_FEEDBACK,
            conversation_id=uuid4(),
            topic_mode_override=TopicModeOverride.NEW_TOPIC
        )

        # Verify topic mode is NEW_TOPIC with 1.0 confidence
        assert result["metadata"]["topic_mode"] == TopicMode.NEW_TOPIC
        assert result["metadata"]["topic_confidence"] == 1.0

        # Verify topic_detector was NOT called
        builder.topic_detector.detect_mode.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_override_uses_auto_detection(self, mock_db):
        """No override should use automatic topic detection."""
        builder = self._create_mock_builder(mock_db)

        # Build prompt WITHOUT override (None)
        result = await builder.build_prompt(
            script_id=uuid4(),
            message="Test message",
            intent=IntentType.SCENE_FEEDBACK,
            conversation_id=uuid4(),
            topic_mode_override=None  # No override
        )

        # Verify topic_detector WAS called
        builder.topic_detector.detect_mode.assert_called_once()

        # Verify result uses detected mode
        assert result["metadata"]["topic_mode"] == TopicMode.FOLLOW_UP
        assert result["metadata"]["topic_confidence"] == 0.8
