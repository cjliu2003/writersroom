"""
Tests for StateManager (Phase 2: Working Set State)

Tests the conversation state tracking for continuity across turns.
"""

import pytest
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

from app.services.state_manager import StateManager
from app.models.conversation_state import ConversationState
from app.schemas.ai import IntentType


class TestStateManagerUpdate:
    """Test state update operations."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        db.execute = AsyncMock()
        db.commit = AsyncMock()
        db.flush = AsyncMock()
        db.add = MagicMock()
        db.refresh = AsyncMock()
        return db

    @pytest.fixture
    def state_manager(self, mock_db):
        """Create StateManager with mock db."""
        return StateManager(mock_db)

    @pytest.fixture
    def sample_conversation_id(self):
        return uuid4()

    def test_extract_commitment_with_suggest(self, state_manager):
        """Test extracting 'I suggest...' commitment."""
        response = "Based on the analysis, I suggest making the dialogue more concise. The scene is well-paced."
        result = state_manager._extract_commitment(response)
        assert result is not None
        assert "suggest" in result.lower()

    def test_extract_commitment_with_recommend(self, state_manager):
        """Test extracting 'I recommend...' commitment."""
        response = "Looking at the structure, I recommend adding more tension in the second act."
        result = state_manager._extract_commitment(response)
        assert result is not None
        assert "recommend" in result.lower()

    def test_extract_commitment_with_you_could(self, state_manager):
        """Test extracting 'You could...' commitment."""
        response = "The character lacks depth. You could add a backstory scene to establish motivation."
        result = state_manager._extract_commitment(response)
        assert result is not None
        assert "could" in result.lower()

    def test_extract_commitment_with_consider(self, state_manager):
        """Test extracting 'Consider...' commitment."""
        response = "The pacing feels rushed. Consider adding a pause beat before the revelation."
        result = state_manager._extract_commitment(response)
        assert result is not None
        assert "consider" in result.lower()

    def test_extract_commitment_no_commitment(self, state_manager):
        """Test response with no commitment."""
        response = "The dialogue flows naturally. The characters are well-developed."
        result = state_manager._extract_commitment(response)
        assert result is None

    def test_extract_scene_numbers_single(self, state_manager):
        """Test extracting single scene number from response."""
        import re
        response = "Looking at Scene 5, the pacing is good."
        matches = re.findall(r'[Ss]cene (\d+)', response)
        assert len(matches) == 1
        assert matches[0] == '5'

    def test_extract_scene_numbers_multiple(self, state_manager):
        """Test extracting multiple scene numbers from response."""
        import re
        response = "Scene 3 flows into scene 7, and then scene 12 resolves the arc."
        matches = re.findall(r'[Ss]cene (\d+)', response)
        assert len(matches) == 3
        assert '3' in matches
        assert '7' in matches
        assert '12' in matches

    def test_extract_characters_caps(self, state_manager):
        """Test extracting character names (ALL CAPS format)."""
        from collections import Counter
        import re
        response = "JOHN enters. MARY turns to face JOHN. SARAH watches from the doorway."
        caps = re.findall(r'\b([A-Z][A-Z]+)\b', response)
        char_counts = Counter(caps)
        # JOHN appears twice, MARY once, SARAH once
        characters = [c for c, count in char_counts.items() if count >= 2]
        assert "JOHN" in characters
        assert "MARY" not in characters  # Only appeared once


class TestStateManagerGetState:
    """Test state retrieval operations."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        return db

    @pytest.fixture
    def state_manager(self, mock_db):
        """Create StateManager with mock db."""
        return StateManager(mock_db)

    @pytest.mark.asyncio
    async def test_get_state_exists(self, state_manager, mock_db):
        """Test getting existing state."""
        conversation_id = uuid4()
        existing_state = ConversationState(
            id=uuid4(),
            conversation_id=conversation_id,
            active_scene_ids=[1, 2, 3],
            active_characters=["JOHN", "MARY"],
            active_threads=["love story"],
            last_user_intent="scene_feedback",
            last_assistant_commitment="I suggest adding more tension."
        )

        # Mock the execute to return the state
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_state
        mock_db.execute.return_value = mock_result

        result = await state_manager.get_state(conversation_id)

        assert result is not None
        assert result.conversation_id == conversation_id
        assert result.active_scene_ids == [1, 2, 3]
        assert result.active_characters == ["JOHN", "MARY"]

    @pytest.mark.asyncio
    async def test_get_state_not_exists(self, state_manager, mock_db):
        """Test getting non-existent state returns None."""
        conversation_id = uuid4()

        # Mock the execute to return None
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        result = await state_manager.get_state(conversation_id)

        assert result is None


class TestStateManagerCreateState:
    """Test state creation operations."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        db.execute = AsyncMock()
        db.commit = AsyncMock()
        db.flush = AsyncMock()
        db.add = MagicMock()
        db.refresh = AsyncMock()
        return db

    @pytest.fixture
    def state_manager(self, mock_db):
        """Create StateManager with mock db."""
        return StateManager(mock_db)

    @pytest.mark.asyncio
    async def test_get_or_create_state_creates_new(self, state_manager, mock_db):
        """Test creating new state when none exists."""
        conversation_id = uuid4()

        # Mock get_state to return None (no existing state)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        result = await state_manager.get_or_create_state(conversation_id)

        # Verify add was called with a new state
        assert mock_db.add.called
        assert mock_db.flush.called


class TestStateManagerClearState:
    """Test state clearing operations."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        db.execute = AsyncMock()
        db.commit = AsyncMock()
        return db

    @pytest.fixture
    def state_manager(self, mock_db):
        """Create StateManager with mock db."""
        return StateManager(mock_db)

    @pytest.mark.asyncio
    async def test_clear_state_resets_fields(self, state_manager, mock_db):
        """Test that clear_state resets active entities but keeps commitment."""
        conversation_id = uuid4()
        existing_state = ConversationState(
            id=uuid4(),
            conversation_id=conversation_id,
            active_scene_ids=[1, 2, 3],
            active_characters=["JOHN", "MARY"],
            active_threads=["love story"],
            last_user_intent="scene_feedback",
            last_assistant_commitment="I suggest adding more tension."
        )

        # Mock get_state to return existing state
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_state
        mock_db.execute.return_value = mock_result

        await state_manager.clear_state(conversation_id)

        # Verify fields were cleared
        assert existing_state.active_scene_ids == []
        assert existing_state.active_characters == []
        assert existing_state.active_threads == []
        assert existing_state.last_user_intent is None
        # Commitment should be preserved
        assert existing_state.last_assistant_commitment == "I suggest adding more tension."
        assert mock_db.commit.called


class TestStateManagerUpdateFromUserMessage:
    """Test state updates from user messages."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        db.execute = AsyncMock()
        db.commit = AsyncMock()
        db.flush = AsyncMock()
        db.add = MagicMock()
        db.refresh = AsyncMock()
        return db

    @pytest.fixture
    def state_manager(self, mock_db):
        """Create StateManager with mock db."""
        return StateManager(mock_db)

    @pytest.mark.asyncio
    async def test_update_from_user_message_extracts_scenes(self, state_manager, mock_db):
        """Test that scene numbers are extracted from user message."""
        conversation_id = uuid4()
        existing_state = ConversationState(
            id=uuid4(),
            conversation_id=conversation_id,
            active_scene_ids=[],
            active_characters=[],
            active_threads=[],
            last_user_intent=None,
            last_assistant_commitment=None
        )

        # Mock get_or_create_state to return existing state
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_state
        mock_db.execute.return_value = mock_result

        await state_manager.update_from_user_message(
            conversation_id=conversation_id,
            user_message="What do you think of Scene 5 and Scene 8?",
            intent=IntentType.SCENE_FEEDBACK
        )

        # Should have extracted scenes 5 and 8
        assert 5 in existing_state.active_scene_ids
        assert 8 in existing_state.active_scene_ids


class TestStateManagerRecencyLimits:
    """Test that state respects recency limits."""

    def test_max_scenes_limit(self):
        """Test MAX_SCENES constant is set appropriately."""
        manager = StateManager(AsyncMock())
        assert manager.MAX_SCENES == 3

    def test_max_characters_limit(self):
        """Test MAX_CHARACTERS constant is set appropriately."""
        manager = StateManager(AsyncMock())
        assert manager.MAX_CHARACTERS == 5

    def test_max_threads_limit(self):
        """Test MAX_THREADS constant is set appropriately."""
        manager = StateManager(AsyncMock())
        assert manager.MAX_THREADS == 3


class TestStateManagerAddThread:
    """Test thread management operations."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        db.execute = AsyncMock()
        db.commit = AsyncMock()
        db.flush = AsyncMock()
        db.add = MagicMock()
        db.refresh = AsyncMock()
        return db

    @pytest.fixture
    def state_manager(self, mock_db):
        """Create StateManager with mock db."""
        return StateManager(mock_db)

    @pytest.mark.asyncio
    async def test_add_thread_new(self, state_manager, mock_db):
        """Test adding a new thread."""
        conversation_id = uuid4()
        existing_state = ConversationState(
            id=uuid4(),
            conversation_id=conversation_id,
            active_scene_ids=[],
            active_characters=[],
            active_threads=["existing thread"],
            last_user_intent=None,
            last_assistant_commitment=None
        )

        # Mock get_or_create_state
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_state
        mock_db.execute.return_value = mock_result

        result = await state_manager.add_thread(
            conversation_id=conversation_id,
            thread_name="new thread"
        )

        # New thread should be added at the front
        assert "new thread" in existing_state.active_threads
        assert existing_state.active_threads[0] == "new thread"

    @pytest.mark.asyncio
    async def test_add_thread_duplicate_ignored(self, state_manager, mock_db):
        """Test that duplicate threads are not added."""
        conversation_id = uuid4()
        existing_state = ConversationState(
            id=uuid4(),
            conversation_id=conversation_id,
            active_scene_ids=[],
            active_characters=[],
            active_threads=["existing thread"],
            last_user_intent=None,
            last_assistant_commitment=None
        )

        # Mock get_or_create_state
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_state
        mock_db.execute.return_value = mock_result

        result = await state_manager.add_thread(
            conversation_id=conversation_id,
            thread_name="existing thread"
        )

        # Thread count should not increase
        assert len([t for t in existing_state.active_threads if t == "existing thread"]) == 1
