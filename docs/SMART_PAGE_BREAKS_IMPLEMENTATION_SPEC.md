# Smart Page Breaks - Implementation Specification

**Project**: WritersRoom TipTap Editor Integration
**Feature**: Industry-Standard Smart Page Break System
**Version**: 1.0
**Date**: 2025-10-30
**Status**: Design Complete - Ready for Implementation

---

## Table of Contents

1. [Overview](#overview)
2. [Requirements Analysis](#requirements-analysis)
3. [Technical Architecture](#technical-architecture)
4. [Implementation Details](#implementation-details)
5. [Algorithm Specifications](#algorithm-specifications)
6. [Data Structures](#data-structures)
7. [Integration Plan](#integration-plan)
8. [Performance Considerations](#performance-considerations)
9. [Testing Strategy](#testing-strategy)
10. [Export Handling](#export-handling)
11. [Phase Planning](#phase-planning)
12. [Risk Analysis](#risk-analysis)

---

## Overview

### Purpose

Implement industry-standard smart page break rules for screenplay formatting in the TipTap editor. These rules prevent formatting violations that would make scripts unprofessional or difficult to read, such as orphaned character names, split dialogue without continuation markers, and transitions at the top of pages.

### Scope

**In Scope:**
- 5 core smart break rules (dialogue continuation, character orphans, parenthetical grouping, scene heading orphans, transition positioning)
- Non-destructive visual implementation using ProseMirror decorations
- Real-time recomputation on editor updates, window resize, and pagination changes
- Integration with existing ScreenplayKit and PaginationPlus extensions
- Configurable enable/disable via ScreenplayKit options

**Out of Scope (Future Enhancements):**
- Sentence-boundary dialogue splitting (prevent mid-sentence breaks)
- Widow/orphan prevention for action blocks
- Visual debugging mode
- Per-rule configuration (enable/disable individual rules)

### Goals

1. **Professional Quality**: Match Final Draft and other professional screenwriting software behavior
2. **Performance**: Maintain <16ms recomputation time for responsive editing (60fps)
3. **Non-Destructive**: Never modify the underlying Yjs document (essential for collaboration)
4. **Compatibility**: Work seamlessly with existing real-time collaboration system
5. **Maintainability**: Clear code structure following established patterns in the codebase

---

## Requirements Analysis

### Rule 1: Dialogue Continuation

**Problem**: When dialogue spans multiple pages, readers need clear indication that the speech continues.

**Solution**:
- Insert `(MORE)` centered at the bottom of the page where dialogue breaks
- Insert `(CONT'D)` after the character name on the continuation page

**Industry Standard**:
```
PAGE 1 BOTTOM:
SARAH
I can't believe what happened
yesterday at the office.
              (MORE)

PAGE 2 TOP:
SARAH (CONT'D)
Everyone was completely shocked
by the announcement.
```

**Implementation Notes**:
- `(MORE)` is a widget decoration at the end of the dialogue node's visible portion on page N
- `(CONT'D)` is an inline widget decoration appended after the character node text on page N+1
- If dialogue spans 3+ pages, need multiple `(MORE)`/`(CONT'D)` pairs
- Handle case where no preceding character found (edge case)

### Rule 2: No Orphan Character Name

**Problem**: A character name appearing as the last line of a page without accompanying dialogue is confusing and unprofessional.

**Solution**: If a character node ends on page N but its following dialogue node starts on page N+1, push the character node to page N+1.

**Industry Standard**:
```
WRONG:
[end of page 1]
JOHN

[top of page 2]
Where are we going?

CORRECT:
[end of page 1]
[empty space]

[top of page 2]
JOHN
Where are we going?
```

**Implementation Notes**:
- Check each character node: does next node exist, is it dialogue, do they span different pages?
- If yes: insert spacer widget before character to push it to next page
- Spacer height = (pageBottom - character.rect.top) + safetyPx

### Rule 3: Parenthetical Sticks with Dialogue

**Problem**: Parenthetical direction must stay with the dialogue it modifies, not be separated by a page break.

**Solution**: If a parenthetical node ends on page N but the following dialogue starts on page N+1, push the parenthetical to page N+1.

**Industry Standard**:
```
WRONG:
[end of page 1]
(sarcastically)

[top of page 2]
That's just great.

CORRECT:
[end of page 1]
[empty space]

[top of page 2]
(sarcastically)
That's just great.
```

**Implementation Notes**:
- Check each parenthetical node: does next node exist, is it dialogue, do they span different pages?
- If yes OR if next is not dialogue: push parenthetical to next page
- Same spacer widget technique as Rule 2

### Rule 4: No Scene Heading Orphan

**Problem**: A scene heading at the bottom of a page without any action/content is confusing and breaks visual flow.

**Solution**: If a scene heading ends on page N but the next block starts on page N+1, push the scene heading to page N+1.

**Industry Standard**:
```
WRONG:
[end of page 1]
INT. COFFEE SHOP - DAY

[top of page 2]
Sarah enters looking tired.

CORRECT:
[end of page 1]
[empty space]

[top of page 2]
INT. COFFEE SHOP - DAY

Sarah enters looking tired.
```

**Implementation Notes**:
- Check each scene heading: does next node exist, do they span different pages?
- If yes: push scene heading to next page
- Industry standard requires ≥1 line of content with the heading

### Rule 5: No Transition at Top

**Problem**: Transitions mark the end of a scene and should not appear as the first element on a new page.

**Solution**: If a transition is the first block on a page, insert small spacer to nudge it down or push previous content to keep transition with preceding scene.

**Industry Standard**:
```
WRONG:
[top of page 2]
CUT TO:

INT. BEDROOM - NIGHT

CORRECT:
[end of page 1]
Sarah walks away.
CUT TO:

[top of page 2]
INT. BEDROOM - NIGHT
```

**Implementation Notes**:
- For each page, find the first block with startPage == pageIndex
- If it's a transition: insert small nudge spacer (14px) to prevent it being the absolute first line
- Alternative: could push previous block to keep transition with it (more complex)

---

## Technical Architecture

### Extension Structure

**Type**: TipTap Extension (not Node extension)
**Pattern**: ProseMirror Plugin with DecorationSet state
**Integration**: Registered via ScreenplayKit.addProseMirrorPlugins()

```
frontend/extensions/screenplay/
├── plugins/
│   ├── smart-enter-plugin.ts          [existing]
│   └── smart-breaks-plugin.ts          [new - this spec]
├── screenplay-kit.ts                   [modify - add plugin registration]
└── types.ts                            [modify - add SmartBreaksOptions]
```

### Plugin Architecture

```typescript
SmartBreaksPlugin Structure:
├── PluginKey<DecorationSet>           // State management
├── Plugin State
│   ├── init: () => DecorationSet.empty
│   ├── apply: (tr, old) => DecorationSet
│   └── Meta handling: { decorations: DecorationSet }
├── Plugin View
│   ├── init: Setup observers, queue first computation
│   ├── update: Trigger recomputation (debounced)
│   └── destroy: Cleanup observers
└── Decoration Computation
    ├── getPageRects()                 // Extract page geometry
    ├── collectBlocks()                // Gather screenplay blocks
    ├── applyRules()                   // Execute 5 rules
    └── createDecorationSet()          // Build final decorations
```

### Decoration Strategy

**Widget Decorations** (Visual elements inserted into the view):
1. **Spacer Widget**: Zero-width div with dynamic height to push blocks to next page
2. **(MORE) Widget**: Centered text displayed at end of split dialogue
3. **(CONT'D) Widget**: Inline text appended after character name
4. **Nudge Widget**: Small spacer to prevent transitions at page top

**Key Properties**:
- `side: -1` for spacers (insert before target position)
- `side: 1` for text widgets (insert after target position)
- Non-editable, pointer-events: none
- Data attributes for debugging (e.g., `data-smart-break-spacer="true"`)

### State Management Pattern

```typescript
Plugin State Lifecycle:
1. init(state):
   - Return DecorationSet.empty

2. apply(tr, oldDecorationSet, oldState, newState):
   - If tr.getMeta(SmartBreaksKey)?.decorations exists:
     → Return new decorations from meta
   - Else if tr.docChanged:
     → Return DecorationSet.empty (will recompute in view.update)
   - Else:
     → Return oldDecorationSet.map(tr.mapping, tr.doc)

3. View Update:
   - On doc change, resize, or pagination mutation
   - Compute new decorations
   - Dispatch tr.setMeta(SmartBreaksKey, { decorations })
```

---

## Implementation Details

### File Structure

#### 1. Main Plugin File: `smart-breaks-plugin.ts`

**Location**: `frontend/extensions/screenplay/plugins/smart-breaks-plugin.ts`

**Exports**:
```typescript
export interface SmartBreaksOptions {
  schemaNames: {
    sceneHeading: string;
    action: string;
    character: string;
    parenthetical: string;
    dialogue: string;
    transition: string;
  };
  moreText?: string;      // Default: '(MORE)'
  contdText?: string;     // Default: " (CONT'D)"
  safetyPx?: number;      // Default: 4
}

export function SmartBreaksPlugin(options: SmartBreaksOptions): Plugin<DecorationSet>
```

**Internal Functions**:
```typescript
// Page geometry
function getPageRects(headers: HTMLElement[]): PageRect[]
function guessPageHeightFromCSS(el: HTMLElement): number | null
function pageIndexForY(y: number, rects: PageRect[]): number

// Block collection
interface BlockInfo {
  pos: number;
  end: number;
  type: BlockKind;
  rect: DOMRect;
  startPage: number;
  endPage: number;
}
function collectBlocks(view: EditorView, options: SmartBreaksOptions): BlockInfo[]

// Decoration builders
function pushToNextPage(block: BlockInfo, pageRects: PageRect[], safetyPx: number): Decoration | null
function addMoreAtEndOfPage(block: BlockInfo, moreText: string): Decoration
function addContdAfterCharacter(block: BlockInfo, contdText: string): Decoration
function addNudgeWidget(block: BlockInfo): Decoration

// Main computation
function computeDecorations(view: EditorView, options: SmartBreaksOptions): DecorationSet
```

#### 2. ScreenplayKit Integration: Modify `screenplay-kit.ts`

**Changes**:
```typescript
// Import new plugin
import { SmartBreaksPlugin } from './plugins/smart-breaks-plugin';

// Update options interface (already has placeholder)
export interface ScreenplayKitOptions {
  enableSmartEnter?: boolean;          // existing
  enableSmartPageBreaks?: boolean;     // existing placeholder - now implement
}

// Update addProseMirrorPlugins()
addProseMirrorPlugins() {
  const plugins = [];

  // Smart Enter (existing)
  if (this.options.enableSmartEnter !== false) {
    plugins.push(SmartEnterPlugin());
  }

  // Smart Page Breaks (NEW)
  if (this.options.enableSmartPageBreaks === true) {
    plugins.push(SmartBreaksPlugin({
      schemaNames: {
        sceneHeading: 'sceneHeading',
        action: 'action',
        character: 'character',
        parenthetical: 'parenthetical',
        dialogue: 'dialogue',
        transition: 'transition',
      },
      moreText: '(MORE)',
      contdText: " (CONT'D)",
      safetyPx: 4,
    }));
  }

  return plugins;
}
```

#### 3. Styles: Add to `screenplay.css`

**New Classes**:
```css
/* Smart break spacer (invisible) */
[data-smart-break-spacer] {
  width: 1px;
  display: block;
  pointer-events: none;
  user-select: none;
}

/* (MORE) text widget */
.smart-break-more {
  display: block;
  text-align: center;
  font-family: 'Courier', 'Courier New', monospace;
  font-size: 12pt;
  line-height: 12pt;
  margin-top: 4px;
  pointer-events: none;
  user-select: none;
}

/* (CONT'D) inline widget */
.smart-break-contd {
  font-family: 'Courier', 'Courier New', monospace;
  font-size: 12pt;
  line-height: 12pt;
  pointer-events: none;
  user-select: none;
}
```

#### 4. Test Page Integration: Modify `test-tiptap/page.tsx`

**Changes**:
```typescript
// Enable smart breaks in ScreenplayKit configuration
ScreenplayKit.configure({
  enableSmartPageBreaks: true,  // Add this line
}),
```

---

## Algorithm Specifications

### Main Computation Flow

```typescript
function computeDecorations(view: EditorView, options: SmartBreaksOptions): DecorationSet {
  const { state } = view;
  const { doc } = state;

  // STEP 1: Get pagination headers
  const headers = Array.from(document.querySelectorAll<HTMLElement>('.rm-page-header'));
  if (!headers.length) {
    return DecorationSet.create(doc, []); // Early exit if no pagination
  }

  // STEP 2: Build page rectangles
  const pageRects = getPageRects(headers);

  // STEP 3: Collect screenplay blocks with page assignments
  const blocks = collectBlocks(view, options);

  // STEP 4: Apply rules and accumulate decorations
  const decorations: Decoration[] = [];

  // Rule 1: Dialogue continuation
  applyDialogueContinuationRule(blocks, decorations, options);

  // Rule 2: No orphan character
  applyNoOrphanCharacterRule(blocks, decorations, pageRects, options);

  // Rule 3: Parenthetical with dialogue
  applyParentheticalRule(blocks, decorations, pageRects, options);

  // Rule 4: No scene heading orphan
  applySceneHeadingRule(blocks, decorations, pageRects, options);

  // Rule 5: No transition at top
  applyNoTransitionAtTopRule(blocks, decorations, pageRects);

  // STEP 5: Create decoration set
  return DecorationSet.create(doc, decorations);
}
```

### Page Geometry Calculation

```typescript
function getPageRects(headers: HTMLElement[]): PageRect[] {
  const rects = headers.map(h => h.getBoundingClientRect());

  // Try to get page height from CSS variable or use fallback
  const height = guessPageHeightFromCSS(headers[0]) || 1056; // Letter @ 96dpi

  const out: PageRect[] = [];
  for (let i = 0; i < rects.length; i++) {
    const top = rects[i].top;
    const bottom = (i < rects.length - 1)
      ? rects[i + 1].top - 1  // Use next header position
      : top + height;          // Use calculated height for last page
    out.push({ top, bottom });
  }
  return out;
}

function guessPageHeightFromCSS(el: HTMLElement): number | null {
  const root = el.closest('.screenplay-editor.rm-with-pagination') as HTMLElement | null;
  if (!root) return null;

  const cs = getComputedStyle(root);
  const h = cs.getPropertyValue('--rm-page-height').trim();
  if (!h) return null;

  const px = parseFloat(h);
  return Number.isFinite(px) ? px : null;
}

function pageIndexForY(y: number, rects: PageRect[]): number {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (y >= r.top && y <= r.bottom) return i;
  }

  // Fallback for out-of-bounds
  if (!rects.length) return -1;
  return y < rects[0].top ? 0 : rects.length - 1;
}
```

### Block Collection

```typescript
function collectBlocks(view: EditorView, options: SmartBreaksOptions): BlockInfo[] {
  const { state } = view;
  const { doc } = state;

  const wanted = new Set<string>([
    options.schemaNames.sceneHeading,
    options.schemaNames.action,
    options.schemaNames.character,
    options.schemaNames.parenthetical,
    options.schemaNames.dialogue,
    options.schemaNames.transition,
  ]);

  const blocks: BlockInfo[] = [];

  doc.descendants((node, pos) => {
    // Only process block nodes of screenplay types
    if (!node.isBlock) return false;
    if (!wanted.has(node.type.name)) return;

    // Get DOM element and rect
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (!dom) return;

    const rect = dom.getBoundingClientRect();
    if (!isFiniteRect(rect)) return;

    // Get page geometry from pagination
    const headers = Array.from(document.querySelectorAll<HTMLElement>('.rm-page-header'));
    const pageRects = getPageRects(headers);

    const startPage = pageIndexForY(rect.top, pageRects);
    const endPage = pageIndexForY(rect.bottom, pageRects);

    blocks.push({
      pos,
      end: pos + node.nodeSize,
      type: node.type.name as BlockKind,
      rect,
      startPage,
      endPage,
    });
  });

  return blocks;
}

function isFiniteRect(r: DOMRect): boolean {
  return Number.isFinite(r.top) &&
         Number.isFinite(r.bottom) &&
         r.height >= 0;
}
```

### Rule Implementation Functions

#### Rule 1: Dialogue Continuation

```typescript
function applyDialogueContinuationRule(
  blocks: BlockInfo[],
  decorations: Decoration[],
  options: SmartBreaksOptions
): void {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Only process dialogue that spans pages
    if (block.type !== options.schemaNames.dialogue) continue;
    if (block.startPage === block.endPage) continue;

    // (a) Add (MORE) at end of visible portion on first page
    const moreWidget = Decoration.widget(block.end - 1, () => {
      const el = document.createElement('div');
      el.className = 'smart-break-more';
      el.textContent = options.moreText || '(MORE)';
      el.setAttribute('data-smart-break', 'more');
      return el;
    }, { side: 1 });
    decorations.push(moreWidget);

    // (b) Add (CONT'D) after nearest preceding character on next page
    // Find the most recent character block before this dialogue
    const charBlock = [...blocks.slice(0, i)]
      .reverse()
      .find(b => b.type === options.schemaNames.character);

    if (charBlock) {
      const contdWidget = Decoration.widget(charBlock.end - 1, () => {
        const el = document.createElement('span');
        el.className = 'smart-break-contd';
        el.textContent = options.contdText || " (CONT'D)";
        el.setAttribute('data-smart-break', 'contd');
        return el;
      }, { side: 1 });
      decorations.push(contdWidget);
    }
  }
}
```

#### Rule 2: No Orphan Character

```typescript
function applyNoOrphanCharacterRule(
  blocks: BlockInfo[],
  decorations: Decoration[],
  pageRects: PageRect[],
  options: SmartBreaksOptions
): void {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Only process character blocks
    if (block.type !== options.schemaNames.character) continue;

    // Check next block
    const next = blocks[i + 1];
    if (!next || next.type !== options.schemaNames.dialogue) continue;

    // If character ends on different page than dialogue starts, push character
    if (block.endPage !== next.startPage) {
      const spacer = pushToNextPage(block, pageRects, options.safetyPx || 4);
      if (spacer) decorations.push(spacer);
    }
  }
}

function pushToNextPage(
  block: BlockInfo,
  pageRects: PageRect[],
  safetyPx: number
): Decoration | null {
  const pageIdx = block.startPage;
  if (pageIdx < 0 || pageIdx >= pageRects.length) return null;

  // Calculate height needed to push block to next page
  const delta = Math.max(0, pageRects[pageIdx].bottom - block.rect.top) + safetyPx;
  if (delta <= 0) return null;

  return Decoration.widget(block.pos, () => {
    const el = document.createElement('div');
    el.setAttribute('data-smart-break-spacer', 'true');
    el.style.cssText = `height:${delta}px; width:1px;`;
    return el;
  }, { side: -1 });
}
```

#### Rule 3: Parenthetical with Dialogue

```typescript
function applyParentheticalRule(
  blocks: BlockInfo[],
  decorations: Decoration[],
  pageRects: PageRect[],
  options: SmartBreaksOptions
): void {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Only process parenthetical blocks
    if (block.type !== options.schemaNames.parenthetical) continue;

    const next = blocks[i + 1];

    // Push if: no next block, next is not dialogue, or spans different pages
    if (!next ||
        next.type !== options.schemaNames.dialogue ||
        block.endPage !== next.startPage) {
      const spacer = pushToNextPage(block, pageRects, options.safetyPx || 4);
      if (spacer) decorations.push(spacer);
    }
  }
}
```

#### Rule 4: No Scene Heading Orphan

```typescript
function applySceneHeadingRule(
  blocks: BlockInfo[],
  decorations: Decoration[],
  pageRects: PageRect[],
  options: SmartBreaksOptions
): void {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Only process scene heading blocks
    if (block.type !== options.schemaNames.sceneHeading) continue;

    const next = blocks[i + 1];

    // Push if next block exists and spans different page
    if (next && block.endPage !== next.startPage) {
      const spacer = pushToNextPage(block, pageRects, options.safetyPx || 4);
      if (spacer) decorations.push(spacer);
    }
  }
}
```

#### Rule 5: No Transition at Top

```typescript
function applyNoTransitionAtTopRule(
  blocks: BlockInfo[],
  decorations: Decoration[],
  pageRects: PageRect[]
): void {
  // Get unique page indices
  const pages = Array.from(new Set(blocks.map(b => b.startPage))).sort((a, b) => a - b);

  for (const pageIdx of pages) {
    // Find first block on this page
    const firstBlock = blocks.find(b => b.startPage === pageIdx);

    // If it's a transition, add small nudge
    if (firstBlock?.type === 'transition') {
      const nudgeWidget = Decoration.widget(firstBlock.pos, () => {
        const el = document.createElement('div');
        el.setAttribute('data-smart-break-spacer', 'true');
        el.style.cssText = 'height: 14px; width: 1px;';
        return el;
      }, { side: -1 });
      decorations.push(nudgeWidget);
    }
  }
}
```

### Observer Setup

```typescript
// In plugin view initialization
view: (editorView) => {
  let rafHandle = 0;
  const root = editorView.dom.closest('.screenplay-editor.rm-with-pagination') || editorView.dom;

  const recompute = () => {
    cancelAnimationFrame(rafHandle);
    rafHandle = requestAnimationFrame(() => {
      const decorations = computeDecorations(editorView, options);
      editorView.dispatch(
        editorView.state.tr.setMeta(SmartBreaksKey, { decorations })
      );
    });
  };

  // ResizeObserver for window/container size changes
  const resizeObserver = new ResizeObserver(recompute);
  resizeObserver.observe(root as Element);

  // MutationObserver for pagination DOM changes
  const mutationObserver = new MutationObserver(recompute);
  mutationObserver.observe(root as Element, {
    childList: true,
    subtree: true,
    attributes: true,
  });

  // Initial computation
  queueMicrotask(recompute);

  return {
    update: () => recompute(),
    destroy: () => {
      cancelAnimationFrame(rafHandle);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    },
  };
}
```

---

## Data Structures

### TypeScript Interfaces

```typescript
/**
 * Page rectangle information derived from pagination headers
 */
interface PageRect {
  top: number;     // Y coordinate of page top
  bottom: number;  // Y coordinate of page bottom
}

/**
 * Screenplay block kinds (node types)
 */
type BlockKind =
  | 'sceneHeading'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition';

/**
 * Block information with page assignment
 */
interface BlockInfo {
  pos: number;        // ProseMirror position (start)
  end: number;        // ProseMirror position (end)
  type: BlockKind;    // Node type
  rect: DOMRect;      // DOM bounding rectangle
  startPage: number;  // Page index where block starts
  endPage: number;    // Page index where block ends
}

/**
 * Smart breaks configuration options
 */
interface SmartBreaksOptions {
  /**
   * Node type name mappings (allows flexibility for backend vs TipTap names)
   */
  schemaNames: {
    sceneHeading: string;
    action: string;
    character: string;
    parenthetical: string;
    dialogue: string;
    transition: string;
  };

  /**
   * Text for dialogue continuation marker at page bottom
   * @default '(MORE)'
   */
  moreText?: string;

  /**
   * Text for character continuation marker on next page
   * @default " (CONT'D)"
   */
  contdText?: string;

  /**
   * Safety padding when pushing blocks to next page (px)
   * @default 4
   */
  safetyPx?: number;
}
```

---

## Integration Plan

### Phase 1: Plugin Registration

1. **Create Plugin File**: `frontend/extensions/screenplay/plugins/smart-breaks-plugin.ts`
   - Implement basic plugin structure
   - Export `SmartBreaksPlugin()` factory function
   - Test that it loads without errors

2. **Update ScreenplayKit**: Modify `screenplay-kit.ts`
   - Import SmartBreaksPlugin
   - Add plugin registration in `addProseMirrorPlugins()`
   - Wire up `enableSmartPageBreaks` option

3. **Test Integration**:
   ```typescript
   // In test-tiptap/page.tsx
   ScreenplayKit.configure({
     enableSmartPageBreaks: true,
   }),
   ```

### Phase 2: Core Functionality

1. **Implement Helper Functions**:
   - `getPageRects()` - page geometry extraction
   - `pageIndexForY()` - Y coordinate to page mapping
   - `collectBlocks()` - screenplay block collection
   - `isFiniteRect()` - rect validation

2. **Implement Decoration Builders**:
   - `pushToNextPage()` - spacer widget creation
   - `addMoreAtEndOfPage()` - (MORE) widget
   - `addContdAfterCharacter()` - (CONT'D) widget
   - `addNudgeWidget()` - transition nudge

3. **Test Each Helper**:
   - Unit tests for geometry functions
   - Test block collection with sample documents
   - Verify decoration creation

### Phase 3: Rule Implementation

1. **Implement Rules in Order**:
   - Rule 1: Dialogue continuation
   - Rule 2: No orphan character
   - Rule 3: Parenthetical grouping
   - Rule 4: Scene heading orphan
   - Rule 5: Transition positioning

2. **Test Each Rule Individually**:
   - Create test documents that trigger each rule
   - Verify visual output matches expectations
   - Check edge cases

### Phase 4: Styling & Polish

1. **Add CSS Styles**: Update `screenplay.css`
   - `.smart-break-more` styling
   - `.smart-break-contd` styling
   - `[data-smart-break-spacer]` styling

2. **Performance Testing**:
   - Test with 469KB FDX file
   - Measure recomputation time
   - Optimize if needed

3. **Collaboration Testing**:
   - Open multiple tabs
   - Verify decorations work independently
   - Ensure no sync issues

---

## Performance Considerations

### Target Metrics

- **Recomputation Time**: <16ms for 60fps responsive editing
- **Initial Load**: <100ms for first decoration computation
- **Large Documents**: <50ms for 469KB FDX file (~3000 blocks)
- **Memory**: <2MB overhead for decoration state

### Optimization Strategies

#### 1. Early Exit Conditions

```typescript
// Exit early if no pagination
const headers = Array.from(document.querySelectorAll('.rm-page-header'));
if (!headers.length) {
  return DecorationSet.create(doc, []);
}

// Skip blocks with invalid rects
const rect = dom.getBoundingClientRect();
if (!isFiniteRect(rect)) return;
```

#### 2. Debouncing with RAF

```typescript
let rafHandle = 0;
const recompute = () => {
  cancelAnimationFrame(rafHandle);
  rafHandle = requestAnimationFrame(() => {
    // Computation happens here at most once per frame
  });
};
```

#### 3. Efficient Block Collection

```typescript
// Use doc.descendants with early returns
doc.descendants((node, pos) => {
  if (!node.isBlock) return false;  // Skip inline content
  if (!wanted.has(node.type.name)) return;  // Skip non-screenplay nodes
  // Process only relevant blocks
});
```

#### 4. Minimal DOM Queries

```typescript
// Query pagination headers once per computation
const headers = Array.from(document.querySelectorAll('.rm-page-header'));
const pageRects = getPageRects(headers);

// Reuse pageRects for all blocks
blocks.forEach(block => {
  const startPage = pageIndexForY(block.rect.top, pageRects);
  // ...
});
```

#### 5. Future Optimizations (if needed)

- **Caching**: Cache page rects if headers haven't moved (detect via rect comparison)
- **Incremental Updates**: Track which blocks changed and only recompute affected rules
- **Web Worker**: Offload geometry calculations to worker thread (complex, likely unnecessary)

### Performance Testing Plan

```typescript
// Add to plugin for benchmarking (remove in production)
const start = performance.now();
const decorations = computeDecorations(view, options);
const duration = performance.now() - start;
if (duration > 16) {
  console.warn(`[SmartBreaks] Slow recomputation: ${duration.toFixed(2)}ms`);
}
```

---

## Testing Strategy

### Unit Tests

**Location**: `frontend/extensions/screenplay/__tests__/smart-breaks.test.ts`

```typescript
describe('SmartBreaks - Geometry', () => {
  test('getPageRects - calculates correct page boundaries', () => {
    // Mock headers with known positions
    // Verify rect.top and rect.bottom values
  });

  test('pageIndexForY - maps Y coordinates to pages', () => {
    // Test boundary conditions
    // Test out-of-bounds handling
  });

  test('guessPageHeightFromCSS - extracts CSS variable', () => {
    // Mock CSS variable
    // Verify fallback behavior
  });
});

describe('SmartBreaks - Block Collection', () => {
  test('collectBlocks - gathers screenplay nodes', () => {
    // Create mock editor with screenplay nodes
    // Verify correct blocks collected with page assignments
  });

  test('isFiniteRect - validates DOMRect', () => {
    // Test valid and invalid rects
  });
});

describe('SmartBreaks - Decoration Builders', () => {
  test('pushToNextPage - creates spacer with correct height', () => {
    // Mock block and page rects
    // Verify spacer widget properties
  });

  test('addMoreAtEndOfPage - creates (MORE) widget', () => {
    // Verify widget position, content, styling
  });

  test('addContdAfterCharacter - creates (CONT\'D) widget', () => {
    // Verify widget position, content, styling
  });
});
```

### Integration Tests

**Location**: `frontend/extensions/screenplay/__tests__/smart-breaks-integration.test.ts`

```typescript
describe('SmartBreaks - Rule Integration', () => {
  test('Rule 1: Dialogue continuation across pages', () => {
    // Create editor with dialogue spanning pages
    // Verify (MORE) and (CONT'D) decorations exist
  });

  test('Rule 2: Character orphan prevention', () => {
    // Create character + dialogue at page boundary
    // Verify character pushed to next page
  });

  test('Rule 3: Parenthetical grouping', () => {
    // Create parenthetical + dialogue at boundary
    // Verify both on same page
  });

  test('Rule 4: Scene heading orphan prevention', () => {
    // Create scene heading at page boundary
    // Verify pushed with following content
  });

  test('Rule 5: No transition at page top', () => {
    // Place transition at page start
    // Verify nudge spacer added
  });

  test('Multiple rules simultaneously', () => {
    // Complex document triggering all rules
    // Verify all decorations applied correctly
  });
});
```

### Edge Case Tests

```typescript
describe('SmartBreaks - Edge Cases', () => {
  test('No pagination headers present', () => {
    // Verify early exit, no errors
  });

  test('Dialogue spans 3+ pages', () => {
    // Verify multiple (MORE)/(CONT'D) pairs
  });

  test('Missing character before split dialogue', () => {
    // Verify graceful handling (no (CONT'D))
  });

  test('Empty pages', () => {
    // Verify no crashes on pages with no blocks
  });

  test('Zero-height blocks', () => {
    // Verify blocks with no visual height handled
  });

  test('First page special handling', () => {
    // Can't push blocks before page 1
  });

  test('Last page special handling', () => {
    // Different logic when no next page exists
  });
});
```

### Performance Tests

```typescript
describe('SmartBreaks - Performance', () => {
  test('Large document recomputation < 50ms', async () => {
    // Load 469KB FDX test file (~3000 blocks)
    const start = performance.now();
    // Trigger recomputation
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(50);
  });

  test('RAF debouncing prevents excessive recomputation', () => {
    // Trigger multiple updates rapidly
    // Verify only one computation per frame
  });
});
```

### Collaboration Tests

```typescript
describe('SmartBreaks - Collaboration', () => {
  test('Decorations do not sync via Yjs', () => {
    // Create two editors with same Yjs doc
    // Add decorations in one
    // Verify decorations don't appear in other
  });

  test('Each client computes decorations independently', () => {
    // Two clients with different viewport sizes
    // Verify decorations can differ (acceptable)
  });

  test('Document edits trigger recomputation', () => {
    // Edit document in one client
    // Verify decorations update in all clients
  });
});
```

### Manual Testing Checklist

- [ ] Enable smart breaks in test-tiptap page
- [ ] Load script with all screenplay element types
- [ ] Verify each rule visually:
  - [ ] Split dialogue shows (MORE) and (CONT'D)
  - [ ] Character names don't orphan at page bottom
  - [ ] Parentheticals stay with dialogue
  - [ ] Scene headings stay with following content
  - [ ] Transitions don't start pages
- [ ] Test with 469KB FDX file (performance)
- [ ] Test in multiple browser tabs (collaboration)
- [ ] Test window resize (decorations update)
- [ ] Test zoom in/out (decorations update)
- [ ] Test rapid typing (debouncing works)

---

## Export Handling

### Problem Statement

Smart breaks are visual-only decorations in the editor. When exporting to PDF or FDX, we need to materialize `(MORE)` and `(CONT'D)` markers as actual text in the output without modifying the source Yjs document.

### Export Strategy

#### Approach 1: Export-Time Computation (Recommended)

```typescript
// In export service (e.g., backend/app/services/pdf_export.py)
async function exportToPDF(scriptId: string): Promise<Buffer> {
  // 1. Fetch script content from database
  const script = await getScriptContent(scriptId);

  // 2. Run smart breaks computation one final time
  // This gives us decoration positions without modifying source
  const decorations = computeSmartBreaksForExport(script.content_blocks);

  // 3. Generate PDF with decorations materialized
  return generatePDFWithSmartBreaks(script.content_blocks, decorations);
}

function computeSmartBreaksForExport(blocks: ContentBlock[]): ExportDecoration[] {
  // Similar to editor computation, but:
  // - Use known page height (792pt for Letter)
  // - Use known line height (12pt)
  // - Calculate page breaks mathematically instead of via DOM
  // - Return list of { type: 'more' | 'contd', position, text }
}
```

#### Approach 2: Real-Time Materialization Hook

```typescript
// Add to SmartBreaksPlugin
export function getSmartBreakMarkers(editorView: EditorView): SmartBreakMarker[] {
  // Extract current decorations from plugin state
  const state = SmartBreaksKey.getState(editorView.state);

  // Convert decorations to export-friendly format
  return convertDecorationsToMarkers(state, editorView);
}

interface SmartBreakMarker {
  type: 'more' | 'contd';
  position: number;    // ProseMirror position
  text: string;        // '(MORE)' or " (CONT'D)"
  blockId: string;     // Associated block ID for mapping
}
```

#### Implementation Notes

1. **Export Flow**:
   ```
   User clicks "Export to PDF"
   → Frontend calls backend export API
   → Backend fetches script content
   → Backend runs smart breaks computation
   → Backend generates PDF with markers
   → Return PDF file
   ```

2. **FDX Export**: Similar approach, but insert markers as FDX elements
   ```xml
   <Paragraph Type="Dialogue">
     <Text>I can't believe what happened</Text>
   </Paragraph>
   <Paragraph Type="Action">
     <Text Style="Italic+AllCaps">(MORE)</Text>
   </Paragraph>
   ```

3. **Future Enhancement**: Could cache decoration positions with last export timestamp to avoid recomputation if document unchanged.

---

## Phase Planning

### Phase 1: MVP (1-2 weeks)

**Goal**: Core functionality with Rules 1-2 working

**Deliverables**:
- [ ] SmartBreaksPlugin skeleton created
- [ ] Plugin registered in ScreenplayKit
- [ ] Page geometry functions implemented
- [ ] Block collection implemented
- [ ] Rule 1 (Dialogue continuation) working
- [ ] Rule 2 (No orphan character) working
- [ ] Basic CSS styling added
- [ ] Unit tests for geometry and block collection
- [ ] Manual testing with simple documents

**Success Criteria**:
- Dialogue splits show (MORE) and (CONT'D) correctly
- Character names push to next page with dialogue
- No performance issues with documents up to 1000 blocks

### Phase 2: Complete Rules (1 week)

**Goal**: All 5 rules implemented and tested

**Deliverables**:
- [ ] Rule 3 (Parenthetical grouping) implemented
- [ ] Rule 4 (Scene heading orphan) implemented
- [ ] Rule 5 (No transition at top) implemented
- [ ] Edge case handling for all rules
- [ ] Integration tests for each rule
- [ ] Testing with 469KB FDX file
- [ ] Collaboration testing (multiple tabs)

**Success Criteria**:
- All rules work correctly on complex documents
- Edge cases handled gracefully
- Performance <50ms for large documents
- No issues with real-time collaboration

### Phase 3: Polish & Production (1 week)

**Goal**: Production-ready quality and documentation

**Deliverables**:
- [ ] CSS styling polished and industry-accurate
- [ ] Comprehensive test coverage (>90%)
- [ ] Performance optimization if needed
- [ ] Documentation for users and developers
- [ ] Export handling strategy finalized
- [ ] Integration with production script-editor page

**Success Criteria**:
- Professional visual quality matching Final Draft
- All tests passing
- Documentation complete
- Ready for user testing

### Phase 4: Advanced Features (Future)

**Goal**: Enhancements beyond MVP

**Potential Features**:
- [ ] Sentence-boundary dialogue splitting
- [ ] Widow/orphan prevention for action blocks
- [ ] Per-rule configuration (enable/disable individual rules)
- [ ] Visual debugging mode
- [ ] Configurable line counting
- [ ] Custom (MORE)/(CONT'D) text per project

**Timeline**: TBD based on user feedback and priorities

---

## Risk Analysis

### Technical Risks

#### Risk 1: Performance with Large Documents

**Severity**: Medium
**Probability**: Medium
**Impact**: Poor editing experience, lag during typing

**Mitigation**:
- Early exit conditions for no pagination
- RAF debouncing to limit recomputation frequency
- Efficient block collection using doc.descendants
- Performance testing with 469KB test file
- Profiling and optimization if metrics not met

**Contingency**: If optimization insufficient, implement incremental updates or caching

#### Risk 2: Pagination Extension DOM Structure Changes

**Severity**: High
**Probability**: Low
**Impact**: Smart breaks stop working if DOM selectors change

**Mitigation**:
- Document exact DOM structure requirements
- Test with specific version: tiptap-pagination-plus@1.2.2
- Graceful degradation: early exit if selectors not found
- Fallback to CSS variable or fixed height

**Contingency**: Update selectors or switch to different pagination extension

#### Risk 3: Decoration Positioning Inaccuracies

**Severity**: Medium
**Probability**: Medium
**Impact**: Decorations appear at wrong positions, visual glitches

**Mitigation**:
- Extensive testing with various page sizes and zoom levels
- Safety padding (safetyPx) to prevent edge cases
- Visual regression testing with screenshots
- User feedback during beta testing

**Contingency**: Adjust calculation logic, increase safety padding

#### Risk 4: Collaboration Conflicts

**Severity**: Low
**Probability**: Low
**Impact**: Decorations cause sync issues or confusion

**Mitigation**:
- Decorations are view-only, never synced via Yjs
- Each client computes independently
- Test with multiple simultaneous editors
- Document expected behavior (clients may differ slightly)

**Contingency**: Add visual indicator that smart breaks are client-side

### Product Risks

#### Risk 5: Unexpected User Workflows

**Severity**: Medium
**Probability**: Medium
**Impact**: Smart breaks interfere with user editing patterns

**Mitigation**:
- Make feature opt-in initially (enableSmartPageBreaks flag)
- Provide clear documentation
- Beta testing with real users
- Easy disable mechanism

**Contingency**: Add per-rule configuration to disable problematic rules

#### Risk 6: Export Format Compatibility

**Severity**: Medium
**Probability**: Medium
**Impact**: Exported PDFs/FDX don't match editor display

**Mitigation**:
- Design export strategy before full rollout
- Test exports match editor visuals
- Document any intentional differences
- User feedback on export quality

**Contingency**: Iterate on export implementation, add export preview

### Schedule Risks

#### Risk 7: Underestimated Complexity

**Severity**: Low
**Probability**: Medium
**Impact**: Implementation takes longer than planned

**Mitigation**:
- Phased approach with MVP first
- Regular progress check-ins
- Focus on core functionality before polish
- Buffer time in schedule

**Contingency**: Descope Phase 3/4 features, focus on working MVP

---

## Appendix A: Reference Implementation

See `smartBreakNotes.md` for the original pseudocode and TypeScript example that this specification is based on.

**Key Differences from Reference**:
1. This spec integrates with existing ScreenplayKit structure
2. Node type names adjusted for TipTap conventions (sceneHeading vs scene_heading)
3. Integration with test-tiptap page instead of standalone example
4. Phased implementation approach for incremental delivery

---

## Appendix B: Industry Standards Reference

**Final Draft Behavior**:
- Dialogue continuation: (MORE) centered, (CONT'D) after character
- No orphaned elements at page breaks
- Intelligent page break placement for readability

**Scriptwriting Format Standards**:
- Industry Standard Screenplay Format (Studio Binder)
- Hollywood Standard Formatting (Script Lab)
- WGA Format Guidelines

---

## Appendix C: Future Enhancements

### Sentence-Boundary Dialogue Splitting

**Problem**: Current implementation may split dialogue mid-sentence.

**Solution**:
```typescript
// Enhance dialogue continuation rule
function findSentenceBoundary(dialogueBlock: BlockInfo, pageBottom: number): number {
  // Get inline Range.getClientRects() for dialogue text
  // Find last punctuation (. ! ?) whose rect.bottom ≤ pageBottom
  // Return position of that punctuation
  // If none found, push entire dialogue to next page
}
```

**Complexity**: Medium - requires text content analysis and inline rect calculation

### Widow/Orphan Prevention for Action

**Problem**: Single lines of action separated from their paragraph.

**Solution**: Similar to character orphan prevention, but for action blocks:
- Detect if action block has only 1 line on current page and rest on next
- Push entire action block to next page
- Or: detect if action has only 1 line on next page and pull it to current

**Complexity**: Medium - requires line counting within blocks

### Visual Debugging Mode

**Problem**: Hard to debug smart break calculations during development.

**Solution**:
```typescript
// Add debug option to SmartBreaksOptions
interface SmartBreaksOptions {
  // ...existing options
  debug?: boolean;
}

// If debug enabled, add visual overlays
if (options.debug) {
  // Highlight page boundaries
  // Show decoration metadata on hover
  // Display block page assignments
  // Log computation time
}
```

**Complexity**: Low - visualization helpers for development

---

## Document Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-10-30 | Claude Code | Initial specification based on smartBreakNotes.md and TipTap codebase analysis |

---

## Approval & Sign-off

**Design Review**: [ ] Pending
**Technical Review**: [ ] Pending
**Security Review**: [ ] N/A (View-only feature)
**Performance Review**: [ ] Pending
**Ready for Implementation**: [ ] Pending
