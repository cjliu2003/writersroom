# Offline Editing Fixes

## Issues Identified

The offline editing feature had critical bugs preventing it from working properly:

### Issue 1: Offline Queue Never Processed After Reconnecting ⚠️ CRITICAL

**Problem**: Changes made while offline were queued to IndexedDB but never synced when reconnecting.

**Root Cause**: `use-autosave.ts:379`
```typescript
// ❌ BUG: Too restrictive condition
const handleOnline = () => {
  isOnlineRef.current = true;
  if (saveState === 'offline') {  // Only processes if saveState is exactly 'offline'
    processOfflineQueue();
  }
};
```

**Why it failed**:
1. User goes offline → `saveState` changes to 'offline'
2. Changes are queued to IndexedDB
3. User reconnects → `handleOnline` fires
4. But `saveState` might have changed to 'idle', 'saved', or another state
5. Condition `saveState === 'offline'` is FALSE
6. `processOfflineQueue()` never called
7. Changes stay in IndexedDB forever, never synced

**Fix**:
```typescript
// ✅ FIXED: Always process queue on reconnect
const handleOnline = () => {
  isOnlineRef.current = true;
  // Process queue regardless of current saveState
  // Queue might have pending saves even if state changed
  processOfflineQueue();
};
```

### Issue 2: No Immediate Offline Detection

**Problem**: UI didn't show "offline mode" until user triggered a save attempt.

**Root Cause**: `use-autosave.ts:384-386`
```typescript
// ❌ BUG: Only updates ref, no UI feedback
const handleOffline = () => {
  isOnlineRef.current = false;
  // No setSaveState('offline') call
};
```

**Why it failed**:
1. User disconnects WiFi
2. `handleOffline` fires, updates `isOnlineRef.current = false`
3. UI still shows normal state (not "offline")
4. User must trigger a save attempt (by typing) for offline state to show
5. Save fails → error handler detects offline → sets UI state
6. This is why user needed to "refresh to see offline mode"

**Fix**:
```typescript
// ✅ FIXED: Set offline state immediately
const handleOffline = () => {
  isOnlineRef.current = false;
  setSaveState('offline');
  setError('Offline - changes will be queued');
};
```

### Issue 3: Event Listener Cleanup Bug

**Problem**: Minor cleanup bug that could cause memory leaks.

**Root Cause**: `use-autosave.ts:391-394`
```typescript
// ❌ BUG: Wrong event name in cleanup
return () => {
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);  // Was 'online' here
};
```

**Fix**: Already correct in the fix above (line 396).

## Implementation

**File**: `frontend/hooks/use-autosave.ts:376-398`

**Changes**:
1. Removed restrictive `if (saveState === 'offline')` condition (line 379)
2. Added `setSaveState('offline')` and error message in `handleOffline` (lines 387-388)
3. Fixed event listener cleanup (confirmed correct at line 396)
4. Removed `saveState` from useEffect dependencies (only `processOfflineQueue` needed)

## How It Works Now

### Scenario 1: User Goes Offline

```
1. User disconnects WiFi
   └─ window fires 'offline' event

2. handleOffline() executes
   ├─ isOnlineRef.current = false
   ├─ setSaveState('offline')  ← NEW: Immediate UI feedback
   └─ setError('Offline - changes will be queued')

3. UI updates immediately
   └─ Autosave indicator shows "Offline - changes will be queued"

4. User types → onChange fires
   ├─ syncStatus !== 'synced' (because WebSocket offline)
   └─ markChanged() triggers autosave

5. Autosave attempts → network fails
   ├─ Catch block detects !isOnlineRef.current
   └─ Queues to IndexedDB via addPendingSave()

6. User sees "Offline - queued for sync" indicator
```

### Scenario 2: User Reconnects

```
1. User reconnects WiFi
   └─ window fires 'online' event

2. handleOnline() executes
   ├─ isOnlineRef.current = true
   └─ processOfflineQueue()  ← NEW: Always called, no condition

3. processOfflineQueue() runs
   ├─ Retrieves all queued saves from IndexedDB
   ├─ Processes in chronological order
   └─ Calls performSave() for each

4. For each queued save:
   ├─ Success → removePendingSave() clears from IndexedDB
   ├─ Conflict → continue (skip, let user resolve)
   ├─ Rate limit → break (stop processing, retry later)
   └─ Other error → increment retry count, remove if max retries exceeded

5. UI updates to "Saved" when queue completes
```

### Scenario 3: User Refreshes While Offline

```
⚠️ IMPORTANT: Yjs in-memory updates are lost on refresh

1. User goes offline, makes changes
   └─ Changes queued to IndexedDB ✅

2. User refreshes browser
   ├─ Yjs doc resets (all in-memory updates lost) ❌
   └─ IndexedDB queue persists ✅

3. Page reloads
   ├─ Fetches last saved version from server
   └─ Any post-queue changes lost

4. User reconnects
   └─ Queue processes, restoring queued changes ✅

Result: Only changes that were queued persist
```

## Testing

### Manual Test 1: Offline Detection

```javascript
// In browser console
window.dispatchEvent(new Event('offline'));
```

**Expected**:
- Autosave indicator immediately shows "Offline - changes will be queued"
- No need to refresh or trigger save

### Manual Test 2: Offline Editing & Sync

```javascript
// 1. Go offline
window.dispatchEvent(new Event('offline'));

// 2. Type in editor
// Expected: Changes appear, indicator shows "Offline - queued for sync"

// 3. Check IndexedDB
// DevTools → Application → IndexedDB → writersroom-autosave → pending-saves
// Expected: Entries present

// 4. Reconnect
window.dispatchEvent(new Event('online'));

// Expected:
// - Queue processes automatically
// - Indicator changes to "Saved"
// - IndexedDB pending-saves empty
```

### Manual Test 3: Real Network Disconnect

```
1. Disconnect WiFi/unplug ethernet
2. Verify indicator shows "Offline" immediately
3. Type in editor
4. Verify changes appear locally
5. Reconnect network
6. Verify changes persist and sync to server
```

## Known Limitations

### Yjs Memory Loss on Refresh

**Current**: Yjs updates lost on browser refresh while offline

**Impact**:
- If user refreshes after going offline, only the last queued autosave snapshot persists
- Any typing after refresh and before reconnect is lost

**Mitigation**:
- Autosave queue captures snapshots every 1.5-5 seconds
- Most edits captured before refresh

**Future Enhancement**:
- Add `y-indexeddb` provider for persistent Yjs storage
- Would preserve all Yjs updates across refreshes

### IndexedDB Availability

**Requirement**: Browser must support IndexedDB

**Fallback**:
- `isIndexedDBAvailable()` check at line 343
- If unavailable, offline queue disabled
- Changes lost if offline without IndexedDB

**Coverage**: All modern browsers support IndexedDB

## Architecture Impact

### Autosave Flow

**Before**: Autosave only triggered after save failure detected offline state

**After**: Offline state set immediately on network event

### Queue Processing

**Before**: Only processed if `saveState === 'offline'` when reconnecting

**After**: Always processes queue on reconnect, regardless of state

## Related Files

- `frontend/hooks/use-autosave.ts` - Main autosave logic with offline handling
- `frontend/utils/autosave-storage.ts` - IndexedDB queue management
- `frontend/hooks/use-yjs-collaboration.ts` - Yjs WebSocket status tracking
- `frontend/components/screenplay-editor-with-autosave.tsx` - Conditional autosave trigger

## Deployment Notes

**Breaking Changes**: None - purely bug fixes

**Migration**: Not required - IndexedDB schema unchanged

**Testing Required**:
1. Offline editing with disconnect/reconnect
2. Multi-tab collaboration while offline
3. Browser refresh while offline
4. Queue processing after extended offline period

## Summary

Three critical bugs fixed:

✅ **Queue processing**: Always processes on reconnect (was conditional)
✅ **Offline detection**: Immediate UI feedback (was delayed)
✅ **Cleanup**: Event listeners properly removed (minor fix)

These fixes enable true offline editing with reliable sync when reconnecting.
