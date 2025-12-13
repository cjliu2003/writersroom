# WritersRoom AI Assistant - Implementation Plan

**Version:** 1.0
**Date:** 2025-11-30
**Timeline:** 14 weeks (~3.5 months)
**Status:** Planning Phase

---

## Executive Summary

This document outlines the implementation plan for the WritersRoom AI assistant system, building on the architecture defined in `AI_SYSTEM.md`. The plan addresses critical gaps identified in the original specification and provides a phased approach to delivering a production-ready, token-efficient screenplay AI assistant.

### Key Objectives

1. **Complete Script Understanding:** AI comprehends screenplay at global (theme, arcs, pacing) and local (scene/line) levels
2. **Token Efficiency:** Predictable costs through intelligent context management and prompt caching
3. **Screenplay-Aware Intelligence:** RAG strategy respects narrative structure, not arbitrary chunks
4. **Scalable Architecture:** Handles full feature-length screenplays (80-120 pages, up to 200)

### Success Metrics

- **Token Cost:** <$5 per user per month with aggressive caching
- **Response Quality:** 90%+ user satisfaction with AI understanding
- **Context Accuracy:** AI references correct scenes/characters 95%+ of time
- **Performance:** <2s response time for standard queries
- **Cache Hit Rate:** >80% for subsequent messages in conversation

---

## Architecture Improvements

### Critical Gaps Addressed

1. **Conversation Context Management** - Multi-turn coherence
2. **Prompt Caching Strategy** - 90% cost reduction via Claude caching
3. **Plot Thread Tracking** - Cross-scene relationship understanding
4. **Intent-Specific Retrieval** - Optimized context assembly per query type
5. **Tiered Token Budgets** - Flexible budget allocation based on query complexity

### Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **LLM Model** | Claude 3.5 Sonnet | Prompt caching, 200K context, superior screenplay understanding |
| **Embedding Model** | text-embedding-3-small | 90% cheaper than ada-002, better quality |
| **Vector DB** | pgvector (existing) | Integrated with PostgreSQL, sufficient for screenplay scale |
| **Job Queue** | RQ with Redis | Lightweight, already using Redis for WebSocket |
| **Token Counting** | tiktoken + Anthropic SDK | Accurate counting for budget management |

---

## Implementation Phases

### Phase 0: Foundation (Weeks 1-2)

**Objective:** Prepare database schema and development environment

#### Database Schema Additions

Create Alembic migrations for new tables:

```sql
-- Scene summaries (scene cards)
CREATE TABLE scene_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id UUID REFERENCES scenes(id) ON DELETE CASCADE,
    summary_text TEXT NOT NULL,
    tokens_estimate INTEGER NOT NULL,
    version INTEGER DEFAULT 1,
    last_generated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_scene_summaries_scene_id ON scene_summaries(scene_id);

-- Global script outlines
CREATE TABLE script_outlines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id UUID REFERENCES scripts(id) ON DELETE CASCADE,
    version INTEGER DEFAULT 1,
    summary_text TEXT NOT NULL,
    tokens_estimate INTEGER NOT NULL,
    is_stale BOOLEAN DEFAULT FALSE,
    dirty_scene_count INTEGER DEFAULT 0,
    last_generated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_script_outlines_script_id ON script_outlines(script_id);

-- Character sheets
CREATE TABLE character_sheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id UUID REFERENCES scripts(id) ON DELETE CASCADE,
    character_name VARCHAR(255) NOT NULL,
    summary_text TEXT NOT NULL,
    tokens_estimate INTEGER NOT NULL,
    is_stale BOOLEAN DEFAULT FALSE,
    dirty_scene_count INTEGER DEFAULT 0,
    last_generated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(script_id, character_name)
);
CREATE INDEX idx_character_sheets_script_id ON character_sheets(script_id);

-- Scene-character relationships
CREATE TABLE scene_characters (
    scene_id UUID REFERENCES scenes(id) ON DELETE CASCADE,
    character_name VARCHAR(255) NOT NULL,
    PRIMARY KEY (scene_id, character_name)
);
CREATE INDEX idx_scene_characters_character ON scene_characters(character_name);

-- Plot threads and story structure
CREATE TABLE plot_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id UUID REFERENCES scripts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    scenes INTEGER[] NOT NULL,  -- Array of scene indices
    thread_type VARCHAR(50) NOT NULL,  -- 'character_arc', 'plot', 'subplot', 'theme'
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_plot_threads_script_id ON plot_threads(script_id);

-- Scene relationships (setup/payoff, callbacks, etc.)
CREATE TABLE scene_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id UUID REFERENCES scripts(id) ON DELETE CASCADE,
    setup_scene_id UUID REFERENCES scenes(id) ON DELETE CASCADE,
    payoff_scene_id UUID REFERENCES scenes(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) NOT NULL,  -- 'setup_payoff', 'callback', 'parallel', 'echo'
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_scene_relationships_script_id ON scene_relationships(script_id);

-- Conversation summaries for long conversations
CREATE TABLE conversation_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
    summary_text TEXT NOT NULL,
    tokens_estimate INTEGER NOT NULL,
    messages_covered INTEGER NOT NULL,  -- How many messages this summary covers
    last_message_id UUID REFERENCES chat_messages(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_conversation_summaries_conversation_id ON conversation_summaries(conversation_id);

-- Extend existing tables
ALTER TABLE scripts ADD COLUMN state VARCHAR(20) DEFAULT 'empty' CHECK (state IN ('empty', 'partial', 'analyzed'));
ALTER TABLE scripts ADD COLUMN last_state_transition TIMESTAMPTZ;

ALTER TABLE scenes ADD COLUMN hash VARCHAR(64);
ALTER TABLE scenes ADD COLUMN is_key_scene BOOLEAN DEFAULT FALSE;
CREATE INDEX idx_scenes_hash ON scenes(hash);
CREATE INDEX idx_scenes_is_key ON scenes(is_key_scene) WHERE is_key_scene = TRUE;
```

#### Pydantic Schemas

Create schemas in `backend/app/schemas/ai_schemas.py`:

```python
from pydantic import BaseModel, Field
from typing import Literal, Optional
from uuid import UUID
from datetime import datetime

class ScriptState(str, Enum):
    EMPTY = "empty"
    PARTIAL = "partial"
    ANALYZED = "analyzed"

class SceneSummary(BaseModel):
    id: UUID
    scene_id: UUID
    summary_text: str
    tokens_estimate: int
    version: int
    last_generated_at: datetime

class ScriptOutline(BaseModel):
    id: UUID
    script_id: UUID
    version: int
    summary_text: str
    tokens_estimate: int
    is_stale: bool
    dirty_scene_count: int
    last_generated_at: datetime

class CharacterSheet(BaseModel):
    id: UUID
    script_id: UUID
    character_name: str
    summary_text: str
    tokens_estimate: int
    is_stale: bool
    dirty_scene_count: int
    last_generated_at: datetime

class PlotThread(BaseModel):
    id: UUID
    script_id: UUID
    name: str
    scenes: list[int]
    thread_type: Literal["character_arc", "plot", "subplot", "theme"]
    description: Optional[str] = None

class ChatMessageRequest(BaseModel):
    script_id: UUID
    conversation_id: Optional[UUID] = None
    current_scene_id: Optional[UUID] = None
    message: str
    intent_hint: Optional[Literal["local_edit", "scene_feedback", "global_question", "brainstorm"]] = None
    max_tokens: Optional[int] = Field(default=600, le=4000)
    budget_tier: Optional[Literal["quick", "standard", "deep"]] = "standard"

class ChatMessageResponse(BaseModel):
    message: str
    conversation_id: UUID
    usage: dict
    context_used: dict
```

#### Dependencies Installation

Update `backend/requirements.txt`:

```txt
# AI and embeddings
anthropic==0.18.1        # Claude API client
tiktoken==0.5.2          # Token counting

# Background jobs
rq==1.15.1              # Redis Queue for async processing

# Existing dependencies remain...
```

#### Tasks Checklist

- [ ] Create Alembic migration files
- [ ] Test migrations on development database
- [ ] Create Pydantic schemas
- [ ] Install new dependencies
- [ ] Update SQLAlchemy models
- [ ] Create database indexes for performance
- [ ] Write unit tests for schema validation

**Deliverable:** Database schema ready, migrations tested, development environment configured

---

### Phase 1: Core Ingestion Pipeline (Weeks 3-5)

**Objective:** Build the foundation for script analysis and artifact generation

#### 1.1 Scene Hash & Change Detection

File: `backend/app/services/scene_service.py`

```python
import hashlib
from typing import Optional

def normalize_scene_text(text: str) -> str:
    """
    Normalize scene text for consistent hashing.
    Removes formatting variations but preserves content.
    """
    # Remove excessive whitespace but preserve line structure
    lines = [line.strip() for line in text.split('\n')]
    normalized = '\n'.join(line for line in lines if line)
    return normalized.lower()

def compute_scene_hash(scene_text: str) -> str:
    """
    Compute SHA-256 hash of normalized scene text.
    Used for change detection.
    """
    normalized = normalize_scene_text(scene_text)
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()

async def detect_scene_changes(scene: Scene, db: AsyncSession) -> bool:
    """
    Detect if scene content has changed since last analysis.

    Returns:
        True if scene has changed, False otherwise
    """
    new_hash = compute_scene_hash(scene.raw_text)

    if scene.hash is None or scene.hash != new_hash:
        # Scene changed - update hash
        scene.hash = new_hash
        scene.last_updated = datetime.utcnow()
        await db.commit()
        return True

    return False
```

#### 1.2 Scene Card Generation

File: `backend/app/services/ingestion_service.py`

```python
from anthropic import AsyncAnthropic
from app.schemas.ai_schemas import SceneSummary
import tiktoken

class IngestionService:
    def __init__(self):
        self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.tokenizer = tiktoken.get_encoding("cl100k_base")

    async def generate_scene_summary(self, scene: Scene) -> SceneSummary:
        """
        Generate structured scene card from scene text.

        Scene card structure (5-7 lines, ~150 tokens):
        - Action: 1-2 sentence plot summary
        - Conflict: Core tension or obstacle
        - Character Changes: Emotional/relational shifts
        - Plot Progression: How this advances story
        - Tone: Pacing and emotional register
        """
        prompt = f"""Analyze this screenplay scene and create a concise scene card.

Scene {scene.scene_index}: {scene.slugline}

{scene.raw_text}

Create a structured summary with these sections:

**Action:** (1-2 sentences summarizing what happens)
**Conflict:** (The core tension, obstacle, or question)
**Character Changes:** (Emotional or relational shifts)
**Plot Progression:** (How this advances the story)
**Tone:** (Pacing and emotional register)

Keep total length to 5-7 lines (~150 tokens)."""

        response = await self.client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )

        summary_text = response.content[0].text
        tokens_estimate = len(self.tokenizer.encode(summary_text))

        # Store in database
        scene_summary = SceneSummary(
            scene_id=scene.id,
            summary_text=summary_text,
            tokens_estimate=tokens_estimate,
            version=1,
            last_generated_at=datetime.utcnow()
        )

        return scene_summary

    async def batch_generate_scene_summaries(
        self,
        scenes: list[Scene],
        progress_callback: Optional[callable] = None
    ) -> list[SceneSummary]:
        """
        Generate summaries for multiple scenes with progress tracking.
        """
        summaries = []
        total = len(scenes)

        for idx, scene in enumerate(scenes):
            summary = await self.generate_scene_summary(scene)
            summaries.append(summary)

            if progress_callback:
                progress_callback(idx + 1, total)

        return summaries
```

#### 1.3 Scene Embeddings

```python
class EmbeddingService:
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    async def generate_scene_embedding(self, scene_card: str) -> list[float]:
        """
        Generate embedding vector for scene card using text-embedding-3-small.

        Cost: $0.00002 per 1K tokens (90% cheaper than ada-002)
        Dimensions: 1536
        """
        response = await self.client.embeddings.create(
            model="text-embedding-3-small",
            input=scene_card,
            encoding_format="float"
        )

        return response.data[0].embedding

    async def should_reembed(
        self,
        old_card: str,
        new_card: str,
        threshold: float = 0.95
    ) -> bool:
        """
        Determine if scene card has changed enough to warrant re-embedding.

        Only re-embed if cosine similarity < 0.95 (significant change).
        Saves embedding costs for minor edits.
        """
        if old_card == new_card:
            return False

        # Simple heuristic: if length changed by >20%, definitely re-embed
        length_ratio = len(new_card) / max(len(old_card), 1)
        if length_ratio < 0.8 or length_ratio > 1.2:
            return True

        # For subtle changes, compute similarity
        old_embedding = await self.generate_scene_embedding(old_card)
        new_embedding = await self.generate_scene_embedding(new_card)

        similarity = cosine_similarity(old_embedding, new_embedding)
        return similarity < threshold
```

#### 1.4 Global Outline Generation

```python
async def generate_script_outline(self, script_id: UUID) -> ScriptOutline:
    """
    Generate global outline from all scene summaries.

    Includes:
    - High-level story summary
    - Act-by-act breakdown
    - Key turning points
    """
    # Fetch all scene summaries
    scene_summaries = await self.db.execute(
        select(SceneSummary)
        .join(Scene)
        .where(Scene.script_id == script_id)
        .order_by(Scene.scene_index)
    )
    summaries = scene_summaries.scalars().all()

    # Concatenate scene cards
    scene_cards = "\n\n".join([
        f"Scene {idx}: {summary.summary_text}"
        for idx, summary in enumerate(summaries)
    ])

    prompt = f"""Analyze this screenplay and create a comprehensive outline.

SCENE CARDS:
{scene_cards}

Create an outline with:

1. **LOGLINE:** One-sentence story summary
2. **ACT STRUCTURE:** Break scenes into acts and identify key beats
3. **MAJOR TURNING POINTS:** Inciting incident, midpoint, climax
4. **CENTRAL CONFLICT:** What's the core story engine?

Keep total length under 500 tokens."""

    response = await self.client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=800,
        messages=[{"role": "user", "content": prompt}]
    )

    outline_text = response.content[0].text
    tokens_estimate = len(self.tokenizer.encode(outline_text))

    return ScriptOutline(
        script_id=script_id,
        version=1,
        summary_text=outline_text,
        tokens_estimate=tokens_estimate,
        is_stale=False,
        dirty_scene_count=0,
        last_generated_at=datetime.utcnow()
    )
```

#### 1.5 Character Sheet Extraction

```python
async def generate_character_sheet(
    self,
    script_id: UUID,
    character_name: str
) -> CharacterSheet:
    """
    Generate character sheet for a specific character.

    Includes:
    - Want/Need (external goal vs internal need)
    - Character arc progression
    - Key scenes and relationships
    """
    # Get all scenes where character appears
    scenes_with_char = await self.db.execute(
        select(Scene, SceneSummary)
        .join(SceneCharacter, Scene.id == SceneCharacter.scene_id)
        .join(SceneSummary, Scene.id == SceneSummary.scene_id)
        .where(SceneCharacter.character_name == character_name)
        .where(Scene.script_id == script_id)
        .order_by(Scene.scene_index)
    )

    scene_data = scenes_with_char.all()

    # Build character timeline
    timeline = "\n".join([
        f"Scene {scene.scene_index}: {summary.summary_text}"
        for scene, summary in scene_data
    ])

    prompt = f"""Analyze {character_name}'s arc across these scenes:

{timeline}

Create a character sheet with:

1. **WANT:** External goal (what they think they need)
2. **NEED:** Internal need (what they actually need)
3. **ARC:** How they change from beginning to end
4. **KEY RELATIONSHIPS:** Important connections to other characters
5. **PIVOTAL MOMENTS:** 3-5 defining scenes

Keep under 300 tokens."""

    response = await self.client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )

    sheet_text = response.content[0].text
    tokens_estimate = len(self.tokenizer.encode(sheet_text))

    return CharacterSheet(
        script_id=script_id,
        character_name=character_name,
        summary_text=sheet_text,
        tokens_estimate=tokens_estimate,
        is_stale=False,
        dirty_scene_count=0,
        last_generated_at=datetime.utcnow()
    )
```

#### 1.6 State Machine Logic

File: `backend/app/services/script_state_service.py`

```python
class ScriptStateService:
    # State transition thresholds
    EMPTY_TO_PARTIAL_MIN_SCENES = 3
    EMPTY_TO_PARTIAL_MIN_PAGES = 10
    PARTIAL_TO_ANALYZED_MIN_SCENES = 30
    PARTIAL_TO_ANALYZED_MIN_PAGES = 60

    async def check_state_transition(self, script: Script) -> Optional[str]:
        """
        Check if script should transition to a new state.

        Returns new state if transition should occur, None otherwise.
        """
        scene_count = await self.count_scenes(script.id)
        page_count = await self.estimate_page_count(script.id)

        if script.state == "empty":
            if scene_count >= self.EMPTY_TO_PARTIAL_MIN_SCENES or \
               page_count >= self.EMPTY_TO_PARTIAL_MIN_PAGES:
                return "partial"

        elif script.state == "partial":
            if scene_count >= self.PARTIAL_TO_ANALYZED_MIN_SCENES or \
               page_count >= self.PARTIAL_TO_ANALYZED_MIN_PAGES:
                return "analyzed"

        return None

    async def transition_script_state(
        self,
        script: Script,
        new_state: str,
        user_initiated: bool = False
    ):
        """
        Transition script to new state and trigger appropriate analysis.
        """
        old_state = script.state
        script.state = new_state
        script.last_state_transition = datetime.utcnow()
        await self.db.commit()

        # Trigger analysis based on new state
        if new_state == "partial":
            # Partial ingestion: scene cards + embeddings
            await self.trigger_partial_ingestion(script.id)

        elif new_state == "analyzed":
            # Full analysis: scene cards + outline + character sheets
            await self.trigger_full_analysis(script.id)

        # Notify user of transition (if automatic)
        if not user_initiated:
            await self.notify_state_transition(script.id, old_state, new_state)

    async def estimate_page_count(self, script_id: UUID) -> int:
        """
        Estimate page count based on content.

        Screenplay standard: ~55 lines per page
        """
        scenes = await self.db.execute(
            select(Scene).where(Scene.script_id == script_id)
        )

        total_lines = sum(
            len(scene.raw_text.split('\n'))
            for scene in scenes.scalars().all()
        )

        return total_lines // 55
```

#### Tasks Checklist

- [ ] Implement scene hash computation and change detection
- [ ] Create scene card generation with structured template
- [ ] Build embedding service with similarity-based re-embedding
- [ ] Implement global outline generation
- [ ] Create character sheet extraction
- [ ] Build state machine with threshold checks
- [ ] Add progress tracking for batch operations
- [ ] Write unit tests for all ingestion components
- [ ] Integration test: full script ingestion end-to-end

**Deliverable:** Complete ingestion pipeline that transforms raw screenplay into analyzed artifacts

---

### Phase 2: RAG & Context Assembly (Weeks 6-7)

**Objective:** Build intelligent context retrieval and prompt assembly

#### 2.1 Intent Classification

File: `backend/app/services/intent_classifier.py`

```python
from typing import Literal, Optional

IntentType = Literal["local_edit", "scene_feedback", "global_question", "brainstorm"]

class IntentClassifier:
    """
    Classify user intent to determine optimal context assembly strategy.

    Uses heuristic rules for speed and cost efficiency.
    Falls back to LLM classifier for ambiguous cases.
    """

    # Keyword patterns for each intent
    LOCAL_EDIT_KEYWORDS = [
        "punch up", "rewrite", "change", "fix", "edit", "improve line",
        "better dialogue", "rephrase", "tweak", "adjust"
    ]

    GLOBAL_QUESTION_KEYWORDS = [
        "arc", "theme", "overall", "acts", "structure", "pacing",
        "entire script", "whole story", "character development"
    ]

    SCENE_FEEDBACK_KEYWORDS = [
        "analyze scene", "scene pacing", "what do you think",
        "feedback on", "review scene", "scene work"
    ]

    BRAINSTORM_KEYWORDS = [
        "ideas for", "what if", "alternatives", "suggestions",
        "help me think", "brainstorm", "creative", "explore"
    ]

    def classify_heuristic(self, message: str) -> Optional[IntentType]:
        """
        Fast heuristic classification based on keywords.

        Returns None if ambiguous.
        """
        message_lower = message.lower()

        # Count keyword matches for each intent
        scores = {
            "local_edit": sum(1 for kw in self.LOCAL_EDIT_KEYWORDS if kw in message_lower),
            "global_question": sum(1 for kw in self.GLOBAL_QUESTION_KEYWORDS if kw in message_lower),
            "scene_feedback": sum(1 for kw in self.SCENE_FEEDBACK_KEYWORDS if kw in message_lower),
            "brainstorm": sum(1 for kw in self.BRAINSTORM_KEYWORDS if kw in message_lower)
        }

        # Get highest scoring intent
        max_score = max(scores.values())

        if max_score == 0:
            return None  # Ambiguous

        # Check if there's a clear winner
        winners = [intent for intent, score in scores.items() if score == max_score]

        if len(winners) == 1:
            return winners[0]

        return None  # Tie - ambiguous

    async def classify_with_llm(self, message: str) -> IntentType:
        """
        Use small LLM call to classify ambiguous intents.

        Cost: ~100 tokens per classification
        """
        prompt = f"""Classify this user message into one of these intents:

1. local_edit - User wants to edit specific lines/dialogue in current scene
2. scene_feedback - User wants feedback on a specific scene
3. global_question - User asking about overall script structure, themes, or arcs
4. brainstorm - User wants creative ideas or alternatives

User message: "{message}"

Respond with just the intent name."""

        response = await self.client.messages.create(
            model="claude-3-5-haiku-20241022",  # Cheaper model for classification
            max_tokens=20,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content[0].text.strip()

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
        """
        if hint:
            return hint

        heuristic_result = self.classify_heuristic(message)

        if heuristic_result:
            return heuristic_result

        # Fall back to LLM for ambiguous cases
        return await self.classify_with_llm(message)
```

#### 2.2 Vector Search & Retrieval

File: `backend/app/services/retrieval_service.py`

```python
from pgvector.sqlalchemy import Vector
from sqlalchemy import func

class RetrievalService:
    """
    Screenplay-aware retrieval using vector search + metadata filtering.
    """

    async def vector_search(
        self,
        script_id: UUID,
        query: str,
        limit: int = 10,
        filters: Optional[dict] = None
    ) -> list[tuple[Scene, SceneSummary, float]]:
        """
        Semantic search over scene embeddings.

        Args:
            script_id: Script to search within
            query: Search query text
            limit: Max results to return
            filters: Optional filters (act, character, is_key_scene)

        Returns:
            List of (Scene, SceneSummary, similarity_score) tuples
        """
        # Generate query embedding
        query_embedding = await self.embedding_service.generate_scene_embedding(query)

        # Build base query
        stmt = (
            select(
                Scene,
                SceneSummary,
                SceneEmbedding.embedding_vector.cosine_distance(query_embedding).label('distance')
            )
            .join(SceneSummary, Scene.id == SceneSummary.scene_id)
            .join(SceneEmbedding, Scene.id == SceneEmbedding.scene_id)
            .where(Scene.script_id == script_id)
        )

        # Apply filters
        if filters:
            if 'act' in filters:
                stmt = stmt.where(Scene.act_number == filters['act'])

            if 'characters' in filters:
                stmt = stmt.join(SceneCharacter).where(
                    SceneCharacter.character_name.in_(filters['characters'])
                )

            if 'is_key_scene' in filters:
                stmt = stmt.where(Scene.is_key_scene == filters['is_key_scene'])

        # Order by similarity and limit
        stmt = stmt.order_by('distance').limit(limit)

        results = await self.db.execute(stmt)

        return [
            (scene, summary, 1 - distance)  # Convert distance to similarity
            for scene, summary, distance in results.all()
        ]

    async def get_scene_with_neighbors(
        self,
        scene_id: UUID,
        neighbor_count: int = 1
    ) -> list[tuple[Scene, SceneSummary]]:
        """
        Get a scene plus N neighboring scenes for context.

        Respects narrative flow - returns scenes in order.
        """
        # Get target scene
        target_scene = await self.db.get(Scene, scene_id)

        # Get neighbors by scene_index
        stmt = (
            select(Scene, SceneSummary)
            .join(SceneSummary, Scene.id == SceneSummary.scene_id)
            .where(Scene.script_id == target_scene.script_id)
            .where(
                Scene.scene_index >= target_scene.scene_index - neighbor_count,
                Scene.scene_index <= target_scene.scene_index + neighbor_count
            )
            .order_by(Scene.scene_index)
        )

        results = await self.db.execute(stmt)
        return results.all()

    async def retrieve_for_intent(
        self,
        script_id: UUID,
        message: str,
        intent: IntentType,
        current_scene_id: Optional[UUID] = None
    ) -> dict:
        """
        Intent-specific retrieval strategy.

        Different intents require different context assembly approaches.
        """
        if intent == "local_edit":
            # Positional retrieval - current scene + neighbors
            if not current_scene_id:
                raise ValueError("local_edit requires current_scene_id")

            scenes = await self.get_scene_with_neighbors(current_scene_id, neighbor_count=1)

            return {
                "retrieval_type": "positional",
                "scenes": scenes,
                "focus": "current_scene"
            }

        elif intent == "global_question":
            # Pure semantic search across all scenes
            results = await self.vector_search(
                script_id=script_id,
                query=message,
                limit=10
            )

            return {
                "retrieval_type": "semantic",
                "scenes": [(scene, summary) for scene, summary, _ in results],
                "focus": "global_understanding"
            }

        elif intent == "scene_feedback":
            # Hybrid: current scene + semantically similar scenes
            current_scenes = await self.get_scene_with_neighbors(
                current_scene_id,
                neighbor_count=0
            ) if current_scene_id else []

            semantic_results = await self.vector_search(
                script_id=script_id,
                query=message,
                limit=5
            )

            # Merge and deduplicate
            all_scenes = current_scenes + [
                (scene, summary)
                for scene, summary, _ in semantic_results
            ]

            # Deduplicate by scene_id
            seen = set()
            unique_scenes = []
            for scene, summary in all_scenes:
                if scene.id not in seen:
                    seen.add(scene.id)
                    unique_scenes.append((scene, summary))

            return {
                "retrieval_type": "hybrid",
                "scenes": unique_scenes,
                "focus": "scene_context"
            }

        else:  # brainstorm
            # Minimal context - just outline
            return {
                "retrieval_type": "minimal",
                "scenes": [],
                "focus": "creative_freedom"
            }
```

#### 2.3 Conversation Context Management

File: `backend/app/services/conversation_service.py`

```python
class ConversationService:
    """
    Manage conversation history and summaries for multi-turn coherence.
    """

    SLIDING_WINDOW_SIZE = 10  # Last 5 message pairs
    SUMMARY_TRIGGER_COUNT = 15  # Generate summary after 15 messages

    async def get_conversation_context(
        self,
        conversation_id: UUID,
        token_budget: int = 300
    ) -> dict:
        """
        Get conversation context within token budget.

        Returns recent messages + summary of older conversation.
        """
        # Get recent messages
        recent_messages = await self.db.execute(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(self.SLIDING_WINDOW_SIZE)
        )
        recent = list(reversed(recent_messages.scalars().all()))

        # Get conversation summary (if exists)
        summary = await self.db.execute(
            select(ConversationSummary)
            .where(ConversationSummary.conversation_id == conversation_id)
            .order_by(ConversationSummary.created_at.desc())
            .limit(1)
        )
        summary_obj = summary.scalar_one_or_none()

        # Format for prompt
        context = {
            "summary": summary_obj.summary_text if summary_obj else None,
            "recent_messages": [
                {
                    "role": msg.role,
                    "content": msg.content,
                    "timestamp": msg.created_at
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

    async def should_generate_summary(self, conversation_id: UUID) -> bool:
        """
        Check if conversation is long enough to warrant summary generation.
        """
        message_count = await self.db.scalar(
            select(func.count(ChatMessage.id))
            .where(ChatMessage.conversation_id == conversation_id)
        )

        last_summary = await self.db.execute(
            select(ConversationSummary)
            .where(ConversationSummary.conversation_id == conversation_id)
            .order_by(ConversationSummary.created_at.desc())
            .limit(1)
        )
        summary_obj = last_summary.scalar_one_or_none()

        if not summary_obj:
            return message_count >= self.SUMMARY_TRIGGER_COUNT

        # Generate new summary if >15 messages since last summary
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
        """
        # Get all messages
        messages = await self.db.execute(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation_id)
            .order_by(ChatMessage.created_at)
        )
        all_messages = messages.scalars().all()

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
            model="claude-3-5-sonnet-20241022",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )

        summary_text = response.content[0].text
        tokens_estimate = len(self.tokenizer.encode(summary_text))

        return ConversationSummary(
            conversation_id=conversation_id,
            summary_text=summary_text,
            tokens_estimate=tokens_estimate,
            messages_covered=len(all_messages),
            last_message_id=all_messages[-1].id,
            created_at=datetime.utcnow()
        )
```

#### 2.4 Prompt Assembly with Caching

File: `backend/app/services/context_builder.py`

```python
class ContextBuilder:
    """
    Assemble prompts with optimal token budget allocation and caching.

    Budget tiers:
    - quick: 1200 tokens (simple questions)
    - standard: 5000 tokens (scene analysis)
    - deep: 20000 tokens (comprehensive analysis)
    """

    BUDGET_TIERS = {
        "quick": 1200,
        "standard": 5000,
        "deep": 20000
    }

    async def build_prompt(
        self,
        script_id: UUID,
        message: str,
        intent: IntentType,
        conversation_id: Optional[UUID] = None,
        current_scene_id: Optional[UUID] = None,
        budget_tier: str = "standard"
    ) -> dict:
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
        """
        total_budget = self.BUDGET_TIERS[budget_tier]

        # 1. System prompt (cacheable)
        system_prompt = self._get_system_prompt(intent)
        system_tokens = self._count_tokens(system_prompt)

        # 2. Global context (cacheable)
        global_context = await self._get_global_context(script_id, intent)
        global_tokens = self._count_tokens(global_context)

        # 3. Retrieved scene cards (cacheable)
        retrieval_result = await self.retrieval_service.retrieve_for_intent(
            script_id=script_id,
            message=message,
            intent=intent,
            current_scene_id=current_scene_id
        )
        scene_cards = self._format_scene_cards(retrieval_result["scenes"])
        scene_tokens = self._count_tokens(scene_cards)

        # 4. Conversation context (not cached)
        conv_context = ""
        conv_tokens = 0
        if conversation_id:
            conv_data = await self.conversation_service.get_conversation_context(
                conversation_id,
                token_budget=min(300, total_budget // 6)
            )
            conv_context = self._format_conversation(conv_data)
            conv_tokens = self._count_tokens(conv_context)

        # 5. Local context (not cached)
        local_context = ""
        local_tokens = 0
        if current_scene_id and intent == "local_edit":
            scene = await self.db.get(Scene, current_scene_id)
            local_context = f"CURRENT SCENE:\n{scene.slugline}\n\n{scene.raw_text}"
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

        # Build Claude API message format with cache control
        return {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 600,  # Output budget
            "system": [
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"}
                }
            ],
            "messages": [
                {
                    "role": "user",
                    "content": [
                        # Global context (cached)
                        {
                            "type": "text",
                            "text": global_context,
                            "cache_control": {"type": "ephemeral"}
                        } if global_context else None,

                        # Scene cards (cached)
                        {
                            "type": "text",
                            "text": scene_cards,
                            "cache_control": {"type": "ephemeral"}
                        } if scene_cards else None,

                        # Conversation context (not cached)
                        {
                            "type": "text",
                            "text": conv_context
                        } if conv_context else None,

                        # Local context (not cached)
                        {
                            "type": "text",
                            "text": local_context
                        } if local_context else None,

                        # User message (not cached)
                        {
                            "type": "text",
                            "text": message
                        }
                    ]
                }
            ],
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
        """
        base = """You are an expert screenplay writing assistant. You understand screenplay format, story structure, and character development.

Key guidelines:
- Respect screenplay formatting conventions
- Focus on showing not telling
- Maintain character voice consistency
- Consider pacing and visual storytelling
- Provide specific, actionable feedback"""

        intent_additions = {
            "local_edit": "\n\nFocus on improving dialogue and action lines. Be concise and specific.",
            "scene_feedback": "\n\nAnalyze scene structure, pacing, conflict, and character development.",
            "global_question": "\n\nConsider overall story arc, theme, and structural elements.",
            "brainstorm": "\n\nBe creative and exploratory. Offer multiple alternatives."
        }

        return base + intent_additions.get(intent, "")

    async def _get_global_context(self, script_id: UUID, intent: IntentType) -> str:
        """
        Get global artifacts (outline + character sheets).

        Omitted for brainstorm intent to allow creative freedom.
        """
        if intent == "brainstorm":
            return ""

        # Get script outline
        outline = await self.db.execute(
            select(ScriptOutline)
            .where(ScriptOutline.script_id == script_id)
            .order_by(ScriptOutline.version.desc())
            .limit(1)
        )
        outline_obj = outline.scalar_one_or_none()

        if not outline_obj:
            return ""

        # Get main character sheets (top 3 by dirty_scene_count)
        character_sheets = await self.db.execute(
            select(CharacterSheet)
            .where(CharacterSheet.script_id == script_id)
            .order_by(CharacterSheet.dirty_scene_count.desc())
            .limit(3)
        )
        sheets = character_sheets.scalars().all()

        # Format global context
        context_parts = ["SCRIPT OUTLINE:\n" + outline_obj.summary_text]

        if sheets:
            context_parts.append("\nMAIN CHARACTERS:")
            for sheet in sheets:
                context_parts.append(f"\n{sheet.character_name}:\n{sheet.summary_text}")

        return "\n\n".join(context_parts)
```

#### Tasks Checklist

- [ ] Implement intent classifier with heuristic + LLM fallback
- [ ] Build vector search with metadata filtering
- [ ] Create intent-specific retrieval strategies
- [ ] Implement conversation context management
- [ ] Build conversation summary generation
- [ ] Create prompt assembly with caching structure
- [ ] Add token counting and budget management
- [ ] Test retrieval quality with sample queries
- [ ] Benchmark cache hit rates

**Deliverable:** Intelligent context assembly that optimizes for relevance and cost

---

### Phase 3: Chat Integration (Weeks 8-9)

**Objective:** Connect all components into working chat endpoint

#### 3.1 AI Service Update

File: `backend/app/services/ai_service.py` (renamed from openai_service.py)

```python
from anthropic import AsyncAnthropic
import tiktoken

class AIService:
    """
    Unified AI service supporting Claude and OpenAI models.
    """

    def __init__(self):
        self.anthropic_client = AsyncAnthropic(
            api_key=settings.ANTHROPIC_API_KEY
        )
        self.openai_client = AsyncOpenAI(
            api_key=settings.OPENAI_API_KEY
        )
        self.tokenizer = tiktoken.get_encoding("cl100k_base")

    async def generate_response(
        self,
        prompt: dict,
        max_tokens: int = 600,
        stream: bool = False
    ) -> dict:
        """
        Generate AI response using Claude 3.5 Sonnet.

        Returns usage statistics including cache metrics.
        """
        if stream:
            return await self._generate_streaming(prompt, max_tokens)

        response = await self.anthropic_client.messages.create(
            model=prompt.get("model", "claude-3-5-sonnet-20241022"),
            max_tokens=max_tokens,
            system=prompt.get("system", []),
            messages=prompt["messages"]
        )

        return {
            "content": response.content[0].text,
            "usage": {
                "input_tokens": response.usage.input_tokens,
                "cache_creation_input_tokens": getattr(
                    response.usage, 'cache_creation_input_tokens', 0
                ),
                "cache_read_input_tokens": getattr(
                    response.usage, 'cache_read_input_tokens', 0
                ),
                "output_tokens": response.usage.output_tokens
            },
            "stop_reason": response.stop_reason
        }

    async def _generate_streaming(self, prompt: dict, max_tokens: int):
        """
        Generate streaming response for real-time UI updates.
        """
        async with self.anthropic_client.messages.stream(
            model=prompt.get("model", "claude-3-5-sonnet-20241022"),
            max_tokens=max_tokens,
            system=prompt.get("system", []),
            messages=prompt["messages"]
        ) as stream:
            async for text in stream.text_stream:
                yield {
                    "type": "content_delta",
                    "text": text
                }

            # Get final usage stats
            message = await stream.get_final_message()
            yield {
                "type": "message_complete",
                "usage": {
                    "input_tokens": message.usage.input_tokens,
                    "cache_creation_input_tokens": getattr(
                        message.usage, 'cache_creation_input_tokens', 0
                    ),
                    "cache_read_input_tokens": getattr(
                        message.usage, 'cache_read_input_tokens', 0
                    ),
                    "output_tokens": message.usage.output_tokens
                }
            }
```

#### 3.2 Chat Router

File: `backend/app/routers/ai_router.py`

```python
from fastapi import APIRouter, Depends, HTTPException, WebSocket
from fastapi.responses import StreamingResponse
from app.schemas.ai_schemas import ChatMessageRequest, ChatMessageResponse
from app.services.ai_service import AIService
from app.services.context_builder import ContextBuilder
from app.services.intent_classifier import IntentClassifier

router = APIRouter(prefix="/api/chat", tags=["ai"])

@router.post("/message", response_model=ChatMessageResponse)
async def chat_message(
    request: ChatMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Send message to AI assistant and get response.

    Request includes:
    - script_id: Which script to discuss
    - conversation_id: Existing conversation (optional)
    - current_scene_id: Current scene context (optional)
    - message: User's message
    - intent_hint: Optional intent classification hint
    - budget_tier: Token budget tier (quick/standard/deep)

    Response includes:
    - message: AI's response
    - conversation_id: Conversation ID (created if new)
    - usage: Token usage statistics
    - context_used: What context was included
    """
    # Validate script access
    script = await validate_script_access(request.script_id, current_user.id, db)

    # Initialize services
    intent_classifier = IntentClassifier()
    context_builder = ContextBuilder(db=db)
    ai_service = AIService()

    # 1. Classify intent
    intent = await intent_classifier.classify(
        message=request.message,
        hint=request.intent_hint
    )

    # 2. Get or create conversation
    if request.conversation_id:
        conversation = await db.get(ChatConversation, request.conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        # Create new conversation
        conversation = ChatConversation(
            script_id=request.script_id,
            user_id=current_user.id,
            title=request.message[:100],  # First message as title
            created_at=datetime.utcnow()
        )
        db.add(conversation)
        await db.commit()
        await db.refresh(conversation)

    # 3. Build context-aware prompt
    prompt = await context_builder.build_prompt(
        script_id=request.script_id,
        message=request.message,
        intent=intent,
        conversation_id=conversation.id,
        current_scene_id=request.current_scene_id,
        budget_tier=request.budget_tier or "standard"
    )

    # 4. Generate AI response
    response = await ai_service.generate_response(
        prompt=prompt,
        max_tokens=request.max_tokens or 600
    )

    # 5. Save conversation messages
    user_message = ChatMessage(
        conversation_id=conversation.id,
        role="user",
        content=request.message,
        created_at=datetime.utcnow()
    )
    db.add(user_message)

    assistant_message = ChatMessage(
        conversation_id=conversation.id,
        role="assistant",
        content=response["content"],
        created_at=datetime.utcnow()
    )
    db.add(assistant_message)

    await db.commit()

    # 6. Track token usage
    await track_token_usage(
        user_id=current_user.id,
        script_id=request.script_id,
        conversation_id=conversation.id,
        usage=response["usage"]
    )

    # 7. Check if conversation needs summary
    conversation_service = ConversationService(db=db)
    if await conversation_service.should_generate_summary(conversation.id):
        # Trigger background summary generation
        from app.workers import queue
        queue.enqueue(
            'generate_conversation_summary',
            conversation.id,
            priority='low'
        )

    return ChatMessageResponse(
        message=response["content"],
        conversation_id=conversation.id,
        usage=response["usage"],
        context_used={
            "intent": intent,
            "budget_tier": request.budget_tier or "standard",
            "tokens_breakdown": prompt["metadata"]["tokens_used"],
            "cache_hit": response["usage"]["cache_read_input_tokens"] > 0,
            "cache_savings_pct": round(
                100 * response["usage"]["cache_read_input_tokens"] /
                max(response["usage"]["input_tokens"], 1)
            )
        }
    )

@router.post("/message/stream")
async def chat_message_stream(
    request: ChatMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Streaming endpoint for real-time response generation.
    """
    # Same setup as chat_message...

    async def generate_stream():
        async for chunk in ai_service.generate_response(
            prompt=prompt,
            max_tokens=request.max_tokens or 600,
            stream=True
        ):
            yield f"data: {json.dumps(chunk)}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream"
    )

@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get conversation history.
    """
    conversation = await db.get(ChatConversation, conversation_id)

    if not conversation or conversation.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.created_at)
    )

    return {
        "conversation": conversation,
        "messages": messages.scalars().all()
    }
```

#### 3.3 Token Usage Tracking

```python
async def track_token_usage(
    user_id: UUID,
    script_id: UUID,
    conversation_id: UUID,
    usage: dict
):
    """
    Track token usage for analytics and billing.
    """
    # Calculate cost
    input_cost = (
        usage["input_tokens"] * 0.003 / 1000 +  # Full price input
        usage["cache_creation_input_tokens"] * 0.00375 / 1000 +  # Cache write (25% more)
        usage["cache_read_input_tokens"] * 0.0003 / 1000  # Cache read (90% discount)
    )
    output_cost = usage["output_tokens"] * 0.015 / 1000
    total_cost = input_cost + output_cost

    # Store usage record
    usage_record = TokenUsage(
        user_id=user_id,
        script_id=script_id,
        conversation_id=conversation_id,
        input_tokens=usage["input_tokens"],
        cache_creation_tokens=usage["cache_creation_input_tokens"],
        cache_read_tokens=usage["cache_read_input_tokens"],
        output_tokens=usage["output_tokens"],
        total_cost=total_cost,
        created_at=datetime.utcnow()
    )

    db.add(usage_record)
    await db.commit()

    # Update user's monthly usage (for quota tracking)
    # Implementation depends on subscription model
```

#### Tasks Checklist

- [ ] Update AI service to support Claude 3.5 Sonnet
- [ ] Implement streaming response generation
- [ ] Create chat message endpoint with full integration
- [ ] Build conversation history endpoint
- [ ] Implement token usage tracking
- [ ] Add error handling and retries
- [ ] Create API documentation
- [ ] Test end-to-end chat flow
- [ ] Performance testing with concurrent requests

**Deliverable:** Working chat endpoint with intelligent, context-aware responses

---

### Phase 4: Incremental Updates & Background Jobs (Week 10)

**Objective:** Keep artifacts fresh with minimal token cost

#### 4.1 RQ Setup

File: `backend/app/workers/__init__.py`

```python
from redis import Redis
from rq import Queue
from app.core.config import settings

# Connect to Redis
redis_conn = Redis.from_url(settings.REDIS_URL)

# Create job queues with priorities
queue_urgent = Queue('urgent', connection=redis_conn)
queue_normal = Queue('normal', connection=redis_conn)
queue_low = Queue('low', connection=redis_conn)

# Worker startup: rq worker urgent normal low
```

#### 4.2 Staleness Tracking

File: `backend/app/services/staleness_service.py`

```python
class StalenessService:
    """
    Track and manage artifact staleness.
    """

    # Thresholds for marking artifacts stale
    OUTLINE_REFRESH_THRESHOLD = 5  # scenes
    CHARACTER_REFRESH_THRESHOLD = 3  # scenes

    async def mark_scene_changed(self, scene: Scene):
        """
        Mark artifacts as potentially stale after scene change.

        Called on every scene save/update.
        """
        # Increment outline dirty count
        await self.db.execute(
            update(ScriptOutline)
            .where(ScriptOutline.script_id == scene.script_id)
            .values(dirty_scene_count=ScriptOutline.dirty_scene_count + 1)
        )

        # Check if outline should be marked stale
        outline = await self.db.scalar(
            select(ScriptOutline)
            .where(ScriptOutline.script_id == scene.script_id)
        )

        if outline and outline.dirty_scene_count >= self.OUTLINE_REFRESH_THRESHOLD:
            outline.is_stale = True
            await self.db.commit()

        # Increment character sheets for characters in this scene
        scene_chars = await self.db.execute(
            select(SceneCharacter.character_name)
            .where(SceneCharacter.scene_id == scene.id)
        )

        for char_name in scene_chars.scalars().all():
            await self.db.execute(
                update(CharacterSheet)
                .where(
                    CharacterSheet.script_id == scene.script_id,
                    CharacterSheet.character_name == char_name
                )
                .values(dirty_scene_count=CharacterSheet.dirty_scene_count + 1)
            )

            # Mark stale if threshold exceeded
            char_sheet = await self.db.scalar(
                select(CharacterSheet)
                .where(
                    CharacterSheet.script_id == scene.script_id,
                    CharacterSheet.character_name == char_name
                )
            )

            if char_sheet and char_sheet.dirty_scene_count >= self.CHARACTER_REFRESH_THRESHOLD:
                char_sheet.is_stale = True

        await self.db.commit()

    async def should_refresh_outline(self, script_id: UUID) -> bool:
        """
        Check if outline needs refresh.
        """
        outline = await self.db.scalar(
            select(ScriptOutline)
            .where(ScriptOutline.script_id == script_id)
        )

        if not outline:
            return False

        return outline.is_stale and outline.dirty_scene_count >= self.OUTLINE_REFRESH_THRESHOLD

    async def should_refresh_character(
        self,
        script_id: UUID,
        character_name: str
    ) -> bool:
        """
        Check if character sheet needs refresh.
        """
        char_sheet = await self.db.scalar(
            select(CharacterSheet)
            .where(
                CharacterSheet.script_id == script_id,
                CharacterSheet.character_name == character_name
            )
        )

        if not char_sheet:
            return False

        return char_sheet.is_stale and \
               char_sheet.dirty_scene_count >= self.CHARACTER_REFRESH_THRESHOLD
```

#### 4.3 Lazy Refresh Jobs

File: `backend/app/workers/refresh_jobs.py`

```python
from rq import get_current_job

async def refresh_script_outline(script_id: UUID):
    """
    Background job to refresh script outline.

    Triggered when outline is stale and user requests global context.
    """
    job = get_current_job()

    # Get database session
    async with AsyncSessionLocal() as db:
        ingestion_service = IngestionService(db=db)

        # Regenerate outline
        outline = await ingestion_service.generate_script_outline(script_id)

        # Save to database
        await db.execute(
            update(ScriptOutline)
            .where(ScriptOutline.script_id == script_id)
            .values(
                summary_text=outline.summary_text,
                tokens_estimate=outline.tokens_estimate,
                version=ScriptOutline.version + 1,
                is_stale=False,
                dirty_scene_count=0,
                last_generated_at=datetime.utcnow()
            )
        )

        await db.commit()

    return {"status": "success", "script_id": str(script_id)}

async def refresh_character_sheet(script_id: UUID, character_name: str):
    """
    Background job to refresh character sheet.
    """
    async with AsyncSessionLocal() as db:
        ingestion_service = IngestionService(db=db)

        # Regenerate character sheet
        sheet = await ingestion_service.generate_character_sheet(
            script_id=script_id,
            character_name=character_name
        )

        # Update database
        await db.execute(
            update(CharacterSheet)
            .where(
                CharacterSheet.script_id == script_id,
                CharacterSheet.character_name == character_name
            )
            .values(
                summary_text=sheet.summary_text,
                tokens_estimate=sheet.tokens_estimate,
                is_stale=False,
                dirty_scene_count=0,
                last_generated_at=datetime.utcnow()
            )
        )

        await db.commit()

    return {"status": "success", "character": character_name}

async def refresh_scene_summary(scene_id: UUID):
    """
    Background job to refresh scene summary after edit.
    """
    async with AsyncSessionLocal() as db:
        scene = await db.get(Scene, scene_id)

        if not scene:
            return {"status": "error", "message": "Scene not found"}

        ingestion_service = IngestionService(db=db)
        embedding_service = EmbeddingService()

        # Regenerate scene summary
        new_summary = await ingestion_service.generate_scene_summary(scene)

        # Check if we need to re-embed
        old_summary = await db.scalar(
            select(SceneSummary)
            .where(SceneSummary.scene_id == scene_id)
        )

        should_reembed = True
        if old_summary:
            should_reembed = await embedding_service.should_reembed(
                old_card=old_summary.summary_text,
                new_card=new_summary.summary_text
            )

        # Update summary
        if old_summary:
            old_summary.summary_text = new_summary.summary_text
            old_summary.tokens_estimate = new_summary.tokens_estimate
            old_summary.version += 1
            old_summary.last_generated_at = datetime.utcnow()
        else:
            db.add(new_summary)

        # Re-embed if needed
        if should_reembed:
            embedding_vector = await embedding_service.generate_scene_embedding(
                new_summary.summary_text
            )

            # Update or create embedding
            scene_embedding = await db.scalar(
                select(SceneEmbedding)
                .where(SceneEmbedding.scene_id == scene_id)
            )

            if scene_embedding:
                scene_embedding.embedding_vector = embedding_vector
                scene_embedding.last_generated_at = datetime.utcnow()
            else:
                scene_embedding = SceneEmbedding(
                    scene_id=scene_id,
                    embedding_vector=embedding_vector,
                    model_name="text-embedding-3-small"
                )
                db.add(scene_embedding)

        await db.commit()

        return {
            "status": "success",
            "reembedded": should_reembed
        }
```

#### 4.4 Webhook Integration

File: `backend/app/routers/scene_autosave_router.py` (existing file - add hooks)

```python
# In existing autosave endpoint, add staleness tracking

@router.patch("/api/scenes/{scene_id}")
async def autosave_scene(
    scene_id: UUID,
    request: SceneUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # ... existing autosave logic ...

    # After successful save, check for changes
    from app.services.staleness_service import StalenessService
    staleness_service = StalenessService(db=db)

    # Detect if scene changed
    changed = await scene_service.detect_scene_changes(scene, db)

    if changed:
        # Mark artifacts as potentially stale
        await staleness_service.mark_scene_changed(scene)

        # Optionally trigger background refresh
        # (debounced - only if last refresh was >5 minutes ago)
        from app.workers import queue_low
        queue_low.enqueue(
            'refresh_scene_summary',
            scene_id,
            job_timeout='5m'
        )

    # ... return response ...
```

#### Tasks Checklist

- [ ] Set up RQ with Redis connection
- [ ] Create worker queues (urgent, normal, low)
- [ ] Implement staleness tracking service
- [ ] Build background refresh jobs
- [ ] Add webhook integration to autosave
- [ ] Create job monitoring dashboard
- [ ] Test concurrent job processing
- [ ] Implement job retry logic

**Deliverable:** Incremental update system with background processing

---

### Phase 5: MCP Tools & Advanced Features (Weeks 11-12)

**Objective:** Add tool calling and advanced capabilities

#### 5.1 MCP Tool Definitions

File: `backend/app/services/mcp_tools.py`

```python
SCREENPLAY_TOOLS = [
    {
        "name": "get_scene",
        "description": "Get full text of a specific scene by index. Use this when you need the complete dialogue and action lines.",
        "input_schema": {
            "type": "object",
            "properties": {
                "script_id": {
                    "type": "string",
                    "description": "The UUID of the script"
                },
                "scene_index": {
                    "type": "integer",
                    "description": "The scene number (0-indexed)"
                }
            },
            "required": ["script_id", "scene_index"]
        }
    },
    {
        "name": "get_scene_context",
        "description": "Get a scene plus N neighboring scenes for narrative context. Better than multiple get_scene calls.",
        "input_schema": {
            "type": "object",
            "properties": {
                "script_id": {"type": "string"},
                "scene_index": {"type": "integer"},
                "neighbor_count": {
                    "type": "integer",
                    "default": 1,
                    "description": "How many scenes before and after to include"
                }
            },
            "required": ["script_id", "scene_index"]
        }
    },
    {
        "name": "get_character_scenes",
        "description": "Get all scenes where a specific character appears, with their arc timeline.",
        "input_schema": {
            "type": "object",
            "properties": {
                "script_id": {"type": "string"},
                "character_name": {
                    "type": "string",
                    "description": "Character name (case-sensitive)"
                },
                "include_full_text": {
                    "type": "boolean",
                    "default": False,
                    "description": "Whether to include full scene text or just summaries"
                }
            },
            "required": ["script_id", "character_name"]
        }
    },
    {
        "name": "search_script",
        "description": "Search scenes by keyword and semantic similarity with optional filters.",
        "input_schema": {
            "type": "object",
            "properties": {
                "script_id": {"type": "string"},
                "query": {
                    "type": "string",
                    "description": "Search query (keywords or semantic description)"
                },
                "filters": {
                    "type": "object",
                    "properties": {
                        "act": {"type": "integer"},
                        "characters": {
                            "type": "array",
                            "items": {"type": "string"}
                        },
                        "is_key_scene": {"type": "boolean"}
                    }
                },
                "limit": {
                    "type": "integer",
                    "default": 10,
                    "description": "Max results to return"
                }
            },
            "required": ["script_id", "query"]
        }
    },
    {
        "name": "analyze_pacing",
        "description": "Get quantitative pacing metrics (no LLM tokens used). Returns scene lengths, act distributions, dialogue ratios.",
        "input_schema": {
            "type": "object",
            "properties": {
                "script_id": {"type": "string"}
            },
            "required": ["script_id"]
        }
    },
    {
        "name": "get_plot_threads",
        "description": "Get plot threads and their associated scenes. Useful for tracking storylines.",
        "input_schema": {
            "type": "object",
            "properties": {
                "script_id": {"type": "string"},
                "thread_type": {
                    "type": "string",
                    "enum": ["character_arc", "plot", "subplot", "theme"],
                    "description": "Filter by thread type (optional)"
                }
            },
            "required": ["script_id"]
        }
    }
]
```

#### 5.2 Tool Execution

```python
class MCPToolExecutor:
    """
    Execute MCP tool calls from LLM.
    """

    async def execute_tool(
        self,
        tool_name: str,
        tool_input: dict,
        db: AsyncSession
    ) -> str:
        """
        Execute tool and return result as string.
        """
        if tool_name == "get_scene":
            return await self._get_scene(
                script_id=UUID(tool_input["script_id"]),
                scene_index=tool_input["scene_index"],
                db=db
            )

        elif tool_name == "get_scene_context":
            return await self._get_scene_context(
                script_id=UUID(tool_input["script_id"]),
                scene_index=tool_input["scene_index"],
                neighbor_count=tool_input.get("neighbor_count", 1),
                db=db
            )

        elif tool_name == "get_character_scenes":
            return await self._get_character_scenes(
                script_id=UUID(tool_input["script_id"]),
                character_name=tool_input["character_name"],
                include_full_text=tool_input.get("include_full_text", False),
                db=db
            )

        elif tool_name == "search_script":
            return await self._search_script(
                script_id=UUID(tool_input["script_id"]),
                query=tool_input["query"],
                filters=tool_input.get("filters"),
                limit=tool_input.get("limit", 10),
                db=db
            )

        elif tool_name == "analyze_pacing":
            return await self._analyze_pacing(
                script_id=UUID(tool_input["script_id"]),
                db=db
            )

        elif tool_name == "get_plot_threads":
            return await self._get_plot_threads(
                script_id=UUID(tool_input["script_id"]),
                thread_type=tool_input.get("thread_type"),
                db=db
            )

        else:
            return f"Unknown tool: {tool_name}"

    async def _get_scene(
        self,
        script_id: UUID,
        scene_index: int,
        db: AsyncSession
    ) -> str:
        """Get full scene text."""
        scene = await db.scalar(
            select(Scene)
            .where(
                Scene.script_id == script_id,
                Scene.scene_index == scene_index
            )
        )

        if not scene:
            return f"Scene {scene_index} not found"

        return f"SCENE {scene_index}: {scene.slugline}\n\n{scene.raw_text}"

    async def _analyze_pacing(
        self,
        script_id: UUID,
        db: AsyncSession
    ) -> str:
        """
        Quantitative pacing analysis (no LLM tokens).
        """
        scenes = await db.execute(
            select(Scene)
            .where(Scene.script_id == script_id)
            .order_by(Scene.scene_index)
        )
        scenes_list = scenes.scalars().all()

        # Calculate metrics
        total_scenes = len(scenes_list)

        # Scene length distribution
        scene_lengths = [len(s.raw_text.split('\n')) for s in scenes_list]
        avg_length = sum(scene_lengths) / max(total_scenes, 1)

        # Dialogue vs action ratio
        dialogue_lines = 0
        action_lines = 0

        for scene in scenes_list:
            for line in scene.raw_text.split('\n'):
                line_stripped = line.strip()
                # Simple heuristic: all-caps = character name, indented = dialogue
                if line_stripped.isupper() and len(line_stripped.split()) <= 3:
                    continue  # Character name
                elif line.startswith(' ' * 10):  # Dialogue indent
                    dialogue_lines += 1
                else:
                    action_lines += 1

        dialogue_ratio = dialogue_lines / max(dialogue_lines + action_lines, 1)

        # Act distribution
        act_distribution = {}
        for scene in scenes_list:
            act = scene.act_number or 1
            act_distribution[act] = act_distribution.get(act, 0) + 1

        # Format report
        report = f"""PACING ANALYSIS:

Total Scenes: {total_scenes}
Average Scene Length: {avg_length:.1f} lines

Dialogue vs Action:
- Dialogue: {dialogue_ratio*100:.1f}%
- Action: {(1-dialogue_ratio)*100:.1f}%

Act Distribution:
"""
        for act, count in sorted(act_distribution.items()):
            pct = 100 * count / total_scenes
            report += f"- Act {act}: {count} scenes ({pct:.1f}%)\n"

        return report
```

#### 5.3 Tool Calling Integration

Update `ai_service.py`:

```python
async def chat_with_tools(
    self,
    prompt: dict,
    tools: list[dict],
    max_tokens: int = 1000,
    max_iterations: int = 5
) -> dict:
    """
    Chat with tool calling support.

    Handles multi-turn tool use loops.
    """
    messages = prompt["messages"]
    system = prompt.get("system", [])

    for iteration in range(max_iterations):
        # Call LLM
        response = await self.anthropic_client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=max_tokens,
            system=system,
            messages=messages,
            tools=tools
        )

        # Check if LLM wants to use tools
        if response.stop_reason != "tool_use":
            # Final answer - return
            return {
                "content": response.content[0].text if response.content else "",
                "usage": response.usage,
                "tool_calls": iteration
            }

        # Execute tool calls
        tool_results = []

        for content_block in response.content:
            if content_block.type == "tool_use":
                # Execute tool
                tool_executor = MCPToolExecutor()
                result = await tool_executor.execute_tool(
                    tool_name=content_block.name,
                    tool_input=content_block.input,
                    db=self.db
                )

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": content_block.id,
                    "content": result
                })

        # Add assistant response and tool results to messages
        messages.append({
            "role": "assistant",
            "content": response.content
        })

        messages.append({
            "role": "user",
            "content": tool_results
        })

    # Max iterations reached
    return {
        "content": "I've reached the maximum number of tool calls. Please rephrase your question.",
        "usage": response.usage,
        "tool_calls": max_iterations
    }
```

#### Tasks Checklist

- [ ] Define MCP tool schemas
- [ ] Implement tool execution functions
- [ ] Add tool calling to AI service
- [ ] Test tool calling with sample queries
- [ ] Create pacing analysis function
- [ ] Build plot thread retrieval
- [ ] Add error handling for tool failures
- [ ] Document tool capabilities for users

**Deliverable:** Full MCP tool suite with advanced screenplay analysis

---

### Phase 6: Testing & Optimization (Weeks 13-14)

**Objective:** Ensure production readiness

#### 6.1 Testing Strategy

**Unit Tests:**
- Scene hash computation
- Intent classification accuracy
- Token counting precision
- Embedding generation
- Staleness tracking logic

**Integration Tests:**
- Full ingestion pipeline (empty → partial → analyzed)
- Context assembly with various intents
- Tool calling workflows
- Conversation context management

**End-to-End Tests:**
- Complete chat flow with real screenplay
- Cache hit rate validation
- Background job processing
- Concurrent user scenarios

**Performance Tests:**
- Response time under load
- Database query optimization
- Vector search performance
- Memory usage profiling

#### 6.2 Optimization Checklist

- [ ] Database query optimization (indexes, query plans)
- [ ] Cache hit rate >80% target
- [ ] Response time <2s for standard queries
- [ ] Token usage monitoring and alerts
- [ ] Error rate <1%
- [ ] Background job retry logic
- [ ] Rate limiting configuration
- [ ] Cost per user analysis

#### 6.3 Production Readiness

- [ ] Logging and monitoring setup
- [ ] Error tracking (Sentry)
- [ ] Performance metrics (Prometheus/Grafana)
- [ ] API documentation (OpenAPI/Swagger)
- [ ] User documentation and tutorials
- [ ] Backup and disaster recovery
- [ ] Security audit
- [ ] Load testing with production-like data

---

## Cost Projections

### Per-User Monthly Costs (Estimated)

**Assumptions:**
- 50 messages per month per active user
- Average script: 90 scenes
- Cache hit rate: 80%

**Ingestion (One-Time per Script):**
- Scene summaries: 90 scenes × 300 tokens × $0.003/1K = $0.08
- Embeddings: 90 scenes × 150 tokens × $0.00002/1K = $0.0003
- Outline: 1 × 800 tokens × $0.003/1K = $0.002
- Character sheets: 3 × 500 tokens × $0.003/1K = $0.005
- **Total ingestion: ~$0.09 per script**

**Chat (Monthly):**

First message (cache creation):
- Input: 1400 tokens × $0.003/1K = $0.004
- Output: 600 tokens × $0.015/1K = $0.009
- **Total: $0.013**

Subsequent messages (80% cache hit):
- Input (cached): 900 tokens × $0.0003/1K = $0.0003
- Input (new): 500 tokens × $0.003/1K = $0.0015
- Output: 600 tokens × $0.015/1K = $0.009
- **Total: $0.011**

**50 messages = 1 new + 49 cached:**
- $0.013 + (49 × $0.011) = $0.552

**Total per user per month: ~$0.64**

**With 10% margin: <$1 per user**

This enables profitable pricing at $10-20/month subscription tiers.

---

## Rollout Strategy

### Beta Phase (Week 15-16)

- [ ] Select 10-20 beta users
- [ ] Deploy to staging environment
- [ ] Monitor real-world usage patterns
- [ ] Collect feedback on accuracy and usefulness
- [ ] Iterate on prompts and retrieval strategies

### Production Launch (Week 17+)

- [ ] Gradual rollout (10% → 50% → 100%)
- [ ] Monitor cost and performance metrics
- [ ] A/B test different budget tiers
- [ ] Optimize based on user behavior

---

## Success Criteria

- ✅ **Response Quality:** 90%+ user satisfaction
- ✅ **Context Accuracy:** 95%+ correct scene/character references
- ✅ **Performance:** <2s response time (p95)
- ✅ **Cost Efficiency:** <$1 per active user per month
- ✅ **Cache Hit Rate:** >80%
- ✅ **Availability:** 99.9% uptime

---

## Appendix: Key Files & Locations

```
backend/
├── app/
│   ├── models/
│   │   ├── scene_summary.py
│   │   ├── script_outline.py
│   │   ├── character_sheet.py
│   │   ├── plot_thread.py
│   │   └── conversation_summary.py
│   ├── schemas/
│   │   └── ai_schemas.py
│   ├── services/
│   │   ├── ai_service.py (renamed from openai_service.py)
│   │   ├── ingestion_service.py (NEW)
│   │   ├── embedding_service.py (NEW)
│   │   ├── intent_classifier.py (NEW)
│   │   ├── retrieval_service.py (NEW)
│   │   ├── conversation_service.py (NEW)
│   │   ├── context_builder.py (NEW)
│   │   ├── staleness_service.py (NEW)
│   │   ├── script_state_service.py (NEW)
│   │   └── mcp_tools.py (NEW)
│   ├── routers/
│   │   └── ai_router.py (enhanced)
│   └── workers/
│       ├── __init__.py (NEW)
│       └── refresh_jobs.py (NEW)
├── alembic/
│   └── versions/
│       └── add_ai_tables.py (NEW migration)
└── requirements.txt (updated)
```

---

## Next Steps

1. **Review & Approve Plan:** Stakeholder sign-off on phases and timeline
2. **Start Phase 0:** Database schema design and migration creation
3. **Set Up Development Environment:** Install dependencies, configure Claude API
4. **Prototype Key Features:** Build minimal versions of ingestion and context assembly
5. **Iterate Based on Testing:** Adjust prompts and retrieval strategies

---

**Document Owner:** AI Team
**Last Updated:** 2025-11-30
**Status:** Ready for Implementation
