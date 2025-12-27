"""
Topic Detection Service

Determines if a message is a follow-up to previous conversation or a new topic.
This enables history gating to optimize context inclusion and reduce token usage.

P2.1 Implementation: History Gating via heuristic pattern matching.
"""

from typing import Optional, Tuple
import re
import logging

from app.schemas.ai import TopicMode

logger = logging.getLogger(__name__)


class TopicDetector:
    """
    Detect if user message continues previous topic or starts new one.

    Strategy:
    1. Heuristic rules for clear cases (explicit phrases)
    2. Pronoun detection for implicit references
    3. Scene number overlap for contextual continuity
    4. Message length heuristic for ambiguous cases

    Benefits:
    - No LLM call overhead (pure heuristics)
    - Fast, deterministic results
    - Reduces token waste on irrelevant history
    """

    # Phrases that indicate follow-up to previous topic
    FOLLOW_UP_PATTERNS = [
        "also", "additionally", "another thing",
        "what about", "how about", "and what",
        "you mentioned", "earlier you said",
        "going back to", "regarding that",
        "same scene", "that character", "the scene",
        "can you", "could you also",
        "more about", "tell me more",
        "what else", "anything else",
        "in addition", "furthermore",
        "related to that", "on that note",
        "continuing", "following up",
    ]

    # Phrases that indicate new topic
    NEW_TOPIC_PATTERNS = [
        "new question", "different question",
        "switching topics", "unrelated",
        "actually,", "by the way,",
        "separate question", "quick question",
        "changing subjects", "on a different note",
        "i have another", "different topic",
        "forget that", "never mind that",
        "let's talk about", "moving on to",
    ]

    async def detect_mode(
        self,
        current_message: str,
        last_assistant_message: Optional[str] = None,
        last_user_message: Optional[str] = None
    ) -> Tuple[TopicMode, float]:
        """
        Detect topic mode for current message.

        Args:
            current_message: Current user message
            last_assistant_message: Previous assistant response (if any)
            last_user_message: Previous user message (if any)

        Returns:
            Tuple of (TopicMode, confidence 0.0-1.0)
            - TopicMode.FOLLOW_UP: Continue previous topic, include last response
            - TopicMode.NEW_TOPIC: New topic, skip recent history
        """
        message_lower = current_message.lower().strip()

        # No history = definitely new topic
        if not last_assistant_message and not last_user_message:
            logger.debug("No conversation history - treating as NEW_TOPIC")
            return TopicMode.NEW_TOPIC, 1.0

        # Check explicit patterns
        follow_up_score = sum(
            1 for p in self.FOLLOW_UP_PATTERNS
            if p in message_lower
        )
        new_topic_score = sum(
            1 for p in self.NEW_TOPIC_PATTERNS
            if p in message_lower
        )

        logger.debug(
            f"Pattern scores - follow_up: {follow_up_score}, new_topic: {new_topic_score}"
        )

        # Clear follow-up signal
        if follow_up_score > new_topic_score + 1:
            logger.debug("Strong follow-up pattern match")
            return TopicMode.FOLLOW_UP, 0.9

        # Clear new topic signal
        if new_topic_score > follow_up_score + 1:
            logger.debug("Strong new topic pattern match")
            return TopicMode.NEW_TOPIC, 0.9

        # Check for pronoun references at start (suggests follow-up)
        pronouns = ["it", "they", "that", "this", "those", "these", "he", "she"]
        pronoun_at_start = any(
            message_lower.startswith(p + " ") or message_lower.startswith(p + "'")
            for p in pronouns
        )
        if pronoun_at_start:
            logger.debug("Pronoun at message start - likely follow-up")
            return TopicMode.FOLLOW_UP, 0.7

        # Check for scene number references matching previous context
        if last_assistant_message:
            prev_scenes = set(re.findall(r'[Ss]cene (\d+)', last_assistant_message))
            curr_scenes = set(re.findall(r'[Ss]cene (\d+)', current_message))

            if prev_scenes and curr_scenes and prev_scenes & curr_scenes:
                logger.debug(
                    f"Overlapping scene references: {prev_scenes & curr_scenes}"
                )
                return TopicMode.FOLLOW_UP, 0.8

        # Check for character name overlap (if they mention same character)
        if last_assistant_message:
            # Simple heuristic: look for capitalized words that appear in both
            prev_caps = set(re.findall(r'\b([A-Z][a-z]+)\b', last_assistant_message))
            curr_caps = set(re.findall(r'\b([A-Z][a-z]+)\b', current_message))
            # Filter out common words
            common_words = {"The", "This", "That", "What", "How", "Why", "When", "Where", "Scene"}
            prev_caps -= common_words
            curr_caps -= common_words

            if prev_caps and curr_caps and len(prev_caps & curr_caps) >= 2:
                logger.debug(
                    f"Overlapping character/entity references: {prev_caps & curr_caps}"
                )
                return TopicMode.FOLLOW_UP, 0.6

        # Default heuristic: short messages are more likely follow-ups
        word_count = len(current_message.split())
        if word_count < 10:
            logger.debug(f"Short message ({word_count} words) - treating as follow-up")
            return TopicMode.FOLLOW_UP, 0.5

        # Longer messages without clear signals = likely new topic
        logger.debug(f"Long message ({word_count} words) - treating as new topic")
        return TopicMode.NEW_TOPIC, 0.5
