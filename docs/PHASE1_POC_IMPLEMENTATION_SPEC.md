# Phase 1 POC Implementation Specification

**Date**: October 29, 2025
**Goal**: Validate TipTap v2.26.4 + Pagination works with existing WritersRoom infrastructure
**Timeline**: 1 week
**Status**: Implementation Ready

---

## Executive Summary

This specification details the Phase 1 Proof of Concept implementation for migrating WritersRoom's screenplay editor from Slate to TipTap. The POC focuses on **two critical features**:

1. **Real-time Collaboration**: Validate TipTap works with existing Y.js + WebSocket backend
2. **Pagination**: Validate `tiptap-extension-pagination` provides screenplay-accurate page breaks

**Success Criteria**: If both features work reliably, proceed to Phase 2 (Screenplay Extensions). Otherwise, stay with Slate.

---

## Architecture Overview

### Component Structure

```
app/test-tiptap/page.tsx (NEW)
├── TipTap Editor Instance
│   ├── StarterKit extensions
│   ├── Collaboration extension (Y.js)
│   ├── CollaborationCursor extension
│   └── Pagination extension
├── Existing Yjs Hook (REUSED 100%)
│   └── useScriptYjsCollaboration()
├── Sync Status Indicator (REUSED)
└── Collaboration Test UI (NEW)
```

### Data Flow

```
User Types
    ↓
TipTap Editor (ProseMirror)
    ↓
Y.js Document (CRDT)
    ↓
WebSocket Provider (y-websocket)
    ↓
FastAPI Backend (/api/ws/scripts/:scriptId)
    ↓
Redis Pub/Sub (multi-server coordination)
    ↓
Other Connected Clients
```

**Key Insight**: Backend requires ZERO changes - already implements y-websocket protocol!

---

## Technical Specifications

### 1. Route Structure

**Location**: `frontend/app/test-tiptap/page.tsx`

**Purpose**: Isolated test environment for TipTap POC validation

**Route Access**: `http://localhost:3102/test-tiptap`

### 2. Dependencies (Installed)

```json
{
  "@tiptap/core": "2.26.4",
  "@tiptap/react": "2.26.4",
  "@tiptap/starter-kit": "2.26.4",
  "@tiptap/pm": "2.26.4",
  "@tiptap/extension-collaboration": "2.26.4",
  "@tiptap/extension-collaboration-cursor": "2.26.4",
  "tiptap-extension-pagination": "2.1.4"
}
```

**Note**: Using v2.26.4 (latest v2) for `tiptap-extension-pagination` compatibility.

### 3. Yjs Collaboration Hook (100% Reuse)

**File**: `frontend/hooks/use-script-yjs-collaboration.ts`

**Interface**:
```typescript
interface UseScriptYjsCollaborationProps {
  scriptId: string;
  authToken: string;
  enabled?: boolean;
  onSyncStatusChange?: (status: SyncStatus) => void;
  onError?: (error: Error) => void;
  onUpdate?: (update: Uint8Array, origin: any) => void;
}

interface UseScriptYjsCollaborationReturn {
  doc: Y.Doc | null;
  provider: WebsocketProvider | null;
  awareness: any | null;
  isConnected: boolean;
  syncStatus: SyncStatus;
  connectionError: Error | null;
  reconnect: () => void;
}
```

**Usage**: Import and use unchanged - TipTap accepts Y.Doc directly via Collaboration extension.

### 4. TipTap Editor Configuration

**Extensions Required**:
```typescript
const extensions = [
  StarterKit.configure({
    history: false, // Yjs provides history via undo manager
  }),
  Collaboration.configure({
    document: doc, // Y.Doc from useScriptYjsCollaboration
  }),
  CollaborationCursor.configure({
    provider: provider, // WebsocketProvider for cursors
    user: {
      name: 'Test User',
      color: '#ff0000', // Random color per user
    },
  }),
  Pagination.configure({
    pageSize: 'LETTER', // 8.5" x 11"
    pageMargins: {
      top: 96,    // 1 inch (96 DPI)
      bottom: 96,
      left: 144,  // 1.5 inches (binding margin)
      right: 96,
    },
    pageOrientation: 'portrait',
  }),
];
```

**Editor Instance**:
```typescript
const editor = useEditor({
  extensions,
  editorProps: {
    attributes: {
      class: 'prose prose-sm focus:outline-none',
      style: 'font-family: Courier, monospace; font-size: 12pt; line-height: 12pt;',
    },
  },
});
```

---

## Implementation Tasks

### Task 1: Create Test Route File

**File**: `frontend/app/test-tiptap/page.tsx`

**Requirements**:
- Next.js 14 App Router page component
- "use client" directive (client-side rendering required)
- TypeScript with proper type safety
- Isolated from existing Slate editor

### Task 2: Integrate Yjs Collaboration

**Steps**:
1. Import `useScriptYjsCollaboration` hook
2. Initialize with test script ID: `"test-tiptap-poc"`
3. Extract `doc`, `provider`, `isConnected`, `syncStatus`
4. Pass `doc` to Collaboration extension
5. Pass `provider` to CollaborationCursor extension

**Authentication**:
- For POC, use mock auth token or existing Firebase token
- Production will use standard Firebase JWT flow

### Task 3: Configure Pagination Extension

**Screenplay Page Specifications**:
- **Page Size**: US Letter (8.5" × 11")
- **Top Margin**: 1 inch (96px @ 96 DPI)
- **Bottom Margin**: 1 inch (96px)
- **Left Margin**: 1.5 inches (144px) - binding margin
- **Right Margin**: 1 inch (96px)
- **Font**: Courier 12pt
- **Line Height**: 12pt (6 lines/inch)
- **Target**: 55 lines/page

**Validation**: Pages should match Final Draft pagination (within ±2 lines).

### Task 4: Build Test UI

**Components**:

1. **Connection Status Indicator**
   - Shows: `connecting | connected | synced | offline | error`
   - Color-coded: gray → yellow → green → red
   - Reuse existing `sync-status-indicator` if possible

2. **Collaboration Test Panel**
   - "Open in New Tab" button → `window.open('/test-tiptap')`
   - Active users count from awareness API
   - User cursor colors displayed
   - Connection quality indicator

3. **Pagination Info Panel**
   - Current page number
   - Total pages
   - Lines on current page
   - "Jump to Page" input

4. **Editor Container**
   - Full-width layout
   - Fixed-height pages with visual breaks
   - Scrollable container
   - Page shadows/borders for visual feedback

### Task 5: Add Keyboard Shortcuts (Optional POC Enhancement)

**Shortcuts**:
- `Cmd/Ctrl + B`: Bold
- `Cmd/Ctrl + I`: Italic
- `Cmd/Ctrl + U`: Underline
- `Cmd/Ctrl + Z`: Undo (via Yjs)
- `Cmd/Ctrl + Shift + Z`: Redo

---

## Testing Protocol

### Test 1: Basic Editor Functionality

**Steps**:
1. Navigate to `/test-tiptap`
2. Type "INT. OFFICE - DAY" into editor
3. Apply bold formatting (`Cmd+B`)
4. Verify text renders in Courier 12pt

**Expected**: Editor accepts input, formatting works, styling correct.

### Test 2: Real-time Collaboration

**Steps**:
1. Open `/test-tiptap` in Tab 1
2. Click "Open in New Tab" → Tab 2 opens
3. In Tab 1: Type "FADE IN:"
4. In Tab 2: Observe text appears in real-time
5. In Tab 2: Type "EXT. BEACH - SUNSET"
6. In Tab 1: Observe text appears in real-time
7. Close Tab 2
8. In Tab 1: Verify content persists

**Expected**:
- ✅ Changes sync instantly (<100ms latency)
- ✅ No conflicts or text duplication
- ✅ Cursors visible (CollaborationCursor)
- ✅ Connection status shows "synced"
- ✅ Content persists after peer disconnect

### Test 3: Multi-Tab Stress Test

**Steps**:
1. Open 5 tabs simultaneously
2. Type rapidly in all tabs at once
3. Close 3 tabs randomly
4. Continue editing in remaining 2 tabs
5. Refresh one tab
6. Verify content consistency

**Expected**:
- ✅ No lost edits
- ✅ No duplicate content
- ✅ Reconnection works after refresh
- ✅ Backend handles multiple connections

### Test 4: Pagination Accuracy

**Steps**:
1. Paste screenplay content (~10 pages)
2. Count lines per page (should be ~55 lines)
3. Measure page height (should be 11 inches @ 96 DPI = 1056px)
4. Add content and observe page breaks
5. Remove content and observe page reflow

**Expected**:
- ✅ Pages are 11" tall (1056px)
- ✅ ~55 lines per page (acceptable: 53-57)
- ✅ Page breaks insert correctly
- ✅ Content reflows on edit

### Test 5: Pagination vs Slate Comparison

**Steps**:
1. Copy content from existing Slate editor
2. Paste into TipTap test route
3. Note page break locations in TipTap
4. Compare to Slate page breaks
5. Calculate difference in page count

**Expected**:
- ✅ Page count within ±1 page for 10-page script
- ✅ Scene breaks align reasonably
- ✅ No orphaned single lines

### Test 6: Connection Resilience

**Steps**:
1. Start editing in `/test-tiptap`
2. Stop backend server (kill FastAPI process)
3. Continue typing → status should show "offline"
4. Restart backend server
5. Wait for reconnection

**Expected**:
- ✅ Status changes to "offline" on disconnect
- ✅ Automatic reconnection within 5 seconds
- ✅ Pending edits sync after reconnection
- ✅ No data loss

---

## Success Criteria

### Critical (Must Pass)

1. **Collaboration Works**: Real-time sync with <100ms latency, zero data loss
2. **Pagination Accurate**: Within ±2 lines per page vs Final Draft standard
3. **Connection Stable**: Auto-reconnect works, handles network issues gracefully
4. **Zero Backend Changes**: Existing WebSocket backend works unchanged

### Important (Should Pass)

1. **Performance**: Editor feels responsive (<50ms keystroke latency)
2. **Cursor Awareness**: Can see other users' cursors and selections
3. **Page Reflow**: Adding/removing text updates pagination correctly
4. **Multi-Tab**: 5+ simultaneous users work without issues

### Nice to Have (Bonus)

1. **Undo/Redo**: Yjs-powered history works across users
2. **Offline Editing**: Content queues and syncs on reconnect
3. **Pagination Config**: Can adjust margins/page size programmatically

---

## Risk Assessment

### Low Risk

- ✅ **Collaboration Protocol**: TipTap uses standard Yjs, backend already compatible
- ✅ **Hook Reuse**: `useScriptYjsCollaboration` is provider-agnostic
- ✅ **Isolation**: Test route doesn't affect existing Slate editor

### Medium Risk

- ⚠️ **Pagination Extension Quality**: Community-maintained, may have bugs
- ⚠️ **Page Break Algorithm**: May not match Final Draft exactly
- ⚠️ **TipTap v2 vs v3**: Using older version, may miss v3 improvements

### Mitigation Strategies

1. **Pagination Issues**: Can adapt existing `pagination-engine.ts` if extension fails
2. **Version Constraint**: Can upgrade to v3 later if needed (requires custom pagination)
3. **Extension Bugs**: Fork and patch `tiptap-extension-pagination` if necessary

---

## Decision Points

### Go/No-Go After Phase 1

**Proceed to Phase 2 (Screenplay Extensions) IF**:
- ✅ All Critical success criteria pass
- ✅ Pagination accuracy acceptable (within ±10% page count)
- ✅ Collaboration performance matches or exceeds Slate

**Stay with Slate IF**:
- ❌ Data loss occurs during collaboration testing
- ❌ Pagination off by >20% (e.g., 10-page script becomes 12+ pages)
- ❌ Major performance issues (>200ms keystroke latency)
- ❌ Backend changes required (defeats "zero changes" goal)

---

## Code Structure Reference

### Existing Files to Reuse (No Changes)

```
frontend/hooks/use-script-yjs-collaboration.ts  ✅ 100% reuse
frontend/components/sync-status-indicator.tsx   ✅ Reusable
frontend/types/screenplay.ts                    ✅ Reference for types
backend/app/routers/websocket.py               ✅ Zero changes
backend/app/services/redis_pubsub.py           ✅ Zero changes
```

### New Files to Create

```
frontend/app/test-tiptap/page.tsx              🆕 Main POC component
docs/PHASE1_POC_IMPLEMENTATION_SPEC.md        🆕 This document
```

---

## Implementation Order

**Recommended Sequence**:

1. **Create Route File** (15 min)
   - Basic Next.js page structure
   - "use client" directive
   - Placeholder UI

2. **Integrate Yjs Hook** (30 min)
   - Import and initialize hook
   - Display connection status
   - Test WebSocket connection

3. **Add TipTap Editor** (45 min)
   - Import TipTap packages
   - Configure StarterKit + Collaboration
   - Test basic typing

4. **Add Pagination** (30 min)
   - Configure Pagination extension
   - Style page containers
   - Test page breaks

5. **Build Test UI** (1 hour)
   - Collaboration panel
   - Pagination info
   - "Open in New Tab" button

6. **Testing & Validation** (2-3 hours)
   - Run all 6 test scenarios
   - Document results
   - Take screenshots/videos

**Total Estimated Time**: 5-6 hours of focused work

---

## Next Steps After Phase 1

### If POC Succeeds

**Phase 2**: Build Screenplay Extensions (1 week)
- Scene Heading, Action, Character, Dialogue, etc.
- Keyboard shortcuts (Tab, Enter transitions)
- Command+Digit shortcuts

**Phase 3**: Pagination Refinement (3-5 days)
- Fine-tune page break algorithm
- Handle widows/orphans
- Scene boundary awareness

**Phase 4**: Data Migration (2-3 days)
- Slate JSON → TipTap ProseMirror JSON converter
- Migration script for existing scripts
- Rollback strategy

### If POC Fails

**Alternative Path**: Improve Slate Pagination
- Adapt existing `pagination-engine.ts`
- Fix line height calculations
- Optimize page break placement
- Stay with proven Slate architecture

---

## Validation Deliverables

**Required Outputs**:

1. **Working Test Route**: `/test-tiptap` fully functional
2. **Test Results Document**: Pass/fail for all 6 test scenarios
3. **Performance Metrics**:
   - Keystroke latency (ms)
   - Sync latency (ms)
   - Page count accuracy (%)
   - Connection stability (reconnect success rate)
4. **Screenshots**:
   - Multi-tab collaboration in action
   - Pagination with page breaks visible
   - Cursor awareness demo
5. **Go/No-Go Recommendation**: Proceed or stay with Slate

---

## Appendix A: Pagination Extension Configuration

### Full Configuration Object

```typescript
Pagination.configure({
  // Page dimensions
  pageSize: 'LETTER', // or 'A4', 'LEGAL'

  // Custom dimensions (if not using preset)
  pageWidth: 816,   // 8.5" × 96 DPI
  pageHeight: 1056, // 11" × 96 DPI

  // Margins (in pixels @ 96 DPI)
  pageMargins: {
    top: 96,      // 1 inch
    bottom: 96,   // 1 inch
    left: 144,    // 1.5 inches (screenplay binding margin)
    right: 96,    // 1 inch
  },

  // Orientation
  pageOrientation: 'portrait',

  // Visual styling
  showPageNumbers: true,
  pageNumberPosition: 'topRight',

  // Break behavior
  avoidBreakInside: ['heading', 'blockquote'], // Keep elements intact
})
```

### Screenplay-Specific Adjustments

**Target Metrics**:
- 55 lines per page (industry standard)
- Courier 12pt font
- 12pt line height (6 lines/inch)

**Calculation**:
```
Page height: 11 inches
Top margin: 1 inch
Bottom margin: 1 inch
Content area: 9 inches

9 inches × 6 lines/inch = 54 lines
+ Title/page number overhead ≈ 55 lines effective
```

---

## Appendix B: Troubleshooting Guide

### Issue: "Collaboration not syncing"

**Symptoms**: Changes in one tab don't appear in other tabs

**Checks**:
1. WebSocket connection status (should be "connected")
2. Backend server running? (`http://localhost:8000/api/ws/scripts/test-tiptap-poc`)
3. Redis running? (if multi-server setup)
4. Browser console errors?
5. Y.Doc initialized correctly? (not null)

**Solution**:
- Verify `doc` from `useScriptYjsCollaboration` is passed to Collaboration extension
- Check auth token is valid
- Ensure scriptId is consistent across tabs

### Issue: "Pagination not showing page breaks"

**Symptoms**: Editor shows continuous scroll, no page divisions

**Checks**:
1. Pagination extension installed? (`npm list tiptap-extension-pagination`)
2. Pagination extension in `extensions` array?
3. CSS for page containers applied?
4. Sufficient content? (needs 55+ lines to trigger break)

**Solution**:
- Add debug logging to see if extension loaded
- Inspect DOM for page break elements
- Check extension configuration object

### Issue: "TypeError: Cannot read property 'doc' of null"

**Symptoms**: Editor crashes on initialization

**Cause**: Yjs hook returning `null` before WebSocket connects

**Solution**:
```typescript
if (!doc) {
  return <div>Connecting to collaboration server...</div>;
}

const editor = useEditor({
  extensions: [
    Collaboration.configure({ document: doc }),
  ],
});
```

Always guard against null `doc` before initializing editor.

---

## Appendix C: Yjs Protocol Compatibility

**Why Backend Requires Zero Changes**:

WritersRoom's WebSocket backend (`backend/app/routers/websocket.py`) implements the **y-websocket protocol**, which is editor-agnostic:

1. **Binary Message Format**:
   ```
   [messageType: uint8][payload: Uint8Array]
   ```
   - `MESSAGE_SYNC` (0) → Yjs state synchronization
   - `MESSAGE_AWARENESS` (1) → Cursor/presence info
   - `MESSAGE_QUERY_AWARENESS` (3) → Request awareness state

2. **Synchronization Flow**:
   ```
   Client → SYNC_STEP1: Send current state vector
   Server → SYNC_STEP2: Send missing updates since state vector
   Client → SYNC_UPDATE: Apply updates, send acknowledgment
   ```

3. **TipTap Integration**:
   - TipTap's Collaboration extension uses `y-prosemirror` binding
   - `y-prosemirror` generates identical Yjs updates as Slate's `slate-yjs`
   - Backend sees same binary protocol regardless of editor

**Result**: Drop-in replacement at editor level, backend oblivious to change.

---

## Document Control

**Version**: 1.0
**Author**: Claude (AI Assistant)
**Last Updated**: October 29, 2025
**Review Status**: Ready for Implementation

**Change Log**:
- v1.0 (2025-10-29): Initial specification based on migration plan Phase 1