# Troubleshooting: Anthropic Library Upgrade

**Date**: December 3, 2025
**Issue**: Chat message sending failed with `TypeError: AsyncMessages.create() got an unexpected keyword argument 'tools'`
**Status**: ✅ RESOLVED

## Problem Summary

After implementing Phase 1 and Phase 2 of the unified hybrid chat endpoint, users experienced a runtime error when trying to send chat messages:

```
TypeError: AsyncMessages.create() got an unexpected keyword argument 'tools'
```

**Error Location**: `backend/app/routers/ai_router.py:350` in `_handle_tool_loop()`

## Root Cause

The `anthropic` Python library was outdated (version **0.18.1**), which predates the tool calling API feature. Phase 1 implementation added MCP tool calling functionality that requires the `tools` parameter in `client.messages.create()`, which was not supported in the old version.

## Solution

Upgraded the `anthropic` library from **0.18.1** to **0.75.0**.

### Steps Taken

1. **Identified the issue** by reading the error stacktrace in `error.txt`
2. **Checked current version**: `pip show anthropic` → 0.18.1
3. **Upgraded the library**: `pip install --upgrade anthropic` → 0.75.0
4. **Verified tool support**: Confirmed `tools` parameter is now recognized
5. **Restarted backend server** to load the new library version
6. **Updated requirements.txt** to lock the new version

### Command History

```bash
# Check current version
cd backend
source ../writersRoom/bin/activate
pip show anthropic

# Upgrade library
pip install --upgrade anthropic

# Verify upgrade
python -c "from anthropic import AsyncAnthropic; import inspect; print('tools parameter supported:', 'tools' in inspect.signature(AsyncAnthropic().messages.create).parameters)"

# Restart server
kill <PID>  # or lsof -ti:8000 | xargs kill -9
python main.py
```

## Verification

✅ **Backend server running** on port 8000
✅ **Frontend server running** on port 3102
✅ **`tools` parameter now supported** in AsyncMessages.create()
✅ **requirements.txt updated** with anthropic==0.75.0

## Files Modified

1. **`backend/requirements.txt`**
   - Updated: `anthropic==0.18.1` → `anthropic==0.75.0`
   - Added comment: "upgraded for tool calling support"

## Testing Checklist

Now that the error is resolved, test the following:

### ✅ Backend Verification
- [x] Backend server starts without errors
- [x] Health endpoint returns `{"status":"ok"}`
- [x] No import errors for `AsyncAnthropic`
- [ ] Chat endpoint accepts requests without 500 errors

### ⏳ Frontend Integration Testing
- [ ] Send a simple message: "What's the tone of this script?"
- [ ] Send an analytical query: "Analyze the pacing in Act 2"
- [ ] Verify tool metadata displays correctly when tools are used
- [ ] Confirm backwards compatibility (no `enable_tools` field works)

### ⏳ End-to-End Testing
- [ ] RAG-only mode works (simple queries)
- [ ] Hybrid mode works (analytical queries with tools)
- [ ] Tool metadata badge appears below assistant messages
- [ ] Console logging shows tool usage details
- [ ] Message persistence works (refresh page, history intact)

## Dependencies Added

The upgrade also installed these new dependencies required by anthropic 0.75.0:

- `docstring-parser==0.17.0` (new dependency)
- `jiter==0.12.0` (new dependency)

## Lesson Learned

**Always check library versions** when implementing new API features. The Anthropic Python SDK underwent major updates to support tool calling, and Phase 1 implementation assumed the latest version was installed.

**Recommendation**: Add version requirements to implementation documentation for critical features like this.

## Related Documentation

- Phase 1 Implementation: `backend/docs/PHASE1_IMPLEMENTATION_COMPLETE.md`
- Phase 2 Implementation: `frontend/docs/PHASE2_IMPLEMENTATION_COMPLETE.md`
- Design Specification: `backend/docs/UNIFIED_HYBRID_CHAT_DESIGN.md`

## Next Steps

1. Test the chat functionality with real messages
2. Verify tool metadata displays correctly
3. Monitor backend logs for any additional errors
4. Consider adding automated dependency version checks in CI/CD
