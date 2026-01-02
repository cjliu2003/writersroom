# Streaming Final AI Response - Implementation Design

## Overview

Currently, the `stream-with-status` endpoint yields status events during tool execution but waits until the entire final response is generated before sending it to the user. This design enables **streaming the final AI-generated text** to the user incrementally, using Claude's native streaming API.

## Current Architecture

```
User Message → Routing → Context Building → Tool Loop → Synthesis → Complete Event
                                                ↓              ↓
                                         status events    WAIT for full response
```

### Event Flow (Current)
```typescript
{"type": "thinking", "message": "Thinking..."}
{"type": "status", "message": "Reading scene 5...", "tool": "get_scene_content"}
{"type": "status", "message": "Analyzing character...", "tool": "find_character_scenes"}
{"type": "thinking", "message": "Synthesizing findings..."}
{"type": "complete", "message": "Here is my analysis...[FULL 500 words]...", "usage": {...}}
{"type": "stream_end", "conversation_id": "..."}
```

## Proposed Architecture

```
User Message → Routing → Context Building → Tool Loop → Synthesis (STREAMING) → text events → Complete Event
                                                ↓                  ↓
                                         status events    text deltas as they generate
```

### Event Flow (Proposed)
```typescript
{"type": "thinking", "message": "Thinking..."}
{"type": "status", "message": "Reading scene 5...", "tool": "get_scene_content"}
{"type": "status", "message": "Analyzing character...", "tool": "find_character_scenes"}
{"type": "thinking", "message": "Synthesizing findings..."}
{"type": "text", "text": "Here is"}
{"type": "text", "text": " my analysis"}
{"type": "text", "text": " of the"}
{"type": "text", "text": " character..."}
// ... many more text deltas ...
{"type": "complete", "message": "", "usage": {...}, "streamed": true}
{"type": "stream_end", "conversation_id": "..."}
```

---

## Implementation Plan

### Phase 1: Backend Changes

#### 1.1 Add New Event Type to SSE Schema

**File: `backend/app/routers/ai_router.py`**

Add documentation comment for the new `text` event type:

```python
# SSE Event Types:
# - {"type": "thinking", "message": "..."} - AI is processing
# - {"type": "status", "message": "...", "tool": "..."} - Tool execution status
# - {"type": "text", "text": "..."} - Incremental text from final response (NEW)
# - {"type": "complete", "message": "", "usage": {...}, "streamed": true} - Stream complete
# - {"type": "stream_end", "conversation_id": "..."} - Final event with conversation ID
```

#### 1.2 Create Streaming Synthesis Function

**File: `backend/app/routers/ai_router.py`**

Add new async generator function:

```python
async def _trigger_synthesis_streaming(
    client: AsyncAnthropic,
    system: List[dict],
    messages: List[dict],
    all_tool_results: List[dict],
    evidence_builder,
    context_builder,
    user_question: str,
    initial_messages: List[dict],
    intent,
    total_usage: dict,
    ai_conv_logger = None
) -> AsyncGenerator[dict, None]:
    """
    Streaming version of synthesis - yields text events incrementally.

    Yields:
        Dict events with types:
        - {"type": "text", "text": "chunk"} - Text delta
        - {"type": "synthesis_done", "full_text": "...", "usage_delta": {...}} - Completion signal
    """
    # Build evidence and synthesis prompt (same as _trigger_synthesis_inline)
    question_for_synthesis = user_question
    if not question_for_synthesis:
        for msg in reversed(initial_messages):
            if msg.get("role") == "user":
                content = msg.get("content", "")
                if isinstance(content, str):
                    question_for_synthesis = content
                elif isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            question_for_synthesis = block.get("text", "")
                            break
                break
        question_for_synthesis = question_for_synthesis or "the user's question"

    # Build structured evidence from all tool results
    evidence = await evidence_builder.build_evidence(
        tool_results=all_tool_results,
        user_question=question_for_synthesis
    )

    logger.info(
        f"[STREAMING] Evidence built: {len(evidence.items)} items, "
        f"{evidence.total_chars} chars, truncated={evidence.was_truncated}"
    )

    # Create synthesis prompt
    synthesis_content = context_builder.build_synthesis_prompt(
        evidence_text=evidence.to_prompt_text(),
        user_question=question_for_synthesis,
        intent=intent
    )

    # Build synthesis messages
    synthesis_messages = messages.copy()
    synthesis_messages.append({"role": "user", "content": synthesis_content})

    # Stream the synthesis response
    accumulated_text = ""

    async with client.messages.stream(
        model="claude-haiku-4-5",
        max_tokens=FINAL_SYNTHESIS_MAX_TOKENS,
        system=system,
        messages=synthesis_messages
    ) as stream:
        async for text in stream.text_stream:
            accumulated_text += text
            yield {"type": "text", "text": text}

    # Get final message for usage tracking
    final_message = await stream.get_final_message()

    # Calculate usage delta for this synthesis call
    usage_delta = {
        "input_tokens": final_message.usage.input_tokens,
        "cache_creation_input_tokens": getattr(final_message.usage, 'cache_creation_input_tokens', 0),
        "cache_read_input_tokens": getattr(final_message.usage, 'cache_read_input_tokens', 0),
        "output_tokens": final_message.usage.output_tokens
    }

    if ai_conv_logger:
        ai_conv_logger.log_assistant_response(accumulated_text, "synthesis_streaming")

    # Signal completion with full text (for DB storage) and usage
    yield {
        "type": "synthesis_done",
        "full_text": accumulated_text,
        "usage_delta": usage_delta
    }
```

#### 1.3 Modify Tool Loop to Use Streaming Synthesis

**File: `backend/app/routers/ai_router.py`**

In `_handle_tool_loop_with_status`, replace the synthesis calls:

```python
# BEFORE (signal_tool triggered):
if signal_tool_called:
    logger.info(f"Signal tool triggered synthesis with {len(all_tool_results)} tool results")
    yield {"type": "thinking", "message": "Synthesizing findings..."}
    final_text = await _trigger_synthesis_inline(...)
    yield {
        "type": "complete",
        "message": final_text,
        "usage": total_usage,
        "tool_metadata": {...}
    }

# AFTER (streaming):
if signal_tool_called:
    logger.info(f"Signal tool triggered synthesis with {len(all_tool_results)} tool results")
    yield {"type": "thinking", "message": "Synthesizing findings..."}

    final_text = ""
    async for event in _trigger_synthesis_streaming(
        client=client,
        system=system,
        messages=messages,
        all_tool_results=all_tool_results,
        evidence_builder=evidence_builder,
        context_builder=context_builder,
        user_question=user_question,
        initial_messages=initial_messages,
        intent=intent,
        total_usage=total_usage,
        ai_conv_logger=ai_conv_logger
    ):
        if event["type"] == "text":
            yield event  # Forward text deltas to client
        elif event["type"] == "synthesis_done":
            final_text = event["full_text"]
            # Add synthesis usage to total
            for key in event["usage_delta"]:
                total_usage[key] += event["usage_delta"][key]

    yield {
        "type": "complete",
        "message": "",  # Empty - text was already streamed
        "usage": total_usage,
        "tool_metadata": {...},
        "streamed": True
    }
```

Apply similar changes for:
1. The `stop_reason != "tool_use"` case with tool results (around line 933)
2. The iteration limit case (after max_iterations)

#### 1.4 Modify RAG-Only Path to Stream

**File: `backend/app/routers/ai_router.py`**

In `generate_stream()`, update the RAG-only path:

```python
# BEFORE:
else:
    # RAG-only mode: Use AIService without tools
    ai_service = AIService()
    yield f"data: {json.dumps({'type': 'thinking', 'message': 'Thinking...'})}\n\n"
    response = await ai_service.generate_response(
        prompt=prompt,
        max_tokens=request.max_tokens or RAG_ONLY_DEFAULT_MAX_TOKENS
    )
    final_message = response["content"]
    final_usage = response["usage"]
    yield f"data: {json.dumps({'type': 'complete', 'message': final_message, 'usage': final_usage})}\n\n"

# AFTER (streaming):
else:
    # RAG-only mode: Stream response without tools
    from app.core.config import settings
    client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    yield f"data: {json.dumps({'type': 'thinking', 'message': 'Thinking...'})}\n\n"

    accumulated_text = ""
    async with client.messages.stream(
        model=prompt.get("model", "claude-haiku-4-5"),
        max_tokens=request.max_tokens or RAG_ONLY_DEFAULT_MAX_TOKENS,
        system=prompt.get("system", []),
        messages=prompt["messages"]
    ) as stream:
        async for text in stream.text_stream:
            accumulated_text += text
            yield f"data: {json.dumps({'type': 'text', 'text': text})}\n\n"

    # Get final message for usage
    final_msg = await stream.get_final_message()

    final_message = accumulated_text
    final_usage = {
        "input_tokens": final_msg.usage.input_tokens,
        "cache_creation_input_tokens": getattr(final_msg.usage, 'cache_creation_input_tokens', 0),
        "cache_read_input_tokens": getattr(final_msg.usage, 'cache_read_input_tokens', 0),
        "output_tokens": final_msg.usage.output_tokens
    }

    # Log to AI conversation logger
    ai_conv_logger.log_assistant_response(final_message, "end_turn")
    ai_conv_logger.log_token_usage(final_usage)
    ai_conv_logger.log_session_summary()

    yield f"data: {json.dumps({'type': 'complete', 'message': '', 'usage': final_usage, 'streamed': True})}\n\n"
```

---

### Phase 2: Frontend Changes

#### 2.1 Update Event Types

**File: `frontend/lib/api.ts`**

```typescript
// ADD: New text streaming event
export interface TextEvent {
  type: 'text';
  text: string;
}

// MODIFY: CompleteEvent to support streaming flag
export interface CompleteEvent {
  type: 'complete';
  message: string;  // Empty when streamed=true
  usage: TokenUsage;
  tool_metadata?: {
    tool_calls_made: number;
    tools_used: string[];
    stop_reason: string;
  };
  streamed?: boolean;  // NEW: Indicates text was already streamed via text events
}

// UPDATE: Union type
export type ChatStreamEvent = StatusEvent | ThinkingEvent | TextEvent | CompleteEvent | StreamEndEvent;
```

#### 2.2 Update AI Chatbot Component

**File: `frontend/components/ai-chatbot.tsx`**

Add state for streaming text:

```typescript
// ADD: New state for streaming text
const [streamingText, setStreamingText] = useState<string>('')
const [isStreaming, setIsStreaming] = useState(false)
```

Update the event processing loop:

```typescript
// Process SSE events as they arrive
for await (const event of stream) {
  switch (event.type) {
    case 'thinking':
      setStatusMessage(event.message)
      break

    case 'status':
      setStatusMessage(event.message)
      break

    // NEW: Handle text streaming
    case 'text':
      if (!isStreaming) {
        setIsStreaming(true)
        setStatusMessage('')  // Clear status when text starts streaming
      }
      setStreamingText(prev => prev + event.text)
      scrollToBottom()  // Keep scrolled to bottom as text streams
      break

    case 'complete':
      // Use accumulated streaming text if streamed, otherwise use message
      if (event.streamed) {
        finalMessage = streamingText
      } else {
        finalMessage = event.message
      }
      setStreamingText('')
      setIsStreaming(false)

      toolMetadata = event.tool_metadata as ToolCallMetadata | undefined
      setStatusMessage('')

      console.log('AI Response Complete:', {
        output_tokens: event.usage.output_tokens,
        cache_read: event.usage.cache_read_input_tokens,
        tool_metadata: toolMetadata || null,
        streamed: event.streamed || false
      })
      break

    case 'stream_end':
      // ... existing code ...
      break
  }
}
```

#### 2.3 Update Message Display

Add a streaming message bubble that shows during text streaming:

```tsx
// In the message list rendering:
{messages.map((message, index) => (
  // ... existing message rendering ...
))}

{/* NEW: Show streaming text as it arrives */}
{isStreaming && streamingText && (
  <div className="flex justify-start">
    <div className="bg-gray-100 rounded-lg px-4 py-2 max-w-[85%]">
      <MarkdownContent content={streamingText} />
      <span className="inline-block w-2 h-4 bg-purple-500 ml-1 animate-pulse" />
    </div>
  </div>
)}

{/* Show status while not streaming text */}
{!isStreaming && statusMessage && (
  <div className="flex items-center gap-2 text-gray-500 text-sm">
    <Loader2 className="w-4 h-4 animate-spin" />
    {statusMessage}
  </div>
)}
```

---

### Phase 3: Testing Strategy

#### 3.1 Backend Unit Tests

```python
# Test streaming synthesis yields text events
async def test_synthesis_streaming_yields_text_events():
    """Verify synthesis streams text deltas."""
    events = []
    async for event in _trigger_synthesis_streaming(...):
        events.append(event)

    text_events = [e for e in events if e["type"] == "text"]
    assert len(text_events) > 0, "Should yield multiple text events"

    done_event = next(e for e in events if e["type"] == "synthesis_done")
    assert "full_text" in done_event
    assert "usage_delta" in done_event

# Test full streaming path
async def test_stream_with_status_yields_text_events():
    """Verify endpoint streams text to client."""
    response = client.post("/ai/chat/message/stream-with-status", ...)
    events = parse_sse_events(response)

    text_events = [e for e in events if e["type"] == "text"]
    complete_event = next(e for e in events if e["type"] == "complete")

    assert len(text_events) > 0
    assert complete_event["streamed"] == True
    assert complete_event["message"] == ""  # Text was streamed, not in complete
```

#### 3.2 Integration Tests

1. **RAG-only path**: Send a simple question, verify `text` events stream
2. **Tools path**: Send a script-related question, verify status events followed by text events
3. **Error recovery**: Interrupt stream mid-text, verify graceful handling
4. **Empty response**: Verify handling of responses with no text content

#### 3.3 Manual Testing Checklist

- [ ] Send RAG-only question, see text appear incrementally
- [ ] Send tool-using question, see status → thinking → streaming text
- [ ] Verify final message matches accumulated streamed text
- [ ] Verify scroll-to-bottom works during streaming
- [ ] Verify cursor/typing indicator during streaming
- [ ] Test on slow network (throttle to 3G)
- [ ] Test with very long responses (>2000 tokens)

---

## Migration & Backwards Compatibility

### Backwards Compatible Approach

The implementation maintains backwards compatibility:

1. **`complete` event still sent**: After streaming, we still send `complete` with usage info
2. **`message` field available**: If needed, backends can still include full message in `complete`
3. **`streamed` flag**: Frontend can detect streaming mode and handle appropriately
4. **Graceful degradation**: If frontend doesn't handle `text` events, it can still use `complete.message`

### Rollback Plan

If issues arise, set environment variable to disable streaming:

```python
ENABLE_STREAMING_RESPONSE = os.getenv("ENABLE_STREAMING_RESPONSE", "true").lower() == "true"

# In synthesis:
if ENABLE_STREAMING_RESPONSE:
    async for event in _trigger_synthesis_streaming(...):
        yield f"data: {json.dumps(event)}\n\n"
else:
    final_text = await _trigger_synthesis_inline(...)
    yield f"data: {json.dumps({'type': 'complete', 'message': final_text, ...})}\n\n"
```

---

## Performance Considerations

### Benefits
- **Perceived latency reduction**: User sees response starting within ~500ms instead of waiting 3-5s
- **Better UX**: Streaming feels more natural and responsive
- **Progress indication**: Users know the AI is working even during synthesis

### Potential Overhead
- **More SSE events**: Instead of 1 complete event, we send ~50-200 text events
- **More JSON parsing**: Each text event is parsed separately
- **Network overhead**: Minimal - text chunks are small (~5-50 chars each)

### Mitigation
- Keep text chunks reasonably sized (Claude naturally outputs word-sized chunks)
- Batch very small chunks if needed (accumulate for 50ms before sending)

---

## Files to Modify Summary

| File | Changes |
|------|---------|
| `backend/app/routers/ai_router.py` | Add `_trigger_synthesis_streaming()`, modify tool loop and RAG path |
| `frontend/lib/api.ts` | Add `TextEvent` type, update `ChatStreamEvent` union |
| `frontend/components/ai-chatbot.tsx` | Add streaming state, handle `text` events, show streaming bubble |

---

## Appendix: Claude Streaming API Reference

From the official Anthropic documentation:

### Basic Streaming Pattern (Python SDK)

```python
import anthropic

client = anthropic.Anthropic()

with client.messages.stream(
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
    model="claude-sonnet-4-5",
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

### Async Streaming Pattern

```python
async with client.messages.stream(
    model="claude-haiku-4-5",
    max_tokens=1024,
    system=system_prompt,
    messages=messages
) as stream:
    async for text in stream.text_stream:
        yield {"type": "text", "text": text}

# Get final message after streaming completes
final_message = await stream.get_final_message()
```

### SSE Event Types from Claude API

1. `message_start`: Contains initial `Message` object with empty `content`
2. `content_block_start`: Start of a content block (text, tool_use, etc.)
3. `content_block_delta`: Incremental content (`text_delta`, `input_json_delta`, etc.)
4. `content_block_stop`: End of content block
5. `message_delta`: Top-level changes (stop_reason, usage)
6. `message_stop`: Stream complete

### Text Delta Format

```json
{
  "type": "content_block_delta",
  "index": 0,
  "delta": {
    "type": "text_delta",
    "text": "Hello"
  }
}
```

---

This design enables real-time text streaming while maintaining full backwards compatibility and providing clear migration paths.
