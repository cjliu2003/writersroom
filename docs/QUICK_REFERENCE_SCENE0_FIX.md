# Quick Reference: Scene 0 Data Loss Fix

## Problem
First scene overwrites with placeholder after FDX upload (17 blocks → 1 empty block)

## Root Cause
Autosave fires before Yjs sync completes → sends placeholder → overwrites real data

## Solution Location
`backend/app/services/scene_service.py:185-228`

## How It Works
1. **Detect**: Single empty `scene_heading` block = placeholder
2. **Verify**: Database has >1 block or 1 block with text = real data
3. **Block**: If placeholder + real data → PREVENT overwrite
4. **Log**: `🛡️ PREVENTED DATA LOSS` message

## Testing
1. Upload FDX file
2. Open scene 0 in editor
3. Check logs for protection message
4. Verify database keeps 17 blocks

## Expected Log Output
```
🛡️  PREVENTED DATA LOSS: Blocking placeholder overwrite for scene {id}
   Current: 17 blocks with real content
   Attempted: 1 empty placeholder block
```

## Files Changed
- `backend/app/services/scene_service.py` (protection logic)
- `backend/app/db/base.py` (logging config)
- `backend/app/routers/fdx_router.py` (diagnostics)
- `frontend/components/screenplay-editor-with-autosave.tsx` (Yjs seeding)
- `frontend/components/screenplay-editor.tsx` (sync listener)

## Environment
- Python: `/Users/jacklofwall/Documents/GitHub/writersroom/writersRoom/bin/python`
- Backend: port 8000
- Frontend: port 3102

## Related Docs
- Full checkpoint: `SESSION_CHECKPOINT_2025-10-22.md`
- Investigation logs: `error.txt`
- Architecture: `docs/REALTIME_COLLABORATION_SPEC.md`
