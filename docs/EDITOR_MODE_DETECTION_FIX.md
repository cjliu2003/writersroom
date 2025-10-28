# Editor Mode Detection Fix - AI Summary Persistence

## Issue Summary

**Problem**: AI summaries were being saved to the wrong location (Scene.summary instead of Script.scene_summaries) because the endpoint was using incorrect logic to detect editor mode.

**Date Fixed**: 2025-10-27
**Files Modified**: `backend/app/routers/ai_router.py`

## Root Cause Analysis

### The Original (Broken) Logic

The endpoint was checking if Scene records existed to determine editor mode:

```python
# ❌ WRONG: Checking if Scene record exists
scene = await db.execute(select(Scene).where(...))
if scene:
    # Assumed scene-level editor
    scene.summary = summary
else:
    # Assumed script-level editor
    script.scene_summaries[slugline] = summary
```

### Why This Failed

Scripts imported from FDX files have **BOTH**:
1. **Scene records** (created during import)
2. **Script.content_blocks** (when user edits in script-level mode)

A user editing an FDX-imported script in script-level mode would:
- Open script-level editor
- Generate AI summary
- Endpoint finds Scene records exist
- **Incorrectly** saves to Scene.summary (scene-level location)
- Frontend looks in Script.scene_summaries (script-level location)
- Summary appears to disappear!

## The Correct Detection Logic

The correct way to determine editor mode mirrors the `GET /scripts/{id}/content` endpoint logic (lines 148-185 in `backend/app/routers/script_router.py`):

```python
if script.content_blocks is not None:
    content_source = "script"  # Script-level editing
elif script.scenes:
    content_source = "scenes"  # Scene-level (rebuilt from scenes)
else:
    content_source = "empty"   # New/empty script
```

**Key Insight**: Check `script.content_blocks` existence, NOT Scene record existence.

## The Fix

### Detection Logic (Lines 60-63)

```python
# Determine editor mode based on content_blocks (same logic as GET /content)
# If script.content_blocks exists → script-level editor
# If script.content_blocks is null → scene-level editor
if script.content_blocks is not None:
    # Script-level editor path
else:
    # Scene-level editor path
```

### Script-Level Path (Lines 63-79)

```python
if script.content_blocks is not None:
    # Script-level editor: save to script.scene_summaries
    if script.scene_summaries is None:
        script.scene_summaries = {}

    script.scene_summaries[request.slugline] = summary

    # Mark JSONB column as modified (required for persistence)
    attributes.flag_modified(script, 'scene_summaries')

    script.updated_at = datetime.now(timezone.utc)
```

### Scene-Level Path (Lines 80-100)

```python
else:
    # Scene-level editor: save to scene.summary
    scene_query = select(Scene).where(
        Scene.script_id == request.script_id,
        Scene.position == request.scene_index
    )
    result = await db.execute(scene_query)
    scene = result.scalar_one_or_none()

    if not scene:
        raise HTTPException(
            status_code=404,
            detail=f"Scene at index {request.scene_index} not found"
        )

    scene.summary = summary
    scene.updated_at = datetime.now(timezone.utc)
```

## Understanding the Architecture

### Script-Level Editor

**When**: User opens `/script-editor/[id]` page
**Storage**:
- Content: `Script.content_blocks` (JSONB array)
- Summaries: `Script.scene_summaries` (JSONB object)

**Characteristics**:
- Full document Yjs collaboration
- Autosave to Script.content_blocks
- Scene boundaries tracked in-memory
- No Scene records created

**Detection**: `script.content_blocks is not None`

### Scene-Level Editor

**When**: User opens scene-by-scene editing interface (if exists)
**Storage**:
- Content: Individual `Scene.content_blocks` records
- Summaries: Individual `Scene.summary` fields

**Characteristics**:
- Per-scene editing
- Scene records in database
- Script.content_blocks is NULL

**Detection**: `script.content_blocks is None`

### Hybrid State (FDX Import)

Scripts imported from FDX files may have:
- ✅ Scene records (from import)
- ✅ Script.content_blocks (if edited in script-level mode)

**In this case**:
- Editor mode: Script-level (content_blocks exists)
- Summaries go to: Script.scene_summaries
- Scene records: Present but not actively used for editing

## Debug Output

After the fix, you should see logs like:

```
🔍 [AI Summary Debug] Generated summary for 'INT. COFFEE SHOP - DAY'
   Summary length: 142 chars
   Script ID: c4f92fc4-d2bf-497c-84d0-850c44689921
   Script has content_blocks: True
   Path: Script-level editor (content_blocks exists)
   Before: scene_summaries = None
   Initialized empty dict
   After mutation: scene_summaries has 1 entries
   Called flag_modified on scene_summaries
   Committing to database...
   ✅ Commit successful!
```

Key indicators:
- `Script has content_blocks: True` → script-level
- `Path: Script-level editor` → correct path taken
- `Called flag_modified` → JSONB mutation tracking enabled

## Testing

### Test Script-Level Editor

1. Open script-level editor: `/script-editor/[id]`
2. Generate AI summary
3. Check logs - should show "Script-level editor (content_blocks exists)"
4. Check database:
   ```sql
   SELECT scene_summaries FROM scripts WHERE script_id = '...';
   ```
5. Reload page - summary should persist

### Test Scene-Level Editor (if applicable)

1. Open scene-level editor
2. Generate AI summary
3. Check logs - should show "Scene-level editor (content_blocks is null)"
4. Check database:
   ```sql
   SELECT summary FROM scenes WHERE script_id = '...' AND position = 0;
   ```
5. Summary should persist in Scene record

## Related Code

### Content Source Detection (script_router.py:143-203)

The GET /content endpoint uses identical logic:

```python
content_blocks = script.content_blocks
content_source = "script"

if content_blocks is None:
    # Rebuild from scenes
    scenes = script.scenes
    if scenes:
        content_blocks = []
        for scene in scenes:
            if scene.content_blocks:
                content_blocks.extend(scene.content_blocks)
        content_source = "scenes"
    else:
        content_blocks = []
        content_source = "empty"
```

### Frontend Content Source (api.ts:106)

Frontend TypeScript interface:

```typescript
content_source: 'script' | 'scenes' | 'empty';
```

This matches the backend logic exactly.

## Lessons Learned

1. **Don't Assume Record Existence = Current Mode**: Just because Scene records exist doesn't mean the user is in scene-level editing mode

2. **Follow Existing Patterns**: The GET /content endpoint already had the correct logic - we should have mirrored it from the start

3. **Understand Data Evolution**: Content can evolve (FDX import → script-level editing), creating hybrid states

4. **Check the Right Field**: `script.content_blocks` existence is the source of truth for editor mode, not Scene record existence

## Impact

**Before Fix**:
- FDX-imported scripts: summaries saved to Scene.summary (wrong location)
- Script-level editor: looked in Script.scene_summaries (correct location)
- Result: summaries appeared but didn't persist

**After Fix**:
- Script-level editor: saves to Script.scene_summaries (correct location)
- Scene-level editor: saves to Scene.summary (correct location)
- Result: summaries persist correctly based on actual editor mode
