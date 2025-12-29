# AI System Improvements - Implementation Plan

Detailed implementation plan for the AI system improvements identified in `AI_SYSTEM_IMPROVEMENTS.md`.

---

## Overview

### Goals
1. **Domain Classification**: Distinguish GENERAL / SCRIPT / HYBRID questions
2. **Request Type Classification**: SUGGEST (default) vs REWRITE (explicit)
3. **Working Set State**: Track active entities for continuity
4. **Enhanced Continuity**: `refers_to` detection for targeted context retrieval

### Implementation Phases

| Phase | Focus | Effort | Impact |
|-------|-------|--------|--------|
| **Phase 1** | Unified Router (Domain + Request Type) | 2-3 days | HIGH |
| **Phase 2** | Working Set State | 2 days | MEDIUM |
| **Phase 3** | Enhanced Continuity | 1 day | MEDIUM |
| **Phase 4** | System Prompt + Response Formatting | 0.5 day | HIGH |

---

## Phase 1: Unified Router

### 1.1 New Schema Definitions

**File: `app/schemas/ai.py`**

Add after `TopicMode` enum (around line 83):

```python
class DomainType(str, Enum):
    """
    Domain classification for context assembly.

    Determines whether the question is about the script, general
    screenwriting knowledge, or a combination.
    """
    GENERAL = "general"     # Non-script question (no tools, expert knowledge only)
    SCRIPT = "script"       # Script-grounded answer (tools enabled)
    HYBRID = "hybrid"       # Both (answer general first, then apply to script)


class RequestType(str, Enum):
    """
    Request type classification for response formatting.

    Controls whether the AI provides suggestions or full rewrites.
    """
    SUGGEST = "suggest"       # Default - diagnosis + suggestions, no rewrites
    REWRITE = "rewrite"       # Explicit request for full revision
    DIAGNOSE = "diagnose"     # Analysis only, no suggestions
    BRAINSTORM = "brainstorm" # Creative alternatives
    FACTUAL = "factual"       # General knowledge question


class ReferenceType(str, Enum):
    """
    Reference type for continuity resolution.

    Identifies what the user is referring to when continuing a conversation.
    """
    SCENE = "scene"           # "that scene", "this part"
    CHARACTER = "character"   # "he", "she", "they" referring to character
    THREAD = "thread"         # "that storyline", "the subplot"
    PRIOR_ADVICE = "prior_advice"  # "what you suggested", "your recommendation"
    NONE = "none"             # No specific reference


class RouterResult(BaseModel):
    """
    Unified router output containing all classification decisions.
    """
    domain: DomainType
    request_type: RequestType
    intent: IntentType
    continuity: TopicMode
    refers_to: ReferenceType
    confidence: float = Field(ge=0.0, le=1.0)
    needs_probe: bool = False  # True if domain is uncertain and needs script probe
```

### 1.2 New Message Router Service

**File: `app/services/message_router.py`** (NEW FILE)

```python
"""
Message Router Service

Unified classification for domain, request type, intent, and continuity.
Replaces separate IntentClassifier and TopicDetector with single coherent decision.
"""

from typing import Optional
from dataclasses import dataclass
import json
import re
import logging
from anthropic import AsyncAnthropic

from app.core.config import settings
from app.schemas.ai import (
    DomainType, RequestType, IntentType, TopicMode,
    ReferenceType, RouterResult
)

logger = logging.getLogger(__name__)


class MessageRouter:
    """
    Unified message classification for optimal context assembly.

    Single LLM call returns all classification decisions:
    - domain: GENERAL / SCRIPT / HYBRID
    - request_type: SUGGEST / REWRITE / DIAGNOSE / BRAINSTORM / FACTUAL
    - intent: LOCAL_EDIT / SCENE_FEEDBACK / GLOBAL_QUESTION / BRAINSTORM
    - continuity: FOLLOW_UP / NEW_TOPIC
    - refers_to: SCENE / CHARACTER / THREAD / PRIOR_ADVICE / NONE
    """

    # Keywords that strongly indicate GENERAL domain
    GENERAL_KEYWORDS = [
        "what is", "what are", "how do you", "define", "explain",
        "in general", "typically", "usually", "best practice",
        "screenwriting term", "what does", "how does one"
    ]

    # Keywords that strongly indicate SCRIPT domain
    SCRIPT_KEYWORDS = [
        "my script", "this script", "the script", "in my", "our",
        "scene", "character", "dialogue", "act", "draft"
    ]

    # Keywords that indicate REWRITE request type
    REWRITE_KEYWORDS = [
        "rewrite", "revise", "draft", "give me new lines",
        "write me", "create a version", "make this", "change it to",
        "write alternative", "give me alt"
    ]

    # Keywords that indicate SUGGEST request type (default)
    SUGGEST_KEYWORDS = [
        "feedback", "thoughts", "opinion", "suggestions",
        "what do you think", "how can i improve", "any ideas",
        "advice", "recommend"
    ]

    def __init__(self):
        self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    def classify_heuristic(
        self,
        message: str,
        last_assistant_commitment: Optional[str] = None,
        has_active_scene: bool = False
    ) -> Optional[RouterResult]:
        """
        Fast heuristic classification for clear cases.

        Returns RouterResult if confident, None if LLM needed.
        """
        message_lower = message.lower()

        # Score domain
        general_score = sum(1 for kw in self.GENERAL_KEYWORDS if kw in message_lower)
        script_score = sum(1 for kw in self.SCRIPT_KEYWORDS if kw in message_lower)

        # Score request type
        rewrite_score = sum(1 for kw in self.REWRITE_KEYWORDS if kw in message_lower)
        suggest_score = sum(1 for kw in self.SUGGEST_KEYWORDS if kw in message_lower)

        # Determine domain
        domain = None
        if general_score > script_score + 1:
            domain = DomainType.GENERAL
        elif script_score > general_score + 1:
            domain = DomainType.SCRIPT
        elif has_active_scene:
            # Bias toward SCRIPT when we have context
            domain = DomainType.SCRIPT

        # Determine request type
        request_type = RequestType.SUGGEST  # Default
        if rewrite_score > 0:
            request_type = RequestType.REWRITE
        elif "brainstorm" in message_lower or "ideas" in message_lower:
            request_type = RequestType.BRAINSTORM
        elif "?" not in message and ("what is" in message_lower or "define" in message_lower):
            request_type = RequestType.FACTUAL

        # Check for continuity indicators
        continuity = TopicMode.NEW_TOPIC
        refers_to = ReferenceType.NONE

        # Pronouns at start suggest follow-up
        pronoun_patterns = ["it ", "they ", "that ", "this ", "those ", "these ", "he ", "she "]
        if any(message_lower.startswith(p) for p in pronoun_patterns):
            continuity = TopicMode.FOLLOW_UP
            # Try to determine what the pronoun refers to
            if any(x in message_lower for x in ["scene", "part", "section"]):
                refers_to = ReferenceType.SCENE
            elif any(x in message_lower for x in ["character", "he", "she", "they"]):
                refers_to = ReferenceType.CHARACTER

        # "What you said/suggested" indicates prior advice reference
        if any(x in message_lower for x in ["you said", "you suggested", "your suggestion", "what you"]):
            continuity = TopicMode.FOLLOW_UP
            refers_to = ReferenceType.PRIOR_ADVICE

        # If domain is clear, return heuristic result
        if domain:
            # Map to intent (simplified)
            intent = IntentType.SCENE_FEEDBACK  # Default
            if domain == DomainType.GENERAL:
                intent = IntentType.GLOBAL_QUESTION
            elif "edit" in message_lower or "fix" in message_lower:
                intent = IntentType.LOCAL_EDIT
            elif request_type == RequestType.BRAINSTORM:
                intent = IntentType.BRAINSTORM

            return RouterResult(
                domain=domain,
                request_type=request_type,
                intent=intent,
                continuity=continuity,
                refers_to=refers_to,
                confidence=0.8,
                needs_probe=False
            )

        return None  # Need LLM classification

    async def classify_with_llm(
        self,
        message: str,
        last_assistant_commitment: Optional[str] = None,
        active_characters: Optional[list] = None,
        active_scene_ids: Optional[list] = None
    ) -> RouterResult:
        """
        LLM-based classification for ambiguous cases.

        Single call returns all classification decisions.
        Cost: ~150 tokens (~$0.00002 with Haiku)
        """
        context_info = ""
        if last_assistant_commitment:
            context_info += f"\nPrevious assistant said: \"{last_assistant_commitment[:200]}\""
        if active_characters:
            context_info += f"\nActive characters in conversation: {', '.join(active_characters[:5])}"
        if active_scene_ids:
            context_info += f"\nRecently discussed scenes: {active_scene_ids[:3]}"

        prompt = f"""Classify this user message. Return ONLY valid JSON.

Message: "{message}"
{context_info}

Classification schema:
{{
  "domain": "general" | "script" | "hybrid",
  "request_type": "suggest" | "rewrite" | "diagnose" | "brainstorm" | "factual",
  "intent": "local_edit" | "scene_feedback" | "global_question" | "brainstorm",
  "continuity": "follow_up" | "new_topic",
  "refers_to": "scene" | "character" | "thread" | "prior_advice" | "none",
  "confidence": 0.0-1.0
}}

Rules:
- domain: "general" = not about this specific script, "script" = about this script, "hybrid" = both
- request_type: "rewrite" ONLY if user explicitly asks for rewrite/revision, default "suggest"
- refers_to: what does "it/they/that" refer to? Use "prior_advice" if referencing previous suggestions

JSON only:"""

        try:
            response = await self.client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}]
            )

            result_text = response.content[0].text.strip()

            # Parse JSON (handle potential markdown code blocks)
            if "```" in result_text:
                result_text = re.search(r'\{.*\}', result_text, re.DOTALL).group()

            result_json = json.loads(result_text)

            return RouterResult(
                domain=DomainType(result_json.get("domain", "script")),
                request_type=RequestType(result_json.get("request_type", "suggest")),
                intent=IntentType(result_json.get("intent", "scene_feedback")),
                continuity=TopicMode(result_json.get("continuity", "new_topic")),
                refers_to=ReferenceType(result_json.get("refers_to", "none")),
                confidence=float(result_json.get("confidence", 0.7)),
                needs_probe=result_json.get("domain") == "hybrid"
            )

        except Exception as e:
            logger.warning(f"LLM classification failed: {e}, using defaults")
            return RouterResult(
                domain=DomainType.SCRIPT,
                request_type=RequestType.SUGGEST,
                intent=IntentType.SCENE_FEEDBACK,
                continuity=TopicMode.NEW_TOPIC,
                refers_to=ReferenceType.NONE,
                confidence=0.5,
                needs_probe=True
            )

    async def route(
        self,
        message: str,
        last_assistant_commitment: Optional[str] = None,
        active_characters: Optional[list] = None,
        active_scene_ids: Optional[list] = None,
        has_active_scene: bool = False
    ) -> RouterResult:
        """
        Main routing method.

        Priority:
        1. Heuristic classification (fast, free)
        2. LLM classification (accurate, ~$0.00002)

        Returns unified RouterResult with all classification decisions.
        """
        # Try heuristics first
        heuristic_result = self.classify_heuristic(
            message,
            last_assistant_commitment,
            has_active_scene
        )

        if heuristic_result and heuristic_result.confidence >= 0.8:
            logger.info(f"Router: Heuristic classification - {heuristic_result.domain.value}/{heuristic_result.request_type.value}")
            return heuristic_result

        # Fall back to LLM
        llm_result = await self.classify_with_llm(
            message,
            last_assistant_commitment,
            active_characters,
            active_scene_ids
        )

        logger.info(f"Router: LLM classification - {llm_result.domain.value}/{llm_result.request_type.value}")
        return llm_result
```

### 1.3 Script Probe Service

**File: `app/services/script_probe.py`** (NEW FILE)

```python
"""
Script Probe Service

Lightweight script relevance check for ambiguous domain classification.
"""

from typing import Optional, List
from uuid import UUID
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.retrieval_service import RetrievalService

logger = logging.getLogger(__name__)


class ScriptProbe:
    """
    Lightweight probe to check if a question relates to script content.

    Used when domain classification is uncertain to determine if
    the question should be SCRIPT or GENERAL.
    """

    RELEVANCE_THRESHOLD = 0.5

    def __init__(self, db: AsyncSession):
        self.db = db
        self.retrieval_service = RetrievalService(db)

    async def probe_relevance(
        self,
        script_id: UUID,
        query: str,
        limit: int = 3
    ) -> tuple[bool, List[dict]]:
        """
        Quick check if query relates to script content.

        Args:
            script_id: Script to search
            query: User's question
            limit: Max results to check

        Returns:
            Tuple of (is_relevant, top_matches)
        """
        try:
            results = await self.retrieval_service.vector_search(
                script_id=script_id,
                query=query,
                limit=limit
            )

            if not results:
                return False, []

            # Check if any result exceeds relevance threshold
            relevant_matches = []
            for scene, summary, score in results:
                if score >= self.RELEVANCE_THRESHOLD:
                    relevant_matches.append({
                        "scene_id": str(scene.scene_id),
                        "scene_heading": scene.scene_heading,
                        "position": scene.position,
                        "score": score
                    })

            is_relevant = len(relevant_matches) > 0

            logger.info(
                f"Script probe: query='{query[:50]}...' "
                f"relevant={is_relevant} matches={len(relevant_matches)}"
            )

            return is_relevant, relevant_matches

        except Exception as e:
            logger.warning(f"Script probe failed: {e}")
            # On error, assume relevant (safer default)
            return True, []
```

### 1.4 Integration into AI Router

**File: `app/routers/ai_router.py`**

Add imports:
```python
from app.services.message_router import MessageRouter
from app.services.script_probe import ScriptProbe
from app.schemas.ai import DomainType, RequestType, ReferenceType, RouterResult
```

Replace existing classification logic in `stream_chat_message_with_status` (around line 1540-1550):

```python
# === NEW UNIFIED ROUTING ===
router = MessageRouter()
script_probe = ScriptProbe(db)

# Get working set state if exists (Phase 2 will add this)
working_set = None  # TODO: Load from conversation_states table

# Route the message
route_result = await router.route(
    message=request.message,
    last_assistant_commitment=working_set.last_assistant_commitment if working_set else None,
    active_characters=working_set.active_characters if working_set else None,
    active_scene_ids=working_set.active_scene_ids if working_set else None,
    has_active_scene=request.current_scene_id is not None
)

# If domain uncertain, probe script
if route_result.needs_probe or route_result.domain == DomainType.HYBRID:
    is_relevant, matches = await script_probe.probe_relevance(
        script_id=request.script_id,
        query=request.message
    )
    if not is_relevant:
        route_result.domain = DomainType.GENERAL
    elif route_result.domain == DomainType.HYBRID:
        # HYBRID stays HYBRID, but now we have matches
        pass

# Use route_result for decisions
intent = route_result.intent
domain = route_result.domain
request_type = route_result.request_type

# Determine tool enablement based on domain
if domain == DomainType.GENERAL:
    tools_enabled = False  # No tools for general questions
elif request.enable_tools is not None:
    tools_enabled = request.enable_tools
else:
    tools_enabled = should_enable_tools(request.message, intent, request.current_scene_id)
```

---

## Phase 2: Working Set State

### 2.1 Database Model

**File: `app/models/conversation_state.py`** (NEW FILE)

```python
"""
Conversation State Model

Stores working set state for conversation continuity.
"""

from datetime import datetime
from uuid import UUID, uuid4
from typing import List, Optional
from sqlalchemy import String, ForeignKey, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, ARRAY
from sqlalchemy.sql import func

from app.models.base import Base


class ConversationState(Base):
    """
    Working set state for conversation continuity.

    Tracks active entities and last assistant commitment
    to enable pronoun resolution and callback handling.
    """
    __tablename__ = 'conversation_states'

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4
    )

    conversation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey('chat_conversations.conversation_id', ondelete='CASCADE'),
        nullable=False,
        unique=True,
        index=True
    )

    # Active entities (last 1-3 of each)
    active_scene_ids: Mapped[List[int]] = mapped_column(
        ARRAY(Integer),
        nullable=False,
        default=list
    )

    active_characters: Mapped[List[str]] = mapped_column(
        ARRAY(String(100)),
        nullable=False,
        default=list
    )

    active_threads: Mapped[List[str]] = mapped_column(
        ARRAY(String(200)),
        nullable=False,
        default=list
    )

    # Last intent and commitment
    last_user_intent: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True
    )

    last_assistant_commitment: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )

    # Relationship
    conversation: Mapped['ChatConversation'] = relationship(
        'ChatConversation',
        back_populates='state',
        lazy='selectin'
    )

    def __repr__(self) -> str:
        return f"<ConversationState {self.conversation_id}>"
```

### 2.2 Database Migration

**File: `alembic/versions/xxxx_add_conversation_state.py`**

```python
"""Add conversation_states table

Revision ID: xxxx
Revises: previous_revision
Create Date: 2024-xx-xx
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'xxxx'
down_revision = 'previous_revision'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'conversation_states',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('conversation_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('chat_conversations.conversation_id', ondelete='CASCADE'),
                  nullable=False, unique=True, index=True),
        sa.Column('active_scene_ids', postgresql.ARRAY(sa.Integer),
                  nullable=False, server_default='{}'),
        sa.Column('active_characters', postgresql.ARRAY(sa.String(100)),
                  nullable=False, server_default='{}'),
        sa.Column('active_threads', postgresql.ARRAY(sa.String(200)),
                  nullable=False, server_default='{}'),
        sa.Column('last_user_intent', sa.String(50), nullable=True),
        sa.Column('last_assistant_commitment', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('conversation_states')
```

### 2.3 State Manager Service

**File: `app/services/state_manager.py`** (NEW FILE)

```python
"""
Conversation State Manager

Manages working set state for conversation continuity.
"""

from typing import Optional, List
from uuid import UUID
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

        # Parse scene numbers from response
        scene_numbers = mentioned_scenes or []
        scene_matches = re.findall(r'[Ss]cene (\d+)', assistant_response)
        scene_numbers.extend([int(s) for s in scene_matches])

        # Parse character names (capitalized words that appear multiple times)
        characters = mentioned_characters or []
        if not characters:
            # Simple heuristic: find capitalized names
            caps = re.findall(r'\b([A-Z][A-Z]+)\b', assistant_response)
            # Filter to likely character names (appear 2+ times)
            from collections import Counter
            char_counts = Counter(caps)
            characters = [c for c, count in char_counts.items() if count >= 2]

        # Extract commitment (last sentence with "suggest", "recommend", "try", etc.)
        commitment = None
        commitment_patterns = [
            r"I (?:suggest|recommend|would try|think you should)[^.!?]*[.!?]",
            r"(?:You could|You might|Consider)[^.!?]*[.!?]",
            r"(?:My recommendation|My suggestion)[^.!?]*[.!?]"
        ]
        for pattern in commitment_patterns:
            match = re.search(pattern, assistant_response, re.IGNORECASE)
            if match:
                commitment = match.group(0).strip()
                break

        # Update state with recency limits
        if scene_numbers:
            # Add new scenes, keep most recent MAX_SCENES
            current = list(state.active_scene_ids) if state.active_scene_ids else []
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
            f"characters={state.active_characters[:3]}, "
            f"commitment={'yes' if commitment else 'no'}"
        )

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
```

---

## Phase 3: Enhanced Continuity

### 3.1 Context Retrieval Based on `refers_to`

**File: `app/services/context_builder.py`**

Add method:

```python
async def get_reference_context(
    self,
    refers_to: ReferenceType,
    state: Optional[ConversationState],
    script_id: UUID
) -> str:
    """
    Get targeted context based on what user is referring to.

    Args:
        refers_to: What the user is referencing
        state: Current conversation state
        script_id: Script ID for lookups

    Returns:
        Contextual information for the reference
    """
    if not state:
        return ""

    context_parts = []

    if refers_to == ReferenceType.PRIOR_ADVICE:
        if state.last_assistant_commitment:
            context_parts.append(
                f"[Previous suggestion: {state.last_assistant_commitment}]"
            )

    elif refers_to == ReferenceType.CHARACTER:
        if state.active_characters:
            chars = ", ".join(state.active_characters[:3])
            context_parts.append(f"[Active characters: {chars}]")

            # Optionally fetch character sheets for top character
            # (implement if needed)

    elif refers_to == ReferenceType.SCENE:
        if state.active_scene_ids:
            scenes = ", ".join([str(s) for s in state.active_scene_ids[:3]])
            context_parts.append(f"[Active scenes: {scenes}]")

    elif refers_to == ReferenceType.THREAD:
        if state.active_threads:
            threads = ", ".join(state.active_threads[:3])
            context_parts.append(f"[Active plot threads: {threads}]")

    return "\n".join(context_parts)
```

---

## Phase 4: System Prompt Updates

### 4.1 Updated System Prompt

**File: `app/services/context_builder.py`**

Update `_get_system_prompt` method:

```python
def _get_system_prompt(self, intent: IntentType, tools_enabled: bool = False,
                       request_type: RequestType = RequestType.SUGGEST,
                       domain: DomainType = DomainType.SCRIPT) -> str:
    """
    Generate system prompt with domain and request type awareness.
    """
    base = """You are an expert screenplay consultant helping writers improve their work.

CORE PRINCIPLES:
- Be a supportive collaborator, not a rewrite machine
- Respect the writer's voice and vision
- Provide actionable, specific feedback
- Reference specific scenes, characters, and lines when discussing the script

RESPONSE GUIDELINES:

1. REQUEST TYPE AWARENESS:
   - Default to diagnosis and suggestions, NOT full rewrites
   - Only provide full rewrites when user explicitly asks (words: rewrite, revise, draft)
   - Structure feedback as: What works → What could improve → Specific suggestions

2. DOMAIN AWARENESS:
   - For general screenwriting questions: Answer with expert knowledge, no script references needed
   - For script-specific questions: Ground your answer in the actual script content
   - For hybrid questions: Answer the general concept first, then apply to the script

3. SUGGESTION FORMAT (default):
   **What's working:** [1-2 sentences on strengths]
   **What could improve:** [1-2 sentences on opportunities]
   **Suggestions:**
   - [Specific, actionable suggestion 1]
   - [Specific, actionable suggestion 2]
   - [Specific, actionable suggestion 3]

   *If you'd like, I can rewrite specific lines for you.*

4. REWRITE FORMAT (only when explicitly requested):
   REVISED:
   [Full rewritten content here]

   **Changes made:** [Brief explanation]

FORMATTING:
- Use 1-based scene numbering for user-facing references
- Bold character names in ALL CAPS
- Keep responses focused and concise"""

    # Add domain-specific instructions
    if domain == DomainType.GENERAL:
        base += """

DOMAIN: GENERAL QUESTION
This question is about screenwriting in general, not this specific script.
Answer with your expert knowledge. No need to reference the script."""

    elif domain == DomainType.HYBRID:
        base += """

DOMAIN: HYBRID QUESTION
This question has both general and script-specific aspects.
First, answer the general concept briefly. Then, apply it to this script with specific examples."""

    # Add request type instruction
    if request_type == RequestType.REWRITE:
        base += """

REQUEST: REWRITE
The user has explicitly asked for a rewrite. Provide a complete revised version."""
    elif request_type == RequestType.DIAGNOSE:
        base += """

REQUEST: DIAGNOSE ONLY
The user wants analysis only. Focus on what's working and what isn't.
Do not provide suggestions or rewrites."""

    # Add tool instructions if enabled
    if tools_enabled:
        base += self._get_tool_instructions()

    return base
```

### 4.2 Updated Synthesis Format Instructions

**File: `app/services/context_builder.py`**

Update `get_synthesis_format_instructions`:

```python
def get_synthesis_format_instructions(
    self,
    intent: IntentType = None,
    request_type: RequestType = RequestType.SUGGEST
) -> str:
    """
    Get format instructions for synthesis based on intent AND request type.
    """
    # If REWRITE explicitly requested, use rewrite format regardless of intent
    if request_type == RequestType.REWRITE:
        return """
Format your response as a REWRITE:
1. Start with "REVISED:" followed by the full rewritten content
2. Use proper screenplay formatting
3. End with a brief (1-2 sentence) explanation of changes
4. Maximum 300 words for the revised content"""

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
```

---

## Integration Flow

### Complete Request Processing Flow

```
1. REQUEST RECEIVED
   └── Parse ChatMessageRequest

2. UNIFIED ROUTING (Phase 1)
   ├── MessageRouter.route()
   │   ├── Try heuristics (free, fast)
   │   └── Fall back to LLM (~$0.00002)
   └── Returns: RouterResult {domain, request_type, intent, continuity, refers_to}

3. DOMAIN PROBE (if needed)
   ├── If domain == HYBRID or needs_probe
   └── ScriptProbe.probe_relevance() → refine domain

4. LOAD WORKING SET STATE (Phase 2)
   └── StateManager.get_state(conversation_id)

5. CONTEXT ASSEMBLY
   ├── get_reference_context(refers_to, state) [Phase 3]
   ├── System prompt with domain/request_type awareness [Phase 4]
   ├── Global context (outline, characters)
   ├── Conversation context (if FOLLOW_UP)
   └── Local context (if LOCAL_EDIT + current_scene_id)

6. TOOL DECISION
   ├── If domain == GENERAL → tools disabled
   ├── If domain == SCRIPT/HYBRID → use existing logic
   └── Pass request_type to synthesis

7. GENERATE RESPONSE
   ├── If tools enabled → tool loop → evidence synthesis
   └── If tools disabled → direct RAG response

8. UPDATE WORKING SET STATE (Phase 2)
   └── StateManager.update_state(response, intent, ...)

9. PERSIST & RETURN
   └── Save messages, track tokens, stream response
```

---

## Testing Strategy

### Unit Tests

**File: `tests/test_message_router.py`**

```python
import pytest
from app.services.message_router import MessageRouter
from app.schemas.ai import DomainType, RequestType

@pytest.mark.asyncio
class TestMessageRouter:

    def test_general_question_heuristic(self):
        router = MessageRouter()
        result = router.classify_heuristic(
            "What is a save the cat beat?",
            has_active_scene=False
        )
        assert result.domain == DomainType.GENERAL

    def test_script_question_heuristic(self):
        router = MessageRouter()
        result = router.classify_heuristic(
            "How is the pacing in my script?",
            has_active_scene=True
        )
        assert result.domain == DomainType.SCRIPT

    def test_rewrite_detection(self):
        router = MessageRouter()
        result = router.classify_heuristic(
            "Can you rewrite this dialogue?",
            has_active_scene=True
        )
        assert result.request_type == RequestType.REWRITE

    def test_default_suggest(self):
        router = MessageRouter()
        result = router.classify_heuristic(
            "What do you think of this scene?",
            has_active_scene=True
        )
        assert result.request_type == RequestType.SUGGEST
```

### Integration Tests

```python
@pytest.mark.asyncio
class TestChatFlowIntegration:

    async def test_general_question_no_tools(self, client, test_script):
        """General questions should not trigger tool calls."""
        response = await client.post(
            "/api/chat/message/stream-with-status",
            json={
                "script_id": str(test_script.script_id),
                "message": "What makes good dialogue in general?"
            }
        )
        # Parse SSE events
        events = parse_sse(response)
        complete_event = next(e for e in events if e["type"] == "complete")

        # Should not have tool metadata
        assert complete_event.get("tool_metadata") is None

    async def test_suggest_format_default(self, client, test_script):
        """Default responses should use suggestion format."""
        response = await client.post(
            "/api/chat/message/stream-with-status",
            json={
                "script_id": str(test_script.script_id),
                "message": "What do you think of the dialogue in scene 5?"
            }
        )
        events = parse_sse(response)
        complete_event = next(e for e in events if e["type"] == "complete")
        message = complete_event["message"]

        # Should NOT contain "REVISED:" (that's rewrite format)
        assert "REVISED:" not in message
        # Should contain suggestion format markers
        assert any(x in message for x in ["suggest", "could", "try", "improve"])
```

---

## Rollout Plan

### Stage 1: Deploy Phase 1 (Unified Router)
1. Add new schemas to `ai.py`
2. Deploy `MessageRouter` and `ScriptProbe` services
3. Integrate into `ai_router.py` behind feature flag
4. Test with 10% traffic
5. Monitor for regressions in classification accuracy

### Stage 2: Deploy Phase 4 (System Prompt)
1. Update system prompt with response guidelines
2. Update synthesis format instructions
3. Deploy to 100% traffic
4. Monitor for reduction in unsolicited rewrites

### Stage 3: Deploy Phase 2 (Working Set State)
1. Run database migration
2. Deploy `StateManager` service
3. Integrate state loading/updating in router
4. Monitor state update performance

### Stage 4: Deploy Phase 3 (Enhanced Continuity)
1. Add `refers_to` context retrieval
2. Enable targeted context based on reference type
3. Monitor continuity improvement metrics

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| General question accuracy | ~50% | >90% | Manual review sample |
| Unsolicited rewrite rate | ~40% | <10% | Check for "REVISED:" without request |
| Continuity success | ~60% | >85% | Pronoun resolution accuracy |
| Classification cost | ~$0.00003 | ~$0.00002 | Token usage tracking |

---

## Files Changed Summary

| File | Change Type | Phase |
|------|-------------|-------|
| `app/schemas/ai.py` | Modify | 1 |
| `app/services/message_router.py` | New | 1 |
| `app/services/script_probe.py` | New | 1 |
| `app/models/conversation_state.py` | New | 2 |
| `alembic/versions/xxxx_add_conversation_state.py` | New | 2 |
| `app/services/state_manager.py` | New | 2 |
| `app/services/context_builder.py` | Modify | 3, 4 |
| `app/routers/ai_router.py` | Modify | 1, 2, 3 |
| `app/models/__init__.py` | Modify | 2 |
| `app/db/base.py` | Modify | 2 |
