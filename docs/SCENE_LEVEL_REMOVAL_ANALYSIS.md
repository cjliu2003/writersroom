# Scene-Level Editor Removal Analysis

**Date**: 2025-10-27
**Question**: Can we remove the old scene-level editor code now that we're using script-level editing exclusively?
**Answer**: **Partial removal possible with one AI feature migration required**

## Executive Summary

**✅ CAN REMOVE**: Frontend scene-level editor components (safe, no dependencies)
**⚠️ REQUIRES MIGRATION**: AI chat feature currently queries Scene table
**❌ KEEP FOR NOW**: Backend Scene infrastructure (needed for data access until migration complete)

## Current Architecture Overview

### Dual-Mode System

The codebase currently supports TWO editing modes:

1. **Scene-Level Editor** (OLD - Being deprecated)
   - Each scene edited independently
   - WebSocket: `/api/ws/scenes/{scene_id}`
   - Storage: Individual Scene records with Yjs persistence in `scene_versions`
   - Page: `/app/editor`

2. **Script-Level Editor** (NEW - Current production)
   - Entire script edited as single document
   - WebSocket: `/api/ws/scripts/{script_id}`
   - Storage: Script.content_blocks with Yjs persistence in `script_versions`
   - Page: `/app/script-editor`

### Scene Table Role Change

According to `SCRIPT_LEVEL_MIGRATION_PLAN.md`:

**OLD Role**: Primary storage for content editing
**NEW Role**: Derived metadata for AI features (optional)

> "Scene syncing is NOT required for core editor functionality. Scene syncing is purely for AI features (scene descriptions, embeddings, RAG). You can implement this after the editor is working."

## Detailed Component Analysis

### ✅ SAFE TO REMOVE - Frontend Components

These components are ONLY used by the old scene-level editor:

#### Primary Components

| File | Purpose | Dependencies | Can Remove? |
|------|---------|--------------|-------------|
| `/app/editor/page.tsx` | Scene-level editor page | ScreenplayEditor components | ✅ Yes |
| `/components/screenplay-editor.tsx` | Base scene editor | use-yjs-collaboration | ✅ Yes |
| `/components/screenplay-editor-with-autosave.tsx` | Scene editor wrapper | use-yjs-collaboration, use-autosave | ✅ Yes |
| `/hooks/use-yjs-collaboration.ts` | Scene-level Yjs hook | y-websocket, `/ws/scenes/{id}` | ✅ Yes |
| `/components/scene-descriptions.tsx` | Scene sidebar (old) | Used by `/app/editor` | ✅ Yes |

**Lines of Code**: ~2,500 lines

**Removal Impact**: NONE - These are completely isolated from script-level editor

#### Test/Example Components

| File | Purpose | Can Remove? |
|------|---------|-------------|
| `/app/test-collab/page.tsx` | Test page | ✅ Yes |
| `/app/test-script-collab/page.tsx` | Test page | ✅ Yes |
| `/components/screenplay-example.tsx` | Example code | ✅ Yes |
| `/components/examples/autosave-example.tsx` | Example code | ✅ Yes |
| `/components/collaborative-editor-example.tsx` | Example code | ✅ Yes |

**Lines of Code**: ~500 lines

### ⚠️ REQUIRES MIGRATION - AI Features

#### AI Chat Context Loading

**File**: `backend/app/routers/ai_router.py` (lines 141-156)

**Current Implementation**:
```python
# Load recent scenes for context if requested
if request.include_scenes:
    scenes_query = select(Scene).where(
        Scene.script_id == request.script_id
    ).order_by(Scene.position.desc()).limit(10)

    result = await db.execute(scenes_query)
    recent_scenes = result.scalars().all()

    if recent_scenes:
        scene_summaries = []
        for scene in reversed(recent_scenes):
            summary_text = scene.summary or "No summary available"
            scene_summaries.append(f"Scene: {scene.scene_heading}\nSummary: {summary_text}")

        scene_context = "\n\n".join(scene_summaries)
```

**Problem**: Queries `Scene` table for summaries, but script-level editor stores summaries in `script.scene_summaries`

**Required Migration**:
```python
# Load scene summaries from script for context if requested
if request.include_scenes:
    # Get script with scene_summaries
    script = await get_script_if_user_has_access(
        request.script_id,
        user,
        db,
        allow_viewer=True
    )

    if script.scene_summaries:
        scene_summaries = []
        # Iterate through scene_summaries JSONB object
        for heading, summary in script.scene_summaries.items():
            scene_summaries.append(f"Scene: {heading}\nSummary: {summary}")

        scene_context = "\n\n".join(scene_summaries)
```

**Complexity**: LOW (15 lines changed)
**Risk**: LOW (AI chat is already disabled in frontend)

#### AI Summary Generation

**File**: `backend/app/routers/ai_router.py` (lines 62-100)

**Current Status**: ✅ ALREADY SUPPORTS BOTH MODES

The summary generation endpoint correctly detects editor mode:
- If `script.content_blocks` exists → saves to `script.scene_summaries` ✅
- If `script.content_blocks` is null → saves to `scene.summary` (legacy path)

**Action Required**: Remove legacy scene-level path (lines 79-100) after confirming all scripts have `content_blocks`

### ❌ KEEP FOR NOW - Backend Infrastructure

These components support Scene table operations and cannot be removed until AI migration is complete:

| Component | Purpose | Remove After |
|-----------|---------|--------------|
| `models/scene.py` | Scene model definition | AI migration + data cleanup |
| `models/scene_version.py` | Scene Yjs persistence | Confirm no active scene WebSockets |
| `models/scene_snapshot.py` | Scene version history | Data retention policy complete |
| `routers/scene_autosave_router.py` | Scene autosave API | Confirm no clients using it |
| `routers/websocket.py` | Scene WebSocket | Confirm no active connections |
| `services/scene_service.py` | Scene CRUD operations | After dependent features migrated |
| `services/yjs_persistence.py` | Scene Yjs operations | After WebSocket shutdown |

**Database Tables**:
- `scenes` - 77 code references
- `scene_versions` - Yjs updates for scene-level editing
- `scene_snapshots` - Historical versions
- `scene_write_ops` - Idempotency tracking
- `scene_embeddings` - AI embeddings (future feature)

### ⚠️ AMBIGUOUS - Might Be Shared

| Component | Used By | Analysis Needed |
|-----------|---------|-----------------|
| `components/scene-outline-sidebar.tsx` | Script-level editor sidebar? | Check if reused by `/app/script-editor` |
| `GET /api/scripts/{id}/scenes` | Old editor? AI? | Check frontend usage |

## Removal Roadmap

### Phase 1: Immediate (No Risk)

**Remove frontend scene-level editor** (safe, isolated)

1. Delete `/app/editor/page.tsx`
2. Delete `/components/screenplay-editor.tsx`
3. Delete `/components/screenplay-editor-with-autosave.tsx`
4. Delete `/hooks/use-yjs-collaboration.ts`
5. Delete test pages (`/app/test-*`)
6. Delete example components

**Verification**:
```bash
# 1. Remove files
rm -rf frontend/app/editor
rm frontend/components/screenplay-editor.tsx
rm frontend/components/screenplay-editor-with-autosave.tsx
rm frontend/hooks/use-yjs-collaboration.ts
rm -rf frontend/app/test-collab
rm -rf frontend/app/test-script-collab

# 2. Check for broken imports
cd frontend && npm run build

# 3. Verify no compilation errors
```

**Impact**: ZERO (these components are not imported by script-level editor)

**Estimated Time**: 30 minutes

### Phase 2: AI Chat Migration (Low Risk)

**Migrate AI chat to use script.scene_summaries**

1. Update `ai_router.py` chat endpoint (lines 141-156)
2. Test AI chat with script-level summaries
3. Verify scene context loading works correctly

**Verification**:
```bash
# 1. Apply code changes to ai_router.py
# 2. Test AI chat endpoint
curl -X POST http://localhost:8000/api/ai/chat \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"script_id":"...","messages":[],"include_scenes":true}'

# 3. Verify scene context uses script.scene_summaries
```

**Impact**: LOW (AI chat currently disabled in frontend)

**Estimated Time**: 1 hour

### Phase 3: Remove Scene-Level Backend (Medium Risk)

**Prerequisites**:
- ✅ All frontend scene-level code removed (Phase 1)
- ✅ AI features migrated to script-level (Phase 2)
- ✅ Confirm no active scene-level WebSocket connections
- ✅ Confirm all scripts have `content_blocks` populated

**Steps**:

1. **Remove scene-level AI code**:
   - Delete legacy path in `ai_router.py` (lines 79-100)
   - Remove `Scene` import if unused elsewhere

2. **Remove scene-level API endpoints**:
   - Delete `/routers/scene_autosave_router.py`
   - Delete `/routers/websocket.py` (scene WebSocket)
   - Remove from `main.py` router registration

3. **Remove scene-level services**:
   - Delete `/services/scene_service.py`
   - Delete `/services/yjs_persistence.py` (if scene-specific)
   - Remove scene-specific logic from shared services

4. **Database cleanup** (OPTIONAL - Keep for data retention):
   - Keep `scenes` table for reference/backup
   - Keep `scene_versions` for audit trail
   - Keep `scene_snapshots` for version history
   - Drop `scene_write_ops` (idempotency no longer needed)

**Verification**:
```bash
# 1. Check for Scene model usage
grep -r "from app.models.scene import Scene" backend/app --include="*.py"

# 2. Check for scene router usage
grep -r "scene_autosave_router\|scenes_router" backend/app --include="*.py"

# 3. Verify no active WebSocket connections
# Monitor /api/ws/scenes/* endpoint for 24 hours
```

**Impact**: MEDIUM (removes unused API endpoints, but risk of missing dependencies)

**Estimated Time**: 2-3 hours

### Phase 4: Database Table Removal (Optional)

**Prerequisites**:
- ✅ All backend scene code removed (Phase 3)
- ✅ Data retention policy decision made
- ✅ Backup of scene data created

**Decision Point**: Keep or remove Scene tables?

**Option A: Keep Tables (RECOMMENDED)**
- **Pros**: Data retention, audit trail, rollback capability
- **Cons**: Database bloat, maintenance burden
- **Use Case**: Reference data for support, legal compliance

**Option B: Archive and Drop**
- **Pros**: Clean database, reduced maintenance
- **Cons**: Irreversible, lose historical data
- **Use Case**: Confirmed no need for scene-level data

**If removing**:

```sql
-- 1. Backup data
pg_dump -t scenes -t scene_versions -t scene_snapshots -t scene_write_ops > scenes_backup.sql

-- 2. Drop tables (via Alembic migration)
-- Create migration: alembic revision -m "remove_scene_tables"
-- Migration down:
DROP TABLE scene_write_ops;
DROP TABLE scene_snapshots;
DROP TABLE scene_versions;
DROP TABLE scene_embeddings;
DROP TABLE scenes;
```

**Impact**: HIGH (irreversible data loss)

**Estimated Time**: 1 hour + testing

## Risk Assessment

### Low Risk Removals

| Component | Risk | Reason |
|-----------|------|--------|
| Frontend scene editor | ✅ None | Completely isolated, no dependencies |
| Test pages | ✅ None | Not used in production |
| Example components | ✅ None | Documentation only |

### Medium Risk Removals

| Component | Risk | Mitigation |
|-----------|------|------------|
| AI chat migration | ⚠️ Low | AI chat currently disabled, easy to test |
| Scene autosave router | ⚠️ Low | Check for any active clients first |
| Scene WebSocket | ⚠️ Medium | Monitor for 24h to ensure no connections |

### High Risk Removals

| Component | Risk | Mitigation |
|-----------|------|------------|
| Scene model deletion | ⚠️ High | Check ALL backend code for Scene imports |
| Database table drops | 🚨 Critical | Full backup, extensive testing, staged rollout |

## Dependencies Check

### Scripts WITHOUT content_blocks

These scripts are still in scene-level mode and would break:

```sql
SELECT script_id, title, created_at
FROM scripts
WHERE content_blocks IS NULL
ORDER BY created_at DESC;
```

**Action Required**: Ensure all production scripts have been migrated to script-level editing before removing scene infrastructure.

### Active Scene WebSocket Connections

Check if any users are still connected to scene-level WebSockets:

```python
# Add monitoring endpoint or check Redis
from app.services.websocket_manager import websocket_manager

active_scene_connections = [
    conn for conn in websocket_manager.connections
    if conn.room_id and not conn.room_id.startswith('script_')
]

print(f"Active scene-level connections: {len(active_scene_connections)}")
```

## Recommended Approach

### Conservative (RECOMMENDED)

**Timeline**: 3 phases over 2 weeks

1. **Week 1**: Remove frontend scene-level editor (Phase 1)
   - Risk: None
   - Benefit: Clean up ~3,000 lines of unused code

2. **Week 1**: Migrate AI chat to script.scene_summaries (Phase 2)
   - Risk: Low
   - Benefit: Unblock backend removal

3. **Week 2**: Monitor for scene-level activity
   - Check for any scene WebSocket connections
   - Verify all scripts have content_blocks
   - Confirm no scene autosave API usage

4. **Week 2**: Remove scene-level backend (Phase 3) - ONLY if checks pass
   - Risk: Medium
   - Benefit: Remove ~2,000 lines of backend code

5. **Future**: Keep database tables for audit/reference
   - Risk: None
   - Benefit: Data retention, rollback capability

### Aggressive (NOT RECOMMENDED YET)

Remove everything including database tables immediately.

**Why NOT recommended**:
- No confirmation all scripts migrated
- No monitoring of active connections
- Irreversible database changes
- Risk of breaking undiscovered dependencies

## Success Criteria

### Phase 1 Complete (Frontend Removal)
- ✅ Frontend builds without errors
- ✅ Script-level editor still works
- ✅ No broken imports or references

### Phase 2 Complete (AI Migration)
- ✅ AI chat loads scene context from script.scene_summaries
- ✅ AI summary generation saves to script.scene_summaries only
- ✅ No errors in AI endpoints

### Phase 3 Complete (Backend Removal)
- ✅ No scene-level API endpoints accessible
- ✅ No scene WebSocket connections active
- ✅ All backend tests pass
- ✅ Script-level editor fully functional

### Phase 4 Complete (Database Cleanup)
- ✅ Scene tables archived/backed up
- ✅ Database size reduced
- ✅ No foreign key violations
- ✅ All migrations applied successfully

## Files to Remove - Complete List

### Phase 1: Frontend (Safe - ~3,000 lines)

```
frontend/app/editor/page.tsx
frontend/components/screenplay-editor.tsx
frontend/components/screenplay-editor-with-autosave.tsx
frontend/hooks/use-yjs-collaboration.ts
frontend/app/test-collab/page.tsx
frontend/app/test-script-collab/page.tsx
frontend/components/screenplay-example.tsx
frontend/components/examples/autosave-example.tsx
frontend/components/collaborative-editor-example.tsx
frontend/components/collaboration-status-indicator.tsx (if scene-specific)
```

### Phase 3: Backend (After AI migration - ~2,000 lines)

```
backend/app/routers/scene_autosave_router.py
backend/app/routers/websocket.py
backend/app/services/scene_service.py
backend/app/services/yjs_persistence.py (if scene-specific)
```

### Phase 4: Database (Optional)

```sql
-- Via Alembic migration
DROP TABLE scene_write_ops;
DROP TABLE scene_snapshots;
DROP TABLE scene_versions;
DROP TABLE scene_embeddings;
DROP TABLE scenes;
```

## Answer to Original Question

**Q: "Are we at a point where we can begin removing the old code from the scene-level editor?"**

**A: Yes, with qualification:**

✅ **Frontend scene-level editor**: Remove immediately (safe, ~3,000 lines)
⚠️ **AI features**: Migrate first (1 hour work, low risk)
❌ **Backend infrastructure**: Wait until after AI migration and connection monitoring

**Immediate Action**: Start with Phase 1 (frontend removal) - this is safe and gives immediate cleanup benefits.

**Next Action**: Implement Phase 2 (AI migration) - required before backend can be removed.

**Future Action**: Phase 3 (backend removal) - only after confirming no scene-level activity for 1-2 weeks.

## Conclusion

The scene-level editor can be progressively removed over 2-3 phases:

1. **Immediate**: Frontend components (zero risk)
2. **This week**: AI feature migration (low risk)
3. **Next week**: Backend infrastructure (medium risk, requires monitoring)
4. **Optional**: Database cleanup (high risk, evaluate based on needs)

This phased approach minimizes risk while achieving the cleanup goal.
