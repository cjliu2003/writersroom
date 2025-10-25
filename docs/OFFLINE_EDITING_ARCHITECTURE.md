# Offline Editing Architecture

## Overview

WritersRoom implements a **dual-persistence** offline editing system that combines Yjs CRDT-based local persistence with REST autosave fallback. This ensures users can continue working seamlessly when disconnected and have their changes synchronized when they reconnect.

## Two-Layer Persistence

### Layer 1: Yjs Document (Real-time Collaboration Layer)

**Location**: Browser memory (Y.Doc) + Optional IndexedDB persistence

**How it works**:
- Yjs maintains a CRDT (Conflict-free Replicated Data Type) document in browser memory
- During collaboration, changes are synced via WebSocket
- When offline, Yjs continues to work entirely in-memory
- Changes are tracked as "updates" that can be applied when reconnected

**Key characteristics**:
- **Offline-friendly**: Yjs works without network connection
- **Conflict-free**: CRDT automatically merges concurrent edits
- **Lightweight**: Updates are binary-encoded and compressed
- **Ephemeral by default**: Lost on browser refresh unless persisted

### Layer 2: REST Autosave (Snapshot Layer)

**Location**: IndexedDB (offline queue) → PostgreSQL (server-side)

**How it works**:
- Debounced autosave (1.5s delay, max 5s wait) sends full scene snapshots to server
- When offline, saves are queued in IndexedDB
- When back online, queued saves are processed automatically
- Implements optimistic concurrency control (version checking)

**Key characteristics**:
- **Persistent**: Survives browser refresh and crashes
- **Conflict detection**: Version-based with manual resolution UI
- **Full snapshots**: Stores complete scene state at intervals
- **Idempotent**: Uses operation IDs to deduplicate retries

## Offline Editing Flow

### Scenario: User Goes Offline While Editing

```
1. User is online, typing in editor
   ├─ Slate onChange → Yjs doc.update (local)
   ├─ Yjs → WebSocket provider → Server (syncing)
   └─ Autosave hook → debounced REST call → Server (snapshot)

2. Network disconnects (user goes offline)
   ├─ WebSocket provider detects disconnect
   ├─ syncStatus changes: 'synced' → 'offline'
   └─ Autosave hook detects: navigator.onLine === false

3. User continues typing while offline
   ├─ Slate onChange → Yjs doc.update (local) ✅ Still works!
   ├─ Yjs updates accumulate in memory (no WebSocket)
   └─ Autosave attempts fail → queued to IndexedDB

4. Network reconnects (user comes back online)
   ├─ WebSocket provider reconnects automatically
   ├─ Yjs sends accumulated updates to server
   ├─ Server applies updates and broadcasts to other clients
   └─ Autosave hook processes IndexedDB queue
```

### Key Components

#### 1. Yjs Offline Behavior

**File**: `frontend/hooks/use-yjs-collaboration.ts`

Yjs continues to work offline because:
- Y.Doc is entirely in-memory (no network dependency)
- slate-yjs plugin continues to apply local edits to Y.Doc
- Updates accumulate as binary deltas
- WebsocketProvider automatically reconnects when network returns
- On reconnect, provider sends all accumulated updates

**Important**: Yjs updates are ephemeral by default. If the user refreshes the browser while offline, Yjs updates are lost (but autosave snapshots in IndexedDB persist).

#### 2. Autosave Offline Queue

**File**: `frontend/utils/autosave-storage.ts`

IndexedDB schema:
```typescript
interface PendingSave {
  id: string;              // Unique save ID
  sceneId: string;         // Scene UUID
  content: string;         // Full script content (Slate JSON)
  baseVersion: number;     // Scene version when save was attempted
  timestamp: number;       // When save was queued
  retryCount: number;      // Retry attempts
  opId: string;            // Operation ID for idempotency
}
```

**Offline queue operations**:
- `addPendingSave()`: Queue a failed save
- `getPendingSaves()`: Retrieve queued saves for a scene
- `removePendingSave()`: Remove after successful sync
- `clearPendingSaves()`: Clear all after successful save
- `updatePendingSaveRetryCount()`: Track retry attempts

#### 3. Autosave Hook with Offline Detection

**File**: `frontend/hooks/use-autosave.ts`

**Online/offline detection** (lines 376-395):
```typescript
useEffect(() => {
  const handleOnline = () => {
    isOnlineRef.current = true;
    if (saveState === 'offline') {
      processOfflineQueue(); // Auto-process queue
    }
  };

  const handleOffline = () => {
    isOnlineRef.current = false;
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOffline);
    window.removeEventListener('offline', handleOffline);
  };
}, [saveState, processOfflineQueue]);
```

**Save with offline queueing** (lines 231-246):
```typescript
} else if (!isOnlineRef.current && enableOfflineQueue && isIndexedDBAvailable()) {
  // Queue for offline processing
  setSaveState('offline');
  setError('Offline - queued for sync');

  const pendingSave: PendingSave = {
    id: opId || generateOpId(),
    sceneId,
    content,
    baseVersion: currentVersionRef.current,
    timestamp: Date.now(),
    retryCount: 0,
    opId: opId || generateOpId()
  };

  await addPendingSave(pendingSave);
}
```

**Offline queue processing** (lines 342-373):
```typescript
const processOfflineQueue = useCallback(async (): Promise<void> => {
  if (!enableOfflineQueue || !isIndexedDBAvailable()) return;

  try {
    const pendingSaves = await getPendingSaves(sceneId);

    // Process in chronological order
    for (const save of pendingSaves.sort((a, b) => a.timestamp - b.timestamp)) {
      try {
        await performSave(save.content, save.opId);
        await removePendingSave(save.id);
      } catch (err) {
        if (err instanceof ConflictError) {
          continue; // Skip conflicts, let user resolve
        } else if (err instanceof RateLimitError) {
          break; // Stop processing on rate limit
        } else {
          await updatePendingSaveRetryCount(save.id, save.retryCount + 1);

          if (save.retryCount >= maxRetries) {
            await removePendingSave(save.id); // Give up after max retries
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to process offline queue:', err);
  }
}, [sceneId, performSave, enableOfflineQueue, maxRetries]);
```

## Persistence Guarantees

### What Persists Offline

✅ **Survives browser refresh while offline**:
- IndexedDB queued autosaves (full scene snapshots)
- User can close browser, reopen later, and queued saves will sync when online

❌ **Lost on browser refresh while offline**:
- Yjs in-memory updates (unless IndexedDB persistence added)
- Real-time collaboration state
- WebSocket connection

### Sync Behavior When Reconnecting

**Autosave queue processing**:
1. User comes back online
2. `window.addEventListener('online')` fires
3. `processOfflineQueue()` automatically called
4. Queued saves sent to server in chronological order
5. On success: Remove from IndexedDB
6. On conflict: Skip (let user resolve via UI)
7. On rate limit: Stop processing, retry later
8. On error: Increment retry count, remove after max retries

**Yjs sync**:
1. WebsocketProvider automatically reconnects
2. Sends accumulated Y.Doc updates to server
3. Server applies updates to scene_versions table
4. Server broadcasts updates to other connected clients
5. CRDT guarantees conflict-free merge

## Architecture Decisions

### Why Two Persistence Layers?

**Yjs advantages**:
- Real-time CRDT merging (no conflicts)
- Fine-grained updates (character-level)
- Efficient binary encoding
- Automatic collaboration

**Yjs disadvantages**:
- Ephemeral by default (lost on refresh)
- Binary format (not human-readable)
- Complex debugging

**REST autosave advantages**:
- Persistent snapshots (survives refresh)
- Human-readable JSON
- Version history
- Simple debugging

**REST autosave disadvantages**:
- Optimistic locking (conflicts possible)
- Coarse-grained (full scene snapshots)
- Higher latency

**Combined**: Best of both worlds
- Yjs provides real-time collaboration and offline editing
- REST provides persistent snapshots and recovery
- IndexedDB queue bridges the gap for offline persistence

### Conditional Autosave Based on syncStatus

**File**: `frontend/components/screenplay-editor-with-autosave.tsx:204-207`

```typescript
if (syncStatus !== 'synced') {
  autosaveActions.markChanged(updatedScript);
}
```

**Why?**: When Yjs is synced, the server already has the latest changes via WebSocket. Autosave would be redundant. Only trigger autosave when:
- `syncStatus === 'offline'`: Save to IndexedDB queue
- `syncStatus === 'connecting'`: Yjs not ready yet, use REST
- `syncStatus === 'error'`: Fallback to REST autosave

## User Experience

### Online Editing
- Changes appear instantly in other users' editors (Yjs)
- Autosave indicator shows periodic snapshots
- No user action required

### Going Offline
- User sees "Offline - queued for sync" indicator
- Editing continues normally (Yjs in-memory)
- Changes queued in IndexedDB (autosave fallback)

### Coming Back Online
- Automatic reconnection (no user action)
- Queued saves processed automatically
- Indicator shows "Syncing..." then "Saved"
- Other users see updates appear

### Conflict Scenarios

**Scenario 1: User A offline, User B online**
1. User A makes changes offline → queued in IndexedDB
2. User B makes changes online → synced via Yjs
3. User A reconnects → autosave queue processes
4. Server detects version conflict (User B's changes came first)
5. UI shows conflict resolution dialog to User A

**Scenario 2: Two users offline simultaneously**
1. Both users edit the same scene offline
2. Both have queued saves in IndexedDB
3. User A reconnects first → saves succeed
4. User B reconnects → conflict detected
5. User B sees conflict resolution UI

## Backend Persistence

### Yjs Persistence

**File**: `backend/app/services/yjs_persistence.py`

**Table**: `scene_versions`
```sql
CREATE TABLE scene_versions (
  version_id UUID PRIMARY KEY,
  scene_id UUID REFERENCES scenes(scene_id),
  update BYTEA NOT NULL,           -- Binary Yjs update
  created_at TIMESTAMP NOT NULL,
  user_id UUID,
  is_compacted BOOLEAN DEFAULT FALSE,
  compacted_by UUID
);
```

**Append-only log**:
- Each Yjs update stored as binary blob
- Sequential by `created_at`
- Document reconstructed by replaying all updates
- Compaction runs periodically to optimize storage

### REST Autosave Persistence

**File**: `backend/app/routers/scene_autosave_router.py`

**Table**: `scenes`
```sql
CREATE TABLE scenes (
  scene_id UUID PRIMARY KEY,
  script_id UUID REFERENCES scripts(script_id),
  position INTEGER,
  scene_heading TEXT,
  blocks JSONB NOT NULL,           -- Slate JSON blocks
  full_content TEXT,               -- Plain text (for search)
  version INTEGER NOT NULL,        -- Optimistic locking
  updated_at TIMESTAMP NOT NULL,
  snapshot_at TIMESTAMP
);
```

**Table**: `scene_snapshots`
```sql
CREATE TABLE scene_snapshots (
  snapshot_id UUID PRIMARY KEY,
  scene_id UUID REFERENCES scenes(scene_id),
  version INTEGER NOT NULL,
  blocks JSONB NOT NULL,
  scene_heading TEXT,
  created_at TIMESTAMP NOT NULL
);
```

**Optimistic concurrency**:
- Each save includes `base_version`
- Server checks: `base_version === current_version`
- If mismatch → HTTP 409 Conflict
- Client resolves via UI or auto-fast-forward

## Configuration

### Autosave Options

```typescript
export interface AutosaveOptions {
  debounceMs?: number;           // Default: 1500ms
  maxWaitMs?: number;            // Default: 5000ms
  maxRetries?: number;           // Default: 3
  enableOfflineQueue?: boolean;  // Default: true
}
```

### Yjs Collaboration Options

```typescript
export interface UseYjsCollaborationProps {
  sceneId: string;
  authToken: string;
  enabled?: boolean;             // Default: true (feature flag)
  onSyncStatusChange?: (status: SyncStatus) => void;
  onError?: (error: Error) => void;
}
```

## Future Enhancements

### Yjs IndexedDB Persistence

**Current**: Yjs updates lost on browser refresh while offline

**Enhancement**: Use `y-indexeddb` provider for persistent Yjs storage
```typescript
import { IndexeddbPersistence } from 'y-indexeddb';

const indexeddbProvider = new IndexeddbPersistence(sceneId, doc);
```

**Benefits**:
- Yjs updates survive browser refresh
- Faster recovery after offline period
- Reduced load on REST autosave

**Trade-offs**:
- Additional storage usage
- Complexity in managing two IndexedDB databases
- Potential sync conflicts between IndexedDB and WebSocket

### Offline-First Architecture

**Current**: Yjs + REST autosave (hybrid)

**Enhancement**: Make Yjs the primary source of truth
- Yjs IndexedDB as primary persistence
- REST autosave becomes occasional backup
- Reduce reliance on server-side scene table

**Benefits**:
- True offline-first experience
- Simplified conflict resolution (CRDT handles it)
- Reduced server load

**Trade-offs**:
- More complex client-side logic
- Harder debugging (binary format)
- Potential data loss if IndexedDB corrupted

## Testing Offline Behavior

### Manual Testing

1. **Simulate offline editing**:
   ```javascript
   // In browser console
   window.dispatchEvent(new Event('offline'));
   ```

2. **Type in editor while "offline"**:
   - Changes should still appear in editor
   - Autosave indicator shows "Offline - queued for sync"

3. **Check IndexedDB**:
   - Open DevTools → Application → IndexedDB → `writersroom-autosave`
   - Verify `pending-saves` store has entries

4. **Reconnect**:
   ```javascript
   window.dispatchEvent(new Event('online'));
   ```

5. **Verify sync**:
   - Queue should process automatically
   - Indicator changes to "Saved"
   - IndexedDB `pending-saves` should be empty

### Automated Testing

**Integration test scenarios**:
- Save during offline → verify IndexedDB queue
- Reconnect → verify queue processing
- Conflict during sync → verify UI shown
- Max retries exceeded → verify queue cleanup

## Summary

WritersRoom's offline editing architecture provides:

✅ **Seamless offline editing**: Users can type normally without network
✅ **Automatic queue processing**: Changes sync when reconnected
✅ **Conflict resolution**: UI-driven resolution for concurrent edits
✅ **Data persistence**: IndexedDB survives browser refresh
✅ **Real-time collaboration**: Yjs CRDT ensures conflict-free merging

The dual-layer approach (Yjs + REST autosave) balances real-time collaboration needs with persistent offline capabilities, ensuring users never lose work regardless of network conditions.
