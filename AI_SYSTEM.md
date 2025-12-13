````markdown
# WritersRoom AI Assistant – System Architecture

_Last updated: 2025-11-30_

This document describes the architecture for the WritersRoom AI assistant, focusing on:

- The different **parts of the AI system**
- What the **database** needs to store
- How **ingestion, updates, retrieval, and chat** are handled
- How we **control token usage** under a subscription model

---

## 1. Goals & Constraints

### Product Goals

- Provide a context-aware AI assistant that:
  - Understands the screenplay at **global** (theme, arcs, pacing) and **local** (scene/line) levels.
  - Supports brainstorming, rewriting, critique, and analysis.
- Scale to full feature-length screenplays (typically 80–120 pages, max 200).

### Token / Cost Constraints

- Users are on a **token-based subscription**.
- We **cannot** send full scripts to the LLM on every request.
- We want:
  - **One-time or occasional heavy analysis** per script.
  - **Cheap, predictable per-message** token usage.
  - Ability to offer **premium/high-cost analysis features** separately (e.g., full coverage).

---

## 2. High-Level System Components

1. **Frontend (Editor & Chat UI)**
   - Real-time collaborative script editor.
   - Chat pane for interacting with the AI assistant.
   - Keeps track of:
     - Current script, selection, caret position.
     - Current scene number.
     - Mode (editing, outlining, brainstorming, etc.).

2. **Backend API**
   - Authentication, authorization.
   - Script text storage & versioning.
   - Exposes endpoints for:
     - Script CRUD.
     - Scene parsing.
     - AI chat endpoint (orchestration).
     - Ingestion & analysis jobs (background workers).

3. **AI Orchestrator / Assistant Service**
   - Main “brain” that:
     - Receives chat requests + context (script_id, scene_id, user message).
     - Calls:
       - DB for script artifacts.
       - Vector store for retrieval.
       - LLM provider(s) for responses.
       - MCP / tools for multi-step workflows if needed.
   - Implements:
     - Intent classification (local edit vs global question vs brainstorming).
     - Context planning under token budgets.
     - Tool/agent logic.

4. **Ingestion & Analysis Pipeline**
   - Batch/background workers to:
     - Parse scripts into scenes.
     - Generate:
       - Global summary & act outline.
       - Character sheets.
       - Scene cards (short summaries).
       - Embeddings for scenes/cards.
     - Refresh these artifacts on updates (incrementally).

5. **Vector Store**
   - Stores embeddings for:
     - Scene cards (primary).
     - Possibly character-related embeddings, themes, etc.
   - Supports semantic search + filters (by script_id, character, act, etc.).

6. **LLM Providers**
   - One or more models for:
     - **Interactive chat** (long context, good general performance).
     - **Background analysis** (can be cheaper / smaller if appropriate).
   - Tool calling / MCP support for:
     - `get_scene`, `get_outline`, `search_script`, etc.

---

## 3. Script Lifecycle & States

We treat each script as living in one of three **states**:

1. `empty` – brand new or nearly empty.
2. `partial` – some content; not a full draft.
3. `analyzed` – enough content to justify full analysis / RAG.

### 3.1 Script State: `empty`

**Characteristics**

- New script or minimal content (e.g., < 1 full scene / < 2–3k characters).
- No scenes or only tiny fragments.

**Behavior**

- **No ingestion** yet:
  - No embeddings, no scene cards, no outline.
- Chat assistant uses:
  - User’s prompt.
  - Any selected text or small snippet from the editor.
- Focus on:
  - Loglines, worldbuilding, character concepts.
  - Rough beat/act outlines.
  - High-level guidance (genre, tone, etc.).

**State transition**

- When content exceeds a threshold (e.g., first full scene) **or** user manually clicks “Analyze script so far”:
  - Move from `empty` → `partial`.
  - Trigger initial partial ingestion job.

---

### 3.2 Script State: `partial`

**Characteristics**

- Some scenes exist, but not a full or stable draft.
- Examples:
  - 3–5 scenes.
  - 10–40 pages.

**Behavior**

- Run **partial ingestion**:
  - Parse scenes.
  - Generate:
    - Scene cards (short scene summaries).
    - Scene embeddings.
  - Optional: an early global summary (“Summary of script so far”).

- Global outline and character sheets:
  - Might not be fully accurate yet.
  - Can be generated only on-demand (when user asks global questions).

**State transition**

- When script is “large enough” (configurable, e.g., > 40–50 pages or N scenes):
  - Or user clicks “Run full analysis”.
  - Move from `partial` → `analyzed`.
  - Trigger **full analysis pipeline**.

---

### 3.3 Script State: `analyzed`

**Characteristics**

- Substantial content; likely full draft or close.
- Full artifacts exist.

**Behavior**

- Full ingestion artifacts available:
  - Global summary.
  - Act-by-act outline.
  - Character sheets (major characters).
  - Scene cards + embeddings for all scenes.
- AI chat uses:
  - Global + local context with tight token budgets.
  - RAG over scene cards & metadata.
- Background analysis updates run incrementally based on edits.

---

## 4. Data Model – Core Tables & Artifacts

> Note: Pseudocode-level DB schema. Adapt to actual DB (Postgres, etc.).

### 4.1 Script & Scene Tables

**`scripts`**

- `id`
- `user_id`
- `title`
- `raw_text` (optional if you store text elsewhere / as scenes)
- `state` (`empty` | `partial` | `analyzed`)
- `version` (incremented on major changes)
- `created_at`, `updated_at`

**`scenes`**

- `id`
- `script_id`
- `scene_index` (0, 1, 2, …)
- `act_number` (nullable; filled by analysis)
- `sequence_number` (nullable)
- `slugline` (e.g., `INT. APARTMENT – NIGHT`)
- `raw_text` (the full scene text)
- `hash` (hash of normalized `raw_text`)
- `last_updated`
- `is_key_scene` (bool; e.g., inciting incident, midpoint, climax)

### 4.2 Scene Artifacts

**`scene_summaries`**

- `scene_id`
- `summary_text` (short “scene card”, 3–10 lines)
- `tokens_estimate`
- `version`
- `last_generated_at`

**`scene_embeddings`**

- `scene_id`
- `embedding_vector` (vector type)
- `model_name`
- `last_generated_at`

### 4.3 Global Script Artifacts

**`script_outlines`**

- `script_id`
- `version`
- `summary_text` (global + act-by-act outline)
- `tokens_estimate`
- `is_stale` (bool)
- `dirty_scene_count` (int)
- `last_generated_at`

**`character_sheets`**

- `id`
- `script_id`
- `character_name`
- `summary_text` (wants/needs, arc, key beats)
- `tokens_estimate`
- `is_stale` (bool)
- `dirty_scene_count` (int)
- `last_generated_at`

### 4.4 Indexing Characters in Scenes

Optional but very useful:

**`scene_characters`**

- `scene_id`
- `character_name`

This supports queries like: “get all scenes where CHARACTER X appears”.

---

## 5. Ingestion & Update Pipeline

### 5.1 Initial Ingestion (transition to `partial` or `analyzed`)

Triggered by:

- Script crossing content threshold, or
- User clicking **“Analyze script”**.

Steps:

1. **Parse script into scenes**
   - Use FDX/Fountain parser → `scenes`.
   - Extract:
     - `slugline`
     - Raw text
     - Character appearances (for `scene_characters` table).

2. **Generate scene cards & embeddings** (for each scene)
   - Call LLM to produce concise `summary_text`.
   - Compute embedding (via separate embedding model).
   - Save to `scene_summaries` and `scene_embeddings`.

3. **Optional for partial; required for analyzed**:
   - Generate:
     - `script_outlines` (global + act-level summary).
     - `character_sheets` (for main characters).
   - Initialize:
     - `dirty_scene_count = 0` on script outline.
     - `dirty_scene_count = 0` on character sheets.

### 5.2 Incremental Updates on Edits

On each **save/autosave** (debounced):

1. Re-parse script → scenes (or incremental diff).
2. For each scene:
   - Compute normalized `hash`.
   - Compare with stored hash:
     - If new or changed:
       - Mark scene as **dirty**.
       - Update `raw_text`, `hash`, `last_updated`.
3. For each dirty scene:
   - Mark **global artifacts** as stale:
     - `script_outlines.dirty_scene_count++`
   - Mark **character sheets** for characters present in that scene:
     - `character_sheets.dirty_scene_count++` for each relevant character.

When to recompute scene artifacts:

- Option A: **lazy** – only recompute when that scene is needed for retrieval or the user interacts with it via the assistant.
- Option B: **background** – recompute after a debounce if edits are significant.

**When recomputing scene artifacts:**

- Generate updated `summary_text` for scene.
- Generate new embedding.
- Reset any “local dirty” flag on that scene.

---

## 6. Staleness & Refresh Strategy for Global Artifacts

We don’t want to recompute the global outline or all character sheets on every small change.

### 6.1 Staleness Rules

**Outline staleness:**

- `script_outlines.is_stale = true` if:
  - `dirty_scene_count >= OUTLINE_DIRTY_THRESHOLD`
  - or scenes added/removed/reordered (structural change).

**Character sheet staleness:**

- For each `character_sheets` row:
  - `is_stale = true` if:
    - `dirty_scene_count >= CHARACTER_DIRTY_THRESHOLD`
    - or one of their `is_key_scene` changed heavily.

Thresholds are configurable (e.g., 3–5 scenes).

### 6.2 Lazy Refresh

Global artifacts are recomputed **only when needed**, e.g.:

- User asks a global question:
  - “Is my protagonist’s arc satisfying?”
  - “How is the pacing of Act 2?”
- Assistant checks:
  - `script_outlines.is_stale`
  - `character_sheets.is_stale` for relevant characters
- If stale:
  - Run a refresh job to regenerate:
    - Outline (using latest scene summaries).
    - Character sheets (using scenes where they appear).
  - Reset `dirty_scene_count` and `is_stale`.

This keeps background token usage proportional to **meaningful edits + actual user queries**, not every keystroke.

---

## 7. AI Request Flow – From Chat Message to Response

### 7.1 Input to the AI Orchestrator

From the frontend, we send:

- `user_id`
- `script_id`
- `current_scene_id` (if applicable)
- `selection_range` (optional)
- `user_message`
- Optional `mode` hint from UI:
  - `"local_edit" | "scene_feedback" | "global_question" | "brainstorm"` 

### 7.2 Step 1: Intent Classification

Either:

- Use UI hints + simple heuristics, **or**
- Use a small LLM classifier to label the request.

Examples:

- “Punch up this dialogue” → `local_edit`
- “Does my protagonist have a clear arc?” → `global_question`
- “I want some ideas for how this scene could go” → `brainstorm`

### 7.3 Step 2: Context Planning with Token Budget

We define a **token budget** per request, e.g.:

- `INPUT_BUDGET = 1200 tokens`
- `OUTPUT_BUDGET = 600 tokens`

The context planner builds a prompt:

1. **Base system + instructions** (~100–200 tokens)
   - Model behavior, style, constraints.

2. **Global artifacts** (if available & needed)
   - Global summary + act outline (~200–400 tokens).
   - Character sheets for relevant characters (~100–200 tokens each).
   - If global artifacts are stale but still loaded, consider:
     - Using them with a brief disclaimer inside the system prompt (optional),
     - Or triggering a quick refresh if needed.

3. **Local script context**
   - Depends on intent:
     - `local_edit`:
       - Current scene full text.
       - Possibly previous/next scene.
     - `scene_feedback`:
       - 1–3 scenes around `current_scene_id`.
     - `global_question`:
       - Possibly no full scenes, just outline + a few key scenes’ scene cards.
     - `brainstorm`:
       - Usually small selection + outline or concept summary.

4. **RAG retrieval over scene cards**
   - Use vector search to get scene cards relevant to the query.
   - Optionally extend by:
     - Neighbor scenes in same sequence.
     - Scenes with same characters/plot threads.

5. **Budget trimming**
   - If estimated tokens > `INPUT_BUDGET`:
     - Prefer:
       - Shorter scene cards over full scenes.
       - Dropping distant scenes first.
       - Trimming character sheets to essentials.

Result: a compact, tailored prompt that rarely exceeds 1–2k tokens.

### 7.4 Step 3: LLM Call (with Tools/MCP if Needed)

We call the chosen LLM with:

- Prompt built above.
- Tool definitions (MCP server) for:
  - `get_outline`
  - `get_scene`
  - `search_script`
  - `get_character_sheet`
  - Potentially `apply_line_edits` (proposal only, user must confirm).

The LLM:

- May call tools if it needs more precise data (e.g., specific scenes).
- Generally should rely on already-assembled context for normal chat.

### 7.5 Step 4: Returning the Response

The orchestrator:

- Gets the model’s response (and any tool results folded into final text).
- Optionally post-processes:
  - For rewrites: returns diff/patch per line or per block.
  - For suggestions: tags sections of text with proposed changes.

Returns to frontend:

- `assistant_message`
- Optional structured data:
  - Edits, highlights, actionable items.

---

## 8. RAG Strategy for Screenplays

Rather than “plain top-k RAG,” we use **script-aware RAG**:

1. **Chunk by scenes**, not arbitrary tokens.
2. Store **scene cards** as primary retrieval units:
   - Short summaries → cheap to include.
3. Use **metadata filters**:
   - By `script_id`
   - Characters
   - Act/sequence
   - Tags (e.g., “climax”, “reversal”, “subplot-B”).

Retrieval steps:

1. Semantic search over `scene_embeddings` scoped to `script_id`.
2. Take top N scene cards (e.g., N=10–20).
3. Expand by structure:
   - For each card, optionally include:
     - Neighbor scenes in the same sequence.
     - Scenes flagged as pivotal (`is_key_scene`).
4. Decide, per budget:
   - Which scenes to include as **full text**.
   - Which to include only as **summaries**.

---

## 9. Token Accounting & Subscription Model

Two main token categories:

1. **Interactive tokens** (user-visible; main quota)
   - Request tokens: prompts the assistant sees per message.
   - Response tokens: assistant’s replies.

2. **Background/analysis tokens** (opaque to user but still important)
   - Ingestion:
     - Initial scene summaries + outline + character sheets.
   - Incremental updates:
     - Updated scene summaries.
     - Outline/character refresh.

Possible plan:

- Count **interactive tokens** directly against user’s monthly quota.
- Treat **background analysis tokens** as:
  - Part of product cost, with internal safeguards:
    - Limit max analyses per script per day.
    - Ask for confirmation on heavy re-analysis (“Re-run full coverage? This may use more of your credits.”).
  - Or expose as separate “analysis credits” depending on business strategy.

---

## 10. Tools / MCP API Sketch

Example tool interface the LLM can call (MCP or function calling):

```jsonc
// Examples (conceptual)
{
  "tools": [
    {
      "name": "get_scene",
      "description": "Return full text of a specific scene.",
      "parameters": {
        "type": "object",
        "properties": {
          "script_id": { "type": "string" },
          "scene_index": { "type": "number" }
        },
        "required": ["script_id", "scene_index"]
      }
    },
    {
      "name": "get_outline",
      "description": "Return global summary + act-by-act outline for the script.",
      "parameters": {
        "type": "object",
        "properties": {
          "script_id": { "type": "string" }
        },
        "required": ["script_id"]
      }
    },
    {
      "name": "get_character_sheet",
      "description": "Return character sheet for a given character.",
      "parameters": {
        "type": "object",
        "properties": {
          "script_id": { "type": "string" },
          "character_name": { "type": "string" }
        },
        "required": ["script_id", "character_name"]
      }
    },
    {
      "name": "search_script",
      "description": "Keyword + semantic search over scenes.",
      "parameters": {
        "type": "object",
        "properties": {
          "script_id": { "type": "string" },
          "query": { "type": "string" },
          "limit": { "type": "number" }
        },
        "required": ["script_id", "query"]
      }
    }
  ]
}
````

The **orchestrator** can:

* Use these tools directly in long-running workflows (coverage, setup/payoff maps).
* Or expose them to the LLM for single-turn decisions (e.g., grabbing one scene).

---

## 11. Example Prompt Assembly (Pseudo-Code)

```ts
async function buildPrompt(input: {
  userMessage: string;
  scriptId: string;
  currentSceneId?: string;
  modeHint?: "local_edit" | "scene_feedback" | "global_question" | "brainstorm";
}): Promise<Prompt> {
  const budget = 1200; // input tokens target

  const script = await getScript(scriptId);
  const state = script.state; // empty | partial | analyzed

  const base = [
    systemInstructions(),
    userGuidelines(), // e.g. "be concise", "respect formatting"
  ];

  // Fetch global artifacts if state === "analyzed"
  let outline, characterSheets = [];
  if (state === "analyzed") {
    outline = await getScriptOutline(scriptId);
    characterSheets = await getRelevantCharacterSheets(scriptId, input);
  }

  // Determine intent (use modeHint or classifier)
  const intent = inferIntent(input.userMessage, input.modeHint);

  // Collect local context
  const localScenes = await getLocalScenes(scriptId, input.currentSceneId, intent);

  // RAG retrieval (scene cards)
  const retrievedCards = await retrieveSceneCards(scriptId, input.userMessage, intent);

  // Merge into a structured prompt, trimming to budget
  const prompt = assembleWithBudget({
    base,
    outline,
    characterSheets,
    localScenes,
    retrievedCards,
    userMessage: input.userMessage,
    budget,
  });

  return prompt;
}
```

---

## 12. Future Extensions

* **Setup/Payoff Graph**

  * Track “promises” and “payoffs” across scenes.
  * Use LLM to build graph structures during analysis.

* **Character Arc Visualizer**

  * Use character sheets + key scenes to produce timeline of emotional/state changes.

* **Multi-script intelligence**

  * For TV series (multiple episodes):

    * Extend model to “season” level, with shared character sheets and show bible.

* **Improved diffing**

  * More fine-grained change detection beyond per-scene hash (e.g., per-block).

---

## 13. Summary

The core philosophy of this architecture:

> **“Do heavy thinking about the script once (or rarely), then use those artifacts to answer chat questions cheaply, intelligently, and in a screenplay-aware way.”**

Key ideas:

* **Script states** (`empty`, `partial`, `analyzed`) guide how much analysis to run.
* **Scenes & scene cards** are the primary units of structure and retrieval.
* **Global outline + character sheets** give a high-level “mental model” of the script.
* **Incremental, lazy updates** keep artifacts in sync without burning tokens on every small edit.
* A **token-bounded context planner** builds efficient prompts for each chat turn.
* Optional **tools/agents (MCP)** can orchestrate heavier workflows as explicit user actions instead of silent token bombs.

This gives you a system that’s:

* Screenplay-smart,
* Token-efficient,
* And flexible enough to support both casual AI chat and deep script analysis.

```

