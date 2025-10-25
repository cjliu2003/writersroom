# Offline Editing Debugging Guide

## Comprehensive Logging Added

I've added detailed console logging throughout the entire offline editing flow to help diagnose why changes aren't persisting after reconnect + refresh.

## How to Test with Logging

### Step 1: Open Browser Console

1. Open your app in the browser
2. Press F12 or Cmd+Option+I (Mac) to open DevTools
3. Go to the Console tab
4. Clear the console (Cmd+K or Ctrl+L)

### Step 2: Simulate Offline Editing

```javascript
// 1. Go offline
window.dispatchEvent(new Event('offline'));
```

**Expected logs**:
```
📴 Network OFFLINE detected
```

### Step 3: Make Changes

Type in the editor. After 1.5 seconds, you should see:

**Expected logs**:
```
🔄 debouncedSave called: { sceneId: "...", contentLength: 2345, hasChanged: true }
⏰ Setting up autosave timers
⏰ Debounce timer fired, saving now
💾 Starting save to server: { sceneId: "...", baseVersion: 1 }
💥 Save failed: { error: TypeError, errorType: "TypeError", isOnline: false, enableOfflineQueue: true, hasIndexedDB: true }
📦 Queueing save to IndexedDB: { sceneId: "...", contentLength: 2345, baseVersion: 1 }
✅ Save queued successfully to IndexedDB
```

### Step 4: Verify IndexedDB Queue

1. In DevTools, go to **Application** tab
2. Expand **IndexedDB** → **writersroom-autosave** → **pending-saves**
3. **Verify**: You should see one or more entries

**What to check**:
- `id`: Unique save ID
- `sceneId`: Scene UUID
- `content`: Full script content (should be a long JSON string)
- `timestamp`: When it was queued
- `retryCount`: Should be 0

### Step 5: Reconnect

```javascript
// 2. Go online
window.dispatchEvent(new Event('online'));
```

**Expected logs**:
```
🌐 Network ONLINE detected
📥 Processing offline queue: { sceneId: "...", queueLength: 1, saves: [{id: "...", timestamp: "...", contentLength: 2345}] }
📤 Attempting to save queued item: "..."
💾 Starting save to server: { sceneId: "...", baseVersion: 1 }
✅ Queued save successful, removed from queue: "..."
✅ Finished processing offline queue
```

### Step 6: Verify Queue Cleared

1. Go back to **Application** → **IndexedDB** → **pending-saves**
2. **Verify**: Should be empty now

### Step 7: Refresh or Navigate Away

1. Refresh the page (Cmd+R or Ctrl+R)
2. **OR** go to home and reopen the script

**Expected**: Your changes should persist

## Debugging Failure Scenarios

### Scenario 1: Queue Not Created

If you don't see:
```
📦 Queueing save to IndexedDB
✅ Save queued successfully to IndexedDB
```

**Possible causes**:
1. `isOnlineRef.current` is still `true` (offline event didn't fire)
2. `enableOfflineQueue` is `false`
3. IndexedDB not available

**What to check in logs**:
```
💥 Save failed: { error: ..., errorType: "...", isOnline: ?, enableOfflineQueue: ?, hasIndexedDB: ? }
```

- If `isOnline: true` → Offline event didn't fire or race condition
- If `enableOfflineQueue: false` → Feature disabled
- If `hasIndexedDB: false` → Browser doesn't support IndexedDB

### Scenario 2: Queue Not Processing

If you see:
```
📴 Network OFFLINE detected
📦 Queueing save to IndexedDB
✅ Save queued successfully to IndexedDB
```

But after reconnect, don't see:
```
🌐 Network ONLINE detected
📥 Processing offline queue
```

**Possible causes**:
1. Online event didn't fire
2. `processOfflineQueue` not being called

**Manual trigger**:
```javascript
// In console after reconnecting
window.dispatchEvent(new Event('online'));
```

### Scenario 3: Queue Processing Fails

If you see:
```
🌐 Network ONLINE detected
📥 Processing offline queue: { queueLength: 1, ... }
📤 Attempting to save queued item: "..."
❌ Queued save failed: { id: "...", error: ... }
```

**Possible causes**:
1. **Version conflict**: Server version changed
2. **Network error**: Still offline despite event
3. **Authentication**: Token expired

**What to check**:
- If `⏭️ Skipping conflicted save` → Version conflict (expected, needs manual resolution)
- If `🛑 Rate limited` → Too many requests
- If other error → Check error message

### Scenario 4: Queue Empty on Reconnect

If you see:
```
🌐 Network ONLINE detected
📥 Processing offline queue: { queueLength: 0, ... }
✅ Queue empty, nothing to process
```

**Possible causes**:
1. Queue was never created (see Scenario 1)
2. Queue was cleared by another tab
3. IndexedDB was cleared

**Verify**:
- Check IndexedDB before refreshing
- Check if multiple tabs are open (they share IndexedDB)

## Common Issues and Solutions

### Issue: isOnline is always true

**Cause**: `navigator.onLine` might not update immediately when WiFi disconnects.

**Solution**: Use manual events for testing:
```javascript
window.dispatchEvent(new Event('offline'));
```

### Issue: Changes lost after refresh

**Cause**: If you refresh BEFORE changes are queued, they're lost.

**Timeline**:
1. Type → onChange fires
2. Wait 1.5s → debounce
3. Save attempts → queues to IndexedDB ✅
4. If you refresh before step 3, changes only in Yjs memory ❌

**Solution**: Wait 2-3 seconds after typing before refreshing while offline.

### Issue: Queue processes but changes don't appear

**Cause**: The queued `content` might be stale.

**Check logs**:
```
📦 Queueing save to IndexedDB: { contentLength: ??? }
```

If `contentLength` is much smaller than expected, the content might not include your offline edits.

**Root cause**: getContent() returns stale data. This would be a bug in screenplay-editor-with-autosave.tsx.

## Real Network Testing

### Disconnect WiFi Method

1. Turn off WiFi
2. **Verify** in console:
   ```javascript
   navigator.onLine  // Should be false
   ```
3. Make changes
4. Check IndexedDB
5. Turn on WiFi
6. **Verify**:
   ```javascript
   navigator.onLine  // Should be true
   ```
7. Check logs for queue processing

### Network Throttling Method (Chrome)

1. DevTools → Network tab
2. Set throttling to "Offline"
3. Make changes
4. Set throttling to "No throttling"
5. Check logs

## Expected Complete Log Flow

```
// Initial state
🟢 Editor loaded

// User goes offline
📴 Network OFFLINE detected

// User types (after 1.5s debounce)
🔄 debouncedSave called: { sceneId: "abc", contentLength: 2345, hasChanged: true }
⏰ Setting up autosave timers
⏰ Debounce timer fired, saving now
💾 Starting save to server: { sceneId: "abc", baseVersion: 1 }
💥 Save failed: { errorType: "TypeError", isOnline: false, enableOfflineQueue: true }
📦 Queueing save to IndexedDB: { sceneId: "abc", contentLength: 2345, baseVersion: 1 }
✅ Save queued successfully to IndexedDB

// User reconnects
🌐 Network ONLINE detected
📥 Processing offline queue: { sceneId: "abc", queueLength: 1 }
📤 Attempting to save queued item: "save-id-123"
💾 Starting save to server: { sceneId: "abc", baseVersion: 1 }
✅ Queued save successful, removed from queue: "save-id-123"
✅ Finished processing offline queue

// User refreshes
🟢 Editor loaded with persisted changes
```

## Next Steps

Please run through the test flow and **paste the console logs** here. This will help me identify exactly where the offline editing flow is breaking.

Specifically, I need to see:
1. ✅ Did offline detection trigger?
2. ✅ Was the save queued to IndexedDB?
3. ✅ Did online detection trigger?
4. ✅ Did queue processing run?
5. ✅ Did the queued save succeed or fail?

The logs will reveal the exact failure point.
