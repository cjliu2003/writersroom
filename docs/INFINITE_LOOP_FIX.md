# Infinite Loop Root Cause Analysis & Fix

**Date:** 2025-10-22
**Error:** "Maximum update depth exceeded"
**Status:** ✅ RESOLVED

## Root Cause

The infinite loop was caused by a **circular dependency in useEffect hooks** between the Yjs seeding logic and content updates.

### The Problematic Code

**File:** `frontend/components/screenplay-editor.tsx`
**Line:** 276 (before fix)

```typescript
// Yjs seeding useEffect had 'content' in dependency array
}, [editor, collaboration?.doc, collaboration?.provider, collaboration?.sceneId, content])
//                                                                                  ^^^^^^^
//                                                                          THIS CAUSED THE LOOP
```

## The Infinite Loop Chain

1. **Mount:** Script loads → Yjs seeding useEffect runs
2. **Seed:** `toSharedType()` populates Yjs doc → slate-yjs detects change
3. **Slate onChange:** Fires automatically → `handleChange` called
4. **State Updates:** Editor updates value → wrapper updates scene/script content → parent updates script state
5. **Re-render:** New content prop flows down to components
6. **Yjs Seed Again:** useEffect re-runs because `content` changed → **BACK TO STEP 2**

**Result:** 50+ nested state updates = "Maximum update depth exceeded"

## Why Previous Fixes Didn't Work

### 1. Memoized Callbacks ❌
- **Attempted:** `useCallback` wrappers in use-autosave.ts and page.tsx
- **Why it failed:** Loop was in useEffect dependencies, not callback identity

### 2. Circuit Breaker ❌
- **Attempted:** `isHandlingChange` flag with Promise.resolve() reset
- **Why it failed:** Race condition - microtask executed before React re-render, flag reset too early

### 3. Content Refs ❌
- **Attempted:** Using refs to compare content
- **Why it failed:** useEffects still re-ran based on dependency arrays

## The Solution

### Primary Fix ✅

**File:** `frontend/components/screenplay-editor.tsx`
**Line:** 276

**Change:**
```typescript
// BEFORE (caused loop):
}, [editor, collaboration?.doc, collaboration?.provider, collaboration?.sceneId, content])

// AFTER (breaks loop):
}, [editor, collaboration?.doc, collaboration?.provider, collaboration?.sceneId])
```

**Rationale:**
- The effect uses `seedContentRef.current`, not `content` directly
- `seedContentRef` is kept in sync by a separate useEffect (lines 174-184)
- Seeding should only happen on collaboration setup changes, NOT on every content edit

### Secondary Cleanup ✅

**File:** `frontend/components/screenplay-editor.tsx`
**Lines:** 355-380 (removed)

**Change:** Removed duplicate useEffect that was identical to lines 289-334

## Verification

After applying the fix:
1. ✅ Script loads successfully without errors
2. ✅ Yjs seeding happens once on mount
3. ✅ Content changes don't trigger re-seeding
4. ✅ Slate onChange events don't create circular dependencies
5. ✅ No "Maximum update depth exceeded" error

## Technical Details

### Why `content` Was Unnecessary

The Yjs seeding effect accessed content via `seedContentRef.current`:

```typescript
const nodesToSeed = seedContentRef.current  // Line 234
```

This ref is kept synchronized by a separate useEffect:

```typescript
useEffect(() => {
  if (!content) return
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      seedContentRef.current = parsed as Descendant[]
    }
  } catch { }
}, [content])  // Lines 174-184
```

Therefore, the seeding effect didn't need `content` in its dependencies.

### When Seeding Should Occur

✅ **Should trigger seeding:**
- Component mount (editor created)
- Collaboration enabled/disabled (doc changes)
- Scene switches (sceneId changes)
- Provider connects (provider changes)

❌ **Should NOT trigger seeding:**
- Every keystroke
- Every content change from Slate onChange
- Every parent state update

## Lessons Learned

1. **useEffect Dependencies Matter:** Unnecessary dependencies can create infinite loops
2. **Circuit Breakers Need Correct Timing:** Promise microtasks execute before React re-renders
3. **Ref vs State:** Refs updated by separate effects don't need to be in every effect's dependencies
4. **Yjs Integration:** During collaboration, Yjs doc is the source of truth - avoid clearing/reseeding unnecessarily

## Files Modified

1. `frontend/components/screenplay-editor.tsx`
   - Line 276: Removed `content` from Yjs seeding useEffect dependencies
   - Lines 355-380: Removed duplicate useEffect

## Related Issues

- Circuit breaker timing in `screenplay-editor-with-autosave.tsx` (lines 172-177) still uses Promise.resolve() pattern, but is no longer needed with the primary fix
- Wrapper's content sync effect (line 257) clears/reseeds Yjs doc, but this is now safe because the editor won't re-run seeding on content changes
