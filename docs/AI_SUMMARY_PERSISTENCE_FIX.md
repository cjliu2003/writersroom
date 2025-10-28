# AI Summary Persistence Fix - Missing scene_summaries in API Response

## Issue Summary

**Problem**: AI-generated scene summaries persist to database but don't display after page refresh.

**Symptom**:
- User generates AI summary → displays correctly immediately
- User refreshes page → summary disappears
- Database check shows summary IS stored in `scripts.scene_summaries` ✅
- Frontend displays old summary from `scenes.summary` instead ❌

**Date Fixed**: 2025-10-27
**Related To**: FDX_SCRIPT_CONTENT_BLOCKS_FIX, EDITOR_MODE_DETECTION_FIX, JSONB_MUTATION_TRACKING_FIX

## Root Cause Analysis

### The Data Flow

**When AI Summary is Generated**:
1. User clicks "Generate AI Summary" in sidebar
2. Frontend calls `POST /api/ai/scene-summary`
3. Backend determines editor mode (script-level vs scene-level)
4. Backend saves to `scripts.scene_summaries[slugline] = summary` ✅
5. Backend calls `flag_modified()` to mark JSONB changed ✅
6. Backend commits to database ✅
7. API returns `{success: true, summary: "..."}` ✅
8. Frontend updates local state: `aiSummaries.set(index, summary)` ✅
9. **Summary displays correctly immediately** ✅

**On Page Refresh** (THE PROBLEM):
1. Frontend calls `GET /api/scripts/{id}/content`
2. Backend returns ScriptWithContent response
3. **MISSING**: `scene_summaries` field not included in response ❌
4. Frontend's useEffect tries to load from `script.scene_summaries`
5. `script.scene_summaries` is undefined (not in response)
6. Frontend falls back to `generateLocalSummary()` from content blocks
7. **Result**: Old/generated summary shown instead of AI summary

### Why This Happened

The GET /content endpoint (`script_router.py` lines 187-203) constructs a `ScriptWithContent` response but was missing the `scene_summaries` field:

```python
# OLD (BROKEN):
return ScriptWithContent(
    script_id=script.script_id,
    owner_id=script.owner_id,
    title=script.title,
    # ... other fields
    content_blocks=content_blocks,
    version=script.version,
    updated_by=script.updated_by,
    # MISSING: scene_summaries
    content_source=content_source
)
```

**Frontend Sidebar Logic** (`script-scene-sidebar.tsx` lines 30-46):
```typescript
// Load persisted summaries from script.scene_summaries on mount
useEffect(() => {
  if (!script?.scene_summaries || scenes.length === 0) return;

  const persistedSummaries = new Map<number, string>();
  scenes.forEach((scene, index) => {
    const summary = script.scene_summaries?.[scene.heading];  // ← undefined!
    if (summary) {
      persistedSummaries.set(index, summary);
    }
  });

  if (persistedSummaries.size > 0) {
    console.log('[ScriptSceneSidebar] Loaded persisted summaries:', persistedSummaries.size);
    setAiSummaries(persistedSummaries);
  }
}, [script?.scene_summaries, scenes]);
```

Since `script.scene_summaries` was undefined, the useEffect returned early and never loaded the summaries.

**Display Logic** (`script-scene-sidebar.tsx` lines 242-244):
```typescript
const aiSummary = aiSummaries.get(index);  // Empty because useEffect didn't run
const localSummary = generateLocalSummary(scene);  // Generated from content
const summary = aiSummary || localSummary;  // Falls back to local summary
```

## The Fix

### Backend Changes

#### 1. Added scene_summaries to ScriptWithContent Schema

**File**: `backend/app/schemas/script.py` (lines 75-79)

```python
# AI-generated scene summaries for script-level editor
scene_summaries: Optional[Dict[str, str]] = Field(
    None,
    description="AI-generated summaries keyed by scene heading (slugline)"
)
```

This adds the field to the Pydantic schema so it can be serialized in API responses.

#### 2. Included scene_summaries in GET /content Response

**File**: `backend/app/routers/script_router.py` (line 202)

```python
# Build response with content
return ScriptWithContent(
    script_id=script.script_id,
    owner_id=script.owner_id,
    title=script.title,
    description=script.description,
    current_version=script.current_version,
    created_at=script.created_at,
    updated_at=script.updated_at,
    imported_fdx_path=script.imported_fdx_path,
    exported_fdx_path=script.exported_fdx_path,
    exported_pdf_path=script.exported_pdf_path,
    content_blocks=content_blocks,
    version=script.version,
    updated_by=script.updated_by,
    scene_summaries=script.scene_summaries,  # ✅ NOW INCLUDED
    content_source=content_source
)
```

### Frontend Changes

**No changes needed!** The frontend was already correctly implemented to read from `script.scene_summaries`. It was just missing the data from the API.

## Data Architecture

### Script-Level Editor Storage

For scripts edited in script-level mode:

| Field | Type | Purpose | Populated By |
|-------|------|---------|--------------|
| `Script.content_blocks` | JSONB array | Full script content | FDX import, autosave |
| `Script.scene_summaries` | JSONB object | AI scene summaries | AI endpoint |
| `script_versions` | Table | Yjs collaboration updates | WebSocket |

**Format of scene_summaries**:
```json
{
  "INT. COFFEE SHOP - DAY": "Alice meets Bob to discuss the heist plan...",
  "EXT. PARKING LOT - NIGHT": "The team assembles near the warehouse...",
  "INT. WAREHOUSE - CONTINUOUS": "They breach the security system..."
}
```

Key: Scene heading (slugline)
Value: AI-generated summary text

### Scene-Level Editor Storage (Legacy/Fallback)

For scripts edited in scene-level mode (deprecated):

| Field | Type | Purpose |
|-------|------|---------|
| `Scene.content_blocks` | JSONB array | Scene content |
| `Scene.summary` | Text | Scene summary |

### Background Sync (Future)

According to the migration plan, a background worker will periodically sync Script → Scenes:

```python
# Pseudocode from migration plan
def sync_script_to_scenes(script_id):
    script = get_script(script_id)

    # Extract scene boundaries from script.content_blocks
    scenes = parse_scenes_from_content(script.content_blocks)

    # Update Scene records
    for position, scene_data in enumerate(scenes):
        scene = get_or_create_scene(script_id, position)
        scene.content_blocks = scene_data.blocks
        scene.scene_heading = scene_data.heading

        # Sync AI summary from scripts.scene_summaries
        if script.scene_summaries:
            scene.summary = script.scene_summaries.get(scene_data.heading)
```

**Sync Triggers**:
- Background job: Every 60 seconds for active scripts
- On-demand: When AI features request scene context
- Manual: Admin/debug scripts

## Alternative Approaches Considered

### Option 1: Write-Through to Scene Table (NOT CHOSEN)

Update both `scripts.scene_summaries` AND `scenes.summary` simultaneously when AI summary is generated:

```python
# In ai_router.py
if script.content_blocks is not None:
    # Script-level: save to scripts.scene_summaries
    script.scene_summaries[request.slugline] = summary
    attributes.flag_modified(script, 'scene_summaries')

    # ALSO update Scene table (write-through)
    scene = await db.execute(
        select(Scene).where(
            Scene.script_id == request.script_id,
            Scene.scene_heading == request.slugline
        )
    )
    if scene:
        scene.summary = summary
```

**Why NOT chosen**:
- ❌ Couples AI endpoint to Scene table
- ❌ Violates separation of concerns (script-level shouldn't touch scenes directly)
- ❌ More complex transaction handling
- ❌ Doesn't follow intended architecture (Script → Scene sync should be background job)
- ❌ Would need to handle scene not existing yet (script content not synced to scenes)

### Option 2: Frontend Reads from Scene Table (NOT CHOSEN)

Make frontend read from a different API endpoint that returns scene summaries from the Scene table:

```typescript
// Fetch summaries from Scene table
const sceneSummaries = await fetch(`/api/scenes/${scriptId}/summaries`);
```

**Why NOT chosen**:
- ❌ Adds unnecessary API call
- ❌ Scene table might not have summaries yet (not synced)
- ❌ Goes against intended architecture (Script is source of truth)
- ❌ More complex frontend state management

### Option 3: Immediate Scene Sync on Summary Generation (NOT CHOSEN)

Trigger scene sync immediately when AI summary is generated:

```python
# In ai_router.py after saving summary
if script.content_blocks is not None:
    script.scene_summaries[request.slugline] = summary
    attributes.flag_modified(script, 'scene_summaries')

    # Trigger immediate sync
    await sync_script_to_scenes(script_id)
```

**Why NOT chosen**:
- ❌ Adds latency to AI summary generation
- ❌ Sync logic not yet implemented (future work)
- ❌ Overkill for just updating one summary
- ❌ Better handled by periodic background job

### Option 4: Include scene_summaries in API Response (CHOSEN) ✅

Simply include the existing `script.scene_summaries` field in the GET /content response.

**Why CHOSEN**:
- ✅ Minimal change (add one field to response)
- ✅ Follows intended architecture (Script is source of truth)
- ✅ Frontend already implemented correctly
- ✅ No additional API calls
- ✅ Clean separation of concerns
- ✅ Background sync can handle Scene table updates later

## Testing Plan

### Test 1: Fresh AI Summary Generation

1. Open script editor
2. Generate AI summary for a scene
3. **Expected**: Summary displays immediately
4. Check frontend console: `[ScriptSceneSidebar] Loaded persisted summaries: 0` (local state used)

### Test 2: Refresh After Summary Generation

1. From Test 1, with AI summary displayed
2. Refresh page (F5 or Cmd+R)
3. **Expected**: Summary persists and displays correctly
4. Check frontend console: `[ScriptSceneSidebar] Loaded persisted summaries: 1`
5. Check browser network tab: GET /content response includes `scene_summaries` object

### Test 3: Multiple Summaries

1. Generate AI summaries for 3 different scenes
2. Refresh page
3. **Expected**: All 3 summaries persist and display
4. Check frontend console: `[ScriptSceneSidebar] Loaded persisted summaries: 3`

### Test 4: Database Verification

```sql
-- Check that summaries are in scripts table
SELECT
    script_id,
    title,
    jsonb_pretty(scene_summaries) as summaries
FROM scripts
WHERE script_id = 'your-script-id';

-- Expected: JSONB object with scene headings as keys
```

### Test 5: API Response Verification

```bash
# Call GET /content endpoint
curl "http://localhost:8000/api/scripts/{id}/content" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected response includes:
{
  "script_id": "...",
  "title": "...",
  "content_blocks": [...],
  "scene_summaries": {  ← SHOULD BE PRESENT
    "INT. COFFEE SHOP - DAY": "Summary text..."
  },
  "content_source": "script"
}
```

### Test 6: Fallback Behavior

1. Delete `scene_summaries` from database for a script:
```sql
UPDATE scripts SET scene_summaries = NULL WHERE script_id = 'test-id';
```
2. Open script editor
3. **Expected**: Displays generated local summaries (fallback)
4. Generate AI summary
5. **Expected**: AI summary replaces local summary
6. Refresh
7. **Expected**: AI summary persists

## Success Criteria

- ✅ AI summaries persist across page refreshes
- ✅ GET /content response includes `scene_summaries` field
- ✅ Frontend loads summaries from `script.scene_summaries`
- ✅ Database `scripts.scene_summaries` has correct data
- ✅ Multiple summaries for same script all persist
- ✅ No errors in frontend or backend logs
- ✅ Fallback to local summaries still works when no AI summaries exist

## Future Enhancements

### Background Scene Sync Job

When implemented (per migration plan lines 796-913), the sync job should:

1. Parse `script.content_blocks` to extract scene boundaries
2. Create/update Scene records with content
3. **Sync summaries**: Copy from `script.scene_summaries` to `scene.summary`

```python
# In background sync job
for scene_data in parsed_scenes:
    scene = get_or_create_scene(script_id, scene_data.position)

    # Sync content
    scene.content_blocks = scene_data.blocks
    scene.scene_heading = scene_data.heading

    # Sync AI summary (NEW)
    if script.scene_summaries:
        ai_summary = script.scene_summaries.get(scene_data.heading)
        if ai_summary:
            scene.summary = ai_summary  # Copy AI summary to Scene table
```

This ensures Scene table has updated summaries for AI features (embeddings, RAG).

### On-Demand Sync Trigger

When AI assistant requests scene context:

```python
# When AI needs scene summaries
def get_scene_context_for_ai(script_id):
    # Check if scenes are stale
    if scenes_need_sync(script_id):
        sync_script_to_scenes(script_id)  # Sync on-demand

    # Return scenes with updated summaries
    return get_scenes_with_summaries(script_id)
```

## Related Issues Fixed

This fix completes a series of AI summary persistence issues:

1. **JSONB Mutation Tracking** (Issue #1):
   - Problem: `flag_modified()` not called
   - Fix: Added `attributes.flag_modified(script, 'scene_summaries')`
   - Result: Summaries saved to database ✅

2. **Editor Mode Detection** (Issue #2):
   - Problem: Wrong logic (Scene existence check)
   - Fix: Check `script.content_blocks is not None`
   - Result: Summaries saved to correct location (scripts table) ✅

3. **FDX Script.content_blocks Population** (Issue #3):
   - Problem: Script.content_blocks not populated on import
   - Fix: Populate during FDX import
   - Result: Editor mode detection works correctly ✅

4. **API Response Missing scene_summaries** (Issue #4 - THIS FIX):
   - Problem: GET /content didn't include scene_summaries
   - Fix: Added field to schema and response
   - Result: Frontend can load persisted summaries ✅

All four issues needed to be fixed for complete AI summary persistence!

## Files Modified

### Backend
1. **`backend/app/schemas/script.py`** (lines 75-79)
   - Added `scene_summaries` field to ScriptWithContent schema

2. **`backend/app/routers/script_router.py`** (line 202)
   - Included `scene_summaries` in GET /content response

### Frontend
- **No changes needed** - frontend was already correctly implemented

## Conclusion

The issue was a simple but critical oversight: the GET /content endpoint wasn't including the `scene_summaries` field in its response, even though the frontend was correctly trying to read it.

The fix adds one field to the Pydantic schema and includes it in the response. This allows the frontend's existing logic to load and display persisted AI summaries correctly.

This follows the intended architecture where `scripts.scene_summaries` is the source of truth for script-level editing, and Scene table gets updated later by background sync for AI features.
