# Smart Page Breaks - Current Implementation Logic

**Status**: Experiencing issues with (MORE) appearing on page N+1 instead of page N
**Date**: Current implementation analysis
**Problem**: Despite validation logic, safeBreakPos still exceeds rawBreakPos

---

## Overall Architecture

### Entry Point: `computeDecorations()`
Called on:
- Document changes
- Window resize
- Mutations in pagination container
- Debounced with `requestAnimationFrame`

### Main Rule: `applyDialogueContinuationRule()`
Applies dialogue continuation markers (MORE/CONT'D) for dialogue blocks that span pages.

---

## Step-by-Step Execution Flow

### 1. **Block Collection & Analysis**

```typescript
for (let i = 0; i < blocks.length; i++) {
  const block = blocks[i];

  // Only process dialogue blocks
  if (block.type !== 'dialogue') continue;

  // Adjust position by accumulated height from earlier decorations
  const adjustedTop = block.rect.top + accumulatedHeight;
  const adjustedBottom = block.rect.bottom + accumulatedHeight;

  // Recompute page assignment
  const adjustedStartPage = floorPageIndex(bands, adjustedTop);
  const adjustedEndPage = floorPageIndex(bands, adjustedBottom);

  // Skip if doesn't span pages
  if (adjustedStartPage === adjustedEndPage) continue;
```

**Key Details:**
- `accumulatedHeight` tracks vertical space added by earlier decorations
- Blocks are processed in document order
- Each block's position is adjusted by accumulated height
- Only dialogue blocks that span pages are processed

---

### 2. **Character Block Discovery**

```typescript
// Search backwards for the most recent character (max 3 blocks back)
for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
  if (blocks[j].type === 'character') {
    characterBlock = blocks[j];
    characterName = charNode.textContent.trim();
    break;
  }
}

if (!characterBlock || !characterName) {
  console.warn('[SmartBreaks] No character found before dialogue');
  continue;
}
```

**Key Details:**
- Looks up to 3 blocks back for CHARACTER node
- Extracts character name from node content
- Skips dialogue if no character found

---

### 3. **Find Raw Page Break Position**

**Function**: `findPageBreakPosition(block, bands, view)`

```typescript
// Binary search for the position where content crosses page boundary
let left = block.pos + 1;  // Start after block opening
let right = block.end - 1; // End before block closing

while (left < right) {
  const mid = Math.floor((left + right) / 2);
  const coords = view.coordsAtPos(mid);

  if (coords.top < pageNBottom) {
    // Still on page N, search forward
    left = mid + 1;
  } else {
    // On page N+1 or beyond, search backward
    right = mid;
  }
}

return left; // First position on page N+1
```

**Returns**: The **FIRST position on page N+1** (character-level precision)

**Example**:
- Dialogue starts at 1251
- Binary search finds position 1252 is on page N+1
- Returns 1252

---

### 4. **Find Safe Sentence/Word Boundary**

**Function**: `findSafeSentenceBoundary(doc, rawBreakPos, dialogueStart, pageNBottom, view, moreWidgetHeight)`

#### 4a. Get Text Span

```typescript
const text = doc.textBetween(dialogueStart, rawBreakPos, '');
```

**ProseMirror textBetween(from, to)**:
- `from` inclusive, `to` exclusive
- Returns text from `dialogueStart` to just before `rawBreakPos`

**Example**:
- dialogueStart = 1252 (dialogue.pos + 1)
- rawBreakPos = 1252
- textBetween(1252, 1252) = "" (EMPTY STRING)

#### 4b. Early Return Check

```typescript
if (!text || text.length === 0) {
  const fallback = Math.max(dialogueStart, rawBreakPos - 1);
  console.warn('[SmartBreaks] Empty text, using position', fallback);
  return fallback;
}
```

**Current Behavior**:
- If text is empty: returns `Math.max(1252, 1251) = 1252`
- **BUG**: Returns 1252 which equals rawBreakPos (not < rawBreakPos)

#### 4c. Vertical Space Check Helper

```typescript
const hasRoomForMore = (pos: number): boolean => {
  // CRITICAL: Position must be < rawBreakPos to be on page N
  if (pos >= rawBreakPos) {
    return false; // Reject positions on page N+1
  }

  try {
    const coords = view.coordsAtPos(pos);
    return coords.bottom + moreWidgetHeight + safetyBuffer < pageNBottom;
  } catch (e) {
    return false;
  }
}
```

**Two Checks**:
1. Position must be < rawBreakPos
2. Position must have vertical room for (MORE) widget

#### 4d. Phase 1: Sentence Boundaries

```typescript
for (let i = text.length - 1; i >= 0; i--) {
  const char = text[i];
  const nextChar = i + 1 < text.length ? text[i + 1] : '';

  if (/[.?!]/.test(char) && /\s/.test(nextChar)) {
    const boundaryPos = dialogueStart + i + 2; // After punctuation and space

    if (hasRoomForMore(boundaryPos)) {
      console.log('[SmartBreaks] Found sentence boundary at', boundaryPos);
      return boundaryPos;
    }
  }
}
```

**Searches For**: `. `, `? `, `! ` (punctuation + space)
**Returns**: Position after the space (start of next sentence)
**Validates**: Both `< rawBreakPos` AND has vertical room

#### 4e. Phase 2: Word Boundaries

```typescript
for (let i = text.length - 1; i >= 0; i--) {
  if (/\s/.test(text[i])) {
    const boundaryPos = dialogueStart + i + 1; // After whitespace

    if (hasRoomForMore(boundaryPos)) {
      console.log('[SmartBreaks] No sentence boundary, using word boundary');
      return boundaryPos;
    }
  }
}
```

**Searches For**: Any whitespace
**Returns**: Position after the whitespace (start of next word)

#### 4f. Ultimate Fallback

```typescript
const fallback = Math.max(dialogueStart, rawBreakPos - 1);
console.warn('[SmartBreaks] No safe boundary found, using fallback at', fallback);
return fallback;
```

**Returns**: Greater of dialogueStart or (rawBreakPos - 1)

---

### 5. **Create Decorations**

```typescript
const safeBreakPos = findSafeSentenceBoundary(...);

// Place (MORE) at safe position with side: -1
decorations.push(createMoreMarker(safeBreakPos, '(MORE)'));

// Place CHARACTER (CONT'D) at same position with side: 1
decorations.push(createCharacterContinuation(safeBreakPos, characterName, '(CONT\'D)'));
```

#### Widget Side Parameter

**ProseMirror Widget Rendering**:
- `side: -1` → Render **BEFORE** content at position
- `side: 1` → Render **AFTER** content at position

#### Widget Structure

**createMoreMarker()**:
```typescript
<div style="text-align: center; margin-top: 4px; margin-bottom: 4px;">
  (MORE)
</div>
// side: -1
```

**createCharacterContinuation()**:
```typescript
<div style="text-align: center; text-transform: uppercase; margin-top: 12px; margin-bottom: 4px;">
  CHARACTER (CONT'D)
</div>
// side: 1
```

**Both are block-level divs** (default display: block)

---

## Console Log Evidence

### Example 1: Empty Text Case

```
[SmartBreaks] Added decorations for dialogue at pos 1251:
  Raw break at 1252, safe sentence/word boundary at 1253
  (MORE) at pos 1253 side:-1 (page N), CHARACTER (CONT'D) at pos 1253 side:1 (page N+1)
```

**Analysis**:
- Dialogue starts at 1251
- Raw break at 1252 (first char of dialogue on page N+1)
- textBetween(1252, 1252) = ""
- Early return: Math.max(1252, 1251) = **1252**
- But console shows **1253**!

**DISCREPANCY**: Console shows 1253, but our analysis says it should be 1252.

### Example 2: Successful Sentence Boundary

```
[SmartBreaks] Found sentence boundary at 16183 for raw break 16225
  Raw break at 16225, safe sentence/word boundary at 16183
  (MORE) at pos 16183 side:-1 (page N), CHARACTER (CONT'D) at pos 16183 side:1 (page N+1)
```

**Analysis**:
- Raw break at 16225
- Safe boundary at 16183 (< 16225) ✓
- Found a sentence ending with room on page N
- This case works correctly

---

## Critical Issues Identified

### Issue 1: Empty Text Returns Invalid Position

**Problem Code**:
```typescript
if (!text || text.length === 0) {
  const fallback = Math.max(dialogueStart, rawBreakPos - 1);
  return fallback;
}
```

**When This Happens**:
- Dialogue starts at or very near the raw break position
- textBetween(dialogueStart, rawBreakPos) returns empty string
- Example: dialogueStart = 1252, rawBreakPos = 1252

**What It Returns**:
- Math.max(1252, 1251) = 1252
- **But 1252 === rawBreakPos, not < rawBreakPos**

**Why Validation Doesn't Catch It**:
- This is a direct return, not validated by hasRoomForMore()
- The `pos >= rawBreakPos` check in hasRoomForMore() never runs

### Issue 2: Console Discrepancy

Console shows position **1253** but code should return **1252**. Possibilities:

1. **Code not matching deployed version**: Recent changes not reflected
2. **Position offset**: dialogueStart calculation is off by 1
3. **Multiple passes**: Decorations shift positions on subsequent passes
4. **textBetween behavior**: May include endpoint in some cases

### Issue 3: Widget Rendering Behavior

**Current Assumption**:
- (MORE) at pos X with side: -1 renders on page N
- CHARACTER (CONT'D) at pos X with side: 1 renders on page N+1
- The (MORE) widget pushes CHARACTER (CONT'D) to next page

**Possible Reality**:
- Both widgets at same position might render on same page
- Block-level widgets may not create page breaks
- Side parameter might not work as expected for block elements

---

## Cascade Prediction System

```typescript
let accumulatedHeight = 0;

for each block:
  adjustedTop = block.rect.top + accumulatedHeight;
  adjustedBottom = block.rect.bottom + accumulatedHeight;

  // Check if adjusted position causes span
  adjustedStartPage = floorPageIndex(bands, adjustedTop);
  adjustedEndPage = floorPageIndex(bands, adjustedBottom);

  if (adjustedStartPage !== adjustedEndPage):
    // Add decorations
    accumulatedHeight += totalDecorationHeight;
```

**Purpose**: Account for vertical space added by earlier decorations
**Total Decoration Height**: `charContdHeight + moreHeight = 56px` (at lineHeight 16px)

---

## Key Assumptions Being Made

1. **textBetween(from, to)** is exclusive of `to` position
2. **Widget side: -1** places widget before position content
3. **Widget side: 1** places widget after position content
4. **Block-level widgets** force line breaks
5. **Page boundaries** are determined by `coordsAtPos().top`
6. **rawBreakPos** is always the first position on page N+1
7. **safeBreakPos < rawBreakPos** guarantees page N placement

---

## Questions to Investigate

### Q1: Why does console show 1253 instead of 1252?
- Is dialogueStart actually 1253?
- Is there an off-by-one error in block.pos + 1?
- Are decorations from previous passes affecting positions?

### Q2: How does ProseMirror render widgets at same position?
- Do both widgets stack vertically at position X?
- Does side parameter affect page assignment?
- Do block-level widgets create actual page breaks?

### Q3: Is coordsAtPos() reliable for page boundaries?
- Does it account for widget heights?
- Can positions shift after widget insertion?
- Are coordinates stable across decoration updates?

### Q4: What is the actual document structure?
- What's at position 1251, 1252, 1253?
- Is dialogue node boundary different from text boundary?
- Are there empty text nodes or formatting nodes?

---

## Recommended Next Steps (NO FIXES, JUST INVESTIGATION)

1. **Add More Detailed Logging**:
   ```typescript
   console.log('dialogueStart:', dialogueStart);
   console.log('rawBreakPos:', rawBreakPos);
   console.log('text:', JSON.stringify(text));
   console.log('text.length:', text.length);
   console.log('block.pos:', block.pos);
   console.log('block.pos + 1:', block.pos + 1);
   ```

2. **Log Widget Coordinates**:
   ```typescript
   setTimeout(() => {
     const moreWidget = document.querySelector('.smart-break-more-marker');
     const contdWidget = document.querySelector('.smart-break-character-continuation');
     console.log('(MORE) widget rect:', moreWidget?.getBoundingClientRect());
     console.log('(CONT\'D) widget rect:', contdWidget?.getBoundingClientRect());
   }, 100);
   ```

3. **Verify Position Coordinates**:
   ```typescript
   const rawCoords = view.coordsAtPos(rawBreakPos);
   const safeCoords = view.coordsAtPos(safeBreakPos);
   console.log('rawBreakPos coords:', rawCoords);
   console.log('safeBreakPos coords:', safeCoords);
   console.log('pageNBottom:', pageNBottom);
   ```

4. **Check Document Text**:
   ```typescript
   const textAround = doc.textBetween(
     Math.max(0, dialogueStart - 10),
     Math.min(doc.content.size, rawBreakPos + 10),
     ''
   );
   console.log('Text around break:', JSON.stringify(textAround));
   ```

---

## Summary

The current implementation attempts to:
1. Find where dialogue naturally breaks to page N+1 (binary search)
2. Adjust that position to a sentence/word boundary (text analysis)
3. Verify the adjusted position has vertical room (coordinate check)
4. Place both widgets at that position with different sides

The problem is that the early return case and fallback case don't properly ensure `safeBreakPos < rawBreakPos`, and there may be fundamental issues with how ProseMirror renders block-level widgets at the same position with different side values.
