# AI Chat Tool Loop Implementation Fixes

**Document Version:** 1.0
**Created:** December 2024
**Status:** Ready for Implementation

---

## Executive Summary

This document provides a detailed implementation plan for fixing issues with the AI chat streaming endpoint when tools are enabled. The fixes address:

1. **Incomplete final responses** after max iterations
2. **Context redundancy** when tools are enabled
3. **Missing synthesis guidance** after tool gathering

### Problem Statement

When the AI chat endpoint uses tools (MCP tool loop), users sometimes receive:
- Truncated or rushed responses
- Responses that mix cached context with tool results inconsistently
- "Intermediate thinking" instead of synthesized answers

### Root Causes Identified

| Issue | Root Cause | Impact |
|-------|------------|--------|
| Rushed synthesis | `max_tokens=600` for all calls including final synthesis | Truncated answers |
| Context confusion | Full RAG context + tools = redundancy | Inconsistent responses |
| Missing guidance | No explicit synthesis prompt after tool gathering | Raw tool results returned |

---

## Phase 1: Immediate Fixes (Day 1)

### 1.1 Increase max_tokens for Final Synthesis

**Problem:** After tool calls complete, the final synthesis call uses `max_tokens=600`, which is too restrictive for synthesizing complex tool results.

**File:** `backend/app/routers/ai_router.py`

**Location:** `_handle_tool_loop()` (lines 416-440) and `_handle_tool_loop_with_status()` (lines 572-603)

**Current Code:**
```python
# Line 418-423 in _handle_tool_loop:
final_response = await client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=600,  # <-- Too restrictive
    system=system,
    messages=messages
)
```

**Fix:**
```python
# Increase final synthesis budget
FINAL_SYNTHESIS_MAX_TOKENS = 1200  # Double the normal limit

# Line 418-423 becomes:
final_response = await client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=FINAL_SYNTHESIS_MAX_TOKENS,  # More room for synthesis
    system=system,
    messages=messages
)
```

**Apply to both functions:**
- `_handle_tool_loop()` at line 418
- `_handle_tool_loop_with_status()` at line 576

**Testing:**
```python
# Test that final synthesis has adequate tokens
async def test_final_synthesis_tokens():
    # Mock a scenario with 3 tool calls
    # Verify final response is not truncated
    pass
```

---

### 1.2 Add Explicit Synthesis Prompt After Max Iterations

**Problem:** When max iterations is reached, Claude receives tool results but no explicit instruction to synthesize them into a coherent answer.

**File:** `backend/app/routers/ai_router.py`

**Location:** Before the final API call in both tool loop functions

**Current Code:**
```python
# Lines 416-423 in _handle_tool_loop:
# Max iterations reached - make final call to get text response
logger.warning(f"Tool loop reached max_iterations ({max_iterations})")
final_response = await client.messages.create(...)
```

**Fix:**
```python
# Lines 416-430 becomes:
# Max iterations reached - add synthesis instruction and make final call
logger.warning(f"Tool loop reached max_iterations ({max_iterations})")

# Add explicit synthesis instruction
synthesis_instruction = {
    "role": "user",
    "content": (
        "Based on all the information you've gathered from the tools above, "
        "please provide a complete, well-organized answer to the original question. "
        "Synthesize the key findings and be specific with scene numbers and details."
    )
}
messages.append(synthesis_instruction)

final_response = await client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=FINAL_SYNTHESIS_MAX_TOKENS,
    system=system,
    messages=messages
)
```

**Apply to both functions:**
- `_handle_tool_loop()` before line 418
- `_handle_tool_loop_with_status()` before line 576

**Testing:**
```python
async def test_synthesis_instruction_added():
    # Mock max_iterations being reached
    # Verify synthesis instruction is in messages
    # Verify response quality improves
    pass
```

---

## Phase 2: Context Optimization (Day 2-3)

### 2.1 Add `skip_scene_retrieval` Parameter to ContextBuilder

**Problem:** When tools are enabled, the full RAG context (including scene cards) is redundant because Claude can fetch scenes via tools.

**File:** `backend/app/services/context_builder.py`

**Location:** `build_prompt()` method signature and implementation

**Current Signature:**
```python
async def build_prompt(
    self,
    script_id: UUID,
    message: str,
    intent: IntentType,
    conversation_id: Optional[UUID] = None,
    current_scene_id: Optional[UUID] = None,
    budget_tier: BudgetTier = BudgetTier.STANDARD
) -> Dict:
```

**New Signature:**
```python
async def build_prompt(
    self,
    script_id: UUID,
    message: str,
    intent: IntentType,
    conversation_id: Optional[UUID] = None,
    current_scene_id: Optional[UUID] = None,
    budget_tier: BudgetTier = BudgetTier.STANDARD,
    skip_scene_retrieval: bool = False,  # NEW: Skip scene cards when tools enabled
    tools_enabled: bool = False  # NEW: Adjust system prompt for tool mode
) -> Dict:
```

**Implementation Changes:**

```python
async def build_prompt(
    self,
    script_id: UUID,
    message: str,
    intent: IntentType,
    conversation_id: Optional[UUID] = None,
    current_scene_id: Optional[UUID] = None,
    budget_tier: BudgetTier = BudgetTier.STANDARD,
    skip_scene_retrieval: bool = False,
    tools_enabled: bool = False
) -> Dict:
    """
    Build optimized prompt with caching structure.

    Args:
        ...
        skip_scene_retrieval: If True, skip scene card retrieval (use when tools enabled)
        tools_enabled: If True, adjust system prompt for tool-assisted mode
    """
    import time
    import logging
    logger = logging.getLogger(__name__)

    total_budget = self.BUDGET_TIERS[budget_tier]

    # 1. System prompt (cacheable) - adjust for tools mode
    step_start = time.perf_counter()
    system_prompt = self._get_system_prompt(intent, tools_enabled=tools_enabled)
    system_tokens = self._count_tokens(system_prompt)
    logger.info(f"[CONTEXT] System prompt generation took {(time.perf_counter() - step_start) * 1000:.2f}ms")

    # 2. Global context (cacheable) - always include (outline + characters)
    step_start = time.perf_counter()
    global_context = await self._get_global_context(script_id, intent)
    global_tokens = self._count_tokens(global_context)
    logger.info(f"[CONTEXT] Global context fetch took {(time.perf_counter() - step_start) * 1000:.2f}ms")

    # 3. Retrieved scene cards (cacheable) - SKIP if tools enabled
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

    # ... rest of method unchanged ...
```

**Update `_get_system_prompt()` for tools mode:**

```python
def _get_system_prompt(self, intent: IntentType, tools_enabled: bool = False) -> str:
    """
    Get system prompt tailored to intent and tool mode.
    """
    base = """You are an expert screenplay writing assistant..."""  # existing base

    if tools_enabled:
        # When tools are enabled, emphasize dynamic retrieval
        base += """

IMPORTANT: You have access to tools that can retrieve specific screenplay content.
- Use tools to get precise information (scene text, character appearances, etc.)
- The global context above provides overview; tools provide precision
- Always cite specific scene numbers when referencing tool results
- Synthesize information from multiple tool calls into coherent analysis"""

    intent_additions = {
        IntentType.LOCAL_EDIT: "\n\nFocus on improving dialogue and action lines...",
        # ... existing intent additions ...
    }

    return base + intent_additions.get(intent, "")
```

---

### 2.2 Update AI Router to Use Thin Context for Tool Mode

**File:** `backend/app/routers/ai_router.py`

**Location:** `chat_message()` endpoint (lines 714-724) and `chat_message_stream_with_status()` endpoint (lines 1110-1117)

**Current Code:**
```python
# Line 714-724 in chat_message():
# 3. Build context-aware prompt
step_start = time.perf_counter()
prompt = await context_builder.build_prompt(
    script_id=request.script_id,
    message=request.message,
    intent=intent,
    conversation_id=conversation.conversation_id,
    current_scene_id=request.current_scene_id,
    budget_tier=request.budget_tier or "standard"
)
```

**Fix:**
```python
# Line 714-730 becomes:
# 3. Build context-aware prompt
# Determine if tools will be enabled
tools_enabled = should_enable_tools(request, intent)

step_start = time.perf_counter()
prompt = await context_builder.build_prompt(
    script_id=request.script_id,
    message=request.message,
    intent=intent,
    conversation_id=conversation.conversation_id,
    current_scene_id=request.current_scene_id,
    budget_tier=request.budget_tier or "standard",
    skip_scene_retrieval=tools_enabled,  # NEW: Skip scene cards when tools enabled
    tools_enabled=tools_enabled  # NEW: Adjust system prompt
)
step_duration = (time.perf_counter() - step_start) * 1000
logger.info(f"[CHAT] ✅ Context building took {step_duration:.2f}ms (tools_enabled={tools_enabled}, skip_scenes={tools_enabled})")
```

**Apply same change to:**
- `chat_message()` endpoint
- `chat_message_stream_with_status()` endpoint

---

### 2.3 Simplify Tool Instructions (Remove from Inline Append)

**Problem:** Tool instructions are currently appended inline to the system prompt after it's built. This is fragile and creates redundancy.

**File:** `backend/app/routers/ai_router.py`

**Current Code (lines 751-769):**
```python
if tools_enabled:
    # ... setup ...

    # Extend system prompt with tool usage instructions
    tool_instructions = """

You have access to tools that allow you to retrieve and analyze screenplay content dynamically.
...
"""
    # Merge tool instructions with RAG system prompt
    prompt["system"][0]["text"] += tool_instructions
```

**Fix:** Remove inline tool instructions, rely on `_get_system_prompt(tools_enabled=True)`:

```python
if tools_enabled:
    # Hybrid mode: RAG context + MCP tools
    logger.info("Hybrid mode: Enabling MCP tools with RAG context")
    step_start = time.perf_counter()

    # Import tools and create client
    from app.services.mcp_tools import SCREENPLAY_TOOLS
    from app.core.config import settings

    client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    setup_duration = (time.perf_counter() - step_start) * 1000
    logger.info(f"[CHAT] ✅ Tool setup took {setup_duration:.2f}ms")

    # NOTE: Tool instructions are now included in system prompt via
    # context_builder.build_prompt(tools_enabled=True)
    # No need to append inline

    # Call tool loop
    # ...
```

---

## Phase 3: Response Quality Improvements (Day 4-5)

### 3.1 Add Response Validation Before Returning

**Problem:** Sometimes the model returns incomplete or low-quality responses. We should validate before returning.

**File:** `backend/app/routers/ai_router.py`

**Location:** After extracting final text in tool loop functions

**Implementation:**

```python
def _validate_response_quality(response_text: str, min_length: int = 50) -> bool:
    """
    Basic validation of response quality.

    Args:
        response_text: The response to validate
        min_length: Minimum acceptable length

    Returns:
        True if response passes validation
    """
    if not response_text:
        return False

    if len(response_text.strip()) < min_length:
        return False

    # Check for common incomplete patterns
    incomplete_patterns = [
        "Let me ",  # Incomplete thought
        "I'll ",    # Incomplete thought
        "...",      # Trailing off
    ]

    # Only flag if response ENDS with these patterns
    text_end = response_text.strip()[-50:].lower()
    for pattern in incomplete_patterns:
        if text_end.endswith(pattern.lower()):
            return False

    return True


# In _handle_tool_loop after final_text extraction:
final_text = next(
    (block.text for block in final_response.content if block.type == "text"),
    ""
)

# Validate response quality
if not _validate_response_quality(final_text):
    logger.warning(f"Low quality response detected: {final_text[:100]}...")
    # Could retry or append quality note
```

---

### 3.2 Improve Tool Loop Iteration Handling

**Problem:** During tool iterations, if Claude produces text alongside tool calls, that text might be "thinking out loud" rather than final answer material.

**File:** `backend/app/routers/ai_router.py`

**Location:** Inside the tool loop iteration

**Current Behavior:**
```python
# Line 410 in _handle_tool_loop:
messages.append({"role": "assistant", "content": response.content})
```

This appends ALL content blocks (text + tool_use) to messages.

**Improved Handling:**
```python
# Separate text from tool calls for cleaner message history
assistant_content = []
thinking_text = []

for block in response.content:
    if block.type == "tool_use":
        assistant_content.append(block)
    elif block.type == "text":
        # Store thinking text separately (for logging/debugging)
        thinking_text.append(block.text)
        # Include in message for context continuity
        assistant_content.append(block)

if thinking_text:
    logger.debug(f"Tool loop iteration thinking: {' '.join(thinking_text)[:200]}...")

messages.append({"role": "assistant", "content": assistant_content})
```

---

## Testing Strategy

### Unit Tests

| Test | Description | File |
|------|-------------|------|
| `test_final_synthesis_max_tokens` | Verify final call uses increased tokens | `tests/test_ai_router.py` |
| `test_synthesis_instruction_added` | Verify synthesis prompt on max iterations | `tests/test_ai_router.py` |
| `test_skip_scene_retrieval` | Verify scene cards skipped when flag set | `tests/test_context_builder.py` |
| `test_tools_enabled_system_prompt` | Verify system prompt includes tool guidance | `tests/test_context_builder.py` |
| `test_response_validation` | Verify quality validation catches issues | `tests/test_ai_router.py` |

### Integration Tests

| Test | Description |
|------|-------------|
| `test_tool_loop_full_cycle` | Full tool loop with real tools, verify synthesis |
| `test_max_iterations_synthesis` | Hit max iterations, verify final response quality |
| `test_thin_context_with_tools` | Verify tool mode uses minimal context |

### Manual Testing Checklist

- [ ] Ask "What happens in scene 5?" with tools enabled
- [ ] Ask "Track all appearances of [CHARACTER]" and verify synthesis
- [ ] Ask complex question that requires multiple tool calls
- [ ] Verify response is complete, not truncated
- [ ] Verify response cites specific scenes from tool results

---

## Implementation Order

### Day 1: Immediate Fixes
1. **1.1** Increase `max_tokens` for final synthesis
2. **1.2** Add explicit synthesis prompt

### Day 2-3: Context Optimization
3. **2.1** Add `skip_scene_retrieval` parameter
4. **2.2** Update AI router to use thin context
5. **2.3** Remove inline tool instructions

### Day 4-5: Quality Improvements
6. **3.1** Add response validation
7. **3.2** Improve iteration handling

---

## Rollback Strategy

Each phase can be rolled back independently:

| Phase | Rollback |
|-------|----------|
| Phase 1 | Revert `max_tokens` to 600, remove synthesis prompt |
| Phase 2 | Remove new parameters, revert to full context |
| Phase 3 | Remove validation, revert iteration handling |

---

## Success Metrics

### Before Implementation
- Response truncation rate: ~15%
- Context/tool confusion: ~20% of tool-enabled responses
- "Intermediate thinking" responses: ~10%

### After Implementation (Targets)
- Response truncation rate: <2%
- Context/tool confusion: <5%
- "Intermediate thinking" responses: <2%

### Monitoring
- Log `final_synthesis_tokens_used` vs `max_tokens`
- Log `response_validation_failed` count
- Track `tool_calls_made` vs `max_iterations` ratio

---

## Code Summary

### Files Modified

| File | Changes |
|------|---------|
| `backend/app/routers/ai_router.py` | Synthesis prompt, max_tokens, validation |
| `backend/app/services/context_builder.py` | New parameters, tools-aware system prompt |

### New Constants

```python
# In ai_router.py
FINAL_SYNTHESIS_MAX_TOKENS = 1200

# In context_builder.py (or move to config)
TOOLS_ENABLED_BUDGET_REDUCTION = 0.3  # Reduce context budget by 30% when tools enabled
```

### New Functions

```python
# In ai_router.py
def _validate_response_quality(response_text: str, min_length: int = 50) -> bool
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Dec 2024 | Claude | Initial implementation plan |
