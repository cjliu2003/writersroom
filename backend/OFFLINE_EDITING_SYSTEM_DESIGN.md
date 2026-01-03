# Offline Editing System Design

> **Status**: Design Document
> **Priority**: P1 - Required for proper offline editing support
> **Related**: `YJS_COLLABORATION_FIX_SPEC.md` Phase 2

## Executive Summary

This document describes the system required for robust offline editing support in WritersRoom. The current architecture has most pieces in place but lacks **crash recovery** - the ability to recover unsaved changes when a browser crashes while offline.

---

## Current State Analysis

### Existing Components

| Component | Status | Purpose |
|-----------|--------|---------|
| IndexedDB Queue | ✅ Exists | Stores pending REST saves (`script-autosave-storage.ts`) |
| REST Autosave | ✅ Exists | Fallback when Yjs is unhealthy (`use-script-autosave.ts`) |
| Offline Detection | ✅ Exists | `navigator.onLine` + automatic queue trigger |
| Queue Processing | ✅ Exists | Processes pending saves on reconnect |
| Yjs Collaboration | ✅ Exists | Real-time CRDT sync (`use-script-yjs-collaboration.ts`) |

### The Gap: Crash Recovery

The system correctly handles going offline and coming back online. However, it does NOT handle the scenario where the browser crashes while offline.

---

## Problem Scenario

```
TIMELINE:

T1: User online, editing
    - Yjs syncing to server ✓
    - REST autosave idle

T2: Network drops
    - Yjs status → 'offline'
    - REST autosave activated

T3: User continues editing
    - Changes stored in Yjs (memory only)
    - Changes queued to IndexedDB (persistent) ✓

T4: Browser crashes / tab closed
    - Yjs state LOST (was in memory)
    - IndexedDB SURVIVES (has latest content)

T5: User reopens script
    - REST API returns has_yjs_updates=true
    - WebSocket connects, loads OLD Yjs state from server
    - Frontend trusts Yjs (has_yjs_updates=true)
    - User sees OLD content ❌
    - Offline edits appear "lost"

T6: Queue processing runs
    - IndexedDB has newer content
    - Attempts save with stale baseVersion
    - CONFLICT - versions don't match
```

**Result**: User's offline work is in IndexedDB but the system doesn't know to use it.

---

## Solution: Offline Recovery System

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SCRIPT LOAD                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Check IndexedDB FIRST (before Yjs connection)      │
│  const pending = await getPendingScriptSaves(scriptId)      │
└─────────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          │                                 │
   pending.length > 0                pending = []
          │                                 │
          ▼                                 ▼
┌────────────────────────┐     ┌────────────────────────────┐
│ Step 2: Compare times  │     │ Normal flow:               │
│                        │     │ - Connect Yjs WebSocket    │
│ If IndexedDB newer     │     │ - Trust Yjs as source      │
│ than server:           │     │   of truth                 │
│ → SHOW RECOVERY DIALOG │     └────────────────────────────┘
└────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 3: User Decision                                      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ⚠️  Unsaved Offline Changes Detected                │    │
│  │                                                       │    │
│  │ You have changes from Dec 15, 2:34 PM that weren't  │    │
│  │ synced before your browser closed.                   │    │
│  │                                                       │    │
│  │ Server version: Dec 15, 1:20 PM                      │    │
│  │                                                       │    │
│  │  [🔄 Recover My Changes]   [🗑️ Discard]   [Compare]  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
          │
          ├─── "Recover" ───► Seed Yjs with IndexedDB content
          │                   Clear queue, connect Yjs
          │
          └─── "Discard" ───► Clear IndexedDB queue
                              Normal Yjs load
```

### Data Layer Responsibilities

| Layer | Responsibility | Persistence |
|-------|----------------|-------------|
| **IndexedDB** | Crash recovery store | Browser storage (survives crashes) |
| **Yjs (memory)** | Live collaboration | Memory only (lost on crash) |
| **Yjs (server)** | Collaboration history | `script_versions` table |
| **REST API** | Snapshot backup | `scripts.content_blocks` |

### Data Flow Priorities

1. **On crash recovery**: IndexedDB → Yjs (user choice via dialog)
2. **During normal editing**: Yjs → server (real-time CRDT sync)
3. **When Yjs unhealthy**: Editor → IndexedDB (fallback queue)

---

## Implementation Plan

### Phase 2A: Frontend Offline Recovery (Required)

#### New File: `frontend/hooks/use-offline-recovery.ts`

```typescript
import { useState, useEffect, useCallback } from 'react';
import {
  getPendingScriptSaves,
  clearPendingScriptSaves,
  type PendingScriptSave,
} from '../utils/script-autosave-storage';

export interface OfflineRecoveryState {
  isChecking: boolean;
  hasUnsyncedChanges: boolean;
  pendingContent: any[] | null;
  pendingTimestamp: Date | null;
  serverTimestamp: Date | null;
}

export interface OfflineRecoveryActions {
  recoverChanges: () => Promise<any[]>;
  discardChanges: () => Promise<void>;
}

export function useOfflineRecovery(
  scriptId: string,
  serverUpdatedAt: string | null
): [OfflineRecoveryState, OfflineRecoveryActions] {
  const [state, setState] = useState<OfflineRecoveryState>({
    isChecking: true,
    hasUnsyncedChanges: false,
    pendingContent: null,
    pendingTimestamp: null,
    serverTimestamp: serverUpdatedAt ? new Date(serverUpdatedAt) : null,
  });

  // Check IndexedDB on mount
  useEffect(() => {
    const checkForUnsyncedChanges = async () => {
      try {
        const pendingSaves = await getPendingScriptSaves(scriptId);

        if (pendingSaves.length === 0) {
          setState(prev => ({ ...prev, isChecking: false, hasUnsyncedChanges: false }));
          return;
        }

        // Get most recent pending save
        const sorted = pendingSaves.sort((a, b) => b.timestamp - a.timestamp);
        const latest = sorted[0];
        const pendingTime = new Date(latest.timestamp);
        const serverTime = serverUpdatedAt ? new Date(serverUpdatedAt) : null;

        // Check if pending save is newer than server
        const hasNewer = serverTime ? pendingTime > serverTime : true;

        setState({
          isChecking: false,
          hasUnsyncedChanges: hasNewer,
          pendingContent: hasNewer ? latest.contentBlocks : null,
          pendingTimestamp: hasNewer ? pendingTime : null,
          serverTimestamp: serverTime,
        });
      } catch (error) {
        console.error('[OfflineRecovery] Check failed:', error);
        setState(prev => ({ ...prev, isChecking: false, hasUnsyncedChanges: false }));
      }
    };

    if (scriptId) {
      checkForUnsyncedChanges();
    }
  }, [scriptId, serverUpdatedAt]);

  const recoverChanges = useCallback(async (): Promise<any[]> => {
    if (!state.pendingContent) {
      throw new Error('No pending content to recover');
    }

    const content = state.pendingContent;

    // Clear the queue after recovering
    await clearPendingScriptSaves(scriptId);

    // Reset state
    setState(prev => ({
      ...prev,
      hasUnsyncedChanges: false,
      pendingContent: null,
      pendingTimestamp: null,
    }));

    return content;
  }, [scriptId, state.pendingContent]);

  const discardChanges = useCallback(async (): Promise<void> => {
    await clearPendingScriptSaves(scriptId);

    setState(prev => ({
      ...prev,
      hasUnsyncedChanges: false,
      pendingContent: null,
      pendingTimestamp: null,
    }));
  }, [scriptId]);

  return [state, { recoverChanges, discardChanges }];
}
```

#### New File: `frontend/components/offline-recovery-dialog.tsx`

```typescript
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';

interface OfflineRecoveryDialogProps {
  isOpen: boolean;
  pendingTimestamp: Date | null;
  serverTimestamp: Date | null;
  onRecover: () => void;
  onDiscard: () => void;
  isRecovering?: boolean;
}

export function OfflineRecoveryDialog({
  isOpen,
  pendingTimestamp,
  serverTimestamp,
  onRecover,
  onDiscard,
  isRecovering = false,
}: OfflineRecoveryDialogProps) {
  const formatDate = (date: Date | null) => {
    if (!date) return 'Unknown';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Unsaved Offline Changes Detected
          </DialogTitle>
          <DialogDescription className="pt-2 space-y-2">
            <p>
              You have changes that weren't synced before your browser closed.
            </p>
            <div className="bg-muted p-3 rounded-md text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Your offline changes:</span>
                <span className="font-medium">{formatDate(pendingTimestamp)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Server version:</span>
                <span className="font-medium">{formatDate(serverTimestamp)}</span>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={onDiscard}
            disabled={isRecovering}
            className="w-full sm:w-auto"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Discard Changes
          </Button>
          <Button
            onClick={onRecover}
            disabled={isRecovering}
            className="w-full sm:w-auto"
          >
            <RotateCcw className={`h-4 w-4 mr-2 ${isRecovering ? 'animate-spin' : ''}`} />
            {isRecovering ? 'Recovering...' : 'Recover My Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

#### Modified: `frontend/app/script-editor/page.tsx`

Add the following integration:

```typescript
// Import the new hooks/components
import { useOfflineRecovery } from '@/hooks/use-offline-recovery';
import { OfflineRecoveryDialog } from '@/components/offline-recovery-dialog';

// Inside the component, BEFORE useScriptYjsCollaboration:
const [recoveryState, recoveryActions] = useOfflineRecovery(
  scriptId,
  script?.updated_at || null
);

const [isRecovering, setIsRecovering] = useState(false);
const [recoveredContent, setRecoveredContent] = useState<any[] | null>(null);

// Handle recovery
const handleRecover = async () => {
  setIsRecovering(true);
  try {
    const content = await recoveryActions.recoverChanges();
    setRecoveredContent(content);
    // This content will be used to seed Yjs instead of server content
  } finally {
    setIsRecovering(false);
  }
};

const handleDiscard = async () => {
  await recoveryActions.discardChanges();
  // Continue with normal load
};

// In the render, show dialog if recovery needed:
if (recoveryState.hasUnsyncedChanges && !recoveredContent) {
  return (
    <>
      <ProcessingScreen isVisible={true} mode="open" />
      <OfflineRecoveryDialog
        isOpen={true}
        pendingTimestamp={recoveryState.pendingTimestamp}
        serverTimestamp={recoveryState.serverTimestamp}
        onRecover={handleRecover}
        onDiscard={handleDiscard}
        isRecovering={isRecovering}
      />
    </>
  );
}

// Modify pendingContent logic to prefer recovered content:
useEffect(() => {
  if (recoveredContent) {
    const tipTapDoc = contentBlocksToTipTap(recoveredContent);
    setPendingContent(tipTapDoc);
    setRecoveredContent(null); // Clear after using
  }
}, [recoveredContent]);
```

### Phase 2B: Backend Simplification (Recommended)

#### Modified: `backend/app/routers/script_websocket.py`

Remove the timestamp comparison and simplify:

```python
# BEFORE (current code with timestamp comparison):
yjs_stmt = (
    select(ScriptVersion.created_at)
    .where(ScriptVersion.script_id == script_id)
    .order_by(desc(ScriptVersion.created_at))
    .limit(1)
)
yjs_result = await db.execute(yjs_stmt)
latest_yjs_update = yjs_result.scalar_one_or_none()

rest_updated_at = script.updated_at

if latest_yjs_update and rest_updated_at > latest_yjs_update:
    logger.info(f"REST newer than Yjs for script {script_id}, skipping persisted updates")
    applied_count = 0
else:
    applied_count, was_compacted = await persistence.load_and_compact_if_needed(...)

# AFTER (simplified Yjs-primary):
applied_count, was_compacted = await persistence.load_and_compact_if_needed(
    script_id, ydoc
)

if was_compacted:
    await db.commit()
    logger.info(f"Compacted and loaded Yjs updates for script {script_id}")
elif applied_count > 0:
    logger.info(f"Loaded {applied_count} Yjs updates for script {script_id}")
else:
    logger.info(f"No Yjs updates for script {script_id} - frontend will seed")
```

**Rationale for removal:**
1. The timestamp check was defensive but causes confusion
2. With SYNC_STEP2 pollution fixed, Yjs is reliable
3. Offline recovery is now handled by frontend via IndexedDB check
4. Simpler code = fewer edge cases

---

## Testing Criteria

### Scenario 1: Normal Online Editing
- [ ] Edits sync via Yjs in real-time
- [ ] No recovery dialog shown
- [ ] Collaborators see changes immediately

### Scenario 2: Offline → Online (No Crash)
- [ ] Go offline while editing
- [ ] Make several edits
- [ ] Come back online
- [ ] Yjs reconnects and syncs accumulated changes
- [ ] No recovery dialog (Yjs handled it)

### Scenario 3: Offline → Crash → Reopen
- [ ] Go offline while editing
- [ ] Make several edits
- [ ] Force close browser (simulate crash)
- [ ] Reopen script
- [ ] Recovery dialog appears with correct timestamps
- [ ] "Recover" loads offline content correctly
- [ ] Content syncs to Yjs/server

### Scenario 4: Offline → Crash → Discard
- [ ] Same as Scenario 3
- [ ] Choose "Discard" instead
- [ ] Server content loads correctly
- [ ] IndexedDB queue is cleared

### Scenario 5: Multiple Offline Sessions
- [ ] Edit offline, crash
- [ ] Edit offline again (without recovery), crash again
- [ ] Recovery shows most recent offline changes

---

## Outcomes

| Scenario | Before | After |
|----------|--------|-------|
| Normal editing | ✅ Works | ✅ Works |
| Go offline, come back | ✅ Works | ✅ Works |
| Go offline, browser crashes | ❌ Data appears lost | ✅ Recovery dialog |
| Multiple tabs | ✅ Yjs handles | ✅ Yjs handles |
| Collaborators | ✅ Yjs handles | ✅ Yjs handles |

---

## Timeline Estimate

| Task | Estimate |
|------|----------|
| `useOfflineRecovery` hook | 1-2 hours |
| `OfflineRecoveryDialog` component | 1-2 hours |
| Integration in `script-editor/page.tsx` | 1-2 hours |
| Backend simplification | 30 mins |
| Testing all scenarios | 2-3 hours |
| **Total** | **6-10 hours** |

---

## Related Files

### Frontend
- `frontend/hooks/use-offline-recovery.ts` (NEW)
- `frontend/components/offline-recovery-dialog.tsx` (NEW)
- `frontend/app/script-editor/page.tsx` (MODIFY)
- `frontend/hooks/use-script-autosave.ts` (existing, no changes)
- `frontend/utils/script-autosave-storage.ts` (existing, no changes)

### Backend
- `backend/app/routers/script_websocket.py` (MODIFY - simplify)
- `backend/app/services/script_yjs_persistence.py` (no changes)

---

## Appendix: Why Not Persist Yjs to IndexedDB?

An alternative approach would be to persist the Yjs document itself to IndexedDB (like `y-indexeddb`). This was considered but rejected because:

1. **Complexity**: Adds another persistence layer to coordinate
2. **Conflict potential**: Local Yjs state might diverge from server significantly
3. **Already have REST fallback**: IndexedDB queue serves the same purpose
4. **CRDT overhead**: Storing full Yjs state is larger than content_blocks
5. **Recovery UX**: Users should consciously choose to recover (not automatic)

The REST-based IndexedDB queue is simpler and gives users explicit control over recovery.
