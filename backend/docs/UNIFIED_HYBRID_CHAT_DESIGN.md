# Unified Hybrid Chat Endpoint Design

## Executive Summary

Design specification for combining RAG (Retrieval-Augmented Generation) context building with MCP (Model Context Protocol) tools into a single, intelligent chat endpoint that provides Claude with both comprehensive cached context AND precise on-demand retrieval capabilities.

**Status**: Design Complete
**Target**: Phase 6 - Unified Intelligence
**Approach**: Extend existing `/api/ai/chat/message` with optional tool support

---

## Problem Statement

### Current State
Two separate, non-integrated chat systems exist:

1. **RAG Endpoint** (`/api/ai/chat/message`)
   - ✅ Rich pre-assembled context (outline, characters, scenes)
   - ✅ Claude prompt caching (90% cost reduction)
   - ✅ Intent classification and context optimization
   - ✅ Currently used by frontend
   - ❌ No precise retrieval capabilities
   - ❌ Limited to cached scene cards

2. **MCP Tools Endpoint** (`/api/ai/chat/message/tools`)
   - ✅ 6 screenplay-specific tools for precise retrieval
   - ✅ Multi-turn tool calling loops
   - ✅ Analytical capabilities (pacing, plot threads)
   - ❌ Never called by frontend (unused)
   - ❌ No context pre-assembly or caching
   - ❌ Higher latency and cost without caching

### The Gap
Frontend only exposes RAG endpoint, leaving powerful tool capabilities completely unused. Users cannot access analytical features like "analyze pacing" or "track character X through all scenes".

### Vision
Create a unified endpoint that gives Claude BOTH:
- **Rich Context**: Pre-assembled, cached screenplay understanding
- **Precise Tools**: On-demand retrieval for specific analysis

Claude decides when to use cached context vs. fresh tool calls, optimizing for both accuracy and cost.

---

## Architecture Design

### Core Principle
**Extend, Don't Replace**: Build on RAG's proven context-building architecture, adding tools as an enhancement rather than creating a separate system.

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                  Unified Chat Endpoint                       │
│               /api/ai/chat/message                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │  Intent Classification   │
              │  (existing RAG logic)    │
              └─────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │   ContextBuilder         │
              │   • Global context       │
              │   • Scene cards          │
              │   • Conversation history │
              │   • Cached blocks        │
              └─────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │  System Prompt Merger   │
              │  • RAG guidance +       │
              │  • Tool instructions    │
              └─────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │   Claude API Call       │
              │   • Context (cached)    │
              │   • Tools (enabled)     │
              └─────────────────────────┘
                            │
                ┌───────────┴───────────┐
                │                       │
                ▼                       ▼
         ┌──────────┐            ┌──────────┐
         │ end_turn │            │tool_use  │
         │  (done)  │            │  (loop)  │
         └──────────┘            └──────────┘
                                      │
                                      ▼
                            ┌──────────────────┐
                            │ MCPToolExecutor  │
                            │ • Execute tools  │
                            │ • Error handling │
                            └──────────────────┘
                                      │
                                      ▼
                            ┌──────────────────┐
                            │  Continue Loop   │
                            │  with results    │
                            └──────────────────┘
```

---

## API Schema Design

### Request Schema Enhancement

**Approach**: Extend existing `ChatMessageRequest` with optional tool support.

```python
class ChatMessageRequest(BaseModel):
    """
    Enhanced request schema supporting both RAG and MCP tools.

    Backwards compatible: existing clients work unchanged.
    New clients can opt-in to tools with enable_tools=True.
    """
    # Existing RAG fields
    script_id: UUID
    conversation_id: Optional[UUID] = None
    current_scene_id: Optional[UUID] = None
    message: str
    intent_hint: Optional[str] = None
    max_tokens: Optional[int] = None
    budget_tier: Optional[str] = None  # "quick", "standard", "deep"

    # NEW: Tool support fields
    enable_tools: bool = True  # Enable by default for new requests
    max_iterations: int = 5    # Tool calling loop limit (reduced from 10 for efficiency)
```

**Design Rationale**:
- `enable_tools=True` default enables tools for new clients automatically
- Existing clients without this field continue working (backwards compatible)
- `max_iterations=5` balances precision with latency/cost (lower than tools-only endpoint's 10)

### Response Schema Enhancement

**Approach**: Extend `ChatMessageResponse` with tool usage metadata.

```python
class ToolCallMetadata(BaseModel):
    """Metadata about tool usage in the response."""
    tool_calls_made: int  # Number of tool iterations
    tools_used: List[str]  # Names of tools called (e.g., ["get_scene", "analyze_pacing"])
    stop_reason: str  # "end_turn" (natural) or "max_iterations" (limit reached)

class ChatMessageResponse(BaseModel):
    """
    Unified response with both RAG and tool metadata.

    Provides full transparency into what happened:
    - Which context was used (RAG)
    - Which tools were called (MCP)
    - Cost breakdown
    """
    # Core response
    message: str
    conversation_id: UUID

    # Token usage (aggregated across all API calls)
    usage: TokenUsage  # Existing schema

    # RAG context metadata
    context_used: ContextUsed  # Existing schema

    # NEW: Tool usage metadata
    tool_metadata: Optional[ToolCallMetadata] = None  # Only present if tools were used
```

**Key Benefits**:
- Full observability: frontend sees exactly what happened
- Cost transparency: separate context tokens from tool iteration tokens
- Debugging support: stop_reason explains why loop ended

---

## Implementation Details

### 1. System Prompt Merger

**Challenge**: ContextBuilder returns intent-specific system prompt. Tools need usage instructions. Must merge intelligently.

**Solution**: Extend, don't replace.

```python
# Build RAG context (includes intent-specific system prompt)
prompt = await context_builder.build_prompt(
    script_id=request.script_id,
    message=request.message,
    intent=intent,
    conversation_id=conversation_id,
    budget_tier=request.budget_tier
)

# If tools enabled, append tool usage instructions to system prompt
if request.enable_tools:
    tool_instructions = """

You have access to tools that allow you to retrieve and analyze screenplay content dynamically.

When answering questions:
- Use tools to get accurate, up-to-date information from the screenplay
- Prefer tools over cached context when precision matters
- You can call multiple tools to build comprehensive analysis
- Provide specific scene numbers, character names, and quotes from tool results

Available tools:
- get_scene: Get full scene text by index
- get_scene_context: Get scene plus surrounding scenes
- get_character_scenes: Track character appearances
- search_script: Semantic/keyword search
- analyze_pacing: Quantitative pacing metrics
- get_plot_threads: Plot thread tracking
"""
    # Extend system prompt (maintain caching)
    prompt["system"][0]["text"] += tool_instructions
```

**Why This Works**:
- Preserves RAG's intent-specific guidance (LOCAL_EDIT focus, SCENE_FEEDBACK criteria)
- Adds tool usage instructions as natural extension
- Maintains cache_control on combined system prompt
- Claude sees both frameworks: "use cached context when possible, tools when needed"

### 2. Tool Calling Loop

**Challenge**: Claude may call tools multiple times. Must handle multi-turn loops correctly.

**Solution**: Iterate until natural end or max_iterations.

```python
async def _handle_tool_loop(
    client: AsyncAnthropic,
    system: List[Dict],
    initial_messages: List[Dict],
    tools: List[Dict],
    max_iterations: int,
    tool_executor: MCPToolExecutor
) -> Tuple[str, Dict, ToolCallMetadata]:
    """
    Handle multi-turn tool calling loop.

    Returns:
        - final_message: Claude's final text response
        - aggregated_usage: Total tokens across all iterations
        - tool_metadata: Tool call statistics
    """
    messages = initial_messages.copy()
    total_usage = {
        "input_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "output_tokens": 0
    }
    tools_used = []

    for iteration in range(max_iterations):
        # Call Claude
        response = await client.messages.create(
            model="claude-3-5-haiku-latest",
            max_tokens=600,
            system=system,
            messages=messages,
            tools=tools
        )

        # Aggregate token usage
        for key in total_usage:
            total_usage[key] += response.usage.get(key, 0)

        # Check stop reason
        if response.stop_reason == "end_turn":
            # Natural end - extract final text
            final_text = next(
                (block.text for block in response.content if block.type == "text"),
                ""
            )
            return final_text, total_usage, ToolCallMetadata(
                tool_calls_made=iteration + 1,
                tools_used=list(set(tools_used)),
                stop_reason="end_turn"
            )

        # Extract and execute tool uses
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                tools_used.append(block.name)

                try:
                    # Execute tool
                    result = await tool_executor.execute_tool(
                        tool_name=block.name,
                        tool_input=block.input
                    )
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result
                    })
                except Exception as e:
                    # Return error to Claude (graceful degradation)
                    logger.error(f"Tool execution failed: {e}")
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": f"Error executing tool: {str(e)}",
                        "is_error": True
                    })

        # Append assistant message and tool results to conversation
        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})

    # Max iterations reached - extract latest text
    final_response = await client.messages.create(
        model="claude-3-5-haiku-latest",
        max_tokens=600,
        system=system,
        messages=messages
    )

    final_text = next(
        (block.text for block in final_response.content if block.type == "text"),
        ""
    )

    return final_text, total_usage, ToolCallMetadata(
        tool_calls_made=max_iterations,
        tools_used=list(set(tools_used)),
        stop_reason="max_iterations"
    )
```

**Key Design Decisions**:
- Accumulate messages across iterations (maintains conversation context for Claude)
- Aggregate token usage for accurate cost tracking
- Handle tool errors gracefully (return error to Claude, don't fail request)
- Track which tools were used for observability

### 3. Conversation Persistence

**Challenge**: Tool calling generates intermediate tool_use/tool_result messages. What should we persist?

**Solution**: Only persist user intent and final response.

```python
# After tool loop completes, save conversation messages
user_message = ChatMessage(
    conversation_id=conversation.conversation_id,
    sender="user",
    role=MessageRole.USER,
    content=request.message  # Original user question
)
db.add(user_message)

assistant_message = ChatMessage(
    conversation_id=conversation.conversation_id,
    sender="assistant",
    role=MessageRole.ASSISTANT,
    content=final_message  # Final response after all tool calls
)
db.add(assistant_message)

await db.commit()
```

**Rationale**:
- Users care about: their question → Claude's answer
- Tool calls are implementation details, not conversation content
- Keeps conversation history clean and UI-focused
- Detailed tool trace can be logged for debugging separately

### 4. Caching Optimization

**Challenge**: How does caching work with tools enabled?

**Analysis**: Claude caching works on:
- System blocks (✅ cached)
- Early message content blocks (✅ cached)
- Tool definitions can be cached if static
- Tool results are new content each time (❌ not cacheable)

**Optimization Strategy**:

```python
# System prompt with cache control (cached - rarely changes)
system = [
    {
        "type": "text",
        "text": merged_system_prompt,  # RAG guidance + tool instructions
        "cache_control": {"type": "ephemeral"}
    }
]

# User message with context blocks (cached - rarely changes)
content_blocks = [
    # Global context (cached)
    {
        "type": "text",
        "text": global_context,  # Outline + characters
        "cache_control": {"type": "ephemeral"}
    },
    # Scene cards (cached)
    {
        "type": "text",
        "text": scene_cards,  # Retrieved scenes
        "cache_control": {"type": "ephemeral"}
    },
    # Conversation context (not cached - changes frequently)
    {
        "type": "text",
        "text": conversation_context
    },
    # User message (not cached - unique each time)
    {
        "type": "text",
        "text": request.message
    }
]

# Tool results in subsequent iterations (not cacheable - fresh data)
# These go in follow-up messages, inherently uncacheable
```

**Cache Hit Analysis**:
- First request: Creates cache for system + global + scenes (normal cache creation)
- Subsequent requests: Hits cache on system + global + scenes (90% savings)
- Tool iterations: Cache is maintained throughout loop
- **Net Effect**: Maintain most RAG caching benefits (system, global, scenes), only pay full price for tool execution and final generation

### 5. Intelligent Tool Enablement

**Challenge**: Tools add latency and cost. When should they be enabled?

**Solution**: Smart defaults based on intent and query analysis.

```python
def should_enable_tools(
    request: ChatMessageRequest,
    intent: IntentType
) -> bool:
    """
    Intelligently decide whether to enable tools based on request context.

    Strategy: Enable tools for analytical queries, disable for simple chat.
    """
    # Explicit user override
    if request.enable_tools is not None:
        return request.enable_tools

    # Analytical keywords suggest tool usage
    analytical_keywords = [
        "analyze", "pacing", "track", "find all", "search for",
        "character appears", "plot threads", "quantitative",
        "how many", "which scenes", "compare scenes"
    ]
    message_lower = request.message.lower()
    uses_analytical = any(kw in message_lower for kw in analytical_keywords)

    if uses_analytical:
        return True

    # Intent-based defaults
    if intent in [IntentType.LOCAL_EDIT, IntentType.SCENE_FEEDBACK]:
        # For local edits with scene_id provided, RAG context is sufficient
        if request.current_scene_id:
            return False

    if intent == IntentType.GLOBAL_QUESTION:
        # Global questions may benefit from precise retrieval
        return True

    # Conservative default: enable tools (let Claude decide)
    return True
```

**Design Rationale**:
- Respects explicit user intent (enable_tools parameter)
- Analytical queries clearly need tools → enable
- Local edits with scene context → RAG sufficient → disable
- Conservative default (True) lets Claude decide
- Future: Could track tool usage patterns and refine heuristics

---

## Token Tracking & Cost Transparency

### Challenge
Hybrid approach has complex cost structure:
- Initial context (mostly cached)
- Tool iterations (not cached)
- Multiple API calls per request

### Solution: Comprehensive Token Breakdown

```python
class UnifiedTokenUsage(BaseModel):
    """Detailed token breakdown for hybrid requests."""
    # Standard fields
    input_tokens: int
    cache_creation_input_tokens: int
    cache_read_input_tokens: int
    output_tokens: int

    # NEW: Breakdown by source
    initial_context_tokens: int  # First API call (mostly cached)
    tool_iteration_tokens: int   # Subsequent tool calls (not cached)

    # Derived metrics
    cache_hit_percentage: float
    estimated_cost_usd: float

def calculate_token_metrics(
    initial_response_usage: Dict,
    tool_loop_usage: Dict
) -> UnifiedTokenUsage:
    """Calculate comprehensive token metrics."""
    total_input = initial_response_usage["input_tokens"] + tool_loop_usage["input_tokens"]
    total_cache_read = initial_response_usage["cache_read_input_tokens"] + tool_loop_usage["cache_read_input_tokens"]

    cache_hit_pct = (total_cache_read / total_input * 100) if total_input > 0 else 0

    # Claude 3.5 Haiku pricing (example)
    # Input: $1 / MTok, Cache read: $0.10 / MTok, Output: $5 / MTok
    cost = (
        (total_input - total_cache_read) * 1.0 / 1_000_000 +
        total_cache_read * 0.10 / 1_000_000 +
        (initial_response_usage["output_tokens"] + tool_loop_usage["output_tokens"]) * 5.0 / 1_000_000
    )

    return UnifiedTokenUsage(
        input_tokens=total_input,
        cache_creation_input_tokens=initial_response_usage["cache_creation_input_tokens"],
        cache_read_input_tokens=total_cache_read,
        output_tokens=initial_response_usage["output_tokens"] + tool_loop_usage["output_tokens"],
        initial_context_tokens=initial_response_usage["input_tokens"],
        tool_iteration_tokens=tool_loop_usage["input_tokens"],
        cache_hit_percentage=cache_hit_pct,
        estimated_cost_usd=cost
    )
```

**Frontend Display**:
```typescript
// In chat UI
function displayTokenMetrics(usage: UnifiedTokenUsage) {
  return (
    <div className="token-metrics">
      <div>Total tokens: {usage.input_tokens + usage.output_tokens}</div>
      <div>Cache hit: {usage.cache_hit_percentage.toFixed(1)}%</div>
      <div>Context: {usage.initial_context_tokens} tokens (cached)</div>
      {usage.tool_iteration_tokens > 0 && (
        <div>Tool calls: {usage.tool_iteration_tokens} tokens</div>
      )}
      <div>Cost: ${usage.estimated_cost_usd.toFixed(4)}</div>
    </div>
  );
}
```

---

## Migration Strategy

### Phase 1: Backend Implementation (Week 1)

**Tasks**:
1. ✅ Design complete (this document)
2. ⏳ Extend `ChatMessageRequest` schema with `enable_tools` and `max_iterations`
3. ⏳ Extend `ChatMessageResponse` schema with `tool_metadata`
4. ⏳ Implement system prompt merger in `chat_message()` endpoint
5. ⏳ Implement `_handle_tool_loop()` helper function
6. ⏳ Implement `should_enable_tools()` heuristics
7. ⏳ Add comprehensive logging for tool usage

**Validation**:
- All existing tests pass (backwards compatibility)
- New tests for tool-enabled requests
- Performance benchmarks (latency, cost)

### Phase 2: Frontend Integration (Week 2)

**Tasks**:
1. ⏳ Update `api.ts` types for new request/response schemas
2. ⏳ Add `enable_tools` parameter to `sendChatMessageWithRAG()`
3. ⏳ Update UI to display tool metadata (optional)
4. ⏳ A/B test: 50% of users get tools enabled by default
5. ⏳ Collect metrics: tool usage rate, user satisfaction, cost impact

**Metrics to Track**:
- Tool usage rate (% of requests that use tools)
- Tools used per request (avg iterations)
- Latency comparison (RAG-only vs hybrid)
- Cost comparison (cache hit rate impact)
- User satisfaction (qualitative feedback)

### Phase 3: Optimization (Week 3)

**Based on metrics, optimize**:
1. ⏳ Refine `should_enable_tools()` heuristics
2. ⏳ Adjust `max_iterations` if too high/low
3. ⏳ Add more tools if gaps identified
4. ⏳ Optimize prompt engineering for tool usage
5. ⏳ Consider deprecating separate endpoints

---

## Testing Strategy

### Unit Tests

```python
class TestUnifiedChatEndpoint:
    """Comprehensive test suite for hybrid endpoint."""

    async def test_rag_only_mode(self):
        """
        Test RAG-only mode (enable_tools=False).

        Validates:
        - Caching works as expected
        - No tool metadata in response
        - Performance matches old RAG endpoint
        """
        pass

    async def test_tools_only_mode(self):
        """
        Test minimal context + tools enabled.

        Validates:
        - Tools execute correctly
        - Multi-turn loops work
        - Tool metadata populated
        """
        pass

    async def test_hybrid_mode(self):
        """
        Test full context + tools enabled.

        Validates:
        - Both context AND tools used
        - Claude chooses appropriately
        - Caching maintained
        """
        pass

    async def test_tool_error_handling(self):
        """
        Test graceful degradation when tool fails.

        Validates:
        - Tool errors returned to Claude
        - Request doesn't fail entirely
        - Error appears in response metadata
        """
        pass

    async def test_max_iterations_limit(self):
        """
        Test stop at max_iterations boundary.

        Validates:
        - Loop stops at max_iterations
        - Stop_reason = "max_iterations"
        - Final response still generated
        """
        pass

    async def test_token_tracking_accuracy(self):
        """
        Test token aggregation across iterations.

        Validates:
        - All API call tokens summed
        - Cache metrics correct
        - Cost calculation accurate
        """
        pass

    async def test_conversation_persistence(self):
        """
        Test correct messages saved to database.

        Validates:
        - Only user + final assistant messages saved
        - Tool calls not persisted in chat history
        - Conversation flow clean
        """
        pass

    async def test_intelligent_tool_enablement(self):
        """
        Test should_enable_tools() heuristics.

        Validates:
        - Analytical queries → tools enabled
        - Local edits with scene_id → tools disabled
        - Explicit user override respected
        """
        pass
```

### Integration Tests

```python
async def test_end_to_end_analytical_query():
    """
    Test complete flow: analytical query → tool calls → response.

    Example: "Analyze pacing in Act 2"
    Expected: Claude calls analyze_pacing tool, returns quantitative analysis
    """
    response = await client.post(
        "/api/ai/chat/message",
        json={
            "script_id": test_script_id,
            "message": "Analyze pacing in Act 2",
            "enable_tools": True
        }
    )

    assert response.status_code == 200
    data = response.json()

    # Validate tool usage
    assert data["tool_metadata"] is not None
    assert "analyze_pacing" in data["tool_metadata"]["tools_used"]

    # Validate response quality
    assert "pacing" in data["message"].lower()
    assert any(metric in data["message"].lower() for metric in ["pages", "scenes", "act"])

async def test_cost_comparison():
    """
    Compare cost between RAG-only and hybrid for same queries.

    Validates: Hybrid doesn't dramatically increase cost due to caching
    """
    queries = [
        "What happens in scene 5?",
        "Give me feedback on the dialogue",
        "Track SARAH through the script"
    ]

    for query in queries:
        # RAG-only
        rag_response = await client.post("/api/ai/chat/message", json={
            "script_id": test_script_id,
            "message": query,
            "enable_tools": False
        })

        # Hybrid
        hybrid_response = await client.post("/api/ai/chat/message", json={
            "script_id": test_script_id,
            "message": query,
            "enable_tools": True
        })

        # Compare costs
        rag_cost = calculate_cost(rag_response.json()["usage"])
        hybrid_cost = calculate_cost(hybrid_response.json()["usage"])

        # Hybrid should not be >2x cost due to caching benefits
        assert hybrid_cost < rag_cost * 2
```

---

## Performance Considerations

### Latency Profile

**RAG-only baseline**: ~2-4 seconds
- Intent classification: ~100ms
- Context building: ~200ms
- Vector search: ~300ms
- Claude API call: ~1500ms
- DB operations: ~100ms

**Hybrid with tools**: ~3-8 seconds (depends on tool calls)
- Same as RAG: ~2200ms
- Tool execution (per call): ~500-1000ms
- Additional Claude calls: ~1500ms each
- **Max with 5 iterations**: ~2200 + (5 * 2000) = ~12s worst case

**Mitigation strategies**:
1. Lower max_iterations from 10→5 for responsiveness
2. Intelligent tool enablement (disable when not needed)
3. Frontend loading states with progress indication
4. Future: Streaming responses during tool execution

### Cost Profile

**RAG-only baseline**: ~$0.0001 per request (with caching)
- Input tokens: 3000 (80% cached) → $0.000026
- Output tokens: 400 → $0.0002
- **Total**: ~$0.00023

**Hybrid with tools**: ~$0.0003-0.0008 per request
- Initial context: Same as RAG (~$0.00023)
- Tool iterations: 2-3 additional calls (~$0.0001 each)
- **Total**: ~$0.0004 average

**Expected impact**:
- 30-50% of requests use tools (based on heuristics)
- Average cost increase: ~50% overall
- BUT: Better answers justify cost
- Users can disable tools for cost-sensitive use cases

---

## Success Metrics

### Technical Metrics

1. **Tool Usage Rate**: 30-50% of requests (target)
2. **Average Iterations**: 1.5-2.5 per tool-enabled request
3. **Cache Hit Rate**: >70% (maintain RAG benefits)
4. **Latency P50**: <4s, P95: <8s
5. **Error Rate**: <1% (robust tool error handling)

### Business Metrics

1. **User Satisfaction**: Qualitative feedback surveys
2. **Feature Adoption**: % users trying analytical queries
3. **Cost Efficiency**: $ per high-quality answer
4. **Retention**: Users returning for analytical features

### Quality Metrics

1. **Answer Accuracy**: Human eval of tool-based answers
2. **Context Relevance**: Are tools called appropriately?
3. **Cost-Benefit Ratio**: Better answers worth higher cost?

---

## Future Enhancements

### Phase 6.1: Additional Tools
- `get_character_arc`: Track character development over acts
- `analyze_dialogue`: Stylistic analysis of character voice
- `check_continuity`: Find plot/character inconsistencies
- `suggest_cuts`: Identify scenes to cut for pacing

### Phase 6.2: Smart Caching
- Cache tool results for frequently accessed scenes
- Share tool result cache across users (script-level cache)
- Invalidate cache on script updates

### Phase 6.3: Streaming Tool Execution
- Stream Claude response AS tools execute
- Show "Analyzing scene 5..." progress to user
- Better perceived performance

### Phase 6.4: Tool Composition
- Allow Claude to compose tools (e.g., analyze_pacing → get_scene → suggest_edits)
- Multi-step reasoning with tool chains
- Planning phase before tool execution

---

## Conclusion

The unified hybrid endpoint achieves optimal design by:

1. **Preserving RAG Benefits**: Cached context, intent classification, conversation management
2. **Adding Tool Power**: Precise retrieval, analytical functions, multi-turn loops
3. **Intelligent Routing**: Tools enabled based on intent and query analysis
4. **Comprehensive Observability**: Detailed metrics for debugging and optimization
5. **Graceful Degradation**: Tool errors don't break conversation flow
6. **Backwards Compatibility**: Existing clients work unchanged

This architecture gives Claude the best of both worlds: rich pre-assembled context for efficiency AND dynamic tool access for precision. Users get better answers at optimal cost, with full transparency into how the system works.

**Next Steps**: Implementation Phase 1 (Backend) → Testing → Frontend Integration → Metrics Collection → Optimization
