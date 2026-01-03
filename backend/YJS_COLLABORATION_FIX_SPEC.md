# Yjs Collaboration System Fix Specification

**Status**: ALL PHASES COMPLETE
**Created**: 2026-01-02
**Last Updated**: 2026-01-02
**Priority**: P0 (Critical)

## Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Stop Persisting SYNC_STEP2 | ✅ Complete |
| 1.5 | Compact Polluted Data | ✅ Complete |
| 1.75 | Fix Content Detection | ✅ Complete |
| 2 | Remove Obsolete Rebuild Logic | ✅ Complete |
| 3 | Fix WebSocket Timeout | ✅ Complete |
| 4 | Code Cleanup | ✅ Complete |

---

## Executive Summary

The WebSocket/Yjs collaboration system has critical issues causing:
1. Constant "empty content" detection despite 3316+ persisted updates
2. Continuous rebuilds from scenes table instead of Yjs
3. WebSocket disconnections every ~31 seconds

**Root Cause**: The backend checks `Y.Array('content')` but TipTap uses `Y.XmlFragment('default')`.

---

## Technical Analysis

### NEW FINDING: SYNC_STEP2 Pollution (Critical Bug)

**The persistence layer is storing sync protocol messages, not just edits!**

```python
# script_websocket.py line 497
elif sub_type == SYNC_STEP2 or sub_type == SYNC_UPDATE:  # BUG: Both persisted!
    await persistence.store_update(script_id, upd, user_id)
```

| Message Type | Value | Purpose | Should Persist? |
|--------------|-------|---------|-----------------|
| SYNC_STEP1 | 0 | Client state vector request | No |
| SYNC_STEP2 | 1 | Full state sync on connect | **NO** |
| SYNC_UPDATE | 2 | Actual user edits | **YES** |

**Impact**: Every time a client opens the script:
1. Client sends SYNC_STEP2 with its full document state
2. This gets persisted as a new "update"
3. Result: 3316+ entries without any actual edits
4. Replaying these redundant full-state messages corrupts the document

**This is the primary bug that needs fixing.**

### Current Architecture

```
Frontend (TipTap)                    Backend (y_py)
┌─────────────────┐                  ┌─────────────────┐
│ TipTap Editor   │                  │ script_websocket│
│ Collaboration   │◄────WebSocket───►│ .py             │
│ Extension       │                  │                 │
│                 │                  │                 │
│ Uses:           │                  │ Checks:         │
│ Y.XmlFragment   │                  │ Y.Array         │
│ name: 'default' │                  │ name: 'content' │
└─────────────────┘                  └─────────────────┘
        ▲                                    │
        │                                    ▼
        │                            ┌─────────────────┐
        │                            │ script_versions │
        │                            │ (persisted Yjs  │
        │                            │  updates)       │
        └────────────────────────────┴─────────────────┘
                                     Updates ARE stored
                                     correctly for
                                     XmlFragment('default')
```

### Problem Details

| Component | Expected | Actual | Impact |
|-----------|----------|--------|--------|
| Yjs Shared Type | XmlFragment | Array | Wrong type checked |
| Shared Type Name | 'default' | 'content' | Wrong name used |
| Content Detection | Has content | Shows 0 | Triggers unnecessary rebuild |
| Backend Seeding | Disabled | N/A | Cannot recover from "empty" state |

### y_py Library Limitation

**Critical Finding**: `y_py` v0.6.2 does NOT expose `get_xml_fragment()`:

```python
# Available in y_py:
ydoc.get_array(name)      # Returns YArray
ydoc.get_map(name)        # Returns YMap
ydoc.get_text(name)       # Returns YText
ydoc.get_xml_element(name) # Returns YXmlElement
ydoc.get_xml_text(name)   # Returns YXmlText

# NOT available:
ydoc.get_xml_fragment(name)  # Does NOT exist in y_py
```

However, when Yjs updates are applied via `Y.apply_update(ydoc, update_bytes)`, the XmlFragment IS created internally. The issue is accessing it to check content length.

---

## Implementation Plan

### Phase 1: P0 - Stop Persisting SYNC_STEP2 (CRITICAL)

**Objective**: Only persist actual user edits (SYNC_UPDATE), not sync protocol messages (SYNC_STEP2).

**The Fix**:

```python
# script_websocket.py line 497-508
# FROM:
elif sub_type == SYNC_STEP2 or sub_type == SYNC_UPDATE:
    upd, offset = _read_var_uint8array(msg, offset)
    Y.apply_update(ydoc, upd)
    # Persist the applied update
    await persistence.store_update(script_id, upd, user_id)

# TO:
elif sub_type == SYNC_STEP2 or sub_type == SYNC_UPDATE:
    upd, offset = _read_var_uint8array(msg, offset)
    Y.apply_update(ydoc, upd)

    # ONLY persist SYNC_UPDATE (actual edits), NOT SYNC_STEP2 (sync overhead)
    if sub_type == SYNC_UPDATE:
        try:
            await persistence.store_update(script_id, upd, user_id)
            await db.commit()
        except Exception as e:
            logger.error(f"Error persisting Yjs update: {e}")
    else:
        logger.debug(f"Skipping persistence for SYNC_STEP2 (sync protocol, not edit)")
```

**Why This Fixes the Problem**:
1. SYNC_STEP2 is the full document state sent on every connection
2. Persisting it creates duplicate/redundant entries
3. Only SYNC_UPDATE represents actual user edits
4. This stops the pollution of script_versions table

---

### Phase 1.5: P0 - Clean Up Existing Polluted Data

**Objective**: Handle scripts with thousands of SYNC_STEP2 entries.

**Option A - Compact on Load** (Recommended):

Instead of replaying all 3316 updates, compact them:

```python
# script_yjs_persistence.py - Add compaction method
async def load_and_compact_updates(self, script_id: UUID, ydoc: YDoc) -> int:
    """Load updates and optionally compact if too many."""
    updates = await self._get_all_updates(script_id)

    if len(updates) > 100:  # Threshold for compaction
        logger.info(f"Script {script_id} has {len(updates)} updates - compacting")

        # Apply all updates to a temp doc
        temp_doc = Y.YDoc()
        for upd in updates:
            Y.apply_update(temp_doc, upd)

        # Get single compacted state
        compacted = Y.encode_state_as_update(temp_doc)

        # Replace all updates with single compacted update
        await self._replace_all_updates(script_id, compacted)

        # Apply to target doc
        Y.apply_update(ydoc, compacted)
        return 1  # Now just 1 update
    else:
        # Normal path for reasonable update counts
        for upd in updates:
            Y.apply_update(ydoc, upd)
        return len(updates)
```

**Option B - One-Time Migration Script**:

```sql
-- Identify scripts with excessive updates
SELECT script_id, COUNT(*) as update_count
FROM script_versions
GROUP BY script_id
HAVING COUNT(*) > 100
ORDER BY update_count DESC;

-- For each, keep only the latest update (or compact programmatically)
```

---

### Phase 1.75: P0 - Fix Content Detection Check

**Objective**: Change the content check from Y.Array to something that works.

Since `y_py` doesn't have `get_xml_fragment()`, we have two options:

**Option A - Trust State Vector Size**:
```python
# After applying updates, check state vector size
state_vector = Y.encode_state_vector(ydoc)
has_content = len(state_vector) > 20  # Empty doc is ~10 bytes
```

**Option B - Skip Check If Updates Applied**:
```python
# If we applied compacted updates, trust they have content
if applied_count > 0:
    logger.info("Updates applied - document ready")
    # Skip "rebuild from scenes" entirely
```

**RECOMMENDED: Option B** after implementing compaction (Phase 1.5)

**Files to Modify**:
- `backend/app/routers/script_websocket.py` (lines 271-313)

**Testing Criteria**:
- [ ] Open script with existing Yjs updates
- [ ] Logs should NOT show "Yjs document empty for script"
- [ ] Logs should NOT show "rebuilding from scenes"
- [ ] Content should load correctly in editor

---

### Phase 2: P1 - Remove Obsolete Rebuild Logic

**Objective**: Clean up the "rebuild from scenes" code path that's no longer needed.

**Changes**:

1. **Remove scenes query when updates exist**:
```python
# script_websocket.py lines 287-306
# Remove or guard the scenes query:
if applied_count == 0:
    # Only query scenes if no Yjs updates exist (new script)
    from app.models.scene import Scene
    scenes_result = await db.execute(...)
    # ... rebuild logic ...
```

2. **Remove or update backend seeding comment**:
```python
# Line 309-311: Either re-enable seeding or update the comment
# Option 1: Remove entirely (frontend seeds)
# Option 2: Keep disabled with updated comment explaining why
```

3. **Simplify the initialization flow**:
```python
# Simplified flow:
ydoc = YDoc()
applied_count = await persistence.load_persisted_updates(script_id, ydoc)

if applied_count > 0:
    logger.info(f"Loaded {applied_count} Yjs updates for script {script_id}")
    # Document is ready - frontend will sync via WebSocket
else:
    logger.info(f"No Yjs updates for script {script_id} - frontend will seed")
    # Frontend will check has_yjs_updates=False and seed from REST API
```

**Files to Modify**:
- `backend/app/routers/script_websocket.py` (lines 248-317)

---

### Phase 3: P2 - Fix WebSocket Timeout ✅ IMPLEMENTED

**Status**: COMPLETE (2026-01-02)

**Analysis**:
- Disconnect occurs ~31 seconds after last Yjs message
- Frontend sends awareness heartbeat every 10 seconds
- Heartbeat updates local state but may not generate WebSocket traffic

**Root Cause Hypothesis**:
The awareness heartbeat calls `awarenessInstance.setLocalState()`, but this may not trigger a WebSocket message if the awareness protocol optimizes away redundant updates.

**Solution Implemented - Server-Side WebSocket Ping Frames**:

Added to `backend/app/routers/script_websocket.py`:
- Async `ping_loop()` function that sends WebSocket PING frames every 25 seconds
- Uses protocol-level ping (`websocket.send({"type": "websocket.ping"})`)
- **CRITICAL**: Must NOT use `send_bytes()` - that would send an application message
  that y-websocket tries to decode, causing "Unexpected end of array" errors
- Ping task started with `asyncio.create_task()` before message loop
- Proper cleanup with `ping_task.cancel()` in finally block

```python
# Implemented in script_websocket.py (lines 383-403)
async def ping_loop():
    """Send periodic WebSocket ping frames to keep connection alive."""
    while True:
        try:
            await asyncio.sleep(25)  # Ping every 25 seconds (under 31s timeout)
            # Send WebSocket PING frame at protocol level
            # This is handled by the browser automatically (responds with PONG)
            # and does NOT reach the y-websocket message handler
            await websocket.send({"type": "websocket.ping", "bytes": b""})
            logger.debug(f"Sent WebSocket ping frame to user {user_id} on script {script_id}")
        except asyncio.CancelledError:
            logger.debug(f"Ping loop cancelled for user {user_id}")
            break
        except Exception as e:
            logger.debug(f"Ping loop error for user {user_id}: {e}")
            break

ping_task = asyncio.create_task(ping_loop())
try:
    while True:
        # ... message handling ...
finally:
    ping_task.cancel()
    try:
        await ping_task
    except asyncio.CancelledError:
        pass
```

**Why 25 seconds**: Under the 31-second timeout threshold, frequent enough to maintain connection.

**Why protocol-level PING**: WebSocket PING frames are handled at the protocol layer by the browser.
They never reach the application's message handler, so y-websocket's lib0 decoder never sees them.
Using `send_bytes()` would send an application-level binary message that lib0 tries to parse,
causing "Unexpected end of array" when the message doesn't conform to Yjs protocol.

**Files Modified**:
- `backend/app/routers/script_websocket.py` (added ping loop and asyncio import)

---

### Phase 4: P3 - Code Cleanup ✅ IMPLEMENTED

**Status**: COMPLETE (2026-01-02)

**Objective**: Remove obsolete code and consolidate to single editor implementation.

**Tasks Completed**:

1. **Slate-based editor**: ✅ Already removed
   - `frontend/components/script-editor-with-collaboration.tsx` does not exist
   - No imports/references found in codebase (only this spec mentioned it)

2. **Tests updated**: ✅
   - Added documentation header to `backend/tests/test_script_websocket.py` explaining
     that tests use `Y.Array('content')` for persistence testing (not TipTap integration)
   - Fixed typo: `test_test_script` → `test_script`
   - Tests remain valid for persistence layer testing

3. **Documentation updated**: ✅
   - `docs/REALTIME_COLLABORATION_SPEC.md`:
     - Updated status to IMPLEMENTED
     - Added implementation notes section with key technical details
     - Corrected shared type info (`Y.XmlFragment('default')`)
     - Updated to reflect script-level (not scene-level) collaboration
   - Added migration note about `y_py` → `pycrdt`

4. **Migration planning**: ✅ Documented
   - Added note in REALTIME_COLLABORATION_SPEC.md about `y_py` → `pycrdt` migration path
   - `pycrdt` would provide `get_xml_fragment()` for direct content inspection
   - No immediate action required - documented for future reference

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing scripts | Low | High | Phase 1 is non-destructive - only changes what we check, not data |
| Multiple clients seeding | Medium | Medium | Frontend already has deduplication logic |
| Timeout fix causes issues | Low | Low | Ping/pong is standard WebSocket practice |
| Tests failing | Medium | Low | Tests use obsolete patterns, update or remove |

---

## Testing Strategy

### Unit Tests

1. **Content Detection Test**:
```python
def test_xmlfragment_content_detection():
    """Test that XmlFragment content is correctly detected."""
    doc = Y.YDoc()
    # Simulate TipTap creating XmlFragment content
    # Apply a known update with content
    # Verify content length > 0
```

2. **Empty Document Test**:
```python
def test_empty_document_detection():
    """Test that truly empty documents are correctly detected."""
    doc = Y.YDoc()
    # Don't apply any updates
    # Verify we detect "empty" correctly
```

### Integration Tests

1. **End-to-End Script Load**:
   - Connect to WebSocket with existing script
   - Verify no "rebuilding from scenes" log
   - Verify content syncs correctly

2. **New Script Creation**:
   - Create new script
   - Connect to WebSocket
   - Verify frontend seeds content
   - Verify content persists

### Manual Testing

1. Open existing script with Yjs history
2. Observe console/logs - should NOT see rebuild messages
3. Edit content - should sync and persist
4. Disconnect/reconnect - should maintain state

---

## Rollback Plan

### Phase 1 Rollback
```python
# Revert to original check if issues arise:
shared_root = ydoc.get_array('content')
yjs_content_length = len(shared_root)
```

### Phase 2 Rollback
- Rebuild logic is only removed, not data
- Can re-add if needed

### Phase 3 Rollback
- Ping/pong is additive, can be disabled
- Timeout changes are configuration, easily reverted

---

## Implementation Order

```
Week 1:
├── Day 1-2: Phase 1 - Fix content detection
│   ├── Implement Approach C (trust persisted updates)
│   ├── Test with existing scripts
│   └── Monitor logs
│
├── Day 3-4: Phase 2 - Clean rebuild logic
│   ├── Guard or remove scenes query
│   ├── Simplify initialization flow
│   └── Update logging
│
└── Day 5: Phase 3 - Fix timeout
    ├── Add server-side ping
    ├── Test connection stability
    └── Monitor disconnect frequency

Week 2:
└── Phase 4 - Cleanup
    ├── Remove obsolete code
    ├── Update tests
    └── Update documentation
```

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| "Rebuilding from scenes" logs | Every connection | Never (for existing scripts) |
| WebSocket disconnects per hour | ~100 | < 5 (only intentional) |
| Content sync success rate | Unknown | > 99% |
| Time to first content display | ~5s (with rebuild) | < 2s |

---

## Appendix: File Reference

### Backend Files
- `backend/app/routers/script_websocket.py` - Main WebSocket handler
- `backend/app/services/script_yjs_persistence.py` - Yjs update persistence
- `backend/tests/test_script_websocket.py` - WebSocket tests

### Frontend Files
- `frontend/app/script-editor/page.tsx` - TipTap editor (active)
- `frontend/hooks/use-script-yjs-collaboration.ts` - WebSocket provider hook
- `frontend/components/script-editor-with-collaboration.tsx` - Slate editor (obsolete?)

### Configuration
- `backend/requirements.txt` - y-py==0.6.2
- `frontend/package.json` - yjs, y-websocket versions
