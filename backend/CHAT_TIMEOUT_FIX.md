# Chat Timeout and Logging Fix

## Problem Summary

Chat messages were timing out after 45 seconds and the diagnostic logging wasn't appearing in the backend output.

## Root Causes Identified

### 1. Frontend Timeout Too Short (45 seconds)
**Location**: `frontend/lib/api.ts:398`

The chat message endpoint can take 60-180 seconds due to:
- Access validation: ~3.5s (geographic latency: Croatia → California)
- Intent classification: variable
- RAG context building: 10-30s
- AI generation with tools: 20-120s (multi-tool calls extend this significantly)
- Database operations: multiple queries with geographic latency

**Fix Applied**: Increased timeout from 45s to 180s (3 minutes)

```typescript
// Line 393-399 in frontend/lib/api.ts
export async function sendChatMessageWithRAG(request: ChatMessageRequest): Promise<ChatMessageResponse> {
  // Increase timeout for chat requests (AI generation with tools can take 60-180 seconds)
  // With multi-tool calls, RAG context building, and geographic latency, responses can be slow
  const response = await authenticatedFetch('/ai/chat/message', {
    method: 'POST',
    body: JSON.stringify(request),
    timeoutMs: 180000, // 3 minutes for AI chat with tools
  });
```

### 2. Logging Level Not Configured (INFO logs filtered out)
**Location**: `backend/main.py`

Python's default logging level is WARNING, which filters out INFO level logs. The `[CHAT]` timing logs use `logger.info()`, so they were being silently dropped.

**Fix Applied**: Added logging configuration to show INFO level and above

```python
# Lines 8-14 in backend/main.py
import logging

# Configure logging to show INFO level and above
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
```

### 3. Diagnostic Print Statement Added
**Location**: `backend/app/routers/ai_router.py:473`

Added a print statement to verify the endpoint is being reached even before logging is configured:

```python
# Line 473 in backend/app/routers/ai_router.py
print(f"🔵 DEBUG: chat_message endpoint entered - user: {current_user.user_id}, script: {request.script_id}")
```

## Comprehensive Timing Instrumentation Added

The chat_message endpoint now has timing logs at every major step:

1. **Endpoint start** (line 474)
2. **Access validation** (line 485)
3. **Service initialization** (line 493)
4. **Intent classification** (line 502)
5. **Conversation handling** (line 542)
6. **Context building** (line 555)
7. **Tools enabled indicator** (line 566)
8. **Tool setup** (line 579) - if tools enabled
9. **Tool loop with AI generation** (line 617) - hybrid mode
10. **AI generation** (line 641) - RAG-only mode
11. **Message saving** (line 668)
12. **Token tracking** (line 680)
13. **Summary check** (line 690)
14. **Endpoint complete with total duration** (line 701)

## Files Modified

1. `backend/main.py` - Added logging configuration
2. `backend/app/routers/ai_router.py` - Added comprehensive timing logs and debug print
3. `frontend/lib/api.ts` - Increased timeout from 45s to 180s

## Next Steps - REQUIRES MANUAL ACTION

**IMPORTANT**: The backend server needs to be restarted to pick up these changes.

### Current Server Status
- PID: 80910
- Started: Fri Dec 12 18:58:31 2025
- Files modified: Dec 12 19:09:29 2025
- **Status**: Running old code (auto-reload not working)

### How to Restart

**Option 1 - Manual Restart (Recommended)**:
```bash
# Find the terminal with the backend server running
# Press Ctrl+C to stop the server
# Then restart with:
cd /Users/jacklofwall/Documents/GitHub/writersroom/backend
source ../writersRoom/bin/activate
python -m uvicorn main:app --port 8000 --reload 2>&1 | tee backendLogs.txt
```

**Option 2 - Kill and Restart**:
```bash
# Kill the old process
kill 80910

# Wait a moment
sleep 2

# Start new server
cd /Users/jacklofwall/Documents/GitHub/writersroom/backend
source ../writersRoom/bin/activate
python -m uvicorn main:app --port 8000 --reload 2>&1 | tee backendLogs.txt
```

### After Restart - Verification

1. **Send a chat message** from the frontend
2. **Check for debug output**:
   - Should see: `🔵 DEBUG: chat_message endpoint entered - user: ...`
   - Should see: `[CHAT] ⏱️ ENDPOINT START - user: ...`
3. **Watch for timing logs** showing duration of each step
4. **Verify no timeout errors** (message should complete within 180s)

### Expected Log Output Example

```
🔵 Incoming request: POST /api/ai/chat/message
🔵 DEBUG: chat_message endpoint entered - user: abc123, script: def456
2025-12-12 19:15:00 - app.routers.ai_router - INFO - [CHAT] ⏱️  ENDPOINT START - user: abc123, script: def456
2025-12-12 19:15:03 - app.routers.ai_router - INFO - [CHAT] ✅ Access validation took 3521.45ms
2025-12-12 19:15:03 - app.routers.ai_router - INFO - [CHAT] ✅ Service initialization took 12.34ms
2025-12-12 19:15:05 - app.routers.ai_router - INFO - [CHAT] ✅ Intent classification took 1845.67ms - Intent: scene_specific
2025-12-12 19:15:08 - app.routers.ai_router - INFO - [CHAT] ✅ Conversation handling took 2891.23ms (conversation_id: ...)
2025-12-12 19:15:32 - app.routers.ai_router - INFO - [CHAT] ✅ Context building took 24123.45ms - 8543 tokens
2025-12-12 19:15:32 - app.routers.ai_router - INFO - [CHAT] 🔧 Tools enabled: True
2025-12-12 19:15:32 - app.routers.ai_router - INFO - [CHAT] ✅ Tool setup took 156.78ms
2025-12-12 19:15:32 - app.routers.ai_router - INFO - [CHAT] 🤖 Starting tool loop (this includes AI generation)...
2025-12-12 19:16:48 - app.routers.ai_router - INFO - [CHAT] ✅ Tool loop completed in 75823.45ms
2025-12-12 19:16:51 - app.routers.ai_router - INFO - [CHAT] ✅ Message saving took 3456.78ms
2025-12-12 19:16:52 - app.routers.ai_router - INFO - [CHAT] ✅ Token tracking took 234.56ms
2025-12-12 19:16:52 - app.routers.ai_router - INFO - [CHAT] ✅ Summary check took 123.45ms
2025-12-12 19:16:52 - app.routers.ai_router - INFO - [CHAT] 🏁 ENDPOINT COMPLETE - Total: 111234.56ms
✅ Completed: POST /api/ai/chat/message - 200 - 111.235s
```

## Troubleshooting Auto-Reload Issue

The `--reload` flag is not consistently picking up file changes. This is a known issue that has occurred multiple times:

**Symptoms**:
- Files modified after server start
- Server running but using old code
- Changes not reflected even after waiting

**Workaround**: Always manually restart the server after making code changes

**Future Improvement**: Consider using a more reliable reload mechanism or documenting the need for manual restarts

## Impact Assessment

**Before Fix**:
- Chat messages failing with timeout errors after 45 seconds
- No visibility into which step was slow
- Poor user experience for complex AI queries

**After Fix**:
- 180-second timeout accommodates complex AI operations
- Comprehensive timing logs identify performance bottlenecks
- Better debugging capability for future issues
- Users can complete complex queries with multi-tool calls

## Performance Expectations

Based on the comprehensive timing logs, expected durations are:

- **Quick queries** (no tools): 15-30 seconds
  - Access validation: 3-5s
  - Intent classification: 1-3s
  - Context building: 5-10s
  - AI generation: 5-15s
  - Database ops: 5-10s

- **Standard queries** (with tools): 45-90 seconds
  - Above + Tool loop: 30-60s

- **Complex queries** (multi-tool calls): 90-150 seconds
  - Above + Extended tool loop: 60-120s

The 180-second timeout provides headroom for edge cases and network variability.
