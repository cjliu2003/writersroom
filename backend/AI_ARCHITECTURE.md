# WritersRoom AI System Architecture

## Part 1: Ingestion Job (Script Upload Flow)

When a user uploads an FDX file, here's what happens:

### Upload Endpoint: `POST /fdx/upload`

```
FDX File → Validation → Parse → Database Population → Background Job Enqueue
```

### Tables Populated at Upload Time

| Table | Data Stored |
|-------|-------------|
| **`scripts`** | `script_id`, `owner_id`, `title`, `content_blocks` (full script as JSONB), `scene_summaries` (empty dict initially) |
| **`scenes`** | `scene_id`, `script_id`, `position` (0-indexed), `scene_heading`, `content_blocks` (JSONB), `characters[]`, `themes[]`, `tokens`, `word_count`, `full_content`, `hash` |
| **`scene_characters`** | Junction table: `scene_id` + normalized `character_name` |

### Background Job: `analyze_script_full(script_id)`

Enqueued to Redis queue `'ai_ingestion'` with 30-minute timeout. This job populates:

| Table | Data Generated |
|-------|----------------|
| **`scene_embeddings`** | Vector embeddings for semantic search (pgvector) |
| **`character_sheets`** | AI-generated character summaries, appearance counts |
| **`plot_threads`** | Extracted plot threads and thematic elements |
| **`script_outlines`** | Act-level breakdown and story structure |

---

## Part 2: Chat Endpoint Deep Dive

### Endpoint: `POST /chat/message/stream-with-status`

Returns Server-Sent Events (SSE) with event types:
- `thinking` - AI processing status
- `status` - Tool execution updates
- `complete` - Final response with usage metrics
- `stream_end` - Conversation ID for persistence

---

### Step-by-Step Flow

#### Step 1: Request Parsing & Validation

```python
ChatMessageRequest:
  script_id: UUID           # Required
  conversation_id: UUID     # Optional (creates new if omitted)
  current_scene_id: UUID    # Optional (for scene-specific context)
  message: str              # User's question
  intent_hint: IntentType   # Optional override
  budget_tier: BudgetTier   # "quick" | "standard" | "deep"
  max_iterations: int       # Max tool calls
  enable_tools: bool        # Optional override
```

#### Step 2: Intent Classification

```
User provides hint → Use it
         ↓ No hint
Keyword matching (instant):
  • LOCAL_EDIT: "punch up", "rewrite", "change", "fix"
  • SCENE_FEEDBACK: "analyze scene", "feedback on", "review"
  • GLOBAL_QUESTION: "arc", "theme", "structure", "pacing"
  • BRAINSTORM: "ideas for", "what if", "alternatives"
         ↓ No match
LLM fallback (~100 tokens)
```

#### Step 3: Conversation Management

- **Existing conversation**: Load with `noload('*')` to prevent cascade loading
- **New conversation**: Create `ChatConversation` record with first 100 chars as title

#### Step 4: Tool Enablement Decision

```python
def should_enable_tools():
    if explicitly set → use that
    if analytical keywords ("analyze", "track", "find all", "search") → ENABLE
    if LOCAL_EDIT/SCENE_FEEDBACK with current_scene_id → DISABLE (RAG sufficient)
    if GLOBAL_QUESTION → ENABLE (needs search capability)
    default → ENABLE (conservative)
```

#### Step 5: Context Building

The `ContextBuilder` assembles the prompt in layers:

```
┌─────────────────────────────────────────────────────────┐
│  CACHED (ephemeral, 5-min TTL)                          │
├─────────────────────────────────────────────────────────┤
│  1. System Prompt (~200 tokens)                         │
│     - Expert screenplay assistant persona               │
│     - Tool usage instructions (if tools enabled)        │
│     - Scene indexing rules (0-based → 1-based display)  │
├─────────────────────────────────────────────────────────┤
│  2. Global Context (~400 tokens)                        │
│     - Script outline (act breakdown)                    │
│     - Top 3 character sheets (by appearance count)      │
├─────────────────────────────────────────────────────────┤
│  3. Scene Cards (~300 tokens) [SKIPPED if tools on]     │
│     - Brief descriptions of each scene                  │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│  NOT CACHED (fresh per request)                         │
├─────────────────────────────────────────────────────────┤
│  4. Conversation Context (~200 tokens)                  │
│     - Topic-aware history (NEW_TOPIC clears history)    │
│     - Sliding window of recent messages                 │
├─────────────────────────────────────────────────────────┤
│  5. Local Context (~200 tokens) [if LOCAL_EDIT]         │
│     - Current scene content                             │
├─────────────────────────────────────────────────────────┤
│  6. User Message (~100 tokens)                          │
└─────────────────────────────────────────────────────────┘
```

**Budget Tiers**:
- `quick`: 1,200 tokens
- `standard`: 5,000 tokens
- `deep`: 20,000 tokens

---

### Step 6: AI Generation (The Core Loop)

#### Path A: Tools Enabled (Hybrid Mode)

```
┌──────────────────────────────────────────────────────────────┐
│                    TOOL LOOP ITERATION                        │
├──────────────────────────────────────────────────────────────┤
│  Messages array grows each iteration:                         │
│                                                               │
│  Iteration 1:                                                 │
│    [system] + [global_context] + [user_message]              │
│    → Claude decides: tool_use OR end_turn                     │
│                                                               │
│  If tool_use:                                                 │
│    → Execute tools via MCPToolExecutor                        │
│    → Yield: {"type": "status", "tool": "get_scene"}          │
│    → Collect results                                          │
│    → REVERSE tool result order (recency bias fix)             │
│    → Append: assistant_response + tool_results                │
│                                                               │
│  Iteration 2-N:                                               │
│    [system] + [context] + [previous_messages] + [tool_results]│
│    → Claude sees ALL prior context + new tool data            │
│    → Repeat until stop_reason != "tool_use"                   │
│                                                               │
│  Max tokens truncation recovery (P0.3):                       │
│    If truncated AND recovery_attempts < 2:                    │
│      → Append: "Continue your tool planning."                 │
│      → Retry iteration                                        │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│                    SYNTHESIS PHASE                            │
├──────────────────────────────────────────────────────────────┤
│  ALWAYS triggered when tool results exist (P0.3 fix)          │
│                                                               │
│  Evidence Building:                                           │
│    1. Parse all tool results into EvidenceItems               │
│    2. Score by relevance to user question                     │
│    3. Sort by relevance (highest first)                       │
│    4. Truncate: max 10 items, 1,500 chars each, 8K total      │
│                                                               │
│  Synthesis Prompt:                                            │
│    "Answer this question: {user_question}                     │
│                                                               │
│     Using this evidence:                                      │
│     {ranked_evidence}                                         │
│                                                               │
│     {intent_specific_format_instructions}                     │
│                                                               │
│     CRITICAL: Start DIRECTLY with answer - no preamble..."    │
│                                                               │
│  Final call: Claude with 1,200 tokens (FINAL_SYNTHESIS)       │
└──────────────────────────────────────────────────────────────┘
```

#### Path B: Tools Disabled (RAG-Only Mode)

```
[system] + [cached_context] + [conversation] + [local_scene] + [message]
    → Claude (1,200 tokens)
    → Direct response, no tool loop
```

---

### Available Tools & What They Do

| Tool | Input | Returns | Use Case |
|------|-------|---------|----------|
| **`get_scene`** | `scene_index` (0-based) | Full scene text | "What happens in scene 5?" |
| **`get_scene_context`** | `scene_index`, `neighbor_count` | Scene + neighbors | "Show me scene 3 with context" |
| **`get_character_scenes`** | `character_name` (CAPS) | All appearances + arc | "Track SARAH through the script" |
| **`search_script`** | `query`, `filters`, `limit` | Semantic search results | "Find scenes about betrayal" |
| **`analyze_pacing`** | (none) | Metrics (no LLM cost) | "How's the pacing in Act 2?" |
| **`get_plot_threads`** | (none) | Plot threads & themes | "What are the main storylines?" |
| **`get_scene_relationships`** | `scene_index` | Scene connections | "How does this connect to others?" |

---

### Step 7-8: Persistence & Tracking

**Chat Messages Saved**:
```sql
INSERT INTO chat_messages (conversation_id, role, content)
VALUES
  (uuid, 'user', user_message),
  (uuid, 'assistant', final_response);
```

**Token Usage Tracked**:
```python
TokenUsage(
  input_tokens=...,
  cache_creation_input_tokens=...,  # 25% premium
  cache_read_input_tokens=...,      # 90% discount!
  output_tokens=...,
  total_cost=...  # Calculated at Claude pricing
)
```

---

### Multi-Turn Message Array Structure

Here's exactly what gets passed each iteration:

```python
# Iteration 1
messages = [
    {"role": "user", "content": [
        {"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": global_context, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": user_question}
    ]}
]

# After tool execution (Iteration 2+)
messages = [
    {"role": "user", "content": [...]},  # Original
    {"role": "assistant", "content": [   # Claude's tool request
        {"type": "tool_use", "id": "toolu_xxx", "name": "get_scene", "input": {"scene_index": 4}}
    ]},
    {"role": "user", "content": [        # Tool results (REVERSED order)
        {"type": "tool_result", "tool_use_id": "toolu_xxx", "content": "Scene 5 text..."}
    ]}
]

# Synthesis (final iteration)
messages = [
    ...all previous...,
    {"role": "user", "content": synthesis_prompt}  # Evidence + formatting instructions
]
```

---

## Key Optimizations

| Optimization | Impact |
|--------------|--------|
| **Prompt caching** | 90% cost reduction on cached tokens |
| **`noload('*')`** | Prevents loading 148 scenes per conversation |
| **Evidence truncation** | Max 8K chars prevents context overflow |
| **Tool result reversal** | Counteracts LLM recency bias |
| **Always synthesize** | Ensures consistent output formatting |
| **Haiku model** | Cheaper than Sonnet for tool loops |

---

## Critical Fixes Implemented

| Fix ID | Issue | Solution |
|--------|-------|----------|
| P0.1 | Only extracting first text block | Extract ALL text blocks via `_extract_all_text()` |
| P0.2 | RAG-only mode too terse | Increase max_tokens from 600→1,200 |
| P0.3 | Max tokens truncation mid-thought | Recovery loop with max 2 retry attempts |
| P1.1 | Batch tool performance | Add batch tools (get_scenes, get_scenes_context) |
| P1.2 | Recency bias in tool results | Evidence ranking + truncate to budget |
| P1.3 | Raw tool dump quality | Structured evidence building + synthesis prompt |
| TIER 2 | Recency bias in LLM | Reverse tool results order before appending |

---

## Database Schema Summary

### Script Ingestion Tables

| Table | Purpose |
|-------|---------|
| `scripts` | Main script record with metadata |
| `scenes` | Individual scenes with content blocks |
| `scene_characters` | Junction: scene ↔ character |
| `scene_embeddings` | Vector embeddings for semantic search |
| `character_sheets` | AI-generated character profiles |
| `plot_threads` | Extracted storylines and themes |
| `script_outlines` | Act-level structure breakdown |

### Chat Tables

| Table | Purpose |
|-------|---------|
| `chat_conversations` | Conversation sessions per script |
| `chat_messages` | Individual messages (user + assistant) |
| `token_usage` | Cost tracking per conversation |

---

## Architecture Summary

WritersRoom's AI system is a **sophisticated multi-phase architecture**:

1. **Ingestion**: FDX parser → scenes + characters → background analysis job (embeddings, outlines, character sheets)

2. **Intent Classification**: Keyword-first (fast) with LLM fallback (accurate)

3. **Context Assembly**: Cached global context + scene cards + conversation history, gated by intent & topic

4. **Hybrid Execution**:
   - Tools enabled → Multi-turn tool calling + evidence-based synthesis
   - Tools disabled → Direct RAG response

5. **Tool Loop**:
   - Iterative tool calling with status updates
   - Evidence building (ranking by relevance)
   - Structured synthesis (intent-specific formatting)

6. **Cost Optimization**:
   - Prompt caching (90% discount on cache hits)
   - Haiku model (cheaper)
   - Token budgeting
   - Evidence truncation

The system balances **accuracy** (tools for precise data retrieval) with **cost** (caching, budgeting) and **user experience** (streaming status, synthesis quality).
