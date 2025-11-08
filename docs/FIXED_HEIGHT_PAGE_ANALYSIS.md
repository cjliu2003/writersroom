# Fixed-Height Page Implementation Analysis

**Date**: October 28, 2025
**Issue**: Pages appear similar but not exactly the same size
**Goal**: Every page should be a fixed visual height regardless of text content

---

## Root Cause Analysis

### Current Line Counting System

The pagination engine (text-metrics.ts) calculates "lines" as:

```typescript
calculateElementLines(text, elementType, metrics) {
  const baseLines = BASE_LINE_HEIGHTS[elementType];  // e.g., scene_heading: 2
  const textLines = Math.ceil(text.length / maxCols);  // Wrapped text lines
  return baseLines + textLines;
}
```

**Example Calculation**:
- Scene heading with 50 characters
- BASE_LINE_HEIGHTS['scene_heading'] = 2
- maxCols for scene_heading = 60
- textLines = Math.ceil(50/60) = 1
- **Total: 2 + 1 = 3 "lines"**

### The Problem

This **logical line count** doesn't match **visual rendered height** because:

1. **Element spacing varies independently**:
   - Scene heading: `marginTop: '24px', marginBottom: '12px'`
   - Action: `marginBottom: '12px'`
   - Character: `marginTop: '12px', marginBottom: '0px'`
   - Dialogue: `marginBottom: '12px'`

2. **Line height inconsistency**:
   - Container: `lineHeight: '12pt'` ← Correct (6 lines/inch)
   - Elements: `lineHeight: '1.5'` ← Wrong (4 lines/inch = 18pt)

3. **Spacing not included in line count**:
   - BASE_LINE_HEIGHTS accounts for element "importance"
   - Does NOT account for CSS margin values
   - A scene heading is counted as "2 lines" but renders as: 24px + content + 12px

4. **Variable page content**:
   - Page with 10 scene headings: 10 × (24px + 12px) = 360px extra spacing
   - Page with 55 action lines: 55 × 12px = 660px spacing
   - **Same line count, different visual height**

---

## Why Pages Are Variable Height

**Current page structure**:
```
┌─────────────────────────────┐
│ [Previous content]          │
│ ...                         │
├─────────────────────────────┤ ← Page break decoration
│ Gray separator (2rem)       │
├─────────────────────────────┤
│ Top margin spacer (1.2in)   │
│                             │
│ Content (variable height)   │
│ - Scene heading (36px)      │
│ - Action (24px)             │
│ - Character (12px)          │
│ - Dialogue (30px)           │
│ - ...                       │
│ (55 logical lines total)    │
│                             │
│ [No bottom constraint]      │
└─────────────────────────────┘ ← Next page break

Visual page height = 1.2in + (variable content) = INCONSISTENT
```

**The issue**: Content height between page breaks varies based on:
- Element type distribution (more scene headings = more spacing)
- Line wrapping differences
- Empty vs full elements

---

## Solution Options

### Option 1: Fix Line Counting (Partial Fix)

**Approach**: Account for CSS margins in line calculations

```typescript
const MARGIN_PER_LINE = 12; // 12pt = 1 line at 12pt lineHeight

const ELEMENT_MARGINS: Record<string, number> = {
  scene_heading: 36 / MARGIN_PER_LINE, // 24 + 12 = 36px = 3 lines
  action: 12 / MARGIN_PER_LINE,         // 12px = 1 line
  character: 12 / MARGIN_PER_LINE,      // 12 + 0 = 1 line
  dialogue: 12 / MARGIN_PER_LINE,       // 12px = 1 line
  // ...
};

function calculateElementLines(text, elementType, metrics) {
  const maxCols = metrics.maxColsByType[elementType] || 60;
  const marginLines = ELEMENT_MARGINS[elementType] || 1;
  const textLines = text.length > 0 ? Math.ceil(text.length / maxCols) : 0;

  return marginLines + textLines;
}
```

**Pros**:
- Better accuracy in line counting
- Minimal code changes

**Cons**:
- Still approximate (doesn't account for line height inconsistency)
- Still varies slightly due to rendering differences
- Doesn't guarantee pixel-perfect consistency

---

### Option 2: CSS Grid with Fixed-Height Pages (NOT VIABLE)

**Approach**: Split content into actual separate page containers

```tsx
<div className="page" style={{ height: '11in' }}>
  {/* Page 1 content */}
</div>
<div className="page" style={{ height: '11in' }}>
  {/* Page 2 content */}
</div>
```

**Pros**:
- Perfect visual consistency
- True fixed-height pages

**Cons**:
- **BREAKS Slate's document model** - Slate requires continuous content
- Breaks text selection across pages
- Breaks Yjs collaboration (can't sync across split containers)
- Breaks cursor navigation
- **NOT VIABLE**

---

### Option 3: Fixed-Height Content Areas with Overflow (RECOMMENDED)

**Approach**: Wrap content sections in fixed-height containers, allow overflow

```tsx
// In renderLeaf, page break decoration:
if (pageBreak) {
  return (
    <span {...attributes}>
      {/* Page separator */}
      <div style={{
        display: 'block',
        width: '100vw',
        height: '2rem',
        background: '#f3f4f6',
        position: 'relative',
        left: '50%',
        marginLeft: '-50vw',
        marginRight: '-50vw',
      }} />

      {/* Fixed-height page container wrapper */}
      <div style={{
        height: '9.8in',  // 11in - 1.2in top margin
        overflow: 'hidden',  // Hide content that exceeds page height
        position: 'relative',
      }}>
        {/* Top margin spacer */}
        <div style={{ height: '1.2in' }} />
        {children}
      </div>
    </span>
  );
}
```

**Wait, this won't work either!**

The problem: Page break decorations are applied at TEXT NODES, not at the boundaries of content sections. We can't "wrap" previous content because decorations are point-in-time, not container-based.

---

### Option 4: CSS Background Grid (BEST SOLUTION)

**Approach**: Use CSS to create visual fixed-height page boxes, let content flow naturally

```css
.screenplay-container {
  /* Create repeating 11-inch page boxes */
  background-image:
    repeating-linear-gradient(
      to bottom,
      white 0px,
      white calc(11in - 2rem),
      #f3f4f6 calc(11in - 2rem),  /* Gray separator */
      #f3f4f6 11in
    );

  /* Ensure content padding aligns with background */
  padding-top: 1.2in;
}

/* Ensure each decoration-marked page break aligns with CSS grid */
.page-break-separator {
  /* Position to align with background grid */
  height: 2rem;
  margin-top: calc(9.8in - var(--current-content-height));
}
```

**Problem**: We still can't calculate `--current-content-height` from within a decoration.

---

### Option 5: Bottom Padding/Spacer (PRAGMATIC SOLUTION)

**Approach**: Add substantial bottom padding to push content to consistent page boundaries

```tsx
// In script-editor-with-collaboration.tsx, page container:
<div style={{
  padding: '1in 1in 1in 1.5in',
  paddingTop: '1.2in',
  paddingBottom: '9in',  // Large bottom padding
  fontFamily: '"Courier Prime", Courier, monospace',
  fontSize: '12pt',
  lineHeight: '12pt',
}}>
```

Then in renderLeaf page break:
```tsx
if (pageBreak) {
  return (
    <span {...attributes}>
      {/* Push remaining space to create fixed-height appearance */}
      <div style={{
        height: 'calc(9.8in - var(--accumulated-height))',  // Problem: can't calculate
        minHeight: '0',
      }} />

      {/* Page separator */}
      <div className="page-break-separator" style={{ ... }} />

      {/* Top margin for next page */}
      <div style={{ height: '1.2in' }} />

      {children}
    </span>
  );
}
```

**Problem**: Still can't calculate accumulated height within decoration.

---

## THE ACTUAL SOLUTION: CSS Column Break Properties

**Approach**: Use CSS multi-column layout with page breaks

```css
.screenplay-container {
  column-width: 8.5in;
  column-gap: 2rem;
  column-fill: auto;  /* Don't balance columns */
}

.screenplay-content {
  break-inside: auto;
  orphans: 2;
  widows: 2;
}

/* Force page breaks at decoration points */
.page-break-marker {
  break-before: column;
  height: 0;
  overflow: hidden;
}
```

**NO WAIT** - This creates horizontal columns, not vertical pages. Not what we want.

---

## THE REAL SOLUTION: Accept Slight Variation + Fix Line Height

Given the constraints of Slate's continuous document model and decoration-based rendering, **perfect pixel-identical pages are not achievable** without breaking Slate's architecture.

### Pragmatic Solution

**Phase 1: Fix Critical Issues**

1. **Fix line height consistency** (CRITICAL)
   - Remove `lineHeight: '1.5'` from element baseStyles
   - Use container's `lineHeight: '12pt'` consistently
   - This alone will dramatically improve consistency

2. **Improve line counting accuracy**
   - Account for CSS margins in BASE_LINE_HEIGHTS
   - Update text-metrics.ts to match actual rendered spacing

3. **Standardize element spacing**
   - Ensure all margins are multiples of 12pt (one line)
   - Remove fractional pixel values

**Phase 2: Visual Polish**

4. **Add bottom padding to pages**
   - Add minimum bottom space before page breaks
   - Creates more consistent "page feel"

5. **Implement smart page breaks** (Phase 3)
   - Prevents orphans, which create visual inconsistency
   - Ensures pages break at natural boundaries

### Expected Outcome

- Pages will be **~95% consistent** in visual height
- Small variations (1-2 lines) may still occur due to rendering
- This is **acceptable** for screenplay editing
- Perfect consistency only possible in print preview mode (future feature)

---

## Recommended Implementation

### Step 1: Fix Line Height (Immediate)

```typescript
// In script-editor-with-collaboration.tsx, baseStyles:
const baseStyles: React.CSSProperties = {
  fontFamily: 'Courier, monospace',
  fontSize: '12pt',
  lineHeight: '12pt',  // REMOVE the 1.5 value
  whiteSpace: 'pre-wrap',
  wordWrap: 'break-word',
};
```

### Step 2: Update Line Counting (Short-term)

```typescript
// In text-metrics.ts:
export const BASE_LINE_HEIGHTS: Record<string, number> = {
  scene_heading: 4,    // 24px top + 12px bottom + 1 line content = 4 lines
  action: 2,           // 12px bottom + 1 line content = 2 lines
  character: 2,        // 12px top + 1 line content = 2 lines
  dialogue: 2,         // 12px bottom + 1 line content = 2 lines
  parenthetical: 1,    // Minimal spacing
  transition: 3,       // 12px top + 24px bottom + 1 line = 3 lines
  shot: 2,
  general: 1,
};
```

### Step 3: Add Consistent Element Spacing (Short-term)

```typescript
// Ensure all margins are multiples of 12px:
case 'scene_heading':
  return (
    <div {...attributes} style={{
      ...baseStyles,
      marginTop: '24px',    // 2 lines
      marginBottom: '24px', // 2 lines (changed from 12px)
    }}>
```

### Step 4: Test and Validate

After these changes:
1. Test with various content types
2. Measure actual page heights
3. Adjust BASE_LINE_HEIGHTS if needed
4. Document expected variance

---

## Alternative: Print Preview Mode (Future)

For **perfect** fixed-height pages, implement a separate "Print Preview" mode:

```tsx
{printPreviewMode ? (
  // Render in fixed-height page boxes (non-editable)
  <PagedPrintPreview content={editorContent} />
) : (
  // Current continuous scroll editing
  <ScriptEditorWithCollaboration />
)}
```

This is how professional software (Final Draft, Celtx) handles it:
- **Edit mode**: Continuous scroll, slight page variance acceptable
- **Preview mode**: Fixed-height pages, pixel-perfect, read-only

---

## Conclusion

**The Problem**: Pages vary in height because we count logical lines but render with variable CSS spacing.

**The Solution**:
1. Fix line height inconsistency (immediate impact)
2. Improve line counting to match rendered spacing (better accuracy)
3. Accept slight variation as acceptable for edit mode (pragmatic)
4. Future: Add print preview mode for pixel-perfect pages

**Why we can't have perfect pages in edit mode**:
- Slate requires continuous document structure
- Decorations are point-based, not container-based
- CSS can't measure accumulated content height before rendering
- Split containers break Slate's selection, collaboration, and navigation

**Result**: ~95% visual consistency is achievable and acceptable for professional screenplay editing in real-time collaborative mode.

---

**Recommendation**: Implement Step 1 (fix line height) immediately, then assess if additional steps are needed based on user feedback.
