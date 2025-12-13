"""
Intent Classification Service

Classifies user intent to determine optimal context assembly strategy.
Uses heuristic rules for speed and cost efficiency, with LLM fallback for ambiguous cases.
"""

from typing import Optional
from anthropic import AsyncAnthropic

from app.core.config import settings
from app.schemas.ai import IntentType


class IntentClassifier:
    """
    Classify user intent to determine optimal context assembly strategy.

    Priority:
    1. User-provided hint (if available)
    2. Heuristic classification (keyword matching)
    3. LLM classification (for ambiguous cases)
    """

    # Keyword patterns for each intent
    LOCAL_EDIT_KEYWORDS = [
        "punch up", "rewrite", "change", "fix", "edit", "improve line",
        "better dialogue", "rephrase", "tweak", "adjust", "make this",
        "change this", "rewrite this", "fix this dialogue"
    ]

    GLOBAL_QUESTION_KEYWORDS = [
        "arc", "theme", "overall", "acts", "structure", "pacing",
        "entire script", "whole story", "character development",
        "throughout", "across the script", "overall story"
    ]

    SCENE_FEEDBACK_KEYWORDS = [
        "analyze scene", "scene pacing", "what do you think",
        "feedback on", "review scene", "scene work", "this scene",
        "does this scene", "is this scene", "scene feel"
    ]

    BRAINSTORM_KEYWORDS = [
        "ideas for", "what if", "alternatives", "suggestions",
        "help me think", "brainstorm", "creative", "explore",
        "possibilities", "options", "different ways"
    ]

    def __init__(self):
        """Initialize intent classifier with Anthropic client."""
        self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    def classify_heuristic(self, message: str) -> Optional[IntentType]:
        """
        Fast heuristic classification based on keywords.

        Args:
            message: User's message text

        Returns:
            IntentType if clear match found, None if ambiguous
        """
        message_lower = message.lower()

        # Count keyword matches for each intent
        scores = {
            IntentType.LOCAL_EDIT: sum(
                1 for kw in self.LOCAL_EDIT_KEYWORDS if kw in message_lower
            ),
            IntentType.GLOBAL_QUESTION: sum(
                1 for kw in self.GLOBAL_QUESTION_KEYWORDS if kw in message_lower
            ),
            IntentType.SCENE_FEEDBACK: sum(
                1 for kw in self.SCENE_FEEDBACK_KEYWORDS if kw in message_lower
            ),
            IntentType.BRAINSTORM: sum(
                1 for kw in self.BRAINSTORM_KEYWORDS if kw in message_lower
            )
        }

        # Get highest scoring intent
        max_score = max(scores.values())

        if max_score == 0:
            return None  # Ambiguous - no keywords matched

        # Check if there's a clear winner
        winners = [intent for intent, score in scores.items() if score == max_score]

        if len(winners) == 1:
            return winners[0]

        return None  # Tie - ambiguous

    async def classify_with_llm(self, message: str) -> IntentType:
        """
        Use small LLM call to classify ambiguous intents.

        Cost: ~100 tokens per classification (~$0.00001)

        Args:
            message: User's message text

        Returns:
            IntentType classification
        """
        prompt = f"""Classify this user message into one of these intents:

1. local_edit - User wants to edit specific lines/dialogue in current scene
2. scene_feedback - User wants feedback on a specific scene
3. global_question - User asking about overall script structure, themes, or arcs
4. brainstorm - User wants creative ideas or alternatives

User message: "{message}"

Respond with ONLY the intent name (local_edit, scene_feedback, global_question, or brainstorm)."""

        response = await self.client.messages.create(
            model="claude-haiku-4-5",  # Cheaper model for classification
            max_tokens=20,
            messages=[{"role": "user", "content": prompt}]
        )

        # Parse response
        intent_str = response.content[0].text.strip().lower()

        # Map to IntentType enum
        intent_mapping = {
            "local_edit": IntentType.LOCAL_EDIT,
            "scene_feedback": IntentType.SCENE_FEEDBACK,
            "global_question": IntentType.GLOBAL_QUESTION,
            "brainstorm": IntentType.BRAINSTORM
        }

        return intent_mapping.get(intent_str, IntentType.SCENE_FEEDBACK)  # Default fallback

    async def classify(
        self,
        message: str,
        hint: Optional[IntentType] = None
    ) -> IntentType:
        """
        Main classification method.

        Priority:
        1. User-provided hint (if available)
        2. Heuristic classification
        3. LLM classification (for ambiguous cases)

        Args:
            message: User's message text
            hint: Optional user-provided intent hint

        Returns:
            IntentType classification
        """
        # 1. User hint takes priority
        if hint:
            return hint

        # 2. Try heuristic classification
        heuristic_result = self.classify_heuristic(message)

        if heuristic_result:
            return heuristic_result

        # 3. Fall back to LLM for ambiguous cases
        return await self.classify_with_llm(message)
