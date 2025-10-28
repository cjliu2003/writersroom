# FDX Import Script.content_blocks Population Fix

## Issue Summary

**Problem**: After FDX import, `Script.content_blocks` was NULL in the database even though content displayed correctly in the UI.

**Impact**:
- Editor mode detection incorrectly determined script was in "scene-level" mode
- AI summaries saved to wrong location (Scene.summary instead of Script.scene_summaries)
- Script-level autosave wouldn't work properly
- Violated intended architecture where Script.content_blocks is primary storage

**Date Fixed**: 2025-10-27
**Files Modified**: `backend/app/routers/fdx_router.py`

## Root Cause Analysis

### The Gap in FDX Import

The FDX import flow (`POST /api/fdx/upload`) was:

1. **Parse FDX file** → Get `ParsedFDXResult` with:
   - `elements`: List[ScreenplayElement] - Full script content as flat list
   - `scenes`: List[SceneData] - Parsed scene data with boundaries
   - `title`: Script title

2. **Create Script record**:
```python
# ❌ WRONG: Script.content_blocks was not populated
new_script = Script(
    title=parsed_result.title,
    description=f"Imported from {file.filename}",
    owner_id=current_user.user_id
    # Missing: content_blocks=...
)
```

3. **Create Scene records** (lines 90-137):
```python
for position, scene_data in enumerate(parsed_result.scenes):
    content_blocks_json = [
        {
            "type": block.type.value,
            "text": block.text,
            "metadata": block.metadata
        }
        for block in scene_data.content_blocks
    ]

    db_scene = Scene(
        script_id=new_script.script_id,
        position=position,
        scene_heading=scene_data.slugline,
        content_blocks=content_blocks_json,  # ✅ Scene.content_blocks populated
        # ... other fields
    )
```

**Result**: Scene records had content_blocks, but Script.content_blocks was NULL.

### Why It Appeared to Work

The GET /content endpoint has fallback logic (lines 143-185 in `script_router.py`):

```python
# Determine content source and build response
content_blocks = script.content_blocks
content_source = "script"

# Migration fallback: rebuild from scenes if content_blocks is null
if content_blocks is None:
    scenes = await db.execute(
        select(Scene)
        .where(Scene.script_id == script_id)
        .order_by(Scene.position)
    )
    scenes = scenes.scalars().all()

    if scenes:
        # Rebuild full script content from scenes
        content_blocks = []
        for scene in scenes:
            if scene.content_blocks:
                content_blocks.extend(scene.content_blocks)

        content_source = "scenes"  # ← Indicates rebuilding happened
```

So the flow was:
1. Frontend requests GET /scripts/{id}/content
2. Backend finds Script.content_blocks is NULL
3. Backend rebuilds from Scene records (fallback)
4. Frontend displays content correctly
5. **BUT**: Script.content_blocks never gets written back to database

### Why This Broke AI Summaries

The AI summary endpoint (`POST /api/ai/scene-summary`) determines where to save summaries based on editor mode:

```python
# Determine editor mode based on content_blocks (same logic as GET /content)
if script.content_blocks is not None:
    # Script-level editor: save to script.scene_summaries
    script.scene_summaries[request.slugline] = summary
    attributes.flag_modified(script, 'scene_summaries')
else:
    # Scene-level editor: save to scene.summary
    scene.summary = summary
```

**With Script.content_blocks NULL**:
- Endpoint detected "scene-level" mode
- Saved summary to Scene.summary
- Frontend looked in Script.scene_summaries
- Summary appeared to disappear on reload!

## The Fix

### Changes to FDX Router (lines 63-81)

**Added**: Convert parsed elements to script content_blocks before creating Script record:

```python
# Convert all parsed elements to content_blocks format for script-level storage
script_content_blocks = [
    {
        "type": element.type.value,
        "text": element.text,
        "metadata": element.metadata
    }
    for element in parsed_result.elements
]

print(f"Converted {len(parsed_result.elements)} elements to script content_blocks")

# Create new script in database with content_blocks populated
new_script = Script(
    title=parsed_result.title,
    description=f"Imported from {file.filename}",
    owner_id=current_user.user_id,
    content_blocks=script_content_blocks  # ✅ Populate Script.content_blocks
)
```

### Added Diagnostic Logging (lines 156-162)

```python
# DIAGNOSTIC: Verify Script.content_blocks was populated
print(f"[DIAGNOSTIC] Script AFTER db.commit and refresh:")
print(f"  script_id: {new_script.script_id}")
print(f"  title: {new_script.title}")
print(f"  content_blocks: {'None' if new_script.content_blocks is None else f'{len(new_script.content_blocks)} blocks'}")
if new_script.content_blocks:
    print(f"  First block: type={new_script.content_blocks[0].get('type')}, text={new_script.content_blocks[0].get('text')[:50]}...")
```

## Understanding the Architecture

### Dual Storage Design (Migration Plan Lines 447-520)

The architecture maintains **two copies** of content:

1. **Primary Storage (Script-Level)**:
   - `Script.content_blocks` (JSONB) - Full script as flat array
   - `script_versions` table (Yjs updates) - CRDT collaboration data
   - **Purpose**: Real-time editing, autosave, collaboration

2. **Derived Storage (Scene-Level)**:
   - `Scene.content_blocks` (JSONB per scene) - Scene-bounded chunks
   - `Scene` metadata (summary, characters, themes, embeddings)
   - **Purpose**: AI features (RAG, embeddings, scene summaries)

### Why Both Are Needed

**Script.content_blocks** enables:
- Script-level editor (single document view)
- Full-document Yjs collaboration
- Efficient autosave (single JSONB update)
- Editor mode detection

**Scene records** enable:
- AI embeddings (scene-sized chunks)
- Scene-level summaries for RAG
- Character/theme tracking per scene
- Semantic search across scenes

### Background Sync Strategy (Migration Plan Lines 796-913)

A periodic job syncs Script.content_blocks → Scene records:

```python
# Pseudocode from migration plan
def sync_script_to_scenes(script_id):
    script = get_script(script_id)

    # Parse script.content_blocks to find scene boundaries
    scenes = extract_scene_boundaries(script.content_blocks)

    # Update or create Scene records
    for position, scene_data in enumerate(scenes):
        scene = get_or_create_scene(script_id, position)
        scene.content_blocks = scene_data.blocks
        scene.scene_heading = scene_data.heading
        # ... update other fields

    # Delete scenes beyond current count (if script shortened)
    delete_scenes_after(script_id, len(scenes))
```

**Triggers**:
- Background job: Every 60 seconds for active scripts
- On-demand: When AI assistant requests scene context
- Manual: Admin/debug script to force sync

## Testing the Fix

### 1. Upload a New FDX File

```bash
# Use the API to upload an FDX file
curl -X POST "http://localhost:8000/api/fdx/upload" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@test_script.fdx"
```

**Expected Backend Logs**:
```
Parsing FDX file: test_script.fdx
Converted 245 elements to script content_blocks
Creating 15 scenes in database
[DIAGNOSTIC] Script AFTER db.commit and refresh:
  script_id: abc-123-def-456
  title: Test Script
  content_blocks: 245 blocks
  First block: type=scene_heading, text=INT. COFFEE SHOP - DAY...
```

### 2. Verify Database

```sql
-- Check Script.content_blocks is populated
SELECT
    script_id,
    title,
    content_blocks IS NOT NULL as has_content_blocks,
    jsonb_array_length(content_blocks) as block_count,
    content_blocks->0->>'type' as first_block_type,
    content_blocks->0->>'text' as first_block_text
FROM scripts
WHERE script_id = 'abc-123-def-456';

-- Expected result:
-- has_content_blocks: true
-- block_count: 245
-- first_block_type: scene_heading
-- first_block_text: INT. COFFEE SHOP - DAY
```

### 3. Verify GET /content Response

```bash
curl "http://localhost:8000/api/scripts/abc-123-def-456/content" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response**:
```json
{
  "script_id": "abc-123-def-456",
  "title": "Test Script",
  "content_blocks": [...],
  "content_source": "script"  // ← Should be "script", not "scenes"
}
```

### 4. Test AI Summary Persistence

1. Open script in script-level editor
2. Generate AI summary for a scene
3. Check backend logs:

```
🔍 [AI Summary Debug] Generated summary for 'INT. COFFEE SHOP - DAY'
   Script has content_blocks: True
   Path: Script-level editor (content_blocks exists)  ← Should see this
   Called flag_modified on scene_summaries
   ✅ Commit successful!
```

4. Reload page - summary should persist

5. Verify database:

```sql
SELECT script_id, scene_summaries
FROM scripts
WHERE script_id = 'abc-123-def-456';

-- Expected: JSONB object like:
-- {"INT. COFFEE SHOP - DAY": "Summary text..."}
```

## Migration Strategy for Existing Scripts

### Problem: Existing FDX-Imported Scripts

Scripts imported before this fix have:
- ✅ Scene.content_blocks populated (per scene)
- ❌ Script.content_blocks NULL
- Result: GET /content rebuilds every request (inefficient)

### Solution Options

#### Option 1: Write-Back on GET /content (Quick Fix)

Add to `script_router.py` lines 176-180:

```python
if content_blocks is None:
    # Rebuild from scenes
    scenes = ...
    content_blocks = []
    for scene in scenes:
        content_blocks.extend(scene.content_blocks)

    content_source = "scenes"

    # ✅ NEW: Write back to script for future requests
    script.content_blocks = content_blocks
    await db.commit()
```

**Pros**: Automatic migration on first access
**Cons**: Adds latency to first GET /content request

#### Option 2: Background Migration Script (Recommended)

Create `backend/scripts/migrate_existing_scripts.py`:

```python
"""
Migrate existing scripts to populate Script.content_blocks from Scene records.
Run once to fix scripts imported before the FDX fix.
"""

from sqlalchemy import select
from app.models.script import Script
from app.models.scene import Scene
from app.db.base import get_async_session

async def migrate_scripts():
    async with get_async_session() as db:
        # Find scripts with NULL content_blocks but with scenes
        result = await db.execute(
            select(Script)
            .where(Script.content_blocks.is_(None))
        )
        scripts = result.scalars().all()

        print(f"Found {len(scripts)} scripts needing migration")

        for script in scripts:
            # Get scenes ordered by position
            scenes_result = await db.execute(
                select(Scene)
                .where(Scene.script_id == script.script_id)
                .order_by(Scene.position)
            )
            scenes = scenes_result.scalars().all()

            if not scenes:
                print(f"  Script {script.script_id}: No scenes, skipping")
                continue

            # Rebuild content_blocks from scenes
            content_blocks = []
            for scene in scenes:
                if scene.content_blocks:
                    content_blocks.extend(scene.content_blocks)

            if content_blocks:
                script.content_blocks = content_blocks
                print(f"  Script {script.script_id}: Populated {len(content_blocks)} blocks")

        await db.commit()
        print(f"✅ Migration complete!")

if __name__ == "__main__":
    import asyncio
    asyncio.run(migrate_scripts())
```

Run with:
```bash
cd backend
python scripts/migrate_existing_scripts.py
```

#### Option 3: Do Nothing (Acceptable)

If there are few existing scripts or rebuild performance is acceptable:
- GET /content will continue rebuilding from scenes
- New FDX imports will have Script.content_blocks populated
- Existing scripts gradually fixed via autosave writes

## Impact

### Before Fix

**FDX Import Flow**:
```
Upload FDX → Parse → Create Script (content_blocks=NULL) → Create Scenes (content_blocks populated)
                                                          ↓
                                            Script.content_blocks stays NULL forever
```

**GET /content Flow**:
```
Request → Check Script.content_blocks → NULL → Rebuild from scenes → Return (slow)
                                                                   ↓
                                                    Never writes back to Script.content_blocks
```

**AI Summary Flow**:
```
Generate → Check content_blocks → NULL → Scene-level path → Save to Scene.summary → Wrong location!
```

### After Fix

**FDX Import Flow**:
```
Upload FDX → Parse → Convert elements → Create Script (content_blocks populated) → Create Scenes
                                                     ↓
                                        Script.content_blocks has full script content
```

**GET /content Flow**:
```
Request → Check Script.content_blocks → Populated → Return directly (fast)
```

**AI Summary Flow**:
```
Generate → Check content_blocks → Populated → Script-level path → Save to Script.scene_summaries → Correct location!
```

## Related Fixes

This fix completes a series of related issues:

1. **JSONB Mutation Tracking** (Issue #1):
   - Problem: Summaries didn't persist due to mutation detection
   - Fix: Added `attributes.flag_modified(script, 'scene_summaries')`
   - Doc: `JSONB_MUTATION_TRACKING_FIX.md`

2. **Editor Mode Detection** (Issue #2):
   - Problem: Wrong detection logic using Scene existence
   - Fix: Changed to check `script.content_blocks is not None`
   - Doc: `EDITOR_MODE_DETECTION_FIX.md`

3. **FDX Script.content_blocks Population** (Issue #3 - THIS FIX):
   - Problem: FDX import didn't populate Script.content_blocks
   - Fix: Convert parsed elements and set during Script creation
   - Doc: `FDX_SCRIPT_CONTENT_BLOCKS_FIX.md` (this document)

All three issues needed to be fixed for AI summaries to persist correctly in FDX-imported scripts.

## Lessons Learned

1. **Dual Storage Requires Dual Population**: When maintaining two copies of data (Script.content_blocks + Scene.content_blocks), ensure BOTH are populated at creation time.

2. **Fallback Logic Can Mask Issues**: GET /content's rebuild logic made the bug invisible - content displayed correctly but underlying issue remained.

3. **Test the Database, Not Just the UI**: UI can display correct data even when database isn't properly populated.

4. **Follow the Data Flow**: Traced from FDX upload → Script creation → GET /content → AI summary to understand complete picture.

5. **Architecture Documentation Is Critical**: Migration plan (2271 lines) was essential to understanding intended architecture vs actual implementation.

## References

- Migration Plan: `docs/SCRIPT_LEVEL_MIGRATION_PLAN.md` (lines 447-520, 796-913)
- GET /content Logic: `backend/app/routers/script_router.py` (lines 143-203)
- FDX Parser: `backend/app/services/fdx_parser.py` (lines 69-110)
- Related Fix #1: `docs/JSONB_MUTATION_TRACKING_FIX.md`
- Related Fix #2: `docs/EDITOR_MODE_DETECTION_FIX.md`
