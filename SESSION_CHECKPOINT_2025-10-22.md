# Session Checkpoint: Scene 0 Data Loss Fix
**Date**: October 22, 2025
**Session Type**: Bug Investigation & Fix
**Status**: Solution Implemented, Awaiting Verification

---

## Problem Statement

After uploading FDX files, the first scene (position 0) was being overwritten with placeholder data (1 empty `scene_heading` block) instead of keeping the 17 blocks uploaded from the FDX parser.

**User Impact**:
- Blank editor screen on load
- First scene showing as "UNTITLED SCENE" with no content
- Data loss of scene content and heading despite correct upload

---

## Root Cause Analysis

### Primary Issue
Frontend autosave firing with placeholder content before Yjs synchronization completes.

### Detailed Sequence
1. ✅ FDX upload stores 17 blocks correctly in database
2. ✅ Frontend loads scenes via `GET /api/scripts/{script_id}/scenes`
3. ✅ WebSocket connects for Yjs collaboration
4. ❌ Editor creates placeholder for scene 0 (content not synced yet)
5. ❌ Autosave immediately fires with placeholder: 1 empty scene_heading block
6. ❌ Backend accepts placeholder and overwrites 17 real blocks

### Evidence
Backend logs from error.txt (lines 225-231):
```
⚠️  SCENE 0 UPDATE DETECTED:
   Scene ID: 1aadb6c7-acf7-44d7-96ec-0980377bb189
   Current content_blocks: 17 blocks ← CORRECT DATA
   New content_blocks: 1 blocks ← PLACEHOLDER
   Current scene_heading: INT. HALLWAY - SASKATOON POLICE DEPARTMENT – NIGHT ← CORRECT
   New scene_heading: UNTITLED SCENE ← PLACEHOLDER
```

---

## Solution Implemented

### Location
`backend/app/services/scene_service.py:185-228`

### Approach
Backend protection against placeholder overwrites with three-layer defense:

1. **Placeholder Detection** (lines 197-205)
   - Identifies single block with empty text and `scene_heading` type
   - Checks for exact placeholder signature

2. **Real Data Verification** (lines 207-215)
   - Checks if database currently has >1 block OR 1 block with actual text content
   - Prevents false positives from legitimately empty scenes

3. **Overwrite Blocking** (lines 217-224)
   - If placeholder detected AND real data exists: BLOCK the update
   - Keep existing `content_blocks` and `scene_heading` intact
   - Log clear warning for debugging

### Code Changes

#### scene_service.py (lines 185-228)
```python
# IMPORTANT: Don't overwrite with empty content_blocks to prevent data loss
new_content_blocks = data.get("content_blocks", data.get("blocks", []))

# Log if we're updating scene 0's first scene (position 0)
if scene.position == 0:
    print(f"\n⚠️  SCENE 0 UPDATE DETECTED:")
    print(f"   Scene ID: {scene_id}")
    print(f"   Current content_blocks: {len(scene.content_blocks) if scene.content_blocks else 0} blocks")
    print(f"   New content_blocks: {len(new_content_blocks) if new_content_blocks else 0} blocks")
    print(f"   Current scene_heading: {scene.scene_heading}")
    print(f"   New scene_heading: {data.get('scene_heading', 'N/A')}\n")

# Detect placeholder/empty blocks that would corrupt real data
is_placeholder = False
if new_content_blocks and len(new_content_blocks) == 1:
    first_block = new_content_blocks[0]
    if isinstance(first_block, dict):
        text = first_block.get("text", "").strip()
        block_type = first_block.get("type", "")
        is_placeholder = (not text or text == "") and block_type == "scene_heading"

# Check if we're about to lose real data
current_has_real_data = False
if scene.content_blocks:
    if len(scene.content_blocks) > 1:
        current_has_real_data = True
    elif len(scene.content_blocks) == 1:
        first_text = scene.content_blocks[0].get("text", "").strip()
        if first_text and first_text != "":
            current_has_real_data = True

if is_placeholder and current_has_real_data:
    print(f"🛡️  PREVENTED DATA LOSS: Blocking placeholder overwrite for scene {scene_id}")
    print(f"   Current: {len(scene.content_blocks)} blocks with real content")
    print(f"   Attempted: 1 empty placeholder block")
    # Don't update content_blocks or scene_heading - keep existing data
elif new_content_blocks or not scene.content_blocks:
    # Only update if new data exists, or if current data is also empty
    scene.content_blocks = new_content_blocks
    scene.scene_heading = data.get("scene_heading", scene.scene_heading)
else:
    print(f"[WARNING] Prevented overwriting scene {scene_id} content_blocks with empty data")
```

---

## Technical Discoveries

### Architecture Insights
1. **Yjs-Primary Design**: Yjs updates are PRIMARY source of truth, REST autosave is FALLBACK
2. **Data Loading Priority**: `GET /api/scripts/{id}/scenes` loads from Yjs first, falls back to database
3. **Race Condition**: Timing issue between Yjs sync completion and autosave trigger on initial load
4. **full_content Format**: Should be plain text string, but gets corrupted to Slate JSON array

### Frontend Data Flow
1. **FDX Parser**: Generates plain text `full_content` correctly (joins content with `\n`)
2. **Autosave Sends**: `full_content` as `JSON.stringify(elements)` (Slate JSON string)
3. **Frontend Expects**: `parseFullContentToElements()` expects string, not pre-parsed array
4. **Fallback Logic**: `extractSceneSlice()` defaults to position 0 when UUID not found

### Frontend Patterns
- `syncStatus !== 'synced'` triggers autosave (offline fallback pattern)
- Editor creates placeholder with `fallback_*` IDs when content missing
- `contentToBlocks()` can return empty array if parsing fails

---

## Files Modified

### Backend Changes

#### 1. backend/app/services/scene_service.py
**Lines**: 185-228
**Changes**: Added placeholder detection and data loss prevention in `update_scene_with_cas()`
**Purpose**: Core protection logic to prevent placeholder overwrites

#### 2. backend/app/db/base.py
**Lines**: 17, 34
**Changes**: Disabled SQL query logging (`echo=False`, `logging.WARNING`)
**Purpose**: Reduce console noise for easier diagnostic log reading

#### 3. backend/app/models/scene.py
**Lines**: 53-57
**Changes**: Fixed `content_blocks` type from `Dict` to `List[Dict]` with `default=list`
**Status**: Model fix applied, migration not completed due to enum error
**Note**: Default only affects new records, not the root cause

#### 4. backend/app/routers/fdx_router.py
**Lines**: 86-145, 171-176
**Changes**: Added extensive diagnostic logging for scene 0 data flow, upload completion banner
**Purpose**: Track data from parser through database storage

### Frontend Changes (Previous Session)

#### 5. frontend/components/screenplay-editor-with-autosave.tsx
**Lines**: 267-312
**Changes**: Added Yjs doc seeding with real content detection and `toSharedType()`
**Purpose**: Prevent editor from starting with placeholder content

#### 6. frontend/components/screenplay-editor.tsx
**Lines**: 201-212, 286
**Changes**: Added Yjs `'update'` event listener for `YjsEditor.synchronizeValue()`
**Purpose**: Force Slate-Yjs synchronization when doc updates

---

## Testing Status

### Backend Tests
- ✅ 21/23 FDX parser tests passing
- ⚠️ 2 pre-existing test failures (unrelated to this fix)

### Manual Testing Required
1. Upload FDX file with multiple scenes
2. Open editor and navigate to first scene (scene 0)
3. Check backend logs for protection message
4. Verify database retains 17 blocks (not overwritten with 1 placeholder)

### Expected Behavior
Backend should log when protection activates:
```
🛡️  PREVENTED DATA LOSS: Blocking placeholder overwrite for scene {scene_id}
   Current: 17 blocks with real content
   Attempted: 1 empty placeholder block
```

---

## Investigation Artifacts

### error.txt Analysis
- **Upload Success**: 148 scenes created, first scene: "INT. HALLWAY - SASKATOON POLICE DEPARTMENT – NIGHT"
- **Scene 0 Corruption**: Supabase shows `full_content` as Slate JSON array with `fallback_` ID
- **Autosave Overwrite**: Logs show 17 blocks → 1 block replacement (lines 225-231)
- **WebSocket Timing**: Yjs sync completes AFTER autosave already fired

### Diagnostic Logging Added
1. **FDX Upload**: Scene 0 data flow from parser → DB (fdx_router.py:86-145)
2. **Scene Updates**: Position 0 detection with current/new block comparison (scene_service.py:189-195)
3. **Protection Activation**: Clear "PREVENTED DATA LOSS" message (scene_service.py:215-217)
4. **Upload Completion**: Banner showing scenes created and first scene name (fdx_router.py:171-176)

---

## Environment Context

- **Python Environment**: `/Users/jacklofwall/Documents/GitHub/writersroom/writersRoom/bin/python`
- **Backend Port**: 8000
- **Frontend Port**: 3102
- **Database**: PostgreSQL via Supabase
- **Collaboration**: Yjs CRDT + Redis pub/sub for multi-server coordination
- **Test Assets**: FDX files in `test_assets/` directory

---

## Next Steps

### Immediate Verification
1. User uploads FDX file and opens scene 0
2. Check backend logs for protection message
3. Verify Supabase shows 17 blocks, not 1 placeholder
4. Confirm editor displays scene content correctly

### If Protection Activates Successfully
- ✅ Data loss prevented
- ✅ Backend protection working as designed
- Consider frontend fix to prevent placeholder generation (lower priority)

### If Issue Persists
Investigate:
- Why editor generates placeholder before Yjs sync
- Whether `syncStatus` check needs adjustment
- Timing of autosave trigger vs Yjs sync completion

---

## Key Learnings

### Race Conditions in Real-Time Systems
- WebSocket/Yjs sync is async and may not complete before user interactions
- Autosave fallback can trigger before primary sync mechanism ready
- Backend protection needed as safety net for frontend race conditions

### Multi-Layer Architecture Debugging
- Traced issue from frontend → autosave → backend → database → API response
- Used diagnostic logging at each layer to identify exact corruption point
- Evidence-based debugging: logs proved upload worked, autosave corrupted

### Data Integrity Patterns
- **Defensive Backend**: Don't trust all client data, validate before overwrite
- **Placeholder Detection**: Identify empty/corrupt data signatures
- **Real Data Verification**: Check existing data quality before replacement
- **Graceful Degradation**: Keep existing data when new data is suspicious

---

## Session Metadata

**Total Investigation Time**: ~3 hours across multiple sessions
**Key Breakthrough**: Backend logs showing 17 → 1 block overwrite
**Solution Type**: Defensive backend protection (server-side fix)
**User Environment**: macOS, venv Python, Supabase PostgreSQL
**Collaboration Tools**: Git status tracking, error.txt log aggregation
