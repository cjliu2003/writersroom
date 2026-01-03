# Offline Recovery Conflict Resolution - Phases 2 & 3 Implementation Plan

**Status**: Design Complete
**Created**: 2026-01-03
**Depends On**: Phase 1 (Complete)

---

## Executive Summary

This document outlines the implementation plan for advanced conflict resolution features when recovering offline changes in a collaborative screenplay editing environment.

- **Phase 2**: Block-level comparison UI with selective merge capabilities
- **Phase 3**: Smart auto-merge with inline conflict editing

---

## Current State (Phase 1 - Complete)

### What's Implemented

| Component | Description |
|-----------|-------------|
| `use-offline-recovery.ts` | Hook with conflict detection and severity assessment |
| `offline-recovery-dialog.tsx` | Enhanced dialog with conflict warnings |
| `detectConflictSeverity()` | Compares block counts and text lengths |
| `ConflictInfo` interface | Severity levels: `none`, `minor`, `major` |
| `confirmRecoveryComplete()` | Safe IndexedDB clearing after content applied |

### Current Limitations

1. **All-or-nothing recovery** - User must choose entire offline version or entire current version
2. **No visibility into differences** - User can't see what specifically changed
3. **No partial merge** - Can't keep some offline changes while preserving collaborator work

---

## Phase 2: Block-Level Comparison UI

### 2.1 Overview

Provide users with a visual diff of their offline content versus the current collaborative document, allowing them to cherry-pick blocks from either version.

### 2.2 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Conflict Resolution Dialog                  │
├─────────────────────────┬───────────────────────────────────┤
│   OFFLINE VERSION       │        CURRENT VERSION            │
│   (Your changes)        │        (Collaborator work)        │
├─────────────────────────┼───────────────────────────────────┤
│ ☑ INT. COFFEE SHOP     │ ☐ INT. COFFEE SHOP - DAY         │
│   (modified)            │   (current)                       │
├─────────────────────────┼───────────────────────────────────┤
│ ☑ Sarah enters...      │ ☐ Sarah walks in slowly...        │
│   (your text)           │   (collaborator's text)           │
├─────────────────────────┼───────────────────────────────────┤
│ ☑ NEW BLOCK            │   --- (not present) ---           │
│   (added offline)       │                                   │
├─────────────────────────┼───────────────────────────────────┤
│   --- (deleted) ---     │ ☐ COLLABORATOR'S NEW SCENE        │
│                         │   (added by collaborator)         │
├─────────────────────────┴───────────────────────────────────┤
│                      MERGE PREVIEW                          │
│  [Live preview of merged result based on selections]        │
├─────────────────────────────────────────────────────────────┤
│           [Cancel]              [Apply Merged Version]      │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 New Components

#### File Structure
```
frontend/
├── components/
│   └── conflict-resolution/
│       ├── conflict-resolution-dialog.tsx    # Main container
│       ├── block-diff-viewer.tsx             # Side-by-side diff view
│       ├── diff-block.tsx                    # Individual block with selection
│       ├── merge-preview.tsx                 # Live preview panel
│       └── types.ts                          # Shared types
├── utils/
│   ├── block-diff-engine.ts                  # Core diff algorithm
│   ├── block-fingerprint.ts                  # Block comparison logic
│   └── merge-builder.ts                      # Merge state management
└── hooks/
    └── use-conflict-resolution.ts            # State management hook
```

#### Component Specifications

##### `ConflictResolutionDialog`
```typescript
interface ConflictResolutionDialogProps {
  isOpen: boolean;
  offlineBlocks: ContentBlock[];
  currentBlocks: ContentBlock[];
  onMerge: (mergedBlocks: ContentBlock[]) => void;
  onCancel: () => void;
}
```

**Responsibilities:**
- Full-screen or large modal container
- Orchestrates child components
- Manages overall merge state
- Handles keyboard shortcuts (Escape to cancel, Ctrl+Enter to apply)

##### `BlockDiffViewer`
```typescript
interface BlockDiffViewerProps {
  diffResult: DiffResult;
  selections: BlockSelections;
  onSelectionChange: (blockId: string, source: 'offline' | 'current') => void;
  scrollSyncEnabled: boolean;
}
```

**Responsibilities:**
- Two-column layout with synchronized scrolling
- Renders diff blocks with visual indicators
- Handles block selection interactions

##### `DiffBlock`
```typescript
interface DiffBlockProps {
  block: ContentBlock;
  diffType: 'unchanged' | 'added' | 'removed' | 'modified';
  isSelected: boolean;
  isSelectable: boolean;
  onSelect: () => void;
  highlightedText?: TextDiff[]; // For modified blocks
}
```

**Visual States:**
- 🟢 **Added**: Green background, + icon
- 🔴 **Removed**: Red background, - icon, strikethrough
- 🟡 **Modified**: Yellow background, ~ icon, inline diff
- ⚪ **Unchanged**: Normal styling, dimmed

##### `MergePreview`
```typescript
interface MergePreviewProps {
  mergedBlocks: ContentBlock[];
  validationErrors: ValidationError[];
}
```

**Responsibilities:**
- Live preview of merge result
- Screenplay formatting applied
- Validation warnings (e.g., "Dialogue without character")

### 2.4 Block Diff Algorithm

#### Block Fingerprinting
```typescript
interface BlockFingerprint {
  type: BlockType;          // sceneHeading, action, dialogue, etc.
  textHash: string;         // Hash of first 50 chars
  fullHash: string;         // Hash of entire content
  positionHint: number;     // Approximate position (0-1)
}

function createFingerprint(block: ContentBlock, index: number, total: number): BlockFingerprint;
```

#### Diff Algorithm (LCS-Based)
```typescript
interface DiffResult {
  matched: MatchedBlock[];      // Same block in both versions
  offlineOnly: ContentBlock[];  // Added in offline, not in current
  currentOnly: ContentBlock[];  // Added by collaborator
  modified: ModifiedBlock[];    // Same block, different content
}

interface MatchedBlock {
  offlineIndex: number;
  currentIndex: number;
  block: ContentBlock;
}

interface ModifiedBlock {
  offlineBlock: ContentBlock;
  currentBlock: ContentBlock;
  textDiff: TextDiff[];
}

function computeBlockDiff(
  offlineBlocks: ContentBlock[],
  currentBlocks: ContentBlock[]
): DiffResult;
```

**Algorithm Steps:**
1. Generate fingerprints for all blocks in both versions
2. Find Longest Common Subsequence using type + textHash matching
3. Classify unmatched blocks as added/removed
4. For matched blocks with different fullHash, mark as modified
5. Compute text-level diff for modified blocks using Myers algorithm

### 2.5 Merge State Management

```typescript
interface MergeState {
  selections: Map<string, 'offline' | 'current' | 'both'>;
  mergedBlocks: ContentBlock[];
  validationErrors: ValidationError[];
  isValid: boolean;
}

interface ValidationError {
  type: 'orphaned_dialogue' | 'empty_scene' | 'structure_error';
  message: string;
  blockIndex: number;
}

// Hook API
function useConflictResolution(
  offlineBlocks: ContentBlock[],
  currentBlocks: ContentBlock[]
): {
  diffResult: DiffResult;
  mergeState: MergeState;
  selectBlock: (blockId: string, source: 'offline' | 'current') => void;
  selectAll: (source: 'offline' | 'current') => void;
  getMergedContent: () => ContentBlock[];
  reset: () => void;
};
```

### 2.6 Integration Points

#### Update `offline-recovery-dialog.tsx`
Add "Compare Versions" button when conflict is detected:

```tsx
{hasConflict && (
  <Button
    variant="outline"
    onClick={() => setShowConflictResolution(true)}
  >
    <GitCompare className="h-4 w-4 mr-2" />
    Compare & Merge
  </Button>
)}
```

#### Update `page.tsx`
Handle merged content from conflict resolution:

```tsx
const handleMergedRecovery = async (mergedBlocks: ContentBlock[]) => {
  setRecoveredContent(mergedBlocks);
  setForceApplyRecovered(true);
  // Rest follows existing recovery flow
};
```

### 2.7 Implementation Tasks

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| 2.1.1 Create `block-fingerprint.ts` | P0 | 2h | None |
| 2.1.2 Create `block-diff-engine.ts` | P0 | 4h | 2.1.1 |
| 2.1.3 Unit tests for diff algorithm | P0 | 2h | 2.1.2 |
| 2.2.1 Create `DiffBlock` component | P1 | 2h | None |
| 2.2.2 Create `BlockDiffViewer` | P1 | 4h | 2.2.1 |
| 2.2.3 Implement scroll sync | P2 | 1h | 2.2.2 |
| 2.3.1 Create `merge-builder.ts` | P1 | 3h | 2.1.2 |
| 2.3.2 Create `use-conflict-resolution.ts` | P1 | 2h | 2.3.1 |
| 2.3.3 Create `MergePreview` component | P1 | 2h | 2.3.2 |
| 2.4.1 Create `ConflictResolutionDialog` | P1 | 4h | All above |
| 2.4.2 Integrate with recovery flow | P0 | 2h | 2.4.1 |
| 2.4.3 Keyboard navigation & a11y | P2 | 2h | 2.4.1 |
| 2.4.4 Polish & edge cases | P1 | 4h | All above |

**Estimated Total: ~34 hours**

---

## Phase 3: Smart Merge

### 3.1 Overview

Automate non-conflicting merges and provide inline editing for true conflicts, reducing manual work for users.

### 3.2 Auto-Merge Logic

#### Conflict Classification
```typescript
type ConflictType =
  | 'no_conflict'           // Changes don't overlap
  | 'position_conflict'     // Same position, different content
  | 'content_conflict'      // Same block, different modifications
  | 'structural_conflict';  // Incompatible structural changes

interface AutoMergeResult {
  autoMerged: ContentBlock[];           // Automatically resolved
  manualRequired: ManualConflict[];     // Needs user input
  summary: {
    autoMergedCount: number;
    conflictCount: number;
    offlineAdditions: number;
    currentAdditions: number;
  };
}
```

#### Auto-Merge Rules

| Scenario | Resolution | Confidence |
|----------|------------|------------|
| Block added offline only | Include in merge | High |
| Block added by collaborator only | Include in merge | High |
| Block modified only offline | Use offline version | High |
| Block modified only by collaborator | Use current version | High |
| Block modified by both (same result) | Use either (identical) | High |
| Block modified by both (different) | **CONFLICT** - Manual | N/A |
| Block deleted offline, untouched current | Delete | Medium |
| Block deleted offline, modified current | **CONFLICT** - Manual | N/A |
| Block deleted current, modified offline | **CONFLICT** - Manual | N/A |

### 3.3 Inline Conflict Editor

For blocks with text-level conflicts, provide inline editing:

```
┌─────────────────────────────────────────────────────────────┐
│ CONFLICT: Block 5 - Action                                  │
├─────────────────────────────────────────────────────────────┤
│ Sarah <<<<<<< OFFLINE                                       │
│ walks into the coffee shop, looking exhausted.              │
│ =======                                                      │
│ enters slowly, scanning the room nervously.                  │
│ >>>>>>> CURRENT                                              │
│                                                              │
│ [Accept Offline] [Accept Current] [Edit Manually]           │
└─────────────────────────────────────────────────────────────┘
```

#### Component: `InlineConflictEditor`
```typescript
interface InlineConflictEditorProps {
  conflict: ManualConflict;
  onResolve: (resolution: ConflictResolution) => void;
}

interface ConflictResolution {
  conflictId: string;
  choice: 'offline' | 'current' | 'custom';
  customContent?: string;
}
```

**Features:**
- Three resolution options: Accept Offline, Accept Current, Edit Manually
- Syntax highlighting for conflict markers
- Real-time validation of edited content
- Undo/redo within editor

### 3.4 Enhanced Merge Preview

```typescript
interface EnhancedMergePreviewProps {
  autoMerged: ContentBlock[];
  resolvedConflicts: ConflictResolution[];
  unresolvedConflicts: ManualConflict[];
  onConflictClick: (conflictId: string) => void;
}
```

**Visual Indicators:**
- ✅ Auto-merged blocks: Subtle green border
- ✍️ Manually resolved: Blue border
- ⚠️ Unresolved conflicts: Red pulsing border, blocks preview
- Progress indicator: "3 of 5 conflicts resolved"

### 3.5 Yjs-Native Integration (Optional/Advanced)

#### Concept
Instead of replacing document content entirely, create Yjs updates that represent the offline changes. This would:
- Preserve undo/redo history
- Enable true CRDT merging
- Maintain collaboration awareness

#### Challenges
1. **State Vector Mismatch**: Offline edits have outdated state vector
2. **Update Reconstruction**: Need to recreate Yjs operations from content diff
3. **Conflict Detection**: Yjs auto-merges, may create unexpected results

#### Approach (Research Required)
```typescript
// Theoretical API
async function createRecoveryUpdate(
  offlineYDoc: Y.Doc,
  currentYDoc: Y.Doc
): Promise<Uint8Array> {
  // 1. Compute content diff
  // 2. Translate to Yjs operations
  // 3. Create update that applies offline changes
  // 4. Handle conflicts via CRDT semantics
}
```

**Recommendation**: Defer to Phase 3.3 as optional enhancement. The content-replacement approach (Phase 2) is more predictable and debuggable.

### 3.6 Implementation Tasks

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| 3.1.1 Define conflict classification types | P0 | 1h | Phase 2 |
| 3.1.2 Implement auto-merge logic | P0 | 4h | 3.1.1 |
| 3.1.3 Unit tests for auto-merge | P0 | 2h | 3.1.2 |
| 3.2.1 Create `InlineConflictEditor` | P1 | 4h | Phase 2 |
| 3.2.2 Conflict marker parsing | P1 | 2h | 3.2.1 |
| 3.2.3 Custom content validation | P1 | 2h | 3.2.2 |
| 3.3.1 Enhanced merge preview | P1 | 3h | 3.1.2, 3.2.1 |
| 3.3.2 Resolution progress tracking | P2 | 1h | 3.3.1 |
| 3.4.1 Integration & flow updates | P0 | 3h | All above |
| 3.4.2 Edge case handling | P1 | 3h | 3.4.1 |
| 3.5.1 Yjs integration research | P3 | 8h | All above |
| 3.5.2 Yjs integration prototype | P3 | 16h | 3.5.1 |

**Estimated Total (excluding 3.5): ~25 hours**
**Including Yjs research/prototype: ~49 hours**

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Diff algorithm too slow for large scripts (100+ pages) | Medium | High | Implement Web Worker, limit scope, add progress indicator |
| Block fingerprinting false positives/negatives | Medium | Medium | Multi-factor fingerprinting, allow manual correction |
| UI too complex for non-technical users | Medium | High | Progressive disclosure, smart defaults, tutorials |
| Auto-merge produces unexpected results | Medium | High | Conservative defaults, clear audit trail, easy undo |
| Yjs integration adds complexity without proportional benefit | High | Medium | Keep as optional Phase 3.3, maintain fallback |

---

## Success Criteria

### Phase 2

- [ ] Users can view side-by-side diff of offline vs current content
- [ ] Visual indicators clearly show added/removed/modified blocks
- [ ] Users can select blocks from either version
- [ ] Merge preview accurately reflects selections
- [ ] Merged content applies correctly to editor
- [ ] Keyboard navigation works for accessibility
- [ ] Performance acceptable for scripts up to 100 pages

### Phase 3

- [ ] Non-conflicting changes auto-merge correctly
- [ ] Auto-merge summary shows what was automatically resolved
- [ ] Inline conflict editor allows text-level resolution
- [ ] All conflicts must be resolved before merge completes
- [ ] Merge preserves screenplay structure integrity
- [ ] (Optional) Yjs-native merge preserves undo history

---

## Appendix: Type Definitions

```typescript
// Content block types (existing)
type BlockType =
  | 'sceneHeading'
  | 'action'
  | 'character'
  | 'dialogue'
  | 'parenthetical'
  | 'transition'
  | 'shot'
  | 'centered';

interface ContentBlock {
  id: string;
  type: BlockType;
  text: string;
  attrs?: Record<string, any>;
}

// Diff types (new)
interface TextDiff {
  type: 'equal' | 'insert' | 'delete';
  value: string;
}

interface DiffResult {
  matched: MatchedBlock[];
  offlineOnly: IndexedBlock[];
  currentOnly: IndexedBlock[];
  modified: ModifiedBlock[];
}

interface MatchedBlock {
  offlineIndex: number;
  currentIndex: number;
  block: ContentBlock;
}

interface IndexedBlock {
  index: number;
  block: ContentBlock;
}

interface ModifiedBlock {
  offlineBlock: ContentBlock;
  currentBlock: ContentBlock;
  offlineIndex: number;
  currentIndex: number;
  textDiff: TextDiff[];
}

// Merge types (new)
interface BlockSelections {
  [blockId: string]: 'offline' | 'current';
}

interface MergeState {
  selections: BlockSelections;
  mergedBlocks: ContentBlock[];
  validationErrors: ValidationError[];
  isValid: boolean;
}

interface ValidationError {
  type: string;
  message: string;
  blockIndex: number;
}

// Conflict types (Phase 3)
interface ManualConflict {
  id: string;
  offlineBlock: ContentBlock;
  currentBlock: ContentBlock;
  conflictType: ConflictType;
  textDiff: TextDiff[];
}

interface ConflictResolution {
  conflictId: string;
  choice: 'offline' | 'current' | 'custom';
  customContent?: string;
  resolvedAt: Date;
}
```

---

## References

- Phase 1 Implementation: `frontend/hooks/use-offline-recovery.ts`
- Phase 1 Implementation: `frontend/components/offline-recovery-dialog.tsx`
- TipTap Documentation: https://tiptap.dev/docs
- Yjs Documentation: https://docs.yjs.dev
- Myers Diff Algorithm: https://blog.jcoglan.com/2017/02/12/the-myers-diff-algorithm-part-1/
