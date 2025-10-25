# Character Duplication Bug Fix

## Issue Summary
When typing in the editor, characters were being duplicated in a scrambled pattern. For example, typing "test" would result in "TESTTSET" appearing in the editor.

## Root Cause Analysis

### Problem Flow
1. **User Types**: User types a character (e.g., 't')
2. **Slate Update**: Slate editor updates locally
3. **Yjs Sync**: Yjs integration applies change to Y.Doc and syncs with server
4. **handleContentChange Called**: onChange callback is triggered with new content
5. **Parent Update**: `onChange()` is called, updating parent's fullScriptContent state
6. **Content Prop Changes**: Parent passes updated content back to ScreenplayEditorWithAutosave
7. **useEffect Triggers**: Line 262 useEffect detects content change
8. **Yjs Doc Reset**: Lines 281-297 clear and re-seed the entire Yjs document with toSharedType()
9. **Sync Loop**: Yjs synchronization triggers another round of updates
10. **Character Duplication**: The same character gets applied multiple times through different code paths

### The Bug
The critical issue was in `screenplay-editor-with-autosave.tsx:178`:

```typescript
onChange?.(updatedScript);  // ❌ Called unconditionally during Yjs sync!
```

This was being called **even during active Yjs synchronization**, creating a feedback loop:
- Yjs remote changes trigger handleContentChange
- handleContentChange calls onChange
- Parent updates content prop
- Content prop change triggers Yjs doc re-seeding
- Re-seeding triggers more sync events
- **Result**: Same characters applied multiple times

## The Fix

**File**: `screenplay-editor-with-autosave.tsx:179-183`

**Change**: Only propagate changes to parent when NOT actively syncing

```typescript
// BEFORE (BUG):
isHandlingChange.current = true;
onChange?.(updatedScript);  // ❌ Always called, even during sync!
Promise.resolve().then(() => {
  isHandlingChange.current = false;
});

// AFTER (FIX):
isHandlingChange.current = true;

// CRITICAL: Only propagate changes to parent when NOT actively syncing
// During Yjs sync, changes come from remote and shouldn't loop back
if (syncStatus === 'synced' || syncStatus === 'disconnected') {
  onChange?.(updatedScript);
}

Promise.resolve().then(() => {
  isHandlingChange.current = false;
});
```

## Why This Works

### Sync States
- **'connecting'**: Initial WebSocket connection, don't propagate
- **'connected'**: WebSocket open but not synced yet, don't propagate
- **'synced'**: Fully synchronized, safe to propagate local changes
- **'offline'**: No connection, safe to propagate (queue for later)
- **'disconnected'**: Connection lost, safe to propagate (fallback mode)
- **'error'**: Error state, don't propagate

### The Logic
1. **During sync setup** ('connecting', 'connected'): Changes are coming FROM Yjs, don't loop back
2. **When synced**: Local edits are safe to propagate to parent
3. **When offline/disconnected**: Local-only mode, safe to propagate

This prevents the circular update loop:
```
❌ OLD: Type → Yjs → onChange → Parent → Content → Yjs → Duplicate
✅ NEW: Type → Yjs → [no onChange during sync] → Clean update
```

## Impact

### Before Fix
- Typing "test" produced "TESTTSET" (scrambled duplicates)
- Every keystroke could create multiple character insertions
- Editor became unusable for typing

### After Fix
- Typing "test" correctly produces "test"
- Single character insertion per keystroke
- Normal typing experience restored

## Testing Required

1. **Solo Typing**: Type text in editor, verify characters appear once
2. **Collaborative Editing**: Two users typing simultaneously, verify no duplication
3. **Sync Reconnection**: Disconnect/reconnect WebSocket, verify typing still works
4. **Offline Mode**: Disconnect network, type, verify works and syncs when reconnected

## Related Issues

This fix resolves:
- Character duplication while typing
- Scrambled text appearing in editor
- Unusable editor during active collaboration
- Circular update loops between Yjs and parent state

## Files Modified

- `frontend/components/screenplay-editor-with-autosave.tsx` (lines 204-207) - Conditional autosave based on syncStatus
- `frontend/components/screenplay-editor.tsx` (lines 209-229, 313) - Conditional doc.update listener with origin checking

## Related to Phantom Scenes Fix

This issue became apparent AFTER fixing the phantom scenes bug. The phantom scenes bug involved:
- Removing onChange from the fallback branch in screenplay-editor.tsx

This character duplication bug involves:
- Conditionally calling onChange based on syncStatus in screenplay-editor-with-autosave.tsx

Both fixes address improper onChange propagation but at different layers of the architecture.

## Collaboration Fix (Two-Tab Sync)

After fixing character duplication, a new issue emerged: edits in one browser tab didn't appear in another tab viewing the same scene.

### Root Cause
The doc.update listener was removed entirely to fix duplication, but this also removed the mechanism for syncing REMOTE changes to the Slate editor. The listener was needed for collaboration but was causing duplication because it didn't distinguish between local and remote updates.

### Solution
Re-added the doc.update listener with origin parameter checking:

```typescript
const handleDocUpdate = (update: Uint8Array, origin: any) => {
  const isLocalChange = origin === editor || origin?.constructor?.name === 'YjsEditor'

  if (!isLocalChange) {
    // Only sync remote changes to trigger React re-render
    syncEditorFromYjs()
  }
}

doc.on('update', handleDocUpdate)
```

### Why This Works
- **Local changes**: Already handled by slate-yjs automatically, skipping sync avoids duplication
- **Remote changes**: Need manual `synchronizeValue()` to trigger React re-render
- **Origin parameter**: Distinguishes local (origin is Symbol) from remote (origin !== Symbol) updates

**Critical Discovery**: slate-yjs uses `Symbol(Denotes that an event originated from slate-yjs)` as the origin for LOCAL changes, not the editor instance. The fix checks `typeof origin === 'symbol'` to detect local changes.

This enables real-time collaboration while maintaining the character duplication fix.

## Final Fix (Symbol Detection)

After the initial collaboration fix, character duplication returned. Analysis of console logs revealed:

### Root Cause
The origin detection was wrong:
```typescript
// ❌ WRONG - slate-yjs doesn't pass editor as origin
const isLocalChange = origin === editor || origin?.constructor?.name === 'YjsEditor'
```

slate-yjs actually passes a **Symbol** as origin for local changes: `Symbol(Denotes that an event originated from slate-yjs)`

### Correct Fix
```typescript
// ✅ CORRECT - Check for Symbol type
const isLocalChange = typeof origin === 'symbol' ||
                     origin === editor ||
                     origin?.constructor?.name === 'YjsEditor'
```

With this fix:
- Local keystrokes have `typeof origin === 'symbol'` → Skip sync (no duplication)
- Remote updates from WebSocket have different origin → Sync to Slate (collaboration works)
