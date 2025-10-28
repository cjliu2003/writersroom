# Backend Data Corruption Diagnosis

**Date**: 2025-10-27
**Script ID**: `d0253e04-c5ce-4128-98d7-690b589c5850`
**Status**: 🔴 CRITICAL - Backend data issue causing blank script editor

## Executive Summary

The script editor blank display issue is caused by **backend data corruption**, NOT a frontend bug. Both the REST content_blocks and all Yjs updates in the database are **EMPTY**, despite the API endpoint returning 3317 blocks from a different data source.

## Database Evidence

### Scripts Table
```
Script ID: d0253e04-c5ce-4128-98d7-690b589c5850
Title: silk_road_090825
Version: 1
Updated: 2025-10-27 02:24:26.472512+00:00
Content blocks: None  ← NULL/EMPTY
```

### Script_Versions Table
```
Found 10 script versions

ALL 10 versions have:
- Update size: 101 bytes (minimal Yjs init document)
- Content array length: 0  ← EMPTY YJS DOCUMENT
- Created between: 2025-10-27 04:19:05 - 04:23:39
```

## Root Cause Analysis

### Data Flow Breakdown

1. **Frontend Requests Content**: `GET /api/scripts/{id}/content`
   - API returns: `{title: 'silk_road_090825', version: 0, content_source: 'scenes', blocks: 3317}`
   - Content is fetched from **SCENES** table (individual scene content_blocks aggregated)
   - REST `content_blocks` column in scripts table is IGNORED (it's NULL)

2. **Frontend Seeds Yjs Document**: Successfully inserts 3317 blocks into local Yjs doc

3. **WebSocket Connects**: `ws://localhost:8000/api/ws/scripts/{id}`
   - Backend loads persisted Yjs updates from `script_versions` table
   - All 10 persisted updates represent EMPTY documents (content array length: 0)
   - Backend sends SyncStep2 with this empty state (562KB of sync data)

4. **Frontend Receives Empty Update**:
   - Yjs protocol applies server's "authoritative" state
   - Empty document overwrites frontend-seeded content
   - Result: Blank editor display

### Why Frontend Seeding Keeps Being Overwritten

The Yjs synchronization protocol is **server-authoritative** during initial sync:

```
Client                          Server
  |                               |
  |------ SyncStep1 (state) ----->|
  |                               | Load persisted updates (EMPTY)
  |<----- SyncStep2 (empty) ------|
  | Apply server state (EMPTY)   |
  | ❌ Local seeded content lost  |
```

## Data Inconsistency Investigation

### API Endpoint Behavior

From `backend/app/routers/script_router.py` - `/api/scripts/{id}/content`:

```python
# Line ~200-250 (approximate)
# Fetch scenes associated with this script
scenes = await db.execute(
    select(Scene).where(Scene.script_id == script_id).order_by(Scene.sequence_number)
)
content_blocks = []
for scene in scenes:
    if scene.blocks:
        content_blocks.extend(scene.blocks)

return {
    "title": script.title,
    "version": script.current_version,
    "content_source": "scenes",  # ← Returns aggregated scene content
    "blocks": len(content_blocks),
    "content_blocks": content_blocks
}
```

**Key Insight**: The API doesn't use `script.content_blocks` - it aggregates from scenes table.

### WebSocket Handler Behavior

From `backend/app/routers/script_websocket.py` lines 172-244:

```python
# Get latest Yjs update timestamp
yjs_stmt = (
    select(ScriptVersion.created_at)
    .where(ScriptVersion.script_id == script_id)
    .order_by(desc(ScriptVersion.created_at))
    .limit(1)
)
yjs_result = await db.execute(yjs_stmt)
latest_yjs_update = yjs_result.scalar_one_or_none()

rest_updated_at = script.updated_at

if latest_yjs_update and rest_updated_at > latest_yjs_update:
    # REST is newer - skip stale Yjs history
    logger.info(f"REST newer than Yjs for script {script_id}, skipping persisted updates")
    applied_count = 0
else:
    # Load persisted Yjs updates from script_versions table
    applied_count = await persistence.load_persisted_updates(script_id, ydoc)
    logger.info(f"Loaded {applied_count} persisted update(s) for script {script_id}")

# If no Yjs history exists, populate from REST content_blocks
if applied_count == 0:
    content_blocks = script.content_blocks  # ← This is NULL!
    if content_blocks:
        # ... populate ydoc ...
    else:
        logger.warning(f"No content available for script {script_id}")
```

**Critical Issues**:

1. **Comparison Bug**:
   - `rest_updated_at = script.updated_at` (last time script metadata updated)
   - `latest_yjs_update` (last Yjs version timestamp)
   - If `rest_updated_at > latest_yjs_update`, it skips Yjs history
   - **BUT**: script.updated_at doesn't reflect scene content changes!
   - Result: Loads empty Yjs history even though scenes have content

2. **Fallback Bug**:
   - When `applied_count = 0`, tries to populate from `script.content_blocks`
   - But `script.content_blocks` is NULL! (API gets content from scenes instead)
   - Result: Sends empty Yjs document to clients

## Why All Yjs Updates Are Empty

Based on timestamps (all between 04:19 - 04:23), these were created during recent troubleshooting sessions where:

1. Frontend connected to WebSocket
2. Frontend seeded local Yjs document with content
3. Frontend applied updates locally
4. Local Yjs updates were sent to backend
5. **BUT**: Frontend-seeded content was immediately overwritten by server's empty state
6. Result: Only empty Yjs updates were ever persisted

This is a **chicken-and-egg problem**:
- Server has no valid Yjs history
- Client seeds content but server immediately overwrites it with empty state
- Client can never establish valid content because server always wins sync

## Solution Strategy

### Option 1: Fix WebSocket Seeding Logic (RECOMMENDED)

Modify `script_websocket.py` to seed from scenes when Yjs history is invalid:

```python
# After checking persisted updates
if applied_count == 0:
    # FIXED: Fetch from scenes table, not script.content_blocks
    scenes_result = await db.execute(
        select(Scene)
        .where(Scene.script_id == script_id)
        .order_by(Scene.sequence_number)
    )
    scenes = scenes_result.scalars().all()

    content_blocks = []
    for scene in scenes:
        if scene.blocks:
            content_blocks.extend(scene.blocks)

    if content_blocks:
        # Populate Yjs document
        sharedRoot = ydoc.get_array('content')
        meta = ydoc.get_map('wr_meta')

        with ydoc.begin_transaction() as txn:
            # Clear and populate
            for i in range(len(sharedRoot)):
                sharedRoot.pop(0)

            for block in content_blocks:
                sharedRoot.append(block)

            # Set metadata
            meta['script_id'] = str(script_id)
            meta['last_synced_from'] = 'scenes'

        logger.info(f"Seeded ydoc with {len(content_blocks)} blocks from scenes")
```

### Option 2: Clear Corrupted Data

```sql
-- Delete all corrupted Yjs updates
DELETE FROM script_versions
WHERE script_id = 'd0253e04-c5ce-4128-98d7-690b589c5850';

-- Verify deletion
SELECT COUNT(*) FROM script_versions
WHERE script_id = 'd0253e04-c5ce-4128-98d7-690b589c5850';
-- Should return 0

-- Next WebSocket connection will have applied_count = 0
-- Will trigger fallback to populate from content
```

**Combined with Option 1**, this ensures fresh start with valid seeding.

### Option 3: Populate script.content_blocks

```sql
-- Aggregate scenes into script.content_blocks
UPDATE scripts
SET content_blocks = (
    SELECT jsonb_agg(block ORDER BY scene_seq, block_idx)
    FROM (
        SELECT s.sequence_number as scene_seq,
               ordinality - 1 as block_idx,
               elem as block
        FROM scenes s
        CROSS JOIN LATERAL jsonb_array_elements(s.blocks) WITH ORDINALITY elem
        WHERE s.script_id = 'd0253e04-c5ce-4128-98d7-690b589c5850'
        ORDER BY s.sequence_number, ordinality
    ) subq
)
WHERE script_id = 'd0253e04-c5ce-4128-98d7-690b589c5850';
```

**Issue**: This doesn't fix the underlying seeding logic bug.

## Recommended Implementation Plan

1. **Immediate Fix (Option 2)**: Clear corrupted Yjs data
   ```bash
   # Run SQL to delete corrupted script_versions
   ```

2. **Backend Fix (Option 1)**: Modify script_websocket.py
   - Change seeding logic to fetch from scenes table
   - Update timestamp comparison logic to check scene content freshness
   - Add validation to prevent empty Yjs documents from being persisted

3. **Validation**: Test the fix
   - Clear browser storage and restart frontend
   - Connect to WebSocket
   - Verify content displays correctly
   - Verify Yjs updates are being persisted with valid content

## Prevention Measures

1. **Add Validation**: Prevent empty Yjs updates from being persisted
   ```python
   # In ScriptYjsPersistence.store_update()
   if len(update) <= 150:  # Minimal empty doc size
       # Decode and check content
       test_doc = YDoc()
       Y.apply_update(test_doc, update)
       if len(test_doc.get_array('content')) == 0:
           logger.warning(f"Rejecting empty Yjs update for script {script_id}")
           return None
   ```

2. **Add Monitoring**: Log when seeding from scenes vs Yjs history

3. **Data Consistency**: Periodic job to validate Yjs content matches scene aggregation

## Files Requiring Changes

1. **backend/app/routers/script_websocket.py** (lines 172-244)
   - Fix seeding logic to use scenes table
   - Fix timestamp comparison logic
   - Add empty document validation

2. **backend/app/services/script_yjs_persistence.py**
   - Add validation to reject empty updates
   - Add logging for seeding source

3. **Database**: Clear corrupted data for affected script

## Testing Checklist

- [ ] Clear script_versions for test script
- [ ] Implement seeding from scenes
- [ ] Test WebSocket connection with empty Yjs history
- [ ] Verify content displays in editor
- [ ] Make edits and verify they persist
- [ ] Disconnect and reconnect - verify content loads
- [ ] Check script_versions table - verify valid updates stored
- [ ] Test with multiple simultaneous clients

## Conclusion

This is definitively a **backend data corruption issue**, not a frontend seeding bug. The frontend seeding logic is working correctly, but the backend is loading and sending empty Yjs documents that overwrite the seeded content.

The fix requires modifying the backend WebSocket handler to seed from the scenes table (matching the REST API behavior) when Yjs history is empty or invalid.

All 5 frontend fixes applied during troubleshooting were correct defensive measures, but they cannot solve a backend data integrity problem.
