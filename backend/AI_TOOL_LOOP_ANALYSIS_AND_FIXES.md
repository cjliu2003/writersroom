# AI Tool Loop Analysis and Implementation Plan

**Document Version:** 1.0
**Created:** December 2024
**Status:** Ready for Implementation

---

## Executive Summary

### Problem Statement
Users report that the AI chat assistant, when using tools to answer questions about specific scenes, sometimes:
1. Makes **redundant tool calls** (e.g., searching both index 4 AND index 5 for "Scene 5")
2. **Focuses on the wrong result** - specifically, the LAST tool result due to LLM recency bias
3. Returns responses that discuss the **wrong scene** (e.g., Scene 6 instead of Scene 5)

### Root Causes Identified
| Cause | Description | Severity |
|-------|-------------|----------|
| **Indexing Confusion** | Contradictory guidance between system prompt (1-based) and tool descriptions (0-indexed) | HIGH |
| **LLM Recency Bias** | Transformer attention mechanism weights recent tokens more heavily | HIGH |

### Solution Overview
A **tiered implementation approach** addressing both root causes:
- **Tier 1 (Immediate):** Prompt engineering fixes - low effort, immediate relief
- **Tier 2 (Short-term):** Architectural improvements per industry best practices
- **Tier 3 (Future):** Full evidence ranking pipeline

---

## Root Cause Analysis

### Issue 1: Scene Indexing Confusion

**Evidence:** User observed Claude made TWO tool calls for a single scene question:
- `get_scene(scene_index=4)` - correct (Scene 5 in 0-indexed)
- `get_scene(scene_index=5)` - incorrect (Scene 6)

**Cause:** Contradictory instructions across the system:

| Location | Instruction | Interpretation |
|----------|-------------|----------------|
| System Prompt (context_builder.py:324) | "Scene 1, Scene 2, etc. where Scene 1 is the first scene" | 1-based user-facing |
| Tool Description (mcp_tools.py:111) | "The scene number (0-indexed)" | Ambiguous |
| Tool Instructions (context_builder.py:349) | "get_scene: Get full scene text by index (0-based)" | 0-indexed |

**Result:** Claude hedges by searching BOTH interpretations.

### Issue 2: LLM Recency Bias

**Evidence:** When multiple tool results are returned, Claude's response focuses on the LAST result (Scene 6) rather than the FIRST result (Scene 5, which was correct).

**Cause:** Well-documented transformer architecture behavior:
- Attention mechanisms weight tokens by position
- More recent tokens (later in context) receive higher attention
- Without explicit guidance, models naturally favor recent information

**Reference:** This is a known failure mode in agentic systems (see AI_AGENT_NOTES.md in repository root).

---

## External Guidance Review

### AI_AGENT_NOTES.md Recommendations

The repository contains external guidance on this exact problem. Assessment of each recommendation:

| Recommendation | Description | Our Assessment |
|----------------|-------------|----------------|
| **#1 Evidence Selection Step** | Add intermediate LLM call to rank/compress results | HIGH impact, HIGH effort - Tier 3 |
| **#2 Re-rank by Relevance** | Order results by relevance score, not chronologically | HIGH impact, MEDIUM effort - Tier 2 |
| **#3 Citation Discipline** | Require model to reference multiple results | MEDIUM impact, LOW effort - Tier 1 |
| **#4 Cap/Normalize Outputs** | Truncate long outputs, use structured returns | MEDIUM impact, MEDIUM effort - Tier 2 |
| **#5 Re-anchor User Question** | Include user question verbatim before synthesis | HIGH impact, LOW effort - Tier 1 |
| **#6 Discard Irrelevant Results** | Allow filtering of low-relevance results | MEDIUM impact, HIGH effort - Tier 3 |

### Key Insight
**Recommendation #5 (Re-anchor User Question)** is HIGH-IMPACT and LOW-EFFORT. This should be incorporated into Tier 1 immediately.

---

## Validity Assessment

### Proposed Fixes Validity

#### Fix A: Tool Description Clarity
**Validity: HIGH**

- **Rationale:** Prevents the upstream problem entirely. If Claude only makes ONE correct call, recency bias is irrelevant.
- **Evidence Base:** User's specific bug report shows indexing confusion caused redundant calls.
- **Risk:** Low - purely descriptive change.

#### Fix B: System Prompt Indexing Guidance
**Validity: HIGH**

- **Rationale:** Reinforces Fix A, provides redundant clarity.
- **Evidence Base:** Multiple locations have inconsistent indexing language.
- **Risk:** Low - prompt text change only.

#### Fix C: Synthesis Instruction Updates
**Validity: MEDIUM**

- **Rationale:** Per AI_AGENT_NOTES.md, prompt-only fixes for recency bias are less effective than architectural changes.
- **Evidence Base:** Industry knowledge; no direct A/B testing in our system.
- **Risk:** Low effort, worth trying even if partial effectiveness.
- **Enhancement:** Incorporate recommendation #5 (re-anchor user question) to strengthen.

### Gap Analysis

| AI_AGENT_NOTES.md Recommendation | Addressed by Our Fixes? |
|----------------------------------|------------------------|
| #1 Evidence Selection Step | NO - Future (Tier 3) |
| #2 Re-rank by Relevance | NO - Future (Tier 2) |
| #3 Citation Discipline | YES - Tier 1 (synthesis instruction) |
| #4 Cap/Normalize Outputs | PARTIAL - Tools already return structured data |
| #5 Re-anchor User Question | YES - Adding to Tier 1 |
| #6 Discard Irrelevant | NO - Future (Tier 3) |

---

## Implementation Plan

### Tier 1: Immediate Fixes (Implement Now)

**Effort:** Low
**Impact:** High (addresses root cause + partial recency mitigation)
**Risk:** Low

#### Change 1: Tool Descriptions (mcp_tools.py)

**File:** `backend/app/services/mcp_tools.py`
**Lines:** 109-112, 123

**Current:**
```python
"scene_index": {
    "type": "integer",
    "description": "The scene number (0-indexed)"
}
```

**Proposed:**
```python
"scene_index": {
    "type": "integer",
    "description": "0-based index: Scene 1 = 0, Scene 5 = 4, Scene 10 = 9. Subtract 1 from the user's scene number."
}
```

#### Change 2: System Prompt Tool Instructions (context_builder.py)

**File:** `backend/app/services/context_builder.py`
**Lines:** 337-354

**Current:**
```python
"""
TOOL USAGE INSTRUCTIONS:
You have access to tools...

Available tools:
- get_scene: Get full scene text by index (0-based)
...
"""
```

**Proposed:**
```python
"""
TOOL USAGE INSTRUCTIONS:
You have access to tools that allow you to retrieve and analyze screenplay content dynamically.

SCENE INDEXING (CRITICAL): Tools use 0-based indexing. When a user mentions "Scene 5",
use scene_index=4 (subtract 1 from the scene number).
Examples: Scene 1 = index 0, Scene 5 = index 4, Scene 10 = index 9.

EFFICIENCY: If the user asks about a specific scene by number, ONE get_scene call
is sufficient. Only fetch multiple scenes if comparison or broader context is needed.

MULTIPLE RESULTS: When you receive multiple tool results, synthesize ALL of them equally.
Do NOT focus only on the most recent result - earlier results often contain key information.

When answering questions:
- Use tools to get accurate, up-to-date information
- Provide specific scene numbers, character names, and quotes
- The global context provides overview; tools provide precision
- After gathering information, synthesize into a clear answer

Available tools:
- get_scene: Get full scene text (scene_index is 0-based: Scene 5 = index 4)
- get_scene_context: Get scene plus surrounding scenes
- get_character_scenes: Track all appearances of a character
- search_script: Semantic/keyword search across the script
- analyze_pacing: Get quantitative pacing metrics
- get_plot_threads: Retrieve plot thread information
"""
```

#### Change 3: Synthesis Instruction (ai_router.py)

**File:** `backend/app/routers/ai_router.py`
**Lines:** 441-449 (and ~605 for streaming version)

**Current:**
```python
synthesis_instruction = {
    "role": "user",
    "content": (
        "Based on all the information you've gathered from the tools above, "
        "please provide a complete, well-organized answer to the original question. "
        "Synthesize the key findings and be specific with scene numbers and details. "
        "Do not mention the tools you used - just provide the final answer."
    )
}
```

**Proposed:** (Incorporates AI_AGENT_NOTES.md #5 - Re-anchor user question)
```python
# Note: user_question should be passed into the function or extracted from initial_messages
synthesis_instruction = {
    "role": "user",
    "content": (
        f"ORIGINAL QUESTION: {user_question}\n\n"
        "Based on ALL the tool results above, provide a complete answer. "
        "IMPORTANT: Give equal weight to EVERY tool result, not just the most recent. "
        "If multiple scenes were fetched, analyze EACH one - the FIRST result often "
        "contains the most relevant information for the user's original question. "
        "Be specific with scene numbers and details. Do not mention tools."
    )
}
```

**Implementation Note:** The `user_question` needs to be extracted from `initial_messages[0]` or passed as a parameter to the tool loop functions.

---

### Tier 2: Short-term Improvements ✅ IMPLEMENTED

**Effort:** Medium
**Impact:** High
**Status:** COMPLETED (December 2024)

#### Enhancement A: Structured Tool Output ✅

**File:** `backend/app/services/mcp_tools.py`
**Methods:** `_get_scene()`, `_get_scene_context()`

Tool responses now return structured data with clear scene identification:

```python
=== SCENE DATA ===
scene_number: 5  (user-facing, 1-based)
scene_index: 4  (internal, 0-based)
scene_heading: INT. BANK - DAY
==================

[Full scene content here]

--- KEY QUOTES ---
1. "First key dialogue line..."
2. "Second key dialogue line..."
```

For context queries, the target scene is explicitly marked:
```
[TARGET - THIS IS THE SCENE USER ASKED ABOUT]
```

#### Enhancement B: Result Ordering ✅

**File:** `backend/app/routers/ai_router.py`
**Functions:** `_handle_tool_loop()`, `_handle_tool_loop_with_status()`

Before passing to synthesis, results are reordered so the FIRST (chronologically) result appears LAST in context:

```python
# TIER 2 FIX: Reverse tool results order to exploit LLM recency bias
if tool_results and len(tool_results) > 1:
    tool_results = list(reversed(tool_results))
    logger.info(f"Reversed {len(tool_results)} tool results to counteract recency bias")
```

This exploits recency bias rather than fighting it - the first (most relevant) result now gets the most attention from the model.

---

### Tier 3: Future Enhancements

**Effort:** High
**Impact:** Highest

#### Enhancement: Evidence Selection Pipeline

Implement the full "Evidence Selection + Compression" pattern from AI_AGENT_NOTES.md:

```
1. Tools execute → raw results
2. NEW: Evidence Selector (LLM or heuristic)
   - Ranks results by relevance to user question
   - Extracts key snippets only
   - Discards/notes irrelevant results
3. Final synthesis from Selected Evidence only
```

**Architecture:**
```
User Question → Tool Calls → Raw Results → [Evidence Selector] → Ranked Evidence → Synthesis → Response
```

This requires an additional API call or sophisticated heuristic but provides the most robust solution.

---

## Testing Strategy

### Test Cases for Tier 1 Fixes

| Test | Input | Expected Behavior | Validates |
|------|-------|-------------------|-----------|
| Single scene query | "What's the dialogue in Scene 5?" | ONE tool call to index 4, response about Scene 5 | Fix A, B |
| Multiple scene comparison | "Compare scenes 3 and 7" | Two tool calls (index 2, 6), response about BOTH | Fix A, B, C |
| Recency bias check | Ask question that triggers 2+ tool calls | Response synthesizes ALL results, not just last | Fix C |

### Validation Checklist

- [ ] Tool call logs show correct single index for explicit scene queries
- [ ] Response discusses the scene the user asked about
- [ ] When multiple results, response references information from ALL results
- [ ] User question is re-stated in synthesis (visible in logs)

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Fixes don't fully solve recency bias | Medium | Medium | Tier 2/3 follow-up planned |
| Over-aggressive indexing instruction causes different bugs | Low | Low | Clear examples provided |
| Breaking change to existing behavior | Low | Medium | All changes are prompt text only |

---

## Rollback Plan

All Tier 1 changes are prompt engineering only. Rollback by reverting string changes in:
- `mcp_tools.py` - revert scene_index descriptions
- `context_builder.py` - revert tool instructions
- `ai_router.py` - revert synthesis instruction

No schema, API, or architectural changes required for Tier 1.

---

## Success Metrics

| Metric | Current State | Target | Measurement |
|--------|--------------|--------|-------------|
| Redundant tool calls for single scene | Common | Rare (<5%) | Log analysis |
| Wrong scene in response | Reported bug | Eliminated | User feedback |
| All results synthesized | Inconsistent | Consistent | Manual review |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Dec 2024 | Claude | Initial analysis and implementation plan |
| 1.1 | Dec 2024 | Claude | Tier 1 implemented: tool descriptions, system prompt, synthesis instruction |
| 1.2 | Dec 2024 | Claude | Tier 2 implemented: structured tool output, result ordering |
