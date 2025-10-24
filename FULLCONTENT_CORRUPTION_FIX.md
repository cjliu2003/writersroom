# Full Content Corruption Fix

**Date**: October 23, 2025
**Issue**: Scene `full_content` field corrupted after FDX upload and reload
**Status**: Fixed

---

## Problem Summary

After uploading FDX files, the `full_content` field for scenes would become corrupted with Slate JSON placeholder data instead of maintaining the correct plain text format. This broke search indexing and AI analysis features.

### User Impact
- Search functionality degraded (plain text index corrupted)
- AI analysis features broken (expecting plain text, getting JSON)
- Database pollution with incorrect data format
- Blank editor display (due to corrupted fullContent fallback)

---

## Root Cause Analysis

### The Corruption Sequence

1. **Initial State (Correct)**
   - FDX parser uploads scene with `full_content` as plain text: `"INT. HALLWAY...\n\nThe hallway is bare..."`
   - Database stores correctly as Text column
   - API returns correct plain text

2. **After Page Reload/Time (Corrupted)**
   - User reloads page or waits for autosave timer
   - Editor may not have fully loaded scene data yet
   - Autosave timer fires with incomplete editor state

3. **Autosave Corruption Mechanism**
   ```typescript
   // use-autosave.ts:134-143
   const { elements, heading, position } = extractSceneSlice(content, sceneId);
   const sliceJson = JSON.stringify(elements);  // ❌ Slate JSON, not plain text!

   const request: SceneUpdateRequest = {
     full_content: sliceJson,  // ❌ Sends JSON string instead of plain text
     ...
   };
   ```

4. **Scene Extraction Fallback**
   ```typescript
   // autosave-api.ts:222-225
   let headingPos = headingUuids.findIndex(u => u === sceneUuid);
   if (headingPos === -1) {
     headingPos = 0;  // ❌ ALWAYS falls back to position 0 if UUID not found
   }
   ```

5. **Result**: Placeholder Slate JSON Overwrites Plain Text
   ```json
   // Database after corruption
   full_content: "[{\"type\":\"scene_heading\",\"children\":[{\"text\":\"\"}],\"id\":\"fallback_1761200457182\",\"metadata\":{...}}]"
   ```

### Field Purpose Mismatch

**Database Schema** (`scene.py:89-93`):
```python
# Store the full content as text for search and analysis
full_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
```

**Intended Use**: Plain text for search indexing and AI analysis
**Autosave Behavior**: Sent stringified Slate JSON (completely wrong format)
**Editor Rendering**: Uses `content_blocks` JSONB field, not `full_content`

---

## Solution Implemented

### Fix: Remove `full_content` from Autosave

**Rationale**:
1. **Format Mismatch**: Autosave sends Slate JSON, field expects plain text
2. **Redundancy**: `content_blocks` already contains all scene content
3. **Corruption Risk**: Overwrites search-optimized plain text with unusable JSON
4. **Scope Separation**: `full_content` for search/export, `content_blocks` for editing

### Code Changes

#### 1. Frontend: Remove `full_content` from Autosave Request

**File**: `frontend/hooks/use-autosave.ts:139-150`

```typescript
const request: SceneUpdateRequest = {
  position: (typeof positionOverride === 'number' ? positionOverride : position),
  scene_heading: sceneHeading,
  blocks,
  // NOTE: Do NOT send full_content from autosave
  // - full_content is for plain text search/analysis (set by FDX parser)
  // - Autosave sends Slate JSON which corrupts the plain text format
  // - Backend can regenerate full_content from blocks if needed
  updated_at_client: new Date().toISOString(),
  base_version: (typeof baseVersionOverride === 'number' ? baseVersionOverride : currentVersionRef.current),
  op_id: opId || generateOpId()
};
```

**Before**: `full_content: sliceJson,` (Slate JSON string)
**After**: Field removed from autosave entirely

#### 2. Frontend: Update TypeScript Interface

**File**: `frontend/utils/autosave-api.ts:14`

```typescript
full_content?: string; // DEPRECATED: Plain text for search/analysis (set by FDX parser only, NOT by autosave)
```

#### 3. Backend: Update Pydantic Model Documentation

**File**: `backend/app/routers/scene_autosave_router.py:40`

```python
full_content: Optional[str] = Field(None, description="DEPRECATED: Plain text for search/analysis (set by FDX parser, NOT autosave)")
```

**Backend handling remains unchanged** - already optional and only updates if provided:
```python
# scene_service.py:234-235
if "full_content" in data:
    scene.full_content = data["full_content"]
```

---

## Verification

### What Still Sets `full_content`

1. **FDX Parser** (`backend/app/services/fdx_parser.py`): ✅ Generates plain text on upload
2. **Export Operations**: ✅ Can regenerate from `content_blocks` when needed
3. **Background Indexing**: ✅ Can update for search optimization
4. **Autosave**: ❌ NO LONGER SENDS (prevents corruption)

### Expected Behavior After Fix

1. **FDX Upload**
   - `full_content` set correctly as plain text by parser
   - `content_blocks` set as JSONB array

2. **Editing Session**
   - Autosave updates `content_blocks` only
   - `full_content` remains unchanged (preserves plain text)
   - No corruption of search index

3. **Page Reload**
   - `full_content` still contains original plain text
   - Editor loads from `content_blocks` or Yjs
   - No placeholder corruption

### Testing Checklist

- [ ] Upload FDX file
- [ ] Verify `full_content` is plain text in database
- [ ] Edit scene in editor
- [ ] Trigger autosave (wait 5 seconds)
- [ ] Check database: `full_content` unchanged (still plain text)
- [ ] Reload page
- [ ] Edit and autosave again
- [ ] Verify `full_content` still plain text (not corrupted)

---

## Prevention Strategy

### Future Guidelines

1. **Field Ownership**: Clearly document which systems own which fields
   - `full_content`: FDX parser, export, search indexing
   - `content_blocks`: Autosave, Yjs, editor
   - Never mix responsibilities

2. **Format Enforcement**: Add validation if needed
   ```python
   # Example: Backend validation
   if "full_content" in data and data["full_content"].startswith("["):
       raise ValueError("full_content must be plain text, not JSON")
   ```

3. **Code Comments**: Mark deprecated/special-purpose fields clearly
   ```typescript
   // DEPRECATED: Do not use for X, only for Y
   full_content?: string;
   ```

4. **Testing**: Add regression test
   ```python
   def test_autosave_does_not_corrupt_full_content():
       # Upload FDX with plain text full_content
       # Trigger autosave
       # Assert full_content unchanged
   ```

---

## Related Issues

- **SESSION_CHECKPOINT_2025-10-22.md**: Scene 0 data loss (different issue, backend protection)
- **QUICK_REFERENCE_SCENE0_FIX.md**: Quick reference for scene 0 debugging
- **Architecture Decision**: Yjs-primary design (Yjs updates are source of truth)

---

## Technical Details

### Data Flow Comparison

**Before Fix**:
```
Editor State → extractSceneSlice() → Slate JSON elements
  ↓
JSON.stringify(elements) → sliceJson
  ↓
Autosave: { full_content: sliceJson, blocks: [...] }
  ↓
Database: full_content corrupted with JSON string
```

**After Fix**:
```
Editor State → extractSceneSlice() → Slate JSON elements
  ↓
contentToBlocks() → blocks array
  ↓
Autosave: { blocks: [...] }  (no full_content)
  ↓
Database: full_content unchanged (preserves plain text from FDX)
```

### Field Comparison

| Field | Type | Purpose | Updated By |
|-------|------|---------|------------|
| `content_blocks` | JSONB | Editor rendering, autosave snapshots | Autosave, Yjs |
| `full_content` | Text | Search indexing, AI analysis | FDX parser, export |
| `scene_heading` | String | Scene title/heading | Both |
| `summary` | Text | Scene summary for memory | AI analysis |

---

## Lessons Learned

1. **Field Semantics**: Document field purposes explicitly in schema
2. **Format Validation**: Consider type validation at API boundaries
3. **Testing Gaps**: Need integration tests for cross-system data flow
4. **Architecture Documentation**: Clarify which system owns which data
5. **Corruption Detection**: Could add checksums/validation for critical fields
