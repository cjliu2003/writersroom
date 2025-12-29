"""
Tests for TopicDetector Phase A Improvements

Validates the improved continuity detection that:
1. Recognizes disagreement/questioning patterns as follow-ups
2. Detects referential pronouns mid-sentence
3. Recognizes questions addressing AI's perspective
4. Defaults to FOLLOW_UP for ambiguous cases
"""

import pytest
from app.services.topic_detector import TopicDetector
from app.schemas.ai import TopicMode


class TestDisagreementPatterns:
    """Test that disagreement/questioning patterns are detected as FOLLOW_UP."""

    @pytest.fixture
    def detector(self):
        return TopicDetector()

    @pytest.mark.asyncio
    async def test_i_dont_know_is_follow_up(self, detector):
        """'I don't know' at start indicates responding to advice."""
        mode, conf = await detector.detect_mode(
            current_message="I don't know, I feel like the dialogue isn't disguising exposition",
            last_assistant_message="The scene relies too heavily on exposition..."
        )
        assert mode == TopicMode.FOLLOW_UP
        assert conf >= 0.5

    @pytest.mark.asyncio
    async def test_i_disagree_is_follow_up(self, detector):
        """'I disagree' indicates responding to prior analysis."""
        mode, conf = await detector.detect_mode(
            current_message="I disagree with your assessment of the pacing",
            last_assistant_message="The pacing in act 2 is too slow..."
        )
        assert mode == TopicMode.FOLLOW_UP

    @pytest.mark.asyncio
    async def test_i_feel_like_is_follow_up(self, detector):
        """'I feel like' indicates personal response to advice."""
        mode, conf = await detector.detect_mode(
            current_message="I feel like that's not quite right for this scene",
            last_assistant_message="Consider changing the dialogue to..."
        )
        assert mode == TopicMode.FOLLOW_UP

    @pytest.mark.asyncio
    async def test_but_i_is_follow_up(self, detector):
        """'But I' indicates disagreement/continuation."""
        mode, conf = await detector.detect_mode(
            current_message="But I think the character motivation is clear enough",
            last_assistant_message="The character's motivation needs more explanation..."
        )
        assert mode == TopicMode.FOLLOW_UP

    @pytest.mark.asyncio
    async def test_why_doesnt_is_follow_up(self, detector):
        """'Why doesn't' questions prior AI statement."""
        mode, conf = await detector.detect_mode(
            current_message="Why doesn't this approach work for the climax?",
            last_assistant_message="I suggest restructuring the climax..."
        )
        assert mode == TopicMode.FOLLOW_UP


class TestQuestionToAI:
    """Test that questions addressing AI's perspective are FOLLOW_UP."""

    @pytest.fixture
    def detector(self):
        return TopicDetector()

    @pytest.mark.asyncio
    async def test_question_with_to_you(self, detector):
        """'to you' in question addresses AI's opinion."""
        mode, conf = await detector.detect_mode(
            current_message="Why doesn't this feel authentic to you?",
            last_assistant_message="The dialogue feels inauthentic..."
        )
        assert mode == TopicMode.FOLLOW_UP
        assert conf >= 0.7

    @pytest.mark.asyncio
    async def test_question_with_your(self, detector):
        """'your' in question references AI's analysis."""
        mode, conf = await detector.detect_mode(
            current_message="Can you explain your reasoning about the subplot?",
            last_assistant_message="The subplot detracts from the main story..."
        )
        assert mode == TopicMode.FOLLOW_UP

    @pytest.mark.asyncio
    async def test_question_with_you(self, detector):
        """'you' in question addresses AI directly."""
        mode, conf = await detector.detect_mode(
            current_message="Do you think this works better?",
            last_assistant_message="Try restructuring the scene..."
        )
        assert mode == TopicMode.FOLLOW_UP


class TestReferentialPronouns:
    """Test that referential pronouns mid-sentence trigger FOLLOW_UP."""

    @pytest.fixture
    def detector(self):
        return TopicDetector()

    @pytest.mark.asyncio
    async def test_this_mid_sentence(self, detector):
        """'this' mid-sentence refers to previous context."""
        mode, conf = await detector.detect_mode(
            current_message="I feel like this is actually working well",
            last_assistant_message="The pacing in scene 5 is problematic..."
        )
        assert mode == TopicMode.FOLLOW_UP

    @pytest.mark.asyncio
    async def test_that_mid_sentence(self, detector):
        """'that' mid-sentence refers to previous context."""
        mode, conf = await detector.detect_mode(
            current_message="The dialogue in that section seems fine to me",
            last_assistant_message="Consider revising the dialogue..."
        )
        assert mode == TopicMode.FOLLOW_UP


class TestDefaultBehavior:
    """Test that ambiguous messages default to FOLLOW_UP."""

    @pytest.fixture
    def detector(self):
        return TopicDetector()

    @pytest.mark.asyncio
    async def test_ambiguous_defaults_to_follow_up(self, detector):
        """Longer messages without clear signals should default to FOLLOW_UP."""
        mode, conf = await detector.detect_mode(
            current_message="The character development seems fine to me overall and the arc is clear",
            last_assistant_message="I have concerns about character development..."
        )
        assert mode == TopicMode.FOLLOW_UP
        assert conf == 0.5

    @pytest.mark.asyncio
    async def test_short_message_strong_follow_up(self, detector):
        """Short messages (<8 words) should have higher confidence FOLLOW_UP."""
        mode, conf = await detector.detect_mode(
            current_message="Okay, what else?",
            last_assistant_message="First, consider the pacing..."
        )
        assert mode == TopicMode.FOLLOW_UP
        assert conf >= 0.7

    @pytest.mark.asyncio
    async def test_no_history_is_new_topic(self, detector):
        """No conversation history should still be NEW_TOPIC."""
        mode, conf = await detector.detect_mode(
            current_message="What do you think about the opening scene?",
            last_assistant_message=None,
            last_user_message=None
        )
        assert mode == TopicMode.NEW_TOPIC
        assert conf == 1.0


class TestExplicitNewTopic:
    """Test that explicit new topic signals still work."""

    @pytest.fixture
    def detector(self):
        return TopicDetector()

    @pytest.mark.asyncio
    async def test_new_question_phrase(self, detector):
        """'New question' should trigger NEW_TOPIC."""
        mode, conf = await detector.detect_mode(
            current_message="New question: how do I format montages?",
            last_assistant_message="The dialogue looks good..."
        )
        assert mode == TopicMode.NEW_TOPIC

    @pytest.mark.asyncio
    async def test_different_topic_phrase(self, detector):
        """'Different topic' should trigger NEW_TOPIC."""
        mode, conf = await detector.detect_mode(
            current_message="Different topic - what about the third act?",
            last_assistant_message="The opening is strong..."
        )
        assert mode == TopicMode.NEW_TOPIC

    @pytest.mark.asyncio
    async def test_switching_topics_phrase(self, detector):
        """'Switching topics' should trigger NEW_TOPIC."""
        mode, conf = await detector.detect_mode(
            current_message="Switching topics, can you help with character names?",
            last_assistant_message="The pacing is excellent..."
        )
        assert mode == TopicMode.NEW_TOPIC


class TestRealWorldScenario:
    """Test the exact scenario that caused the original bug."""

    @pytest.fixture
    def detector(self):
        return TopicDetector()

    @pytest.mark.asyncio
    async def test_original_bug_scenario(self, detector):
        """
        The exact message that was incorrectly classified as NEW_TOPIC.

        User asked about scene 4 dialogue, AI responded with suggestions,
        user questioned one of the suggestions - this should be FOLLOW_UP.
        """
        user_message = (
            "I don't know, I feel like the dialogue isn't disguising exposition, "
            "but is a natural conversation. Why doesn't this feel authentic to you?"
        )
        ai_response = (
            "The scene relies too heavily on exposition disguised as dialogue. "
            "Lines like 'You've been calling Camila' feel like Sam and Lauren "
            "are informing the audience rather than having an authentic conflict."
        )

        mode, conf = await detector.detect_mode(
            current_message=user_message,
            last_assistant_message=ai_response
        )

        assert mode == TopicMode.FOLLOW_UP, (
            f"Expected FOLLOW_UP but got {mode.value} with confidence {conf}. "
            "This is the exact scenario that caused the original bug."
        )
