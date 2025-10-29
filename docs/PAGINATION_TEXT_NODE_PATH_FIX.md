# Page Break Decoration Fix: Text Node Path Requirements

**Date**: 2025-10-28
**Issue**: Page break decorations not rendering despite being calculated correctly
**Root Cause**: Decorations pointing to element nodes instead of text nodes
**Impact**: Critical bug preventing entire pagination feature from working

## Problem Description

After implementing decoration-based pagination (Phase 2.1), page break separators were completely invisible. Console logs showed:

```
[usePageDecorations] Calculated: {
  totalPages: 163,
  decorations: 162,
  elements: 3317
}
```

Decorations were being calculated, but not rendering.

## Investigation Process

### Step 1: Verify Decoration Calculation
Added logging to confirm decorations were being created:
- ✅ Decorations calculated: 162 decorations for 163 pages
- ✅ decorate() callback being invoked for each node path
- ❌ renderLeaf() NOT being called with pageBreak decorations

### Step 2: Debug Logging Discovery
Added console.log statements to both functions:

```typescript
// In use-page-decorations.ts decorate()
console.log('[usePageDecorations] decorate() returning decoration for path:',
  JSON.stringify(path));

// In script-editor-with-collaboration.tsx renderLeaf()
console.log('[renderLeaf] Processing leaf:', leaf);
```

**Key Finding**: decorate() logs appeared, but renderLeaf() logs for pageBreak decorations never appeared.

### Step 3: Path Analysis
Examined the paths being used for decorations:

```typescript
// Console output showed:
[usePageDecorations] decorate() returning decoration for path: [20]
[usePageDecorations] decorate() returning decoration for path: [39]
[usePageDecorations] decorate() returning decoration for path: [61]
```

**Problem Identified**: Paths like `[20]` point to element nodes, not text nodes.

## Slate Architecture Constraint

Slate decorations **must** point to text nodes, not element nodes. This is a fundamental requirement because:

1. Slate's rendering pipeline only creates decorated leaves for text nodes
2. Element nodes are rendered by renderElement(), not renderLeaf()
3. Decorations are applied during text leaf rendering, not element rendering

### Document Structure

```
Slate Document
├─ Element [0] (scene heading)
│  └─ Text [0, 0] "INT. ROOM - DAY"    ← Text node (valid decoration target)
├─ Element [1] (action)
│  └─ Text [1, 0] "John enters."       ← Text node (valid decoration target)
├─ Element [2] (dialogue)
│  └─ Text [2, 0] "Hello there."       ← Text node (valid decoration target)
```

**Wrong**: Decoration at path `[1]` (element node) → renderLeaf never called
**Correct**: Decoration at path `[1, 0]` (text node) → renderLeaf called with decoration

## The Fix

### Before (Bug)
```typescript
// pagination-engine.ts
const path = [index];  // Points to element node
decorations.push({
  anchor: { path, offset: 0 },
  focus: { path, offset: 0 },
  pageBreak: true,
  pageIndex: currentPage - 1,
});
```

### After (Fixed)
```typescript
// pagination-engine.ts
const textPath = [...path, 0];  // Points to first text child
decorations.push({
  anchor: { path: textPath, offset: 0 },
  focus: { path: textPath, offset: 0 },
  pageBreak: true,
  pageIndex: currentPage - 1,
});
```

### Implementation Details

Changed in `frontend/utils/pagination-engine.ts` at line 122:

```typescript
// Check if element fits on current page
if (currentLines + elementLines > LINES_PER_PAGE) {
  // Page break needed before this element
  // Create decoration at the start of the first text node in this element
  // Slate decorations must point to text nodes, not element nodes
  const textPath = [...path, 0]; // Point to first text child [index, 0]
  decorations.push({
    anchor: { path: textPath, offset: 0 },
    focus: { path: textPath, offset: 0 },
    pageBreak: true,
    pageIndex: currentPage - 1, // Zero-indexed for rendering
  });

  // Start new page with this element
  currentPage++;
  currentLines = elementLines;
}
```

## Verification

After applying the fix:

1. **Console logs confirmed renderLeaf invocation**:
   ```
   [renderLeaf] Processing leaf with pageBreak decoration
   ```

2. **Visual confirmation**: Page separators appeared with "PAGE 2", "PAGE 3", etc. labels

3. **Functional test**: Decorations rendered at correct positions after 55 lines per page

## Related Changes

This fix worked in conjunction with another important change:

### Empty State Guard

Added guard in `use-page-decorations.ts` to prevent clearing decorations during Yjs sync transient states:

```typescript
// Guard: Don't recalculate if editor.children is empty or very small
// This prevents clearing decorations during Yjs sync transient states
// Only skip if we already have decorations (to allow initial calculation)
if (editor.children.length === 0 && decorations.length > 0) {
  console.log('[usePageDecorations] Skipping calculation - editor.children is empty (transient state)');
  return;
}
```

This guard ensures decorations persist during WebSocket synchronization when editor.children temporarily becomes empty.

## Key Learnings

1. **Slate Decoration Targets**: Always ensure decorations point to text nodes `[index, 0]`, not element nodes `[index]`

2. **Debug Strategy**: When decorations don't render, check:
   - Are decorations being calculated? (check state/logs)
   - Is decorate() being called? (add logging to decorate callback)
   - Is renderLeaf() being called with decorations? (add logging to renderLeaf)
   - Are paths pointing to text nodes? (examine path structure)

3. **Slate Document Model**: Understanding the element/text node hierarchy is critical for working with decorations

## Impact

This was a **critical bug** that prevented the entire pagination feature from working. Without this fix:
- No visual page breaks would appear
- Page labels would not render
- Users would see continuous white page with no separators

The fix enabled the core functionality of decoration-based pagination, allowing subsequent styling improvements to be visible.

## Files Modified

1. `frontend/utils/pagination-engine.ts` - Line 122: Changed decoration paths from `[index]` to `[index, 0]`
2. `frontend/hooks/use-page-decorations.ts` - Lines 205-208: Added empty state guard
3. `frontend/components/script-editor-with-collaboration.tsx` - Added debug logging (later removed)

## Testing

To verify this fix:

1. Open screenplay editor with multi-page script
2. Scroll through document
3. Confirm gray separator bars appear every 55 lines
4. Verify "PAGE N" labels appear on each separator
5. Check console for decoration calculation logs

Expected behavior:
- Page separators visible at correct intervals
- No console errors about invalid paths
- renderLeaf() called with pageBreak decorations
