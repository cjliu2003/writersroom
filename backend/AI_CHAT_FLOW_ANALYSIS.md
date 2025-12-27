# AI Chat Flow Analysis

This document provides a detailed breakdown of the AI chat endpoint flow, identifying all token limits and potential truncation points that could cause message cutoffs.

---

## Table of Contents

1. [Overview](#overview)
2. [Token Limits Summary](#token-limits-summary)
3. [Endpoint Flow](#endpoint-flow)
4. [Context Building](#context-building)
5. [Tool Loop Implementation](#tool-loop-implementation)
6. [RAG-Only Mode](#rag-only-mode)
7. [Potential Truncation Points](#potential-truncation-points)
8. [Recommendations](#recommendations)

---

## Overview

The AI chat system operates in two modes:

| Mode | Description | Token Limits |
|------|-------------|--------------|
| **Hybrid (Tools)** | RAG context + MCP tools for dynamic data retrieval | 600 per iteration, 1200 for synthesis |
| **RAG-Only** | Pre-fetched context without tools | 600 default (can override) |

**Model Used**: `claude-haiku-4-5` (consistent across all chat operations)

**Endpoint**: `POST /api/ai/chat/message` (defined in `app/routers/ai_router.py:775`)

---

## Token Limits Summary

### Critical Constants (ai_router.py)

```python
# Line 56 - Final synthesis after max iterations
FINAL_SYNTHESIS_MAX_TOKENS = 1200

# Line 59 - Each tool loop iteration
TOOL_LOOP_MAX_TOKENS = 600
```

### Context Builder Defaults (context_builder.py)

```python
# Line 285 - Default output budget
"max_tokens": 600

# Budget tiers for INPUT context (not output)
BUDGET_TIERS = {
    "quick": 1200,
    "standard": 5000,
    "deep": 20000
}
```

### RAG-Only Mode (ai_router.py:974)

```python
response = await ai_service.generate_response(
    prompt=prompt,
    max_tokens=request.max_tokens or 600  # Falls back to 600 if not specified
)
```

---

## Endpoint Flow

### Step-by-Step Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. POST /api/ai/chat/message                                    │
│    - Validates script access                                    │
│    - Initializes IntentClassifier, ContextBuilder, AIService   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Intent Classification                                        │
│    - Heuristic patterns first                                   │
│    - LLM fallback if uncertain                                  │
│    - Types: LOCAL_EDIT, SCENE_FEEDBACK, GLOBAL_QUESTION,       │
│             BRAINSTORM, NARRATIVE_ANALYSIS                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Conversation Handling                                        │
│    - Get existing or create new ChatConversation                │
│    - Uses noload('*') to prevent eager loading cascades        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Tool Enablement Decision (should_enable_tools)               │
│    - Always TRUE for: NARRATIVE_ANALYSIS, GLOBAL_QUESTION      │
│    - FALSE if: force_no_tools=True or quick budget tier        │
│    - Default: TRUE (enables MCP tools)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Context Building (context_builder.build_prompt)              │
│    - System prompt with tool instructions (if tools_enabled)   │
│    - Global context (outline + character sheets)                │
│    - Scene cards (skipped if tools_enabled)                     │
│    - Conversation history (sliding window + summaries)          │
│    - User message                                               │
│    - Cache control blocks for prompt caching                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────┴─────────┐
                    │                   │
              tools_enabled?        !tools_enabled?
                    │                   │
                    ▼                   ▼
        ┌───────────────────┐  ┌───────────────────┐
        │ 6A. HYBRID MODE   │  │ 6B. RAG-ONLY MODE │
        │   (Tool Loop)     │  │   (Direct Call)   │
        └───────────────────┘  └───────────────────┘
                    │                   │
                    ▼                   ▼
        ┌───────────────────┐  ┌───────────────────┐
        │ _handle_tool_loop │  │ ai_service.       │
        │ max_iterations=5  │  │ generate_response │
        │ (default)         │  │ max_tokens=600    │
        └───────────────────┘  └───────────────────┘
                    │                   │
                    └─────────┬─────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. Save Messages & Track Usage                                  │
│    - Save user + assistant messages to chat_messages table     │
│    - Track token usage                                          │
│    - Check if summary generation needed                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 8. Return ChatMessageResponse                                   │
│    - message: AI response text                                  │
│    - conversation_id                                            │
│    - usage: token statistics                                    │
│    - context_used: metadata about context building              │
│    - tool_metadata: (if tools used) tools_used, tool_calls     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Context Building

### System Prompt Structure (context_builder.py:309-371)

The system prompt is tailored based on intent and tool mode:

```python
base = """You are an expert screenplay writing assistant...

Key guidelines:
- Respect screenplay formatting conventions
- When referencing scenes, use standard numbering (Scene 1, Scene 2, etc.)
- Focus on showing not telling
- Maintain character voice consistency
- Consider pacing and visual storytelling
- Provide specific, actionable feedback

IMPORTANT: When conversation history is provided, it is for CONTEXT ONLY..."""
```

**When tools are enabled**, additional instructions are appended:

```python
"""
TOOL USAGE INSTRUCTIONS:
You have access to tools that allow you to retrieve and analyze screenplay content dynamically.

SCENE INDEXING (CRITICAL): Tools use 0-based indexing. When a user mentions "Scene 5",
use scene_index=4 (subtract 1 from the scene number).

EFFICIENCY: If the user asks about a specific scene by number, ONE get_scene call
is sufficient. Only fetch multiple scenes if comparison or broader context is needed.

MULTIPLE RESULTS: When you receive multiple tool results, synthesize ALL of them equally.
Do NOT focus only on the most recent result - earlier results often contain key information.

Available tools:
- get_scene: Get full scene text (scene_index is 0-based)
- get_scene_context: Get scene plus surrounding scenes for context
- get_character_scenes: Track all appearances of a character
- search_script: Semantic/keyword search across the script
- analyze_pacing: Get quantitative pacing metrics
- get_plot_threads: Retrieve plot thread and thematic information
"""
```

### Context Layers

| Layer | Source | Cache Control |
|-------|--------|---------------|
| System Prompt | `_get_system_prompt()` | `cache_control: {"type": "ephemeral"}` |
| Global Context | Script outline + top 3 character sheets | Part of system block |
| Scene Cards | Summaries of relevant scenes | Skipped if tools enabled |
| Conversation History | Sliding window (last N messages) | Regular messages |
| User Message | Current user input | Regular message |

### Prompt Caching

The system uses Anthropic's prompt caching with `cache_control: {"type": "ephemeral"}`:

```python
"system": [
    {
        "type": "text",
        "text": system_prompt,
        "cache_control": {"type": "ephemeral"}
    }
]
```

This enables ~90% cost reduction on repeated calls with similar prompts.

---

## Tool Loop Implementation

### Location: `ai_router.py:324-531`

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Tool Loop Entry                                                 │
│ - messages = initial_messages.copy()                           │
│ - Initialize MCPToolExecutor with db and script_id             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
            ┌─────────────────────────────────────┐
            │ For iteration in range(max_iterations) │
            │ Default max_iterations = 5              │
            └─────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Call Claude API                                                 │
│   model: "claude-haiku-4-5"                                    │
│   max_tokens: TOOL_LOOP_MAX_TOKENS (600)  ⚠️ TRUNCATION POINT  │
│   system: system prompt blocks                                  │
│   messages: conversation history                                │
│   tools: SCREENPLAY_TOOLS (7 tools)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────┴─────────┐
                    │                   │
            stop_reason ==         stop_reason !=
            "tool_use"?            "tool_use"?
                    │                   │
                    ▼                   ▼
        ┌───────────────────┐  ┌───────────────────┐
        │ Execute Tools     │  │ Return final_text │
        │ - get_scene       │  │ - Extract text    │
        │ - search_script   │  │   from content    │
        │ - get_character   │  │ - Log stop_reason │
        │   _scenes         │  │   (may be         │
        │ - etc.            │  │   "max_tokens")   │
        └───────────────────┘  └───────────────────┘
                    │                   │
                    ▼                   │
        ┌───────────────────┐          │
        │ Append to msgs:   │          │
        │ 1. Assistant msg  │          │
        │ 2. Tool results   │          │
        │    (reversed for  │          │
        │     recency bias) │          │
        └───────────────────┘          │
                    │                   │
                    ▼                   │
            Continue loop              │
                    │                   │
                    ▼                   │
        ┌───────────────────┐          │
        │ Max iterations    │          │
        │ reached?          │          │
        └───────────────────┘          │
                    │                   │
              YES   │                   │
                    ▼                   │
┌───────────────────────────────────────┴─────────────────────────┐
│ Final Synthesis Call                                            │
│                                                                 │
│ Add synthesis instruction:                                      │
│ "ORIGINAL QUESTION: {user_question}                            │
│  Based on ALL the tool results above, provide a complete       │
│  answer... Give equal weight to EVERY tool result..."          │
│                                                                 │
│ Call Claude API:                                                │
│   max_tokens: FINAL_SYNTHESIS_MAX_TOKENS (1200)  ⚠️ TRUNCATION │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Return (final_text, total_usage, tool_metadata)                 │
└─────────────────────────────────────────────────────────────────┘
```

### Available MCP Tools (mcp_tools.py)

| Tool | Purpose | Input Parameters |
|------|---------|------------------|
| `get_scene` | Get full scene text | `scene_index` (0-based) |
| `get_scene_context` | Scene + surrounding context | `scene_index`, `window_size` |
| `get_character_scenes` | All appearances of a character | `character_name` |
| `search_script` | Semantic/keyword search | `query`, `limit` |
| `analyze_pacing` | Quantitative pacing metrics | (none) |
| `get_plot_threads` | Plot thread information | (none) |
| `get_scene_relationships` | Scene relationship data | (none) |

### Stop Reason Handling (ai_router.py:381-401)

```python
# CRITICAL: Check for ALL non-tool cases
if response.stop_reason != "tool_use":
    final_text = next(
        (block.text for block in response.content if block.type == "text"),
        ""
    )
    if response.stop_reason == "max_tokens":
        logger.warning(f"Tool loop response truncated (max_tokens)")

    return final_text, total_usage, ToolCallMetadata(...)
```

---

## RAG-Only Mode

### When Triggered

- `tools_enabled = False` (based on `should_enable_tools()` logic)
- Quick budget tier
- `force_no_tools=True` in request

### Flow (ai_router.py:966-982)

```python
response = await ai_service.generate_response(
    prompt=prompt,
    max_tokens=request.max_tokens or 600  # ⚠️ DEFAULT IS 600!
)
```

### AIService.generate_response (ai_service.py:37-85)

```python
async def generate_response(
    self,
    prompt: dict,
    max_tokens: int = 600,  # ⚠️ DEFAULT
    stream: bool = False
) -> Dict:
    response = await self.anthropic_client.messages.create(
        model=prompt.get("model", "claude-haiku-4-5"),
        max_tokens=max_tokens,  # ⚠️ TRUNCATION POINT
        system=prompt.get("system", []),
        messages=prompt["messages"]
    )

    return {
        "content": response.content[0].text,
        "usage": {...},
        "stop_reason": response.stop_reason  # Could be "max_tokens"
    }
```

---

## Potential Truncation Points

### 1. Tool Loop Iterations (HIGH RISK)

**Location**: `ai_router.py:367-373`

```python
response = await client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=TOOL_LOOP_MAX_TOKENS,  # 600 tokens
    ...
)
```

**Risk**: Each intermediate response during tool calling is limited to 600 tokens. If the model tries to provide a partial answer + tool calls, it may truncate.

**Symptoms**:
- `stop_reason: "max_tokens"` logged as warning
- Partial responses returned without completing the thought

### 2. Final Synthesis Call (MEDIUM RISK)

**Location**: `ai_router.py:504-508`

```python
final_response = await client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=FINAL_SYNTHESIS_MAX_TOKENS,  # 1200 tokens
    ...
)
```

**Risk**: After gathering all tool results, the final synthesis is limited to 1200 tokens. Complex questions with multiple tool results may generate responses that exceed this.

**Symptoms**:
- Final response cuts off mid-sentence
- Missing information that tools provided but wasn't synthesized

### 3. RAG-Only Mode (HIGH RISK)

**Location**: `ai_router.py:974`

```python
response = await ai_service.generate_response(
    prompt=prompt,
    max_tokens=request.max_tokens or 600  # DEFAULT IS 600!
)
```

**Risk**: If the client doesn't specify `max_tokens` in the request, it defaults to 600 tokens - the same as a single tool iteration.

**Symptoms**:
- Short, truncated responses for detailed questions
- `stop_reason: "max_tokens"` in usage data

### 4. Context Builder Default (LOW RISK - Not Actually Used)

**Location**: `context_builder.py:285`

```python
"max_tokens": 600,  # Output budget
```

**Note**: This is in the returned metadata but NOT used by the caller. The caller uses `TOOL_LOOP_MAX_TOKENS` or `request.max_tokens` directly.

---

## Token Flow Visualization

```
┌─────────────────────────────────────────────────────────────────┐
│                      HYBRID MODE FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Iteration 1:  INPUT → [System + History + User] → OUTPUT (600)│
│                        └─ If stop_reason="tool_use" ──────────┐│
│                                                                ││
│  Tool Execution: get_scene → returns scene content             ││
│                                                                ││
│  Iteration 2:  INPUT → [...+ Tool Results] → OUTPUT (600)     ││
│                        └─ If stop_reason="tool_use" ──────────┐││
│                                                               │││
│  Tool Execution: search_script → returns matches             │││
│                                                               │││
│  ...continues until stop_reason != "tool_use"...             │││
│                                                               │││
│  Final Synthesis: INPUT → [All context] → OUTPUT (1200) ←────┘││
│                                                     ↑          ││
│                                                     │          ││
│                                        ⚠️ TRUNCATION POINT      ││
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      RAG-ONLY MODE FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Single Call:  INPUT → [System + Context + History + User]     │
│                        ↓                                        │
│                OUTPUT (request.max_tokens OR 600)               │
│                        ↑                                        │
│            ⚠️ TRUNCATION POINT (if default 600)                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Recommendations

### Immediate Fixes

1. **Increase RAG-Only Default**

   Location: `ai_router.py:974`
   ```python
   # BEFORE
   max_tokens=request.max_tokens or 600

   # AFTER
   max_tokens=request.max_tokens or 1200
   ```

2. **Increase Tool Loop Iteration Limit**

   Location: `ai_router.py:59`
   ```python
   # BEFORE
   TOOL_LOOP_MAX_TOKENS = 600

   # AFTER
   TOOL_LOOP_MAX_TOKENS = 800
   ```

3. **Increase Final Synthesis Limit**

   Location: `ai_router.py:56`
   ```python
   # BEFORE
   FINAL_SYNTHESIS_MAX_TOKENS = 1200

   # AFTER
   FINAL_SYNTHESIS_MAX_TOKENS = 2000
   ```

### Client-Side Improvements

4. **Pass explicit max_tokens in requests**

   Frontend should specify `max_tokens: 1500` or higher for detailed questions.

5. **Handle truncation in UI**

   If `stop_reason: "max_tokens"` is returned, show a "Continue" button or warning.

### Monitoring

6. **Add truncation alerting**

   Log and alert when `stop_reason == "max_tokens"` occurs frequently.

7. **Track output token usage**

   Monitor `output_tokens` vs `max_tokens` ratio to identify near-truncation cases.

---

## Quick Reference

| Mode | Location | Default max_tokens | Recommended |
|------|----------|-------------------|-------------|
| Tool Loop Iteration | ai_router.py:369 | 600 | 800-1000 |
| Final Synthesis | ai_router.py:506 | 1200 | 2000 |
| RAG-Only | ai_router.py:974 | 600 | 1200-1500 |

---

## Files Referenced

| File | Key Lines | Purpose |
|------|-----------|---------|
| `app/routers/ai_router.py` | 56-59 | Token constants |
| `app/routers/ai_router.py` | 324-531 | Tool loop implementation |
| `app/routers/ai_router.py` | 775-1063 | Main chat endpoint |
| `app/services/context_builder.py` | 280-307 | Prompt building |
| `app/services/context_builder.py` | 309-371 | System prompt |
| `app/services/ai_service.py` | 37-85 | generate_response method |
| `app/services/mcp_tools.py` | Full file | Tool definitions |
