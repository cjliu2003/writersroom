"""
Context Builder Service

Assemble prompts with optimal token budget allocation and caching.
Implements Claude prompt caching for 90% cost reduction.
"""

from typing import Dict, List, Optional, Tuple
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload
import tiktoken

from app.models.script_outline import ScriptOutline
from app.models.character_sheet import CharacterSheet
from app.models.scene import Scene
from app.schemas.ai import IntentType, BudgetTier
from app.services.retrieval_service import RetrievalService
from app.services.conversation_service import ConversationService
from app.core.config import settings


class ContextBuilder:
    """
    Assemble prompts with optimal token budget allocation and caching.

    Budget tiers:
    - quick: 1200 tokens (simple questions)
    - standard: 5000 tokens (scene analysis)
    - deep: 20000 tokens (comprehensive analysis)
    """

    BUDGET_TIERS = {
        BudgetTier.QUICK: int(settings.BUDGET_QUICK_TOKENS),
        BudgetTier.STANDARD: int(settings.BUDGET_STANDARD_TOKENS),
        BudgetTier.DEEP: int(settings.BUDGET_DEEP_TOKENS)
    }

    def __init__(self, db: AsyncSession):
        """Initialize context builder with database session."""
        self.db = db
        self.retrieval_service = RetrievalService(db)
        self.conversation_service = ConversationService(db)
        self.tokenizer = tiktoken.get_encoding("cl100k_base")

    async def build_prompt(
        self,
        script_id: UUID,
        message: str,
        intent: IntentType,
        conversation_id: Optional[UUID] = None,
        current_scene_id: Optional[UUID] = None,
        budget_tier: BudgetTier = BudgetTier.STANDARD
    ) -> Dict:
        """
        Build optimized prompt with caching structure.

        Prompt structure for Claude caching:

        [CACHEABLE - Rarely changes]
        1. System prompt (~200 tokens)

        [CACHEABLE - Updates on analysis refresh]
        2. Global context (~400 tokens)
           - Script metadata
           - Act outline
           - Character sheets

        [CACHEABLE - Updates on retrieval change]
        3. Scene cards (~300 tokens)
           - Retrieved scene summaries

        [NOT CACHED - Every request]
        4. Conversation context (~200 tokens)
        5. Local context (~200 tokens)
        6. User message (~100 tokens)

        Args:
            script_id: Script ID
            message: User's message
            intent: Classified intent
            conversation_id: Optional conversation ID
            current_scene_id: Optional current scene
            budget_tier: Token budget tier

        Returns:
            Dict with model, max_tokens, system, messages, and metadata
        """
        import time
        import logging
        logger = logging.getLogger(__name__)

        total_budget = self.BUDGET_TIERS[budget_tier]

        # 1. System prompt (cacheable)
        step_start = time.perf_counter()
        system_prompt = self._get_system_prompt(intent)
        system_tokens = self._count_tokens(system_prompt)
        logger.info(f"[CONTEXT] System prompt generation took {(time.perf_counter() - step_start) * 1000:.2f}ms")

        # 2. Global context (cacheable)
        step_start = time.perf_counter()
        global_context = await self._get_global_context(script_id, intent)
        global_tokens = self._count_tokens(global_context)
        logger.info(f"[CONTEXT] Global context fetch took {(time.perf_counter() - step_start) * 1000:.2f}ms")

        # 3. Retrieved scene cards (cacheable)
        step_start = time.perf_counter()
        retrieval_result = await self.retrieval_service.retrieve_for_intent(
            script_id=script_id,
            message=message,
            intent=intent,
            current_scene_id=current_scene_id
        )
        logger.info(f"[CONTEXT] Retrieval service took {(time.perf_counter() - step_start) * 1000:.2f}ms")

        step_start = time.perf_counter()
        scene_cards = self._format_scene_cards(retrieval_result["scenes"])
        scene_tokens = self._count_tokens(scene_cards)
        logger.info(f"[CONTEXT] Scene card formatting took {(time.perf_counter() - step_start) * 1000:.2f}ms")

        # 4. Conversation context (not cached)
        # conv_data is used later for building proper alternating messages
        conv_context = ""
        conv_tokens = 0
        conv_data = None
        if conversation_id:
            conv_data = await self.conversation_service.get_conversation_context(
                conversation_id,
                token_budget=min(300, total_budget // 6)
            )
            # We no longer format conversation into a single text block
            # Instead, conv_data is used directly to build proper alternating messages
            # conv_context = self._format_conversation(conv_data)
            # conv_tokens = self._count_tokens(conv_context)
            # Estimate tokens for the raw conversation messages
            for msg in conv_data.get("recent_messages", []):
                conv_tokens += self._count_tokens(msg.get("content", ""))

        # 5. Local context (not cached)
        # Use noload to prevent eager loading of Scene's 8 relationships
        # Scene has selectin relationships that cascade to Script->ALL scenes (148!)
        local_context = ""
        local_tokens = 0
        if current_scene_id and intent == IntentType.LOCAL_EDIT:
            scene_result = await self.db.execute(
                select(Scene)
                .options(noload('*'))
                .where(Scene.scene_id == current_scene_id)
            )
            scene = scene_result.scalar_one_or_none()
            if scene:
                local_context = f"CURRENT SCENE:\n{scene.scene_heading}\n\n{scene.raw_text}"
                local_tokens = self._count_tokens(local_context)

        # 6. User message
        message_tokens = self._count_tokens(message)

        # Check if we're over budget
        total_used = (
            system_tokens + global_tokens + scene_tokens +
            conv_tokens + local_tokens + message_tokens
        )

        # Trim if needed
        if total_used > total_budget:
            # Priority: system > local > global > scene > conversation
            # Trim scene cards first
            if scene_tokens > total_budget // 4:
                scene_cards = self._trim_scene_cards(scene_cards, total_budget // 4)
                scene_tokens = self._count_tokens(scene_cards)

            # Recalculate
            total_used = (
                system_tokens + global_tokens + scene_tokens +
                conv_tokens + local_tokens + message_tokens
            )

        # Build Claude API message format with cache control
        # IMPORTANT: Build proper alternating user/assistant messages for conversation history
        # Embedding assistant responses as text in a user message causes Claude to "continue"
        # the previous response instead of starting fresh.

        # Build context content blocks (for the first/context message)
        context_blocks = []

        # Global context (cached)
        if global_context:
            context_blocks.append({
                "type": "text",
                "text": global_context,
                "cache_control": {"type": "ephemeral"}
            })

        # Scene cards (cached)
        if scene_cards:
            context_blocks.append({
                "type": "text",
                "text": scene_cards,
                "cache_control": {"type": "ephemeral"}
            })

        # Local context (not cached)
        if local_context:
            context_blocks.append({
                "type": "text",
                "text": local_context
            })

        # Build messages array with proper alternation
        messages = []

        # If we have context, start with a context-setting user message
        if context_blocks:
            context_blocks.append({
                "type": "text",
                "text": "Above is context about the screenplay. Please use it to inform your responses."
            })
            messages.append({
                "role": "user",
                "content": context_blocks
            })
            # Add a brief assistant acknowledgment to maintain alternation
            messages.append({
                "role": "assistant",
                "content": "I understand. I've reviewed the screenplay context provided. How can I help you with your screenplay?"
            })

        # Add conversation history as properly alternating messages
        # Claude API requires alternating user/assistant messages
        if conv_data and conv_data.get("recent_messages"):
            for msg in conv_data["recent_messages"]:
                role = msg['role'].value if hasattr(msg['role'], 'value') else str(msg['role'])
                role = role.lower()

                # Ensure alternation - if last message has same role, skip or merge
                if messages and messages[-1]["role"] == role:
                    # Same role as last message - merge content
                    if isinstance(messages[-1]["content"], str):
                        messages[-1]["content"] += "\n\n" + msg['content']
                    else:
                        # Content is a list of blocks, append new text block
                        messages[-1]["content"].append({
                            "type": "text",
                            "text": msg['content']
                        })
                else:
                    messages.append({
                        "role": role,
                        "content": msg['content']
                    })

        # Add the current user message
        # Ensure we don't have consecutive user messages
        if messages and messages[-1]["role"] == "user":
            # Last message is already a user message - merge with current
            if isinstance(messages[-1]["content"], str):
                messages[-1]["content"] += "\n\n" + message
            else:
                messages[-1]["content"].append({
                    "type": "text",
                    "text": message
                })
        else:
            messages.append({
                "role": "user",
                "content": message
            })

        return {
            "model": "claude-haiku-4-5",
            "max_tokens": 600,  # Output budget
            "system": [
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"}
                }
            ],
            "messages": messages,
            "metadata": {
                "intent": intent,
                "budget_tier": budget_tier,
                "tokens_used": {
                    "system": system_tokens,
                    "global": global_tokens,
                    "scenes": scene_tokens,
                    "conversation": conv_tokens,
                    "local": local_tokens,
                    "message": message_tokens,
                    "total": total_used
                }
            }
        }

    def _get_system_prompt(self, intent: IntentType) -> str:
        """
        Get system prompt tailored to intent.

        Args:
            intent: User intent type

        Returns:
            System prompt string
        """
        base = """You are an expert screenplay writing assistant. You understand screenplay format, story structure, and character development.

Key guidelines:
- Respect screenplay formatting conventions
- When referencing scenes, use standard numbering (Scene 1, Scene 2, etc.) where Scene 1 is the first scene in the script
- Focus on showing not telling
- Maintain character voice consistency
- Consider pacing and visual storytelling
- Provide specific, actionable feedback

IMPORTANT: When conversation history is provided, it is for CONTEXT ONLY. Always start your response fresh and complete - never continue or complete a previous response. Each of your responses should stand alone as a complete answer."""

        intent_additions = {
            IntentType.LOCAL_EDIT: "\n\nFocus on improving dialogue and action lines. Be concise and specific.",
            IntentType.SCENE_FEEDBACK: "\n\nAnalyze scene structure, pacing, conflict, and character development.",
            IntentType.GLOBAL_QUESTION: "\n\nConsider overall story arc, theme, and structural elements.",
            IntentType.BRAINSTORM: "\n\nBe creative and exploratory. Offer multiple alternatives."
        }

        return base + intent_additions.get(intent, "")

    async def _get_global_context(self, script_id: UUID, intent: IntentType) -> str:
        """
        Get global artifacts (outline + character sheets).

        Omitted for brainstorm intent to allow creative freedom.

        Args:
            script_id: Script ID
            intent: User intent

        Returns:
            Formatted global context string
        """
        if intent == IntentType.BRAINSTORM:
            return ""

        # Get script outline - use noload to prevent eager loading of script relationship
        # ScriptOutline has selectin relationship to Script which cascades to load ALL scenes
        outline_result = await self.db.execute(
            select(ScriptOutline)
            .options(noload('*'))
            .where(ScriptOutline.script_id == script_id)
            .order_by(ScriptOutline.version.desc())
            .limit(1)
        )
        outline_obj = outline_result.scalar_one_or_none()

        if not outline_obj:
            return ""

        # Get main character sheets (top 3 by appearance count)
        # Use noload to prevent eager loading of script relationship
        character_sheets_result = await self.db.execute(
            select(CharacterSheet)
            .options(noload('*'))
            .where(CharacterSheet.script_id == script_id)
            .order_by(CharacterSheet.dirty_scene_count.desc())
            .limit(3)
        )
        sheets = character_sheets_result.scalars().all()

        # Format global context
        context_parts = ["SCRIPT OUTLINE:\n" + outline_obj.summary_text]

        if sheets:
            context_parts.append("\nMAIN CHARACTERS:")
            for sheet in sheets:
                context_parts.append(f"\n{sheet.character_name}:\n{sheet.summary_text}")

        return "\n\n".join(context_parts)

    def _format_scene_cards(self, scenes: List[Tuple]) -> str:
        """
        Format scene cards for prompt.

        Args:
            scenes: List of (Scene, SceneSummary) tuples

        Returns:
            Formatted scene cards string
        """
        if not scenes:
            return ""

        cards = ["SCENE CARDS:"]

        for scene, summary in scenes:
            # Use 1-based scene numbering (position 0 = Scene 1)
            scene_number = scene.position + 1
            cards.append(f"\nScene {scene_number}: {scene.scene_heading}")
            cards.append(summary.summary_text)

        return "\n".join(cards)

    def _format_conversation(self, conv_data: Dict) -> str:
        """
        Format conversation context for prompt.

        IMPORTANT: The conversation history is formatted with clear delimiters to
        prevent Claude from "continuing" a previous response. Each message is
        explicitly marked as complete historical context.

        Args:
            conv_data: Conversation data from conversation_service

        Returns:
            Formatted conversation string
        """
        parts = []

        if conv_data.get("summary"):
            parts.append("=== CONVERSATION SUMMARY (for context only) ===")
            parts.append(conv_data["summary"])
            parts.append("=== END SUMMARY ===")

        if conv_data.get("recent_messages"):
            parts.append("\n=== PREVIOUS MESSAGES (for context only - do NOT continue these) ===")
            for msg in conv_data["recent_messages"]:
                role = msg['role'].value if hasattr(msg['role'], 'value') else str(msg['role'])
                parts.append(f"[{role.upper()}]: {msg['content']}")
                parts.append("---")  # Clear separator between messages
            parts.append("=== END PREVIOUS MESSAGES ===")
            parts.append("\nThe user's NEW question follows. Respond ONLY to the new question below, starting fresh:")

        return "\n".join(parts)

    def _count_tokens(self, text: str) -> int:
        """
        Count tokens in text using tiktoken.

        Args:
            text: Text to count

        Returns:
            Token count
        """
        if not text:
            return 0
        return len(self.tokenizer.encode(text))

    def _trim_scene_cards(self, scene_cards: str, max_tokens: int) -> str:
        """
        Trim scene cards to fit within token budget.

        Args:
            scene_cards: Scene cards text
            max_tokens: Maximum tokens

        Returns:
            Trimmed scene cards
        """
        if not scene_cards:
            return scene_cards

        lines = scene_cards.split('\n')
        current_text = []
        current_tokens = 0

        for line in lines:
            line_tokens = self._count_tokens(line)

            if current_tokens + line_tokens > max_tokens:
                break

            current_text.append(line)
            current_tokens += line_tokens

        return '\n'.join(current_text)
