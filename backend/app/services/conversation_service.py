"""
Conversation Service

Manage conversation history and summaries for multi-turn coherence.
"""

from typing import Dict, List, Optional
from uuid import UUID
from datetime import datetime
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from anthropic import AsyncAnthropic
import tiktoken

from app.models.chat_conversation import ChatConversation
from app.models.chat_message import ChatMessage
from app.models.conversation_summary import ConversationSummary
from app.core.config import settings


class ConversationService:
    """
    Manage conversation history and summaries for multi-turn coherence.
    """

    SLIDING_WINDOW_SIZE = 4  # Last 2 message pairs (reduced from 10 to minimize context bleeding)
    SUMMARY_TRIGGER_COUNT = int(
        settings.CONVERSATION_SUMMARY_MESSAGE_THRESHOLD
        if hasattr(settings, 'CONVERSATION_SUMMARY_MESSAGE_THRESHOLD')
        else 15
    )  # Generate summary after 15 messages

    def __init__(self, db: AsyncSession):
        """Initialize conversation service."""
        self.db = db
        self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.tokenizer = tiktoken.get_encoding("cl100k_base")

    async def get_conversation_context(
        self,
        conversation_id: UUID,
        token_budget: int = 300
    ) -> Dict:
        """
        Get conversation context within token budget.

        Returns recent messages + summary of older conversation.

        Args:
            conversation_id: Conversation ID
            token_budget: Maximum tokens for conversation context

        Returns:
            Dict with summary and recent_messages
        """
        # Get recent messages
        recent_messages_result = await self.db.execute(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(self.SLIDING_WINDOW_SIZE)
        )
        recent = list(reversed(recent_messages_result.scalars().all()))

        # Get conversation summary (if exists)
        summary_result = await self.db.execute(
            select(ConversationSummary)
            .where(ConversationSummary.conversation_id == conversation_id)
            .order_by(ConversationSummary.created_at.desc())
            .limit(1)
        )
        summary_obj = summary_result.scalar_one_or_none()

        # Format for prompt
        context = {
            "summary": summary_obj.summary_text if summary_obj else None,
            "recent_messages": [
                {
                    "role": msg.role,
                    "content": msg.content,
                    "timestamp": msg.created_at.isoformat() if msg.created_at else None
                }
                for msg in recent
            ]
        }

        # Estimate tokens and trim if needed
        estimated_tokens = self._estimate_context_tokens(context)

        if estimated_tokens > token_budget:
            # Trim oldest messages
            context["recent_messages"] = context["recent_messages"][-(self.SLIDING_WINDOW_SIZE // 2):]

        return context

    def _estimate_context_tokens(self, context: Dict) -> int:
        """
        Estimate token count for conversation context.

        Args:
            context: Context dict with summary and recent_messages

        Returns:
            Estimated token count
        """
        total = 0

        if context.get("summary"):
            total += len(self.tokenizer.encode(context["summary"]))

        for msg in context.get("recent_messages", []):
            total += len(self.tokenizer.encode(f"{msg['role']}: {msg['content']}"))

        return total

    async def should_generate_summary(self, conversation_id: UUID) -> bool:
        """
        Check if conversation is long enough to warrant summary generation.

        Args:
            conversation_id: Conversation ID

        Returns:
            True if summary should be generated
        """
        # Count total messages
        message_count_result = await self.db.execute(
            select(func.count(ChatMessage.message_id))
            .where(ChatMessage.conversation_id == conversation_id)
        )
        message_count = message_count_result.scalar() or 0

        # Get last summary
        last_summary_result = await self.db.execute(
            select(ConversationSummary)
            .where(ConversationSummary.conversation_id == conversation_id)
            .order_by(ConversationSummary.created_at.desc())
            .limit(1)
        )
        summary_obj = last_summary_result.scalar_one_or_none()

        if not summary_obj:
            # First summary after SUMMARY_TRIGGER_COUNT messages
            return message_count >= self.SUMMARY_TRIGGER_COUNT

        # Generate new summary if >SUMMARY_TRIGGER_COUNT messages since last summary
        messages_since_summary = message_count - summary_obj.messages_covered
        return messages_since_summary >= self.SUMMARY_TRIGGER_COUNT

    async def generate_conversation_summary(
        self,
        conversation_id: UUID
    ) -> ConversationSummary:
        """
        Generate summary of conversation so far.

        Includes:
        - Topics discussed
        - Edits or changes made
        - User preferences mentioned

        Args:
            conversation_id: Conversation ID

        Returns:
            ConversationSummary object
        """
        # Get all messages
        messages_result = await self.db.execute(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation_id)
            .order_by(ChatMessage.created_at)
        )
        all_messages = messages_result.scalars().all()

        # Format conversation
        conversation_text = "\n\n".join([
            f"{msg.role.upper()}: {msg.content}"
            for msg in all_messages
        ])

        prompt = f"""Summarize this conversation between a user and a screenplay AI assistant.

Focus on:
1. Topics discussed (which scenes, characters, or story elements)
2. Changes or edits made
3. User preferences or style notes mentioned
4. Open questions or ongoing work

Keep summary under 200 tokens.

CONVERSATION:
{conversation_text}"""

        response = await self.client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )

        summary_text = response.content[0].text
        tokens_estimate = len(self.tokenizer.encode(summary_text))

        # Create summary object
        summary = ConversationSummary(
            conversation_id=conversation_id,
            summary_text=summary_text,
            tokens_estimate=tokens_estimate,
            messages_covered=len(all_messages),
            last_message_id=all_messages[-1].message_id if all_messages else None
        )

        # Save to database
        self.db.add(summary)
        await self.db.commit()
        await self.db.refresh(summary)

        return summary
