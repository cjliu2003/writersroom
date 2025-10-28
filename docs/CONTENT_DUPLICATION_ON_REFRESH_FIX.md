# Content Duplication on Refresh - Fix After FDX Script.content_blocks Population

## Issue Summary

**Problem**: After populating `Script.content_blocks` during FDX import, page refreshes cause script content to be duplicated (appended to itself).

**Symptom**: Opening a script shows content twice - original content followed by the same content again.

**When It Occurs**: After FDX import when Script.content_blocks is populated, then making edits, then refreshing the page.

**Date Identified**: 2025-10-27 (after FDX_SCRIPT_CONTENT_BLOCKS_FIX)

## Root Cause Analysis

### The Change That Triggered This

In the FDX import fix (`fdx_router.py` lines 63-81), we started populating `Script.content_blocks`:

```python
# Convert all parsed elements to content_blocks format
script_content_blocks = [
    {
        "type": element.type.value,
        "text": element.text,
        "metadata": element.metadata
    }
    for element in parsed_result.elements
]

# Create new script with content_blocks populated
new_script = Script(
    title=parsed_result.title,
    description=f"Imported from {file.filename}",
    owner_id=current_user.user_id,
    content_blocks=script_content_blocks  # ✅ Now populated!
)
```

### The Duplication Scenario

**Before the FDX fix**:
- Script.content_blocks was NULL
- Backend WebSocket seeding was disabled (line 231-233 in script_websocket.py)
- Frontend seeded from REST API
- Everything worked

**After the FDX fix**:
1. **First Load**:
   - Script.content_blocks is populated with full content
   - Frontend GET /content returns content from Script.content_blocks
   - Frontend seeds Yjs doc with content
   - WebSocket connects, backend has NO persisted Yjs updates yet
   - Content displays correctly ✅

2. **User Makes Edits**:
   - Yjs updates are saved to `script_versions` table
   - Script now has BOTH Script.content_blocks AND Yjs persistence

3. **Page Refresh** (**DUPLICATION OCCURS**):
   - Frontend GET /content returns content from Script.content_blocks (same as before)
   - Frontend prepares to seed with this content
   - WebSocket connects, backend loads persisted Yjs updates
   - Backend has `applied_count > 0` (found persisted updates)
   - Backend's `yjs_content_length` check (line 199) shows content exists
   - Backend does NOT trigger rebuild (correct behavior)
   - **BUT**: Frontend's `seedDocIfNeeded()` might have a race condition
   - If frontend seeds AFTER backend sends Yjs updates, content gets APPENDED
   - Result: Original content (from frontend seed) + Persisted edits = DUPLICATION

### The Actual Problem: toSharedType Behavior

The issue is that `toSharedType()` from `slate-yjs` **APPENDS** content to a Yjs array rather than REPLACING it.

From `script-editor-with-collaboration.tsx` line 336:
```typescript
console.log('[ScriptEditor] Calling toSharedType with', nodesToSeed.length, 'nodes');
toSharedType(sharedRoot as any, nodesToSeed as any);
```

**If sharedRoot already has content** (from WebSocket sync), `toSharedType` will APPEND the nodes instead of replacing.

### Why The Safeguards Failed

The frontend has multiple safeguards in `seedDocIfNeeded()`:

1. **Line 264**: `if (editorHasContent)` - Checks if Slate editor has content
2. **Line 276**: `if (hasReceivedRemoteContent)` - Checks if remote updates received
3. **Line 289**: `if (hasContent)` - Checks if Yjs doc has content
4. **Line 326-333**: Triple-check inside transaction

**The race condition**:
- Frontend `seedDocIfNeeded()` checks run BEFORE WebSocket sync completes
- All checks pass (sharedRoot is empty at check time)
- Transaction begins
- WebSocket sync arrives and populates sharedRoot
- Transaction's triple-check at line 326 SHOULD catch this
- But there might be a timing window where it doesn't

## The Solution

### Option 1: Clear sharedRoot Before Seeding (RECOMMENDED)

Add explicit clearing logic before calling `toSharedType()`, matching the backend pattern:

```typescript
// In seedDocIfNeeded(), before calling toSharedType()
doc.transact(() => {
  // CRITICAL: Triple-check nothing has changed during this execution
  if (sharedRoot.length > 0) {
    console.log('[ScriptEditor] Aborting seed - content arrived during transaction, sharedRoot:', sharedRoot.length);
    return;
  }
  if (editor.children.length > 0) {
    console.log('[ScriptEditor] Aborting seed - editor has content:', editor.children.length);
    return;
  }

  // NEW: Explicitly clear sharedRoot before seeding
  // This prevents toSharedType from appending to existing content
  while (sharedRoot.length > 0) {
    sharedRoot.delete(0);
  }
  console.log('[ScriptEditor] Cleared sharedRoot before seeding');

  console.log('[ScriptEditor] Calling toSharedType with', nodesToSeed.length, 'nodes');
  toSharedType(sharedRoot as any, nodesToSeed as any);
  // ... rest of seeding logic
});
```

**Rationale**:
- toSharedType() behavior is append-based
- Explicit clear ensures fresh start
- Matches backend pattern (BACKEND_DATA_CORRUPTION_DIAGNOSIS.md line 190)
- Defense-in-depth: even if checks fail, clear prevents append

### Option 2: Stronger Yjs Content Check

Improve the check at line 326 to abort more aggressively:

```typescript
doc.transact(() => {
  // CRITICAL: Abort if ANY content exists
  const currentLength = sharedRoot.length;
  const editorLength = editor.children.length;

  if (currentLength > 0 || editorLength > 0) {
    console.log(`[ScriptEditor] Aborting seed - content exists: sharedRoot=${currentLength}, editor=${editorLength}`);
    // Mark as seeded to prevent retry
    if (!meta.get('seeded')) {
      meta.set('seeded', true);
      meta.set('seeded_at', new Date().toISOString());
      meta.set('script_id', scriptId);
    }
    return;
  }

  // Proceed with seeding...
});
```

### Option 3: Disable Frontend Seeding Entirely

Since Script.content_blocks is now populated, enable backend seeding and disable frontend seeding:

**Backend** (`script_websocket.py` lines 230-235):
```python
# Populate Yjs document with content_blocks
if content_blocks:
    # RE-ENABLE backend seeding now that Script.content_blocks is populated
    with ydoc.begin_transaction() as txn:
        # Clear existing content
        while len(shared_root) > 0:
            shared_root.pop(0)

        # Populate with content_blocks
        for block in content_blocks:
            shared_root.append(block)

        # Set metadata
        wr_meta.set('seeded', True)
        wr_meta.set('seeded_from', 'backend')
        wr_meta.set('script_id', str(script_id))

    logger.info(f"Seeded Yjs doc with {len(content_blocks)} blocks from backend")
```

**Frontend** (`script-editor-with-collaboration.tsx`):
```typescript
// In seedDocIfNeeded(), check if backend already seeded
const seededFrom = meta.get('seeded_from');
if (seededFrom === 'backend') {
  console.log('[ScriptEditor] Skipping seed - backend already seeded');
  syncEditorFromYjs();
  return;
}
```

**Issues with Option 3**:
- Comment at line 231 says "Backend seeding causes format issues"
- Requires testing to verify format compatibility
- More invasive change

## Recommended Implementation

**Implement Option 1** (Clear Before Seed) with **Option 2** (Stronger Check) as defense-in-depth:

### File: `frontend/components/script-editor-with-collaboration.tsx`

**Location**: Lines 324-340 (inside `seedDocIfNeeded` function's transaction)

**Change**:
```typescript
doc.transact(() => {
  // CRITICAL: Check if content exists and abort if so
  const currentYjsLength = sharedRoot.length;
  const currentEditorLength = editor.children.length;

  if (currentYjsLength > 0 || currentEditorLength > 0) {
    console.log(`[ScriptEditor] Aborting seed - content exists: Yjs=${currentYjsLength}, Editor=${currentEditorLength}`);
    // Mark as seeded to prevent retry loops
    if (!meta.get('seeded')) {
      meta.set('seeded', true);
      meta.set('seeded_at', new Date().toISOString());
      meta.set('script_id', scriptId);
    }
    return;
  }

  // CRITICAL: Clear sharedRoot before seeding to prevent toSharedType from appending
  // toSharedType() appends content rather than replacing, so we must clear first
  while (sharedRoot.length > 0) {
    sharedRoot.delete(0);
  }
  console.log('[ScriptEditor] Cleared sharedRoot before seeding');

  console.log('[ScriptEditor] Calling toSharedType with', nodesToSeed.length, 'nodes');
  toSharedType(sharedRoot as any, nodesToSeed as any);
  meta.set('seeded', true);
  meta.set('seeded_at', new Date().toISOString());
  meta.set('script_id', scriptId);

  seededSuccessfully = true;
  console.log('[ScriptEditor] Seeded Y.Doc with initial content');
}, editor);
```

## Testing Plan

### Step 1: Test Fresh FDX Import

1. Upload new FDX file
2. Verify Script.content_blocks is populated in database
3. Open script editor
4. **Expected**: Content displays correctly once

### Step 2: Test Refresh Without Edits

1. After opening script from Step 1
2. Refresh page (F5 or Cmd+R)
3. **Expected**: Content displays correctly once (no duplication)

### Step 3: Test Refresh With Edits

1. Open script
2. Make a small edit (add text)
3. Wait for autosave (watch for save indicator)
4. Refresh page
5. **Expected**: Content displays once with edit preserved (no duplication)

### Step 4: Test Multiple Refresh Cycles

1. Open script
2. Refresh 5 times in a row
3. **Expected**: Each refresh shows content once (no progressive duplication)

### Step 5: Check Backend Logs

After each test, check backend logs for:
```
Loaded X persisted update(s) for script ...
After loading X updates, Yjs content length: Y
```

**Expected**: Y should equal the number of blocks, not double or triple.

### Step 6: Check Frontend Console

After each test, check frontend console for:
```
[ScriptEditor] Aborting seed - content exists: Yjs=X, Editor=Y
[ScriptEditor] Cleared sharedRoot before seeding
[ScriptEditor] Calling toSharedType with Z nodes
```

**Expected**: Should see "Aborting seed" on refreshes after first load.

## Prevention Measures

1. **Always Clear Before toSharedType**: Treat toSharedType as append-only operation
2. **Strong Content Checks**: Check both Yjs and Slate state before seeding
3. **Explicit Seeding Flags**: Use meta.seeded_from to track seeding source
4. **Logging**: Log all seeding attempts and aborts for debugging

## Related Issues

This is related to previous fixes:
1. **SCRIPT_EDITOR_SEEDING_ANALYSIS.md**: Provider sync event handling
2. **BACKEND_DATA_CORRUPTION_DIAGNOSIS.md**: Backend clearing pattern (line 190)
3. **SCRIPT_EDITOR_FIX_SUMMARY.md**: Multiple seeding safeguards

The duplication issue emerged because:
- We fixed Script.content_blocks population (FDX_SCRIPT_CONTENT_BLOCKS_FIX)
- Now both Script.content_blocks AND Yjs persistence have content
- toSharedType's append behavior caused duplication
- Safeguards had race condition window

## Files to Modify

1. **`frontend/components/script-editor-with-collaboration.tsx`** (lines 324-340)
   - Add sharedRoot clearing before toSharedType
   - Strengthen content existence checks

## Conclusion

The duplication occurs because `toSharedType()` appends rather than replaces, and after our FDX fix, both Script.content_blocks and Yjs persistence contain content. The solution is to explicitly clear sharedRoot before seeding and strengthen the abort conditions to catch any race conditions.

This is a defensive fix that prevents toSharedType from appending to existing content regardless of timing.
