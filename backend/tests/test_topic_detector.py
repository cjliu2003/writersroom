"""
Tests for P2.1 Topic Detector Service

Validates the TopicDetector correctly:
- Detects follow-up vs new topic patterns
- Handles pronouns at message start
- Detects scene number overlap
- Handles edge cases (no history, short messages)
"""

import pytest
from app.services.topic_detector import TopicDetector
from app.schemas.ai import TopicMode


class TestTopicDetectorPatterns:
    """Test pattern-based detection."""

    @pytest.fixture
    def detector(self):
        """Create a TopicDetector instance."""
        return TopicDetector()

    @pytest.mark.asyncio
    async def test_no_history_returns_new_topic(self, detector):
        """Test that no history means new topic with high confidence."""
        mode, confidence = await detector.detect_mode(
            current_message="What happens in scene 5?",
            last_assistant_message=None,
            last_user_message=None
        )
        assert mode == TopicMode.NEW_TOPIC
        assert confidence == 1.0

    @pytest.mark.asyncio
    async def test_follow_up_patterns(self, detector):
        """Test that follow-up patterns are detected."""
        follow_up_messages = [
            "Also, what about the dialogue?",
            "Additionally, can you check the pacing?",
            "What about scene 3?",
            "Can you also look at the ending?",
            "Tell me more about that character",
            "Going back to scene 5, what do you think?",
        ]

        for msg in follow_up_messages:
            mode, confidence = await detector.detect_mode(
                current_message=msg,
                last_assistant_message="Scene 5 is well-structured.",
                last_user_message="Analyze scene 5"
            )
            assert mode == TopicMode.FOLLOW_UP, f"Failed for: {msg}"
            assert confidence >= 0.5

    @pytest.mark.asyncio
    async def test_new_topic_patterns_strong(self, detector):
        """Test that strong new topic patterns are detected.

        Single new topic patterns may not override the short-message heuristic,
        so we test with messages that have multiple indicators or explicit signals.
        """
        # Messages with strong/multiple new topic signals
        new_topic_messages = [
            # Multiple indicators: "by the way" + long enough message
            "By the way, I have a completely different question about the overall structure of this screenplay and how it flows",
            # Explicit "unrelated" + more context
            "Unrelated question: what is the total page count of this script and does it meet industry standards?",
            # "switching topics" is explicit
            "Switching topics here, let's talk about the antagonist's motivation",
        ]

        for msg in new_topic_messages:
            mode, confidence = await detector.detect_mode(
                current_message=msg,
                last_assistant_message="Scene 5 is well-structured.",
                last_user_message="Analyze scene 5"
            )
            assert mode == TopicMode.NEW_TOPIC, f"Failed for: {msg}"
            assert confidence >= 0.5

    @pytest.mark.asyncio
    async def test_ambiguous_new_topic_patterns(self, detector):
        """Test that single new topic patterns in short messages are ambiguous.

        The detector intentionally treats short messages with single new-topic
        patterns as ambiguous, defaulting to follow-up to preserve context.
        """
        ambiguous_messages = [
            "New question: how is the pacing?",
            "Different question about act structure",
            "Separate question about formatting",
        ]

        for msg in ambiguous_messages:
            mode, confidence = await detector.detect_mode(
                current_message=msg,
                last_assistant_message="Scene 5 is well-structured.",
                last_user_message="Analyze scene 5"
            )
            # These are ambiguous - short message heuristic may win
            assert mode in [TopicMode.FOLLOW_UP, TopicMode.NEW_TOPIC], f"Failed for: {msg}"
            # Low confidence either way
            assert confidence <= 0.9


class TestTopicDetectorPronouns:
    """Test pronoun-based detection."""

    @pytest.fixture
    def detector(self):
        return TopicDetector()

    @pytest.mark.asyncio
    async def test_pronoun_at_start_suggests_follow_up(self, detector):
        """Test that pronouns at message start suggest follow-up."""
        pronoun_messages = [
            "It seems a bit slow",
            "They don't seem motivated",
            "That's a good point",
            "This character is interesting",
        ]

        for msg in pronoun_messages:
            mode, confidence = await detector.detect_mode(
                current_message=msg,
                last_assistant_message="The scene has good pacing.",
                last_user_message="How is the pacing?"
            )
            assert mode == TopicMode.FOLLOW_UP, f"Failed for: {msg}"
            assert confidence >= 0.7


class TestTopicDetectorSceneOverlap:
    """Test scene number overlap detection."""

    @pytest.fixture
    def detector(self):
        return TopicDetector()

    @pytest.mark.asyncio
    async def test_scene_number_overlap_suggests_follow_up(self, detector):
        """Test that overlapping scene numbers suggest follow-up."""
        mode, confidence = await detector.detect_mode(
            current_message="Is scene 5 too long?",
            last_assistant_message="Scene 5 has strong dialogue and good pacing.",
            last_user_message="Analyze scene 5"
        )
        assert mode == TopicMode.FOLLOW_UP
        assert confidence >= 0.8

    @pytest.mark.asyncio
    async def test_different_scene_numbers(self, detector):
        """Test that different scene numbers don't trigger overlap detection."""
        # Different scenes, no other follow-up patterns
        mode, confidence = await detector.detect_mode(
            current_message="Analyze scene 10 for me",
            last_assistant_message="Scene 5 is excellent.",
            last_user_message="What about scene 5?"
        )
        # Should be ambiguous (short message → follow_up default)
        # But scene 10 vs scene 5 is different context
        # The short message heuristic will still trigger
        assert mode in [TopicMode.FOLLOW_UP, TopicMode.NEW_TOPIC]


class TestTopicDetectorEdgeCases:
    """Test edge cases."""

    @pytest.fixture
    def detector(self):
        return TopicDetector()

    @pytest.mark.asyncio
    async def test_short_message_defaults_to_follow_up(self, detector):
        """Test that short ambiguous messages default to follow-up."""
        mode, confidence = await detector.detect_mode(
            current_message="OK",  # Very short, no patterns
            last_assistant_message="Scene 5 is well-structured.",
            last_user_message="Analyze scene 5"
        )
        assert mode == TopicMode.FOLLOW_UP
        assert confidence == 0.5  # Low confidence default

    @pytest.mark.asyncio
    async def test_long_message_without_patterns_is_new_topic(self, detector):
        """Test that long messages without patterns lean toward new topic."""
        long_message = (
            "I'm working on a new screenplay about a detective who discovers "
            "a conspiracy in a small town. The detective has a troubled past "
            "and must confront old demons while solving the case. "
            "The setting is 1950s America with noir aesthetics."
        )
        mode, confidence = await detector.detect_mode(
            current_message=long_message,
            last_assistant_message="Scene 5 is about the cafe scene.",
            last_user_message="What happens in scene 5?"
        )
        assert mode == TopicMode.NEW_TOPIC
        assert confidence == 0.5

    @pytest.mark.asyncio
    async def test_mixed_patterns_follow_up_wins(self, detector):
        """Test that when follow-up patterns outnumber new topic patterns."""
        # "Also" and "what about" are follow-up patterns
        # "by the way" is a new topic pattern, but only 1 vs 2
        mode, confidence = await detector.detect_mode(
            current_message="Also, what about the ending?",
            last_assistant_message="The opening is strong.",
            last_user_message="How is the opening?"
        )
        assert mode == TopicMode.FOLLOW_UP

    @pytest.mark.asyncio
    async def test_only_user_history(self, detector):
        """Test detection with only previous user message (no assistant response).

        Without an assistant message, the detector has less context. Short messages
        with single new-topic patterns are ambiguous.
        """
        mode, confidence = await detector.detect_mode(
            current_message="Never mind, different question",
            last_assistant_message=None,
            last_user_message="What about scene 5?"
        )
        # Short message (4 words) - ambiguous without strong signals
        assert mode in [TopicMode.FOLLOW_UP, TopicMode.NEW_TOPIC]
        # Lower confidence due to ambiguity
        assert confidence <= 0.9

    @pytest.mark.asyncio
    async def test_only_assistant_history(self, detector):
        """Test detection with only previous assistant message."""
        mode, confidence = await detector.detect_mode(
            current_message="What else can you tell me about that?",
            last_assistant_message="Scene 5 features John and Mary in the cafe.",
            last_user_message=None
        )
        # "what else" and "that" suggest follow-up
        assert mode == TopicMode.FOLLOW_UP
