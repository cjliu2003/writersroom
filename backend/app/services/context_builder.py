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
from app.models.conversation_state import ConversationState
from app.schemas.ai import IntentType, BudgetTier, TopicMode, TopicModeOverride, ReferenceType, RequestType, DomainType
from app.services.retrieval_service import RetrievalService
from app.services.conversation_service import ConversationService
from app.services.topic_detector import TopicDetector
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
        self.topic_detector = TopicDetector()
        self.tokenizer = tiktoken.get_encoding("cl100k_base")

    async def build_prompt(
        self,
        script_id: UUID,
        message: str,
        intent: IntentType,
        conversation_id: Optional[UUID] = None,
        current_scene_id: Optional[UUID] = None,
        budget_tier: BudgetTier = BudgetTier.STANDARD,
        skip_scene_retrieval: bool = False,
        tools_enabled: bool = False,
        request_type: RequestType = RequestType.SUGGEST,
        domain: DomainType = DomainType.SCRIPT,
        topic_mode_override: Optional[TopicModeOverride] = None
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
           - SKIPPED when tools_enabled=True (Claude can fetch via tools)

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
            skip_scene_retrieval: If True, skip scene card retrieval (use when tools enabled)
            tools_enabled: If True, adjust system prompt for tool-assisted mode
            request_type: Type of request (SUGGEST, REWRITE, etc.) - Phase 4
            domain: Domain classification (GENERAL, SCRIPT, HYBRID) - Phase 4
            topic_mode_override: User override for topic continuity detection

        Returns:
            Dict with model, max_tokens, system, messages, and metadata
        """
        import time
        import logging
        logger = logging.getLogger(__name__)

        total_budget = self.BUDGET_TIERS[budget_tier]

        # 1. System prompt (cacheable) - adjust for tools mode, domain, and request type
        step_start = time.perf_counter()
        system_prompt = self._get_system_prompt(
            intent,
            tools_enabled=tools_enabled,
            request_type=request_type,
            domain=domain
        )
        system_tokens = self._count_tokens(system_prompt)
        logger.info(f"[CONTEXT] System prompt generation took {(time.perf_counter() - step_start) * 1000:.2f}ms")

        # 2. Global context (cacheable)
        step_start = time.perf_counter()
        global_context = await self._get_global_context(script_id, intent)
        global_tokens = self._count_tokens(global_context)
        logger.info(f"[CONTEXT] Global context fetch took {(time.perf_counter() - step_start) * 1000:.2f}ms")

        # 3. Retrieved scene cards (cacheable) - SKIP if tools enabled
        # When tools are enabled, Claude can fetch scenes dynamically via tools,
        # so including pre-fetched scene cards creates redundancy and confusion
        scene_cards = ""
        scene_tokens = 0
        if not skip_scene_retrieval:
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
        else:
            logger.info(f"[CONTEXT] Skipping scene retrieval (tools_enabled={tools_enabled})")

        # 4. Conversation context (not cached) with topic-aware history gating
        # P2 Implementation: Detect if this is a follow-up or new topic to optimize context
        conv_context = ""
        conv_tokens = 0
        conv_data = None
        topic_mode = TopicMode.NEW_TOPIC  # Default for new conversations
        topic_confidence = 1.0

        if conversation_id:
            conv_data = await self.conversation_service.get_conversation_context(
                conversation_id,
                token_budget=min(300, total_budget // 6)
            )

            # Check for user override first
            if topic_mode_override:
                if topic_mode_override == TopicModeOverride.CONTINUE:
                    topic_mode = TopicMode.FOLLOW_UP
                    topic_confidence = 1.0
                    logger.info("[CONTEXT] Topic mode: FOLLOW_UP (user override)")
                elif topic_mode_override == TopicModeOverride.NEW_TOPIC:
                    topic_mode = TopicMode.NEW_TOPIC
                    topic_confidence = 1.0
                    logger.info("[CONTEXT] Topic mode: NEW_TOPIC (user override)")
            # Auto-detect topic mode for history gating
            elif conv_data and conv_data.get("recent_messages"):
                recent_msgs = conv_data["recent_messages"]

                # Get last user and assistant messages for topic detection
                last_user_msg = None
                last_assistant_msg = None
                for msg in reversed(recent_msgs):
                    role = msg['role'].value if hasattr(msg['role'], 'value') else str(msg['role'])
                    if role.lower() == "user" and last_user_msg is None:
                        last_user_msg = msg.get("content", "")
                    elif role.lower() == "assistant" and last_assistant_msg is None:
                        last_assistant_msg = msg.get("content", "")
                    if last_user_msg and last_assistant_msg:
                        break

                topic_mode, topic_confidence = await self.topic_detector.detect_mode(
                    current_message=message,
                    last_assistant_message=last_assistant_msg,
                    last_user_message=last_user_msg
                )

                logger.info(
                    f"[CONTEXT] Topic mode: {topic_mode.value} "
                    f"(confidence: {topic_confidence:.2f})"
                )

            # Gate conversation history based on topic mode
            if topic_mode == TopicMode.NEW_TOPIC:
                # Fresh start - clear conversation history to avoid confusion
                # Keep summary if available, but skip recent messages
                if conv_data:
                    conv_data["recent_messages"] = []
                    logger.info("[CONTEXT] NEW_TOPIC: Skipping recent conversation history")
            else:
                # Follow-up - include recent history as normal
                logger.info("[CONTEXT] FOLLOW_UP: Including conversation history")

            # Estimate tokens for the conversation messages (after gating)
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
        # NOTE: We do NOT add a fake assistant acknowledgment here. Adding a fake
        # "I understand..." response causes Claude to think it already responded
        # and it will try to continue from that fake response, causing responses
        # to feel like they "start out of nowhere" or are continuations.
        # Instead, we let the context flow naturally into the user's actual question.
        if context_blocks:
            context_blocks.append({
                "type": "text",
                "text": "Above is context about the screenplay. Please use it to inform your responses."
            })
            messages.append({
                "role": "user",
                "content": context_blocks
            })

        # Add conversation history as properly alternating messages
        # Claude API requires alternating user/assistant messages
        if conv_data and conv_data.get("recent_messages"):
            for msg in conv_data["recent_messages"]:
                # Skip messages with empty content - Claude API rejects these
                if not msg.get('content') or not str(msg['content']).strip():
                    continue

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
                "topic_mode": topic_mode,
                "topic_confidence": topic_confidence,
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

    def _get_system_prompt(
        self,
        intent: IntentType,
        tools_enabled: bool = False,
        request_type: RequestType = RequestType.SUGGEST,
        domain: DomainType = DomainType.SCRIPT
    ) -> str:
        """
        Generate system prompt with domain and request type awareness.

        Phase 4 Implementation: System prompt now adapts based on:
        - Domain (GENERAL, SCRIPT, HYBRID)
        - Request type (SUGGEST, REWRITE, DIAGNOSE, BRAINSTORM, FACTUAL)
        - Intent (LOCAL_EDIT, SCENE_FEEDBACK, GLOBAL_QUESTION, BRAINSTORM)
        - Tools enabled state

        Args:
            intent: User intent type
            tools_enabled: If True, adjust prompt for tool-assisted mode
            request_type: Type of request (SUGGEST, REWRITE, etc.)
            domain: Domain classification (GENERAL, SCRIPT, HYBRID)

        Returns:
            System prompt string
        """
        # Optimized prompt structure following Claude's official prompt engineering best practices:
        # 1. Role first with behavioral constraint
        # 2. Critical rule at TOP with XML tags (not buried at bottom)
        # 3. Multishot example showing correct behavior
        # 4. Other instructions follow
        # See: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering

        base = """You are an expert screenplay consultant who answers ONE question at a time.

<critical_rule>
ANSWER ONLY THE USER'S CURRENT QUESTION.
- Conversation history is background context, NOT a queue of questions to answer
- If the current question is a NEW TOPIC, focus exclusively on it
- Do NOT re-answer or combine answers from previous questions
- Only reference previous discussion if the user explicitly asks (e.g., "going back to...", "about that scene...")
</critical_rule>

<example>
User previously asked: "How can I improve the dialogue in Scene 5?"
User now asks: "What is dual-dialogue and when should I use it?"
CORRECT: Answer only about dual-dialogue. Do not mention Scene 5.
WRONG: "I'll answer both questions..." or combining the topics.
</example>

<principles>
- Be a supportive collaborator, not a rewrite machine
- Respect the writer's voice and vision
- Provide actionable, specific feedback
- Reference specific scenes, characters, and lines when discussing the script
</principles>

<response_format>
DEFAULT (suggestions):
**What's working:** [1-2 sentences]
**What could improve:** [1-2 sentences]
**Suggestions:** [2-3 specific, actionable items]

REWRITE (only when explicitly requested with words: rewrite, revise, draft):
REVISED: [Full rewritten content]
**Changes made:** [Brief explanation]
</response_format>

<formatting>
- Use 1-based scene numbering for user-facing references
- Bold character names in ALL CAPS
- Keep responses focused and concise
</formatting>"""

        # Add domain-specific instructions with XML tags
        if domain == DomainType.GENERAL:
            base += """

<domain type="general">
This is a general screenwriting question (not script-specific).
Answer with expert knowledge. No need to reference this particular script.
</domain>"""

        elif domain == DomainType.HYBRID:
            base += """

<domain type="hybrid">
This question has both general and script-specific aspects.
First, explain the concept briefly. Then, apply it to this script with specific examples.
</domain>"""

        # Add request type instruction with XML tags
        if request_type == RequestType.REWRITE:
            base += """

<request type="rewrite">
The user explicitly asked for a rewrite. Provide a complete revised version.
</request>"""
        elif request_type == RequestType.DIAGNOSE:
            base += """

<request type="diagnose">
Analysis only. Focus on what's working and what isn't. No rewrites.
</request>"""
        elif request_type == RequestType.BRAINSTORM:
            base += """

<request type="brainstorm">
Creative alternatives requested. Provide multiple distinct options with trade-offs.
</request>"""
        elif request_type == RequestType.FACTUAL:
            base += """

<request type="factual">
Factual information requested. Provide a clear, direct answer.
</request>"""

        # Add intent-specific additions
        intent_additions = {
            IntentType.LOCAL_EDIT: "\n\n<focus>Dialogue and action lines. Be concise and specific.</focus>",
            IntentType.SCENE_FEEDBACK: "\n\n<focus>Scene structure, pacing, conflict, and character development.</focus>",
            IntentType.GLOBAL_QUESTION: "\n\n<focus>Overall story arc, theme, and structural elements.</focus>",
            IntentType.BRAINSTORM: "\n\n<focus>Be creative and exploratory. Offer multiple alternatives.</focus>"
        }
        base += intent_additions.get(intent, "")

        # Add tool instructions if enabled
        if tools_enabled:
            base += self._get_tool_instructions()

        return base

    def _get_tool_instructions(self) -> str:
        """
        Get tool-specific instructions for the system prompt.

        Returns:
            Tool instructions string
        """
        return """

<tools>
You have access to tools to retrieve and analyze screenplay content dynamically.

<critical_indexing>
Tools use 0-based indexing. Scene 5 = scene_index 4 (subtract 1).
Examples: Scene 1 = index 0, Scene 5 = index 4, Scene 10 = index 9.
</critical_indexing>

<tool_usage>
- ONE get_scene call is sufficient for a specific scene by number
- Only fetch multiple scenes if comparison or broader context is needed
- Synthesize ALL tool results equally (don't ignore earlier results)
- Provide specific scene numbers, character names, and quotes from results
</tool_usage>

<available_tools>
- get_scene: Full scene text (0-based index)
- get_scene_context: Scene plus surrounding scenes
- get_character_scenes: Track character appearances
- search_script: Semantic/keyword search
- analyze_pacing: Quantitative pacing metrics
- get_plot_threads: Plot thread and thematic info
</available_tools>
</tools>"""

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

    # =========================================================================
    # P1.3: Tool-Only Mode and Synthesis Prompts
    # =========================================================================

    def get_tool_loop_system_prompt(self) -> str:
        """
        Get system prompt optimized for tool-only mode during tool loop iterations.

        P1.3 Implementation: This prompt enforces that the model outputs ONLY tool
        calls, no prose. This prevents wasted tokens and truncation mid-thought.

        Returns:
            System prompt string for tool loop iterations
        """
        return """You are an expert screenplay analyst with access to tools.

CRITICAL INSTRUCTION: In this phase, output ONLY tool calls.
- Do NOT write any user-facing text
- Do NOT explain what you're doing
- Do NOT provide partial answers
- ONLY call tools to gather information

When you have gathered enough information to answer, call no tools.
The next phase will ask you to synthesize a response.

SCENE INDEXING: Tools use 0-based indexing.
- Scene 1 = index 0
- Scene 5 = index 4
- Scene 10 = index 9
When the user says "Scene N", use scene_index = N - 1.

BATCH TOOLS: For efficiency, prefer batch tools when fetching multiple scenes:
- get_scenes: Fetch multiple scenes at once (max 10)
- get_scenes_context: Fetch multiple scenes with their neighbors

Available tools:
- get_scene / get_scenes: Get scene text (use batch when fetching multiple)
- get_scene_context / get_scenes_context: Get scene with neighbors
- get_character_scenes: Track character appearances
- search_script: Semantic search across scenes
- analyze_pacing: Quantitative pacing metrics (no LLM tokens)
- get_plot_threads: Plot thread information
- get_scene_relationships: Scene connections and foreshadowing"""

    def get_synthesis_format_instructions(
        self,
        intent: IntentType = None,
        request_type: RequestType = RequestType.SUGGEST
    ) -> str:
        """
        Get format instructions for synthesis based on intent AND request type.

        Phase 4 Implementation: Request type takes priority over intent.
        REWRITE requests get rewrite format regardless of intent.

        Args:
            intent: Optional intent type for intent-specific formatting
            request_type: Request type (SUGGEST, REWRITE, DIAGNOSE, etc.)

        Returns:
            Format instruction string
        """
        # If REWRITE explicitly requested, use rewrite format regardless of intent
        if request_type == RequestType.REWRITE:
            return """
Format your response as a REWRITE:
1. Start with "REVISED:" followed by the full rewritten content
2. Use proper screenplay formatting
3. End with a brief (1-2 sentence) explanation of changes
4. Maximum 300 words for the revised content"""

        # If DIAGNOSE requested, use diagnosis-only format
        if request_type == RequestType.DIAGNOSE:
            return """
Format your response as DIAGNOSIS ONLY:
1. **What's working:** 2-3 specific strengths with examples
2. **What needs attention:** 2-3 specific issues with examples
3. Do NOT provide suggestions or rewrites
4. Maximum 200 words"""

        # Otherwise, use intent-specific SUGGESTION format
        intent_formats = {
            IntentType.LOCAL_EDIT: """
Format your response as FEEDBACK (not a rewrite):
1. **What's working:** One strength of the current version (1 sentence)
2. **What could improve:** One specific issue (1 sentence)
3. **Suggestions:** 2-3 specific, actionable suggestions
4. End with: "If you'd like me to rewrite these lines, just ask!"
Maximum 150 words.""",

            IntentType.SCENE_FEEDBACK: """
Format your response as SCENE ANALYSIS:
1. **Main Strength:** What works well in this scene (1-2 sentences)
2. **Area for Improvement:** Primary opportunity (1-2 sentences)
3. **Specific Suggestions:** 2-4 concrete improvements
4. Optional: Offer to rewrite specific lines if applicable
Maximum 200 words.""",

            IntentType.GLOBAL_QUESTION: """
Format your response as STRUCTURAL ANALYSIS:
- Use bullet points for clarity
- Lead with the most significant insight
- Reference specific scene numbers and characters
- Maximum 5 key points
- Maximum 200 words.""",

            IntentType.BRAINSTORM: """
Format your response as CREATIVE OPTIONS:
- Provide 3-5 distinct alternatives
- For each: 1-2 sentences explaining the approach
- Note trade-offs where relevant
- Maximum 200 words."""
        }

        return intent_formats.get(intent, intent_formats[IntentType.SCENE_FEEDBACK])

    def build_synthesis_prompt(
        self,
        evidence_text: str,
        user_question: str,
        intent: IntentType = None,
        request_type: RequestType = RequestType.SUGGEST
    ) -> str:
        """
        Build the synthesis prompt with evidence and format constraints.

        P1.3 Implementation: Provides clean evidence to Claude for synthesis,
        replacing the raw tool dump approach.

        Phase 4: Now accepts request_type for format customization.

        Args:
            evidence_text: Formatted evidence from EvidenceBuilder
            user_question: Original user question
            intent: Optional intent for format customization
            request_type: Request type (SUGGEST, REWRITE, etc.) - Phase 4

        Returns:
            Complete synthesis prompt string
        """
        format_instructions = self.get_synthesis_format_instructions(intent, request_type)

        return f"""Answer this question: {user_question}

Using this evidence:
{evidence_text}

{format_instructions}

CRITICAL INSTRUCTIONS FOR YOUR RESPONSE:
1. Start DIRECTLY with the answer - no preamble, no "Now I can...", no "Based on..."
2. Write as if you inherently know this information - never reference tools, evidence, or analysis
3. Never say phrases like "Now I can give you feedback" or "Having reviewed" or "Let me analyze"
4. Jump straight into the substance: if giving feedback, start with the feedback itself
5. Your response should read as natural expert knowledge, not as a report of findings

BAD starts (never use): "Now I can...", "Based on the evidence...", "Having gathered...", "Let me provide..."
GOOD starts: Direct statement of the answer, insight, or feedback itself."""

    # =========================================================================
    # Phase 3: Enhanced Continuity - Reference Context
    # =========================================================================

    async def get_reference_context(
        self,
        refers_to: ReferenceType,
        state: Optional[ConversationState],
        script_id: UUID
    ) -> str:
        """
        Get targeted context based on what user is referring to.

        Phase 3 Implementation: Provides specific context for pronoun resolution
        and callback handling based on the ReferenceType from routing.

        Args:
            refers_to: What the user is referencing (SCENE, CHARACTER, THREAD, PRIOR_ADVICE)
            state: Current conversation state with active entities
            script_id: Script ID for lookups

        Returns:
            Contextual information for the reference
        """
        if not state:
            return ""

        context_parts = []

        if refers_to == ReferenceType.PRIOR_ADVICE:
            # User is referencing what the assistant previously suggested
            if state.last_assistant_commitment:
                context_parts.append(
                    f"[Previous suggestion: {state.last_assistant_commitment}]"
                )

        elif refers_to == ReferenceType.CHARACTER:
            # User is referencing a character (e.g., "he", "she", "they")
            if state.active_characters:
                chars = ", ".join(state.active_characters[:3])
                context_parts.append(f"[Active characters: {chars}]")

                # Fetch character sheet for top character if available
                if state.active_characters:
                    top_char = state.active_characters[0]
                    char_sheet = await self._get_character_sheet(script_id, top_char)
                    if char_sheet:
                        context_parts.append(
                            f"[{top_char} profile: {char_sheet[:200]}...]"
                            if len(char_sheet) > 200 else f"[{top_char} profile: {char_sheet}]"
                        )

        elif refers_to == ReferenceType.SCENE:
            # User is referencing a scene (e.g., "that scene", "this part")
            if state.active_scene_ids:
                scenes = ", ".join([str(s) for s in state.active_scene_ids[:3]])
                context_parts.append(f"[Active scenes: {scenes}]")

                # Fetch brief info for top scene
                if state.active_scene_ids:
                    top_scene_idx = state.active_scene_ids[0]
                    scene_info = await self._get_scene_brief(script_id, top_scene_idx)
                    if scene_info:
                        context_parts.append(f"[Scene {top_scene_idx} info: {scene_info}]")

        elif refers_to == ReferenceType.THREAD:
            # User is referencing a plot thread
            if state.active_threads:
                threads = ", ".join(state.active_threads[:3])
                context_parts.append(f"[Active plot threads: {threads}]")

        return "\n".join(context_parts)

    async def _get_character_sheet(self, script_id: UUID, character_name: str) -> Optional[str]:
        """
        Get character sheet summary for a specific character.

        Args:
            script_id: Script ID
            character_name: Character name to look up

        Returns:
            Character summary text or None
        """
        try:
            result = await self.db.execute(
                select(CharacterSheet)
                .options(noload('*'))
                .where(
                    CharacterSheet.script_id == script_id,
                    CharacterSheet.character_name.ilike(f"%{character_name}%")
                )
                .limit(1)
            )
            sheet = result.scalar_one_or_none()
            return sheet.summary_text if sheet else None
        except Exception:
            return None

    async def _get_scene_brief(self, script_id: UUID, scene_position: int) -> Optional[str]:
        """
        Get brief scene info (heading and first line) for a scene.

        Args:
            script_id: Script ID
            scene_position: Scene position (1-based user-facing)

        Returns:
            Brief scene info or None
        """
        try:
            # Convert to 0-based for database lookup
            db_position = scene_position - 1 if scene_position > 0 else scene_position

            result = await self.db.execute(
                select(Scene)
                .options(noload('*'))
                .where(
                    Scene.script_id == script_id,
                    Scene.position == db_position
                )
                .limit(1)
            )
            scene = result.scalar_one_or_none()
            if scene:
                heading = scene.scene_heading or "Unknown"
                return f"{heading}"
            return None
        except Exception:
            return None
