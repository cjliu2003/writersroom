"""
Conversation State Manager

Manages working set state for conversation continuity.
"""

from typing import Optional, List
from uuid import UUID
from collections import Counter
import re
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from app.models.conversation_state import ConversationState
from app.schemas.ai import IntentType

logger = logging.getLogger(__name__)


class StateManager:
    """
    Manages conversation working set state.

    Updates state after each assistant response to enable:
    - Pronoun resolution ("he", "she", "that scene")
    - Callback handling ("what you suggested")
    - Entity continuity across turns
    """

    MAX_SCENES = 3
    MAX_CHARACTERS = 5
    MAX_THREADS = 3

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_state(self, conversation_id: UUID) -> Optional[ConversationState]:
        """Get current conversation state."""
        result = await self.db.execute(
            select(ConversationState)
            .options(noload('*'))
            .where(ConversationState.conversation_id == conversation_id)
        )
        return result.scalar_one_or_none()

    async def get_or_create_state(self, conversation_id: UUID) -> ConversationState:
        """Get existing state or create new one."""
        state = await self.get_state(conversation_id)

        if not state:
            state = ConversationState(
                conversation_id=conversation_id,
                active_scene_ids=[],
                active_characters=[],
                active_threads=[],
                last_user_intent=None,
                last_assistant_commitment=None
            )
            self.db.add(state)
            await self.db.flush()
            logger.info(f"Created new conversation state for {conversation_id}")

        return state

    async def update_state(
        self,
        conversation_id: UUID,
        assistant_response: str,
        user_intent: IntentType,
        mentioned_scenes: Optional[List[int]] = None,
        mentioned_characters: Optional[List[str]] = None
    ) -> ConversationState:
        """
        Update conversation state after assistant response.

        Parses response to extract:
        - Scene numbers mentioned
        - Character names mentioned
        - Commitments made (suggestions, recommendations)
        """
        state = await self.get_or_create_state(conversation_id)

        # Parse scene numbers from response
        scene_numbers = mentioned_scenes or []
        scene_matches = re.findall(r'[Ss]cene (\d+)', assistant_response)
        scene_numbers.extend([int(s) for s in scene_matches])

        # Parse character names (capitalized words that appear multiple times)
        characters = mentioned_characters or []
        if not characters:
            # Simple heuristic: find ALL CAPS names (screenplay format)
            caps = re.findall(r'\b([A-Z][A-Z]+)\b', assistant_response)
            # Filter to likely character names (appear 2+ times)
            char_counts = Counter(caps)
            characters = [c for c, count in char_counts.items() if count >= 2]

        # Extract commitment (last sentence with "suggest", "recommend", "try", etc.)
        commitment = self._extract_commitment(assistant_response)

        # Update state with recency limits
        if scene_numbers:
            # Add new scenes, keep most recent MAX_SCENES
            current = list(state.active_scene_ids) if state.active_scene_ids else []
            # Use dict.fromkeys to preserve order while removing duplicates
            updated = list(dict.fromkeys(scene_numbers + current))[:self.MAX_SCENES]
            state.active_scene_ids = updated

        if characters:
            current = list(state.active_characters) if state.active_characters else []
            updated = list(dict.fromkeys(characters + current))[:self.MAX_CHARACTERS]
            state.active_characters = updated

        state.last_user_intent = user_intent.value

        if commitment:
            state.last_assistant_commitment = commitment

        await self.db.commit()
        await self.db.refresh(state)

        logger.info(
            f"State updated: scenes={state.active_scene_ids}, "
            f"characters={state.active_characters[:3] if state.active_characters else []}, "
            f"commitment={'yes' if commitment else 'no'}"
        )

        return state

    def _extract_commitment(self, response: str) -> Optional[str]:
        """Extract a commitment/suggestion from the response."""
        commitment_patterns = [
            r"I (?:suggest|recommend|would try|think you should)[^.!?]*[.!?]",
            r"(?:You could|You might|Consider)[^.!?]*[.!?]",
            r"(?:My recommendation|My suggestion)[^.!?]*[.!?]"
        ]
        for pattern in commitment_patterns:
            match = re.search(pattern, response, re.IGNORECASE)
            if match:
                return match.group(0).strip()
        return None

    async def update_from_user_message(
        self,
        conversation_id: UUID,
        user_message: str,
        intent: IntentType
    ) -> ConversationState:
        """
        Update state based on user message (before assistant response).

        Primarily updates last_user_intent for context.
        """
        state = await self.get_or_create_state(conversation_id)
        state.last_user_intent = intent.value

        # Extract scene references from user message
        scene_matches = re.findall(r'[Ss]cene (\d+)', user_message)
        if scene_matches:
            scene_numbers = [int(s) for s in scene_matches]
            current = list(state.active_scene_ids) if state.active_scene_ids else []
            updated = list(dict.fromkeys(scene_numbers + current))[:self.MAX_SCENES]
            state.active_scene_ids = updated

        await self.db.commit()
        await self.db.refresh(state)

        return state

    async def clear_state(self, conversation_id: UUID) -> None:
        """Clear state for new topic."""
        state = await self.get_state(conversation_id)
        if state:
            state.active_scene_ids = []
            state.active_characters = []
            state.active_threads = []
            state.last_user_intent = None
            # Keep last_assistant_commitment for "what you said" references
            await self.db.commit()
            logger.info(f"Cleared state for conversation {conversation_id}")

    async def add_thread(
        self,
        conversation_id: UUID,
        thread_name: str
    ) -> ConversationState:
        """Add a thread to the active threads list."""
        state = await self.get_or_create_state(conversation_id)

        current = list(state.active_threads) if state.active_threads else []
        if thread_name not in current:
            updated = [thread_name] + current[:self.MAX_THREADS - 1]
            state.active_threads = updated
            await self.db.commit()
            await self.db.refresh(state)

        return state
