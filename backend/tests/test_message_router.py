"""
Tests for MessageRouter (Phase 1: Unified Router)

Tests the unified classification for domain, request type, intent, and continuity.
"""

import pytest
from app.services.message_router import MessageRouter
from app.schemas.ai import (
    DomainType, RequestType, IntentType, TopicMode, ReferenceType
)


class TestMessageRouterHeuristics:
    """Test heuristic-based classification (fast path)."""

    def setup_method(self):
        """Set up router for each test."""
        self.router = MessageRouter()

    # ==========================================================================
    # Domain Classification Tests
    # ==========================================================================

    def test_general_question_save_the_cat(self):
        """'Save the cat' is a screenwriting term - should be GENERAL."""
        result = self.router.classify_heuristic(
            "What is a save the cat beat?",
            has_active_scene=False
        )
        assert result is not None
        assert result.domain == DomainType.GENERAL

    def test_general_question_three_acts(self):
        """'Three acts' is a screenwriting term - should be GENERAL."""
        result = self.router.classify_heuristic(
            "What are the three acts?",
            has_active_scene=False
        )
        assert result is not None
        assert result.domain == DomainType.GENERAL

    def test_general_question_heros_journey(self):
        """'Hero's journey' is a screenwriting term - should be GENERAL."""
        result = self.router.classify_heuristic(
            "Explain the hero's journey",
            has_active_scene=False
        )
        assert result is not None
        assert result.domain == DomainType.GENERAL

    def test_general_question_inciting_incident(self):
        """'Inciting incident' is a screenwriting term - should be GENERAL."""
        result = self.router.classify_heuristic(
            "What is an inciting incident?",
            has_active_scene=False
        )
        assert result is not None
        assert result.domain == DomainType.GENERAL

    def test_script_question_my_script(self):
        """'My script' explicitly references the script - should be SCRIPT."""
        result = self.router.classify_heuristic(
            "How is the pacing in my script?",
            has_active_scene=True
        )
        assert result is not None
        assert result.domain == DomainType.SCRIPT

    def test_script_question_this_scene(self):
        """'This scene' explicitly references script content - should be SCRIPT."""
        result = self.router.classify_heuristic(
            "What do you think of this scene?",
            has_active_scene=True
        )
        assert result is not None
        assert result.domain == DomainType.SCRIPT

    def test_script_question_character(self):
        """Questions about 'character' typically refer to script - should be SCRIPT."""
        result = self.router.classify_heuristic(
            "Is the character development good?",
            has_active_scene=True
        )
        assert result is not None
        assert result.domain == DomainType.SCRIPT

    # ==========================================================================
    # Request Type Classification Tests
    # ==========================================================================

    def test_rewrite_detection_explicit(self):
        """Explicit 'rewrite' should return REWRITE request type."""
        result = self.router.classify_heuristic(
            "Can you rewrite this dialogue?",
            has_active_scene=True
        )
        assert result is not None
        assert result.request_type == RequestType.REWRITE

    def test_rewrite_detection_revise(self):
        """'Revise' should also trigger REWRITE request type."""
        result = self.router.classify_heuristic(
            "Please revise these action lines",
            has_active_scene=True
        )
        assert result is not None
        assert result.request_type == RequestType.REWRITE

    def test_rewrite_detection_draft(self):
        """'Draft' should also trigger REWRITE request type."""
        result = self.router.classify_heuristic(
            "Give me a draft of the opening",
            has_active_scene=True
        )
        assert result is not None
        assert result.request_type == RequestType.REWRITE

    def test_rewrite_detection_punch_up(self):
        """'Punch up' should trigger REWRITE request type."""
        result = self.router.classify_heuristic(
            "Can you punch up these lines?",
            has_active_scene=True
        )
        assert result is not None
        assert result.request_type == RequestType.REWRITE

    def test_default_suggest(self):
        """Without rewrite keywords, should default to SUGGEST."""
        result = self.router.classify_heuristic(
            "What do you think of this scene?",
            has_active_scene=True
        )
        assert result is not None
        assert result.request_type == RequestType.SUGGEST

    def test_diagnose_detection(self):
        """'Analyze' should trigger DIAGNOSE request type."""
        result = self.router.classify_heuristic(
            "Analyze this scene for me",
            has_active_scene=True
        )
        assert result is not None
        assert result.request_type == RequestType.DIAGNOSE

    def test_brainstorm_detection(self):
        """'Brainstorm' should trigger BRAINSTORM request type."""
        result = self.router.classify_heuristic(
            "Let's brainstorm some ideas for the ending",
            has_active_scene=True
        )
        assert result is not None
        assert result.request_type == RequestType.BRAINSTORM

    def test_brainstorm_detection_ideas_for(self):
        """'Ideas for' should also trigger BRAINSTORM."""
        result = self.router.classify_heuristic(
            "Give me ideas for the climax",
            has_active_scene=True
        )
        assert result is not None
        assert result.request_type == RequestType.BRAINSTORM

    def test_brainstorm_detection_what_if(self):
        """'What if' should also trigger BRAINSTORM."""
        result = self.router.classify_heuristic(
            "What if we changed the villain's motivation?",
            has_active_scene=True
        )
        assert result is not None
        assert result.request_type == RequestType.BRAINSTORM

    # ==========================================================================
    # Continuity and Reference Tests
    # ==========================================================================

    def test_follow_up_pronoun_it(self):
        """Starting with 'it' indicates follow-up."""
        result = self.router.classify_heuristic(
            "It seems a bit long",
            has_active_scene=True
        )
        assert result is not None
        assert result.continuity == TopicMode.FOLLOW_UP

    def test_follow_up_pronoun_that(self):
        """Starting with 'that' indicates follow-up."""
        result = self.router.classify_heuristic(
            "That could be improved",
            has_active_scene=True
        )
        assert result is not None
        assert result.continuity == TopicMode.FOLLOW_UP

    def test_follow_up_what_about(self):
        """'What about' indicates follow-up."""
        result = self.router.classify_heuristic(
            "What about the subplot?",
            has_active_scene=True
        )
        assert result is not None
        assert result.continuity == TopicMode.FOLLOW_UP

    def test_follow_up_and_also(self):
        """Starting with 'and' or 'also' indicates follow-up."""
        result = self.router.classify_heuristic(
            "And what about the ending?",
            has_active_scene=True
        )
        assert result is not None
        assert result.continuity == TopicMode.FOLLOW_UP

    def test_prior_advice_reference(self):
        """'You suggested' references prior advice."""
        result = self.router.classify_heuristic(
            "Can you expand on what you suggested earlier?",
            has_active_scene=True
        )
        assert result is not None
        assert result.refers_to == ReferenceType.PRIOR_ADVICE
        assert result.continuity == TopicMode.FOLLOW_UP

    def test_character_reference(self):
        """Pronoun with character-related context should reference CHARACTER."""
        result = self.router.classify_heuristic(
            "What about his motivation?",
            has_active_scene=True
        )
        assert result is not None
        assert result.refers_to == ReferenceType.CHARACTER

    def test_scene_reference(self):
        """Reference to 'that scene' should be SCENE."""
        result = self.router.classify_heuristic(
            "That scene seems too long",
            has_active_scene=True
        )
        assert result is not None
        assert result.refers_to == ReferenceType.SCENE

    def test_new_topic_no_pronouns(self):
        """Questions without pronouns at start are new topics."""
        result = self.router.classify_heuristic(
            "Is the dialogue in scene 5 natural?",
            has_active_scene=True
        )
        assert result is not None
        assert result.continuity == TopicMode.NEW_TOPIC

    # ==========================================================================
    # Intent Classification Tests
    # ==========================================================================

    def test_intent_local_edit(self):
        """'Fix' and 'edit' should trigger LOCAL_EDIT intent."""
        result = self.router.classify_heuristic(
            "Fix the dialogue in this scene",
            has_active_scene=True
        )
        assert result is not None
        assert result.intent == IntentType.LOCAL_EDIT

    def test_intent_global_question(self):
        """'Arc' and 'theme' should trigger GLOBAL_QUESTION intent for script domain."""
        # Note: This tests that when SCRIPT domain is detected, arc-related questions
        # get GLOBAL_QUESTION intent (asking about overall story, not specific scene)
        result = self.router.classify_heuristic(
            "How is the overall arc of my script?",
            has_active_scene=True
        )
        assert result is not None
        assert result.intent == IntentType.GLOBAL_QUESTION

    def test_intent_brainstorm(self):
        """BRAINSTORM request type should set BRAINSTORM intent."""
        result = self.router.classify_heuristic(
            "Let's brainstorm ideas for the ending",
            has_active_scene=True
        )
        assert result is not None
        assert result.intent == IntentType.BRAINSTORM

    # ==========================================================================
    # Edge Cases and Ambiguous Inputs
    # ==========================================================================

    def test_needs_llm_for_ambiguous(self):
        """Ambiguous queries should return None (needs LLM)."""
        result = self.router.classify_heuristic(
            "Is this good?",  # Very ambiguous
            has_active_scene=False
        )
        # May or may not return None - depends on implementation
        # The key is that confidence should be lower for ambiguous queries
        if result:
            assert result.confidence < 0.9

    def test_empty_message(self):
        """Empty message should handle gracefully."""
        result = self.router.classify_heuristic(
            "",
            has_active_scene=False
        )
        # Should return None or low-confidence result
        if result:
            assert result.confidence < 0.8

    def test_rewrite_implies_script_domain(self):
        """REWRITE request should imply SCRIPT domain even without explicit keywords."""
        result = self.router.classify_heuristic(
            "Can you rewrite this?",  # No explicit script keywords
            has_active_scene=False
        )
        assert result is not None
        assert result.domain == DomainType.SCRIPT
        assert result.request_type == RequestType.REWRITE

    def test_brainstorm_implies_script_domain(self):
        """BRAINSTORM request should imply SCRIPT domain."""
        result = self.router.classify_heuristic(
            "Give me ideas for the ending",
            has_active_scene=False
        )
        assert result is not None
        assert result.domain == DomainType.SCRIPT
        assert result.request_type == RequestType.BRAINSTORM


class TestMessageRouterConfidence:
    """Test confidence scoring."""

    def setup_method(self):
        """Set up router for each test."""
        self.router = MessageRouter()

    def test_high_confidence_general(self):
        """Clear general questions should have high confidence."""
        result = self.router.classify_heuristic(
            "What is the hero's journey in screenwriting?",
            has_active_scene=False
        )
        assert result is not None
        assert result.confidence >= 0.75

    def test_confidence_above_threshold(self):
        """Results should only be returned if confidence >= 0.75."""
        result = self.router.classify_heuristic(
            "What is an inciting incident?",
            has_active_scene=False
        )
        if result:
            assert result.confidence >= 0.75


class TestMessageRouterLLM:
    """Test LLM-based classification (would need mocking for real tests)."""

    @pytest.mark.asyncio
    async def test_llm_fallback_structure(self):
        """Test that classify_with_llm returns properly structured result."""
        # Note: This would need API key and mocking for real testing
        # For now, we just test that the method exists and has correct signature
        router = MessageRouter()
        # Verify method exists
        assert hasattr(router, 'classify_with_llm')
        # Verify async
        import asyncio
        assert asyncio.iscoroutinefunction(router.classify_with_llm)
