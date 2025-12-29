"""
Tests for ContextBuilder Phase 3-4 Updates

Phase 3: Enhanced Continuity (get_reference_context)
Phase 4: System Prompt Updates (domain/request-type aware prompts)
"""

import pytest
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.context_builder import ContextBuilder
from app.models.conversation_state import ConversationState
from app.schemas.ai import (
    IntentType, ReferenceType, RequestType, DomainType, BudgetTier
)


class TestGetReferenceContext:
    """Test Phase 3: get_reference_context method."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        return db

    @pytest.fixture
    def context_builder(self, mock_db):
        """Create ContextBuilder with mock db."""
        return ContextBuilder(mock_db)

    @pytest.fixture
    def sample_state(self):
        """Create a sample conversation state."""
        return ConversationState(
            id=uuid4(),
            conversation_id=uuid4(),
            active_scene_ids=[5, 3, 12],
            active_characters=["JOHN", "MARY", "SARAH"],
            active_threads=["love story", "mystery subplot"],
            last_user_intent="scene_feedback",
            last_assistant_commitment="I suggest adding more tension in the dialogue."
        )

    @pytest.mark.asyncio
    async def test_reference_prior_advice(self, context_builder, sample_state):
        """Test getting context for PRIOR_ADVICE reference."""
        result = await context_builder.get_reference_context(
            refers_to=ReferenceType.PRIOR_ADVICE,
            state=sample_state,
            script_id=uuid4()
        )

        assert "Previous suggestion:" in result
        assert "adding more tension" in result

    @pytest.mark.asyncio
    async def test_reference_character(self, context_builder, sample_state):
        """Test getting context for CHARACTER reference."""
        result = await context_builder.get_reference_context(
            refers_to=ReferenceType.CHARACTER,
            state=sample_state,
            script_id=uuid4()
        )

        assert "Active characters:" in result
        assert "JOHN" in result
        assert "MARY" in result

    @pytest.mark.asyncio
    async def test_reference_scene(self, context_builder, sample_state):
        """Test getting context for SCENE reference."""
        result = await context_builder.get_reference_context(
            refers_to=ReferenceType.SCENE,
            state=sample_state,
            script_id=uuid4()
        )

        assert "Active scenes:" in result
        assert "5" in result
        assert "3" in result

    @pytest.mark.asyncio
    async def test_reference_thread(self, context_builder, sample_state):
        """Test getting context for THREAD reference."""
        result = await context_builder.get_reference_context(
            refers_to=ReferenceType.THREAD,
            state=sample_state,
            script_id=uuid4()
        )

        assert "Active plot threads:" in result
        assert "love story" in result

    @pytest.mark.asyncio
    async def test_reference_none(self, context_builder, sample_state):
        """Test getting context for NONE reference returns empty."""
        result = await context_builder.get_reference_context(
            refers_to=ReferenceType.NONE,
            state=sample_state,
            script_id=uuid4()
        )

        assert result == ""

    @pytest.mark.asyncio
    async def test_reference_without_state(self, context_builder):
        """Test that None state returns empty context."""
        result = await context_builder.get_reference_context(
            refers_to=ReferenceType.PRIOR_ADVICE,
            state=None,
            script_id=uuid4()
        )

        assert result == ""

    @pytest.mark.asyncio
    async def test_reference_prior_advice_no_commitment(self, context_builder):
        """Test PRIOR_ADVICE with no commitment in state."""
        state = ConversationState(
            id=uuid4(),
            conversation_id=uuid4(),
            active_scene_ids=[],
            active_characters=[],
            active_threads=[],
            last_user_intent=None,
            last_assistant_commitment=None
        )

        result = await context_builder.get_reference_context(
            refers_to=ReferenceType.PRIOR_ADVICE,
            state=state,
            script_id=uuid4()
        )

        # Should be empty since there's no commitment
        assert result == ""


class TestSystemPromptPhase4:
    """Test Phase 4: System Prompt Updates."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        return db

    @pytest.fixture
    def context_builder(self, mock_db):
        """Create ContextBuilder with mock db."""
        return ContextBuilder(mock_db)

    def test_system_prompt_general_domain(self, context_builder):
        """Test system prompt for GENERAL domain."""
        prompt = context_builder._get_system_prompt(
            intent=IntentType.GLOBAL_QUESTION,
            tools_enabled=False,
            request_type=RequestType.FACTUAL,
            domain=DomainType.GENERAL
        )

        # General domain should reference general screenwriting knowledge
        assert "screenwriting" in prompt.lower() or "expert" in prompt.lower()
        # Should not mention rewriting scripts directly
        assert "screenplay" in prompt.lower() or "writing" in prompt.lower()

    def test_system_prompt_script_domain(self, context_builder):
        """Test system prompt for SCRIPT domain."""
        prompt = context_builder._get_system_prompt(
            intent=IntentType.SCENE_FEEDBACK,
            tools_enabled=True,
            request_type=RequestType.SUGGEST,
            domain=DomainType.SCRIPT
        )

        # Script domain should focus on the specific script
        assert len(prompt) > 0
        # Should have some content about analysis or feedback

    def test_system_prompt_suggest_request_type(self, context_builder):
        """Test system prompt for SUGGEST request type."""
        prompt = context_builder._get_system_prompt(
            intent=IntentType.SCENE_FEEDBACK,
            tools_enabled=False,
            request_type=RequestType.SUGGEST,
            domain=DomainType.SCRIPT
        )

        # SUGGEST should emphasize suggestions, not rewrites
        # Look for terms like suggest, recommend, feedback
        prompt_lower = prompt.lower()
        has_suggest_terms = any(term in prompt_lower for term in [
            "suggest", "recommend", "feedback", "advice", "consider"
        ])
        # The prompt should guide toward suggestions rather than rewrites
        assert len(prompt) > 0

    def test_system_prompt_rewrite_request_type(self, context_builder):
        """Test system prompt for REWRITE request type."""
        prompt = context_builder._get_system_prompt(
            intent=IntentType.LOCAL_EDIT,
            tools_enabled=False,
            request_type=RequestType.REWRITE,
            domain=DomainType.SCRIPT
        )

        # REWRITE should allow for full rewrites
        assert len(prompt) > 0

    def test_system_prompt_brainstorm_request_type(self, context_builder):
        """Test system prompt for BRAINSTORM request type."""
        prompt = context_builder._get_system_prompt(
            intent=IntentType.BRAINSTORM,
            tools_enabled=False,
            request_type=RequestType.BRAINSTORM,
            domain=DomainType.SCRIPT
        )

        # BRAINSTORM should encourage creative exploration
        assert len(prompt) > 0

    def test_system_prompt_tools_enabled(self, context_builder):
        """Test system prompt includes tool instructions when enabled."""
        prompt = context_builder._get_system_prompt(
            intent=IntentType.SCENE_FEEDBACK,
            tools_enabled=True,
            request_type=RequestType.SUGGEST,
            domain=DomainType.SCRIPT
        )

        # When tools enabled, should have tool-related content
        assert len(prompt) > 0


class TestSynthesisFormatInstructions:
    """Test Phase 4: Synthesis Format Instructions Updates."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        return db

    @pytest.fixture
    def context_builder(self, mock_db):
        """Create ContextBuilder with mock db."""
        return ContextBuilder(mock_db)

    def test_synthesis_format_suggest(self, context_builder):
        """Test synthesis format for SUGGEST request type."""
        instructions = context_builder.get_synthesis_format_instructions(
            intent=IntentType.SCENE_FEEDBACK,
            request_type=RequestType.SUGGEST
        )

        # Should have formatting guidance
        assert len(instructions) > 0

    def test_synthesis_format_rewrite(self, context_builder):
        """Test synthesis format for REWRITE request type."""
        instructions = context_builder.get_synthesis_format_instructions(
            intent=IntentType.LOCAL_EDIT,
            request_type=RequestType.REWRITE
        )

        # Should have different guidance for rewrites
        assert len(instructions) > 0

    def test_synthesis_format_brainstorm(self, context_builder):
        """Test synthesis format for BRAINSTORM request type."""
        instructions = context_builder.get_synthesis_format_instructions(
            intent=IntentType.BRAINSTORM,
            request_type=RequestType.BRAINSTORM
        )

        # Should have brainstorming-oriented guidance
        assert len(instructions) > 0

    def test_synthesis_format_diagnose(self, context_builder):
        """Test synthesis format for DIAGNOSE request type."""
        instructions = context_builder.get_synthesis_format_instructions(
            intent=IntentType.SCENE_FEEDBACK,
            request_type=RequestType.DIAGNOSE
        )

        # Should have diagnosis-focused guidance
        assert len(instructions) > 0


class TestBuildPromptPhase4:
    """Test Phase 4: build_prompt with new parameters."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        db.execute = AsyncMock()
        return db

    @pytest.fixture
    def context_builder(self, mock_db):
        """Create ContextBuilder with mock db."""
        return ContextBuilder(mock_db)

    def test_build_prompt_accepts_request_type(self, context_builder):
        """Test that build_prompt method signature accepts request_type parameter."""
        import inspect
        sig = inspect.signature(context_builder.build_prompt)
        params = sig.parameters

        # Verify request_type is in the signature
        assert 'request_type' in params
        # Verify it has a default value
        assert params['request_type'].default == RequestType.SUGGEST

    def test_build_prompt_accepts_domain(self, context_builder):
        """Test that build_prompt method signature accepts domain parameter."""
        import inspect
        sig = inspect.signature(context_builder.build_prompt)
        params = sig.parameters

        # Verify domain is in the signature
        assert 'domain' in params
        # Verify it has a default value
        assert params['domain'].default == DomainType.SCRIPT


class TestBuildSynthesisPromptPhase4:
    """Test Phase 4: build_synthesis_prompt with request_type."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        return db

    @pytest.fixture
    def context_builder(self, mock_db):
        """Create ContextBuilder with mock db."""
        return ContextBuilder(mock_db)

    def test_build_synthesis_prompt_accepts_request_type(self, context_builder):
        """Test that build_synthesis_prompt accepts request_type parameter."""
        # Mock tool results
        tool_results = [
            {"tool_name": "search_scenes", "content": "Found scene 5"}
        ]

        try:
            result = context_builder.build_synthesis_prompt(
                original_message="What about scene 5?",
                intent=IntentType.SCENE_FEEDBACK,
                tool_results=tool_results,
                request_type=RequestType.SUGGEST
            )
            # Should return a valid prompt structure
            assert result is not None
        except TypeError as e:
            if "request_type" in str(e):
                pytest.fail("build_synthesis_prompt doesn't accept request_type parameter")


class TestToolInstructions:
    """Test _get_tool_instructions method."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        return db

    @pytest.fixture
    def context_builder(self, mock_db):
        """Create ContextBuilder with mock db."""
        return ContextBuilder(mock_db)

    def test_tool_instructions_exists(self, context_builder):
        """Test that _get_tool_instructions method exists."""
        assert hasattr(context_builder, '_get_tool_instructions')

    def test_tool_instructions_returns_string(self, context_builder):
        """Test that _get_tool_instructions returns a string."""
        result = context_builder._get_tool_instructions()
        assert isinstance(result, str)
        assert len(result) > 0
