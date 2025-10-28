# Script Editor Seeding Issue - Analysis & Fix Strategy

## Executive Summary

**Issue**: Script editor loads data from API but displays blank editor
**Root Cause**: Yjs document seeding logic never executes due to sync timing race condition
**Severity**: 🔴 Critical - Feature completely non-functional
**Complexity**: 🟡 Moderate - Well-understood pattern fix

---

## Architecture Comparison

### Scene-Level Editor (WORKING)

**Component Hierarchy:**
```
screenplay-editor-with-autosave.tsx
└── screenplay-editor.tsx (handles Yjs seeding)
    └── useYjsCollaboration hook
```

**Seeding Location**: `screenplay-editor.tsx:301-318`

**Key Implementation Details:**
```typescript
// screenplay-editor.tsx lines 301-318
if (provider) {
  const handleSynced = (event: any) => {
    const synced = typeof event === 'boolean' ? event : !!event?.synced
    if (synced) {
      seedDocIfNeeded()  // ✅ Called when sync event fires
    }
  }

  provider.on('synced', handleSynced)  // ✅ Event listener
  cleanupTasks.push(() => provider.off('synced', handleSynced))

  if ((provider as any).synced) {  // ✅ Immediate check
    seedDocIfNeeded()
  }
}
```

**Why It Works:**
1. ✅ Listens to provider 'synced' event
2. ✅ Checks if already synced when effect runs
3. ✅ Properly cleans up event listeners
4. ✅ Handles both: sync-before-mount AND sync-after-mount scenarios

---

### Script-Level Editor (BROKEN)

**Component Hierarchy:**
```
script-editor-with-autosave.tsx
└── script-editor-with-collaboration.tsx (handles Yjs seeding)
    └── useScriptYjsCollaboration hook
```

**Seeding Location**: `script-editor-with-collaboration.tsx:230-232`

**Broken Implementation:**
```typescript
// script-editor-with-collaboration.tsx lines 230-232
if (syncStatus === 'synced') {
  seedDocIfNeeded();  // ❌ Only runs if ALREADY synced when effect executes
}
```

**Why It Fails:**
1. ❌ Only checks syncStatus ONCE (not reactive to changes)
2. ❌ No event listener for when sync completes
3. ❌ Missing provider in useEffect dependencies
4. ❌ Race condition: WebSocket syncs before React useEffect runs

**Timeline of Failure:**
```
T+0ms:   Component mounts, useEffect scheduled
T+50ms:  WebSocket connects
T+80ms:  WebSocket syncs (provider.synced = true)
T+100ms: useEffect runs, checks syncStatus (might still be 'connecting')
T+120ms: syncStatus becomes 'synced' → NO CODE LISTENING FOR THIS CHANGE
RESULT:  seedDocIfNeeded() never called → Yjs doc empty → Editor blank
```

---

## Diagnostic Evidence

### Backend Logs
```
✅ GET /api/scripts/{id}/content → 200 OK
✅ WebSocket connection accepted
❌ Error broadcasting: "Unexpected ASGI message 'websocket.send', after sending 'websocket.close'"
✅ Connection closed
```

**Analysis**: WebSocket connects but immediately closes (secondary issue), but content is fetched successfully.

### Frontend Console Logs
```
✅ [ScriptEditor] Script content response: { blocks: 2000+ }
✅ [ScriptYjsCollaboration] Connecting to WebSocket
✅ [ScriptYjsCollaboration] Status: connected
✅ [ScriptYjsCollaboration] Synced: true
❌ [ScriptEditor] Before sync - sharedRoot length: 0 editor.children length: 0
❌ [ScriptEditor] Received invalid editor value, ignoring
```

**Analysis**: Confirms Yjs doc is empty (sharedRoot length: 0) and never gets seeded.

### Data Flow Validation
```
✅ API Response → Page Component: 2000+ content_blocks received
✅ Page Component → ScriptEditorWithAutosave: initialContent passed
✅ ScriptEditorWithAutosave → ScriptEditorWithCollaboration: initialContent passed
❌ ScriptEditorWithCollaboration: seedContentRef populated BUT seedDocIfNeeded() never called
❌ Yjs Document: Empty (sharedRoot.length = 0)
❌ Slate Editor: Empty (editor.children.length = 0)
```

---

## Proposed Fix Strategy

### Option 1: Direct Provider Event Listener (RECOMMENDED)

**Pattern**: Match scene-level editor implementation exactly

**Implementation**:
```typescript
// In script-editor-with-collaboration.tsx useEffect

useEffect(() => {
  if (!doc || !editor) return;

  const sharedRoot = doc.getArray('content');
  const meta = doc.getMap('wr_meta');

  // ... syncEditorFromYjs and handleDocUpdate functions ...

  doc.on('update', handleDocUpdate);

  const cleanupTasks: Array<() => void> = [];

  // NEW: Listen for provider sync events
  if (provider) {
    const handleSynced = (event: any) => {
      const synced = typeof event === 'boolean' ? event : !!event?.synced;
      if (synced) {
        seedDocIfNeeded();
      }
    };

    provider.on('synced', handleSynced);
    cleanupTasks.push(() => provider.off('synced', handleSynced));

    // Check if already synced
    if ((provider as any).synced) {
      seedDocIfNeeded();
    }
  } else {
    // No provider (edge case) - seed immediately
    seedDocIfNeeded();
  }

  return () => {
    doc.off('update', handleDocUpdate);
    cleanupTasks.forEach(fn => {
      try { fn() } catch {}
    });
  };
}, [doc, editor, provider, scriptId]); // Added provider to deps
```

**Advantages:**
- ✅ Proven pattern (scene-level editor uses this)
- ✅ Handles all timing scenarios
- ✅ Proper cleanup
- ✅ No breaking changes to hook API

**Disadvantages:**
- ⚠️ Direct provider access (coupling to y-websocket)

---

### Option 2: Hook-Level Sync Event (ALTERNATIVE)

**Pattern**: Expose sync event callback from useScriptYjsCollaboration hook

**Hook Modification** (`use-script-yjs-collaboration.ts`):
```typescript
export interface UseScriptYjsCollaborationOptions {
  scriptId: string;
  authToken: string;
  enabled?: boolean;
  onSyncStatusChange?: (status: SyncStatus) => void;
  onSynced?: () => void; // NEW callback
}

// Inside hook
useEffect(() => {
  if (!provider) return;

  const handleSynced = (synced: boolean) => {
    if (synced) {
      onSynced?.(); // Fire callback
    }
  };

  provider.on('synced', handleSynced);
  return () => provider.off('synced', handleSynced);
}, [provider, onSynced]);
```

**Component Usage**:
```typescript
const { doc, provider, awareness, syncStatus } = useScriptYjsCollaboration({
  scriptId,
  authToken,
  enabled: true,
  onSyncStatusChange,
  onSynced: () => {
    // This fires when WebSocket syncs
    seedDocIfNeeded();
  }
});
```

**Advantages:**
- ✅ Cleaner separation of concerns
- ✅ No direct provider access in component
- ✅ Consistent with onSyncStatusChange pattern

**Disadvantages:**
- ⚠️ Requires hook modification
- ⚠️ Still need immediate check for already-synced case

---

### Option 3: Reactive syncStatus Dependency (NOT RECOMMENDED)

**Pattern**: Add syncStatus to useEffect deps and rely on status changes

**Implementation**:
```typescript
useEffect(() => {
  if (!doc || !editor) return;

  // Seed when synced
  if (syncStatus === 'synced') {
    seedDocIfNeeded();
  }
}, [doc, editor, syncStatus, scriptId]); // syncStatus dependency
```

**Why NOT Recommended:**
- ❌ useEffect runs on EVERY status change (connecting → connected → synced)
- ❌ Unnecessary re-execution during connection phase
- ❌ May cause seeding logic to run multiple times
- ❌ Less efficient than event-driven approach

---

## Recommended Solution

**Adopt Option 1** - Direct Provider Event Listener

**Rationale:**
1. **Proven Pattern**: Scene-level editor uses this exact approach and works
2. **Minimal Changes**: Single file modification, no API changes
3. **Complete Coverage**: Handles all timing scenarios
4. **Battle-Tested**: This pattern is already in production for scenes

**Risk Assessment:**
- **Breaking Changes**: None
- **Test Coverage**: Existing scene-level tests validate pattern
- **Rollback**: Simple (revert single file)

---

## Implementation Checklist

- [ ] Modify `script-editor-with-collaboration.tsx` useEffect (lines 149-237)
- [ ] Add provider event listener with handleSynced callback
- [ ] Add immediate provider.synced check
- [ ] Add provider to useEffect dependencies
- [ ] Add cleanup for provider event listener
- [ ] Test with existing script content (2000+ blocks)
- [ ] Verify WebSocket connection/disconnection handling
- [ ] Validate seeding only happens once per session
- [ ] Check for memory leaks in cleanup

---

## Secondary Issue: WebSocket Immediate Closure

**Evidence from backend logs:**
```
Error broadcasting to user...: Unexpected ASGI message 'websocket.send', after sending 'websocket.close'
```

**Analysis**: The WebSocket connects but immediately closes. This is a separate issue from seeding.

**Hypothesis**: The backend WebSocket handler may be closing the connection prematurely, possibly due to:
- Message handling race condition
- Error in initial message processing
- Authentication/authorization issue after connection

**Priority**: 🟡 Medium (doesn't prevent basic functionality once seeding is fixed, but prevents real-time collaboration)

**Recommended Action**: Address after fixing primary seeding issue.

---

## Validation Plan

### Test Scenarios

1. **Fresh Load**
   - Navigate to script editor with existing script
   - Expected: Content displays immediately after WebSocket sync

2. **Already Synced**
   - Component remounts when provider already synced
   - Expected: Content displays immediately without waiting

3. **Slow Connection**
   - Simulate slow WebSocket sync (throttle network)
   - Expected: Content displays after sync completes

4. **Connection Failure**
   - Disable WebSocket server
   - Expected: Graceful fallback (no crash, error message)

### Success Criteria

- ✅ Script content displays within 1 second of page load
- ✅ No blank editor state after sync
- ✅ Console shows "Seeded Y.Doc with initial content"
- ✅ editor.children.length > 0
- ✅ sharedRoot.length > 0
- ✅ No memory leaks (provider listeners cleaned up)

---

## Conclusion

**Root Cause**: Seeding logic race condition - only checks sync status once instead of listening for sync events

**Recommended Fix**: Implement provider event listener pattern (Option 1)

**Confidence Level**: 🟢 High - Pattern proven in scene-level editor

**Implementation Time**: ~15 minutes (single file modification)

**Testing Time**: ~15 minutes (validate all scenarios)

**Risk**: 🟢 Low - Well-understood change, proven pattern, easy rollback
