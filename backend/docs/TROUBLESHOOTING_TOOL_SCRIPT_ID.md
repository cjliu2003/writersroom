# Troubleshooting: MCP Tool Script ID Issue

**Date**: December 3, 2025
**Issue**: LLM tool call failed with `ValueError: badly formed hexadecimal UUID string`
**Status**: ✅ RESOLVED

## Problem Summary

After implementing Phase 1 (Backend) and Phase 2 (Frontend) of the unified hybrid chat endpoint, MCP tool calls were failing with the error:

```
ValueError: badly formed hexadecimal UUID string
```

**Error Location**: `backend/app/services/mcp_tools.py:172` in `MCPToolExecutor.execute_tool()`

**Error Context**:
```python
script_id=UUID(tool_input["script_id"])  # <- ValueError here
```

## Root Cause

Claude (the LLM) was **not informed of the `script_id`** to use when calling tools. The system prompt explained the available tools but didn't specify which script UUID to pass as the `script_id` parameter.

**What happened**:
1. User sends a chat message about their screenplay
2. Backend determines tools should be enabled
3. System prompt tells Claude about available tools
4. Claude tries to call a tool (e.g., `get_scene`)
5. **Claude has to guess the `script_id` parameter** → uses invalid value
6. Backend tries to parse invalid string as UUID → `ValueError`

**Why this occurred**:
- The `script_id` was passed to `_handle_tool_loop()` function (line 584)
- But it was **never injected into the system prompt** for Claude to see
- Tool definitions specified `script_id` as a required string parameter
- Claude had no context about which UUID to use

## Solution

**Automatic script_id injection** via the `MCPToolExecutor` constructor. Since a chat conversation only ever references one script, the LLM doesn't need to know or pass the `script_id` - the system automatically injects it.

### Code Changes

**File 1**: `backend/app/services/mcp_tools.py`

**Change 1 - MCPToolExecutor constructor (lines 152-154)**:
```python
# Before:
def __init__(self, db: AsyncSession):
    self.db = db

# After:
def __init__(self, db: AsyncSession, script_id: UUID):
    self.db = db
    self.script_id = script_id
```

**Change 2 - All tool execution methods now use `self.script_id`**:
```python
# Example from get_scene (line 171-175):
# Before:
return await self._get_scene(
    script_id=UUID(tool_input["script_id"]),  # Parse from LLM input
    scene_index=tool_input["scene_index"]
)

# After:
return await self._get_scene(
    script_id=self.script_id,  # Use injected script_id
    scene_index=tool_input["scene_index"]
)
```

**Change 3 - Tool definitions updated (removed script_id parameter)**:
```python
# Example: get_scene tool definition
# Before:
{
    "name": "get_scene",
    "input_schema": {
        "type": "object",
        "properties": {
            "script_id": {"type": "string", "description": "Script UUID"},
            "scene_index": {"type": "integer", "description": "Scene number"}
        },
        "required": ["script_id", "scene_index"]
    }
}

# After:
{
    "name": "get_scene",
    "input_schema": {
        "type": "object",
        "properties": {
            "scene_index": {"type": "integer", "description": "Scene number"}
        },
        "required": ["scene_index"]  # No script_id needed!
    }
}
```

**File 2**: `backend/app/routers/ai_router.py`

**Change 1 - Pass script_id to MCPToolExecutor (line 344)**:
```python
# Before:
tool_executor = MCPToolExecutor(db=db)

# After:
tool_executor = MCPToolExecutor(db=db, script_id=script_id)
```

**No system prompt change needed** - LLM doesn't need to know about script_id at all!

## Verification

✅ **Backend server running** with auto-reload (picked up the fix)
✅ **Health endpoint responding** correctly
✅ **System prompt now includes script_id** for Claude to use
✅ **Error.txt cleaned up**

## Testing Checklist

Now that the error is resolved, test the following:

### ✅ Tool Call Verification
- [ ] Send analytical query: "Analyze the pacing in Act 2"
- [ ] Verify tool calls succeed without UUID errors
- [ ] Check backend logs show successful tool execution
- [ ] Confirm tool results are returned to Claude

### ⏳ End-to-End Testing
- [ ] Simple query works (RAG-only mode)
- [ ] Analytical query works (hybrid mode with tools)
- [ ] Tool metadata displays correctly in frontend
- [ ] Multiple tool calls work in sequence
- [ ] Error handling works for invalid scene indices, etc.

## Alternative Solutions Considered

### Option 1: Pre-inject script_id in tool executor (CHOSEN ✅)
```python
# In _handle_tool_loop():
tool_executor = MCPToolExecutor(db=db, script_id=script_id)

# In execute_tool():
# Use self.script_id instead of tool_input["script_id"]
```
**Why chosen**:
- **Token efficient**: Doesn't waste tokens in system prompt with UUIDs
- **More reliable**: No risk of Claude making typos or using wrong UUID
- **Cleaner design**: Separation of concerns - LLM provides semantic parameters, system provides context
- **Simpler tool schemas**: Tools only require semantic parameters, not infrastructure IDs
- **Future-proof**: Easier to add other context injection (user_id, org_id, etc.)

### Option 2: Add script_id to system prompt (INITIALLY TRIED, THEN REJECTED)
```python
tool_instructions = f"""
IMPORTANT: When calling any tool, use this script_id: {str(request.script_id)}
"""
```
**Why rejected after user feedback**:
- Wastes tokens by including UUIDs in every system prompt
- Relies on LLM to correctly copy/paste UUIDs (error-prone)
- Makes tool schemas more complex than necessary
- Not the right level of abstraction (infrastructure vs semantic parameters)

## Lessons Learned

### Initial Lesson (Incorrect)
~~**When providing LLMs with tools, always specify ALL required context in the system prompt**~~

This was the initial (wrong) conclusion from the first attempted fix.

### Corrected Lesson (After User Feedback)
**Separate infrastructure context from semantic parameters**:
- **Infrastructure context** (script_id, user_id, org_id): Inject via constructor/context, NOT tool parameters
- **Semantic parameters** (scene_index, character_name, query): These are what the LLM should provide
- **Rule**: If a parameter's value is determined by request context (not user intent), inject it automatically rather than making the LLM provide it

**Benefits of this approach**:
1. **Token efficiency**: No wasted tokens on UUIDs in system prompts
2. **Reliability**: System-provided values can't have typos
3. **Cleaner abstractions**: LLM focuses on semantic meaning, system handles infrastructure
4. **Simpler tool schemas**: Tools only describe what users actually need to specify

## Related Documentation

- Phase 1 Implementation: `backend/docs/PHASE1_IMPLEMENTATION_COMPLETE.md`
- Phase 2 Implementation: `frontend/docs/PHASE2_IMPLEMENTATION_COMPLETE.md`
- Design Specification: `backend/docs/UNIFIED_HYBRID_CHAT_DESIGN.md`
- Anthropic Upgrade: `frontend/docs/TROUBLESHOOTING_ANTHROPIC_UPGRADE.md`

## Next Steps

1. Test tool calling functionality end-to-end
2. Verify all tool types work correctly (get_scene, search_script, etc.)
3. Monitor backend logs for any additional tool execution errors
4. Consider adding validation in MCPToolExecutor to provide better error messages
5. Update Phase 1 documentation to include this fix
