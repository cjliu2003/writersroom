# Debugging Tool Calls - Complete Guide

This guide shows you how to debug and inspect MCP tool calls from Claude, including the order, parameters, and full execution flow.

## Method 1: VS Code Debugger (Best for Step-by-Step Inspection)

### Setup

1. **Install VS Code Python Extension** (if not already installed)
   - Extension ID: `ms-python.python`
   - Also install `ms-python.debugpy`

2. **Open Backend in VS Code**
   ```bash
   cd /Users/jacklofwall/Documents/GitHub/writersroom/backend
   code .
   ```

3. **Start Debug Session**
   - Press `F5` or go to Run → Start Debugging
   - Select "Python: FastAPI Backend" from the dropdown
   - Server will start with debugger attached

### Setting Breakpoints

**Key locations to set breakpoints:**

1. **`ai_router.py:347`** - Start of tool loop iteration
   ```python
   for iteration in range(max_iterations):
       logger.info(f"Tool loop iteration {iteration + 1}/{max_iterations}")
   ```

2. **`ai_router.py:380-383`** - When Claude requests a tool
   ```python
   for block in response.content:
       if block.type == "tool_use":
           tools_used.append(block.name)
           logger.info(f"Executing tool: {block.name} with input: {block.input}")
   ```

3. **`ai_router.py:387-390`** - Tool execution
   ```python
   result = await tool_executor.execute_tool(
       tool_name=block.name,
       tool_input=block.input
   )
   ```

4. **`mcp_tools.py:146-160`** - Tool executor dispatch
   ```python
   async def execute_tool(self, tool_name: str, tool_input: dict) -> str:
   ```

5. **`mcp_tools.py:203`** - Individual tool methods (set breakpoint in the tool you want to inspect)
   - `_get_scene` (line 203)
   - `_get_scene_context` (line 232)
   - `_get_character_scenes` (line 272)
   - `_search_script` (line 320)
   - `_analyze_pacing` (line 362)
   - `_get_plot_threads` (line 455)

### What to Inspect

When breakpoint hits, check **Variables panel** for:

**At `ai_router.py:380` (Tool request from Claude):**
- `block.name` → Tool name Claude wants to call
- `block.input` → Parameters Claude is passing
- `block.id` → Unique ID for this tool call
- `iteration` → Current iteration number (0-indexed)
- `tools_used` → List of all tools used so far

**At `ai_router.py:387` (Before tool execution):**
- `tool_executor.script_id` → Verify script_id is correct UUID
- `block.input` → Full input parameters

**At `mcp_tools.py:146` (Tool executor):**
- `tool_name` → Name of tool being executed
- `tool_input` → Dictionary of parameters
- `self.script_id` → Injected script_id

**At individual tool methods:**
- `script_id` → Verify correct script
- Method-specific parameters (scene_index, character_name, etc.)
- Database query results

### Debug Workflow

1. **Send message from frontend** (e.g., "Show me scene 5")
2. **Breakpoint hits at tool loop** → Check `iteration` count
3. **Step through to tool request** → Inspect `block.name` and `block.input`
4. **Step into `execute_tool`** → Verify routing logic
5. **Step into specific tool method** → Watch database queries and results
6. **Check tool result** → Verify formatted output string
7. **Continue to next iteration** → See if Claude calls more tools

## Method 2: Enhanced Logging (Already Implemented)

The backend already has detailed logging! Just watch the console output.

### Viewing Logs

**Terminal running backend:**
```bash
# You should see logs like:
INFO:     Tool loop iteration 1/5
INFO:     Executing tool: get_scene with input: {'scene_index': 5}
INFO:     Tool get_scene executed successfully
```

**Watch logs in real-time:**
```bash
cd /Users/jacklofwall/Documents/GitHub/writersroom/backend
tail -f /tmp/backend_restart.log
```

### Log Locations

**Lines in `ai_router.py` that log tool activity:**
- Line 347: `logger.info(f"Tool loop iteration {iteration + 1}/{max_iterations}")`
- Line 383: `logger.info(f"Executing tool: {block.name} with input: {block.input}")`
- Line 396: `logger.info(f"Tool {block.name} executed successfully")`
- Line 399: `logger.error(f"Tool execution failed: {e}", exc_info=True)`
- Line 371: `logger.info(f"Tool loop ended naturally after {iteration + 1} iteration(s)")`
- Line 412: `logger.warning(f"Tool loop reached max_iterations ({max_iterations})")`

### What Logs Show

**Example log sequence:**
```
INFO:     Tool loop iteration 1/5
INFO:     Executing tool: get_scene with input: {'scene_index': 5}
INFO:     Tool get_scene executed successfully
INFO:     Tool loop iteration 2/5
INFO:     Executing tool: search_script with input: {'query': 'romantic scenes', 'limit': 10}
INFO:     Tool search_script executed successfully
INFO:     Tool loop ended naturally after 2 iteration(s)
```

This tells you:
1. Claude called `get_scene` first with scene_index=5
2. Then called `search_script` with a query
3. Stopped after 2 iterations (natural end)

## Method 3: Add Custom Debug Logging

If you want even more detail, add temporary logging:

### In `ai_router.py` (line 350, after Claude responds):

```python
response = await client.messages.create(...)

# ADD THIS:
logger.info("="*80)
logger.info(f"CLAUDE RESPONSE - Iteration {iteration + 1}")
logger.info(f"Stop reason: {response.stop_reason}")
logger.info(f"Content blocks: {len(response.content)}")
for idx, block in enumerate(response.content):
    logger.info(f"  Block {idx}: {block.type}")
    if block.type == "tool_use":
        logger.info(f"    Tool: {block.name}")
        logger.info(f"    Input: {block.input}")
    elif block.type == "text":
        logger.info(f"    Text: {block.text[:100]}...")  # First 100 chars
logger.info("="*80)
```

### In `mcp_tools.py` (at start of each tool method):

```python
async def _get_scene(self, script_id: UUID, scene_index: int) -> str:
    # ADD THIS:
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"[TOOL] _get_scene called: script_id={script_id}, scene_index={scene_index}")

    # ... rest of method
```

## Method 4: Frontend Network Tab

**Chrome DevTools → Network tab:**

1. Open DevTools (F12)
2. Go to Network tab
3. Filter by "Fetch/XHR"
4. Send a message
5. Click on the request to `/api/chat/rag`
6. View:
   - **Request Payload**: What frontend sent
   - **Response**: Backend response including `tool_metadata`

**What to look for:**
```json
{
  "message": "Claude's response",
  "tool_metadata": {
    "tool_calls_made": 2,
    "tools_used": ["get_scene", "search_script"],
    "stop_reason": "end_turn"
  }
}
```

## Method 5: Frontend Console Logging

The frontend already logs tool metadata! Open browser console (F12 → Console):

```javascript
// You'll see:
AI Response Metrics: {
  intent: "scene_specific",
  budget_tier: "standard",
  cache_hit: true,
  cache_savings: "75%",
  token_usage: {...},
  tool_metadata: {
    tool_calls_made: 2,
    tools_used: ["get_scene", "search_script"],
    stop_reason: "end_turn"
  }
}

Tool Usage: {
  tools_used: "get_scene, search_script",
  iterations: 2,
  stop_reason: "end_turn"
}
```

## Recommended Debugging Workflow

**For full flow inspection:**

1. **Set breakpoints** in VS Code at:
   - `ai_router.py:347` (loop start)
   - `ai_router.py:380` (tool request detection)
   - `mcp_tools.py:146` (tool executor)

2. **Start debugger** (F5 in VS Code)

3. **Send test message** from frontend

4. **Step through execution** (F10 for step over, F11 for step into)

5. **Inspect variables** at each step:
   - Tool names and parameters
   - Database query results
   - Formatted tool outputs
   - Claude's next response

6. **Watch for patterns**:
   - Which tools Claude chooses
   - Parameter values Claude provides
   - Order of tool calls
   - When Claude decides to stop

## Common Inspection Points

### "What tools did Claude call?"
- **Logs**: Search for "Executing tool:"
- **Debugger**: Check `tools_used` list
- **Frontend**: Check console "Tool Usage"

### "What parameters did Claude pass?"
- **Logs**: Look at "with input:" in log line
- **Debugger**: Inspect `block.input` or `tool_input`

### "What did the tool return?"
- **Debugger**: Check `result` variable after tool execution
- **Logs**: Won't show full result (too long), use debugger

### "Why did tool execution fail?"
- **Logs**: Look for "Tool execution failed:" with traceback
- **Debugger**: Set breakpoint in try/except block, inspect exception

### "How many iterations did it take?"
- **Logs**: "Tool loop ended naturally after X iteration(s)"
- **Frontend**: Check `tool_metadata.tool_calls_made`

### "Did Claude stop naturally or hit max iterations?"
- **Logs**: "ended naturally" vs "reached max_iterations"
- **Frontend**: Check `tool_metadata.stop_reason` ("end_turn" vs "max_iterations")

## Quick Debug Commands

```bash
# Restart backend with verbose logging
cd backend
source ../writersRoom/bin/activate
LOG_LEVEL=DEBUG python main.py

# Watch backend logs in real-time
tail -f /tmp/backend_restart.log | grep -i "tool"

# Clear browser localStorage (if needed)
# Run in browser console:
Object.keys(localStorage).forEach(key => {
  if (key.startsWith('chat-')) localStorage.removeItem(key)
})
```

## Debugging Checklist

- [ ] VS Code debugger attached and running
- [ ] Breakpoints set at key locations
- [ ] Backend logs visible in terminal
- [ ] Frontend console open (F12)
- [ ] Network tab open to see requests/responses
- [ ] Test message ready to send
- [ ] Browser localStorage cleared (if testing fresh)

## Next Steps

After understanding the flow, you can:
1. Optimize tool definitions for better Claude performance
2. Add custom tools for specific screenplay analysis needs
3. Adjust system prompt to guide Claude's tool usage
4. Fine-tune max_iterations based on observed patterns
5. Add caching for frequently called tools
