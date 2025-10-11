# Next Steps: Phase 2.2 - Core Collaboration

**Prerequisites:** Phase 2.1 Complete ✅  
**Timeline:** Weeks 3-4  
**Goal:** Full real-time collaborative editing with persistence

---

## Phase 2.1 → 2.2 Transition

### What We Have Now (Phase 2.1) ✅

- ✅ WebSocket infrastructure
- ✅ Yjs document synchronization (in-memory)
- ✅ Connection management
- ✅ Presence/awareness tracking
- ✅ Status indicators
- ✅ Redis pub/sub (multi-server)

### What's Missing (Phase 2.2 Scope)

- ❌ Yjs updates **not persisted** to database
- ❌ Editor **not bound** to Yjs document
- ❌ No state recovery on reconnection
- ❌ No document history/versioning
- ❌ No compaction of old updates

---

## Phase 2.2 Implementation Plan

### Task 1: Yjs Persistence Service (Priority: Critical)

**File:** `backend/app/services/yjs_persistence.py`

**Purpose:** Save/load Yjs updates to/from PostgreSQL

**Key Methods:**
```python
class YjsPersistence:
    async def store_update(scene_id: UUID, update: bytes) -> UUID
    async def get_scene_state(scene_id: UUID) -> bytes
    async def get_updates_since(scene_id: UUID, since: datetime) -> List[bytes]
    async def compact_updates(scene_id: UUID, before: datetime)
```

**Integration Points:**
- WebSocket endpoint calls `store_update()` on every Yjs update
- Initial connection sends `get_scene_state()` to client
- Background task runs `compact_updates()` daily

**Estimated Time:** 4-6 hours

---

### Task 2: Bind Yjs to Screenplay Editor (Priority: Critical)

**Current Editor:** Slate-based (`components/screenplay-editor.tsx`)

**Options:**

**Option A: Use y-prosemirror** (Recommended if switching editors)
- More mature Yjs binding
- Better cursor sync
- Requires editor migration

**Option B: Custom Slate binding**
- Keep existing Slate editor
- Manual synchronization logic
- More control, more work

**Recommended Approach:** Evaluate editor migration cost vs custom binding

**Files to Create:**
```
frontend/
├── hooks/
│   └── use-yjs-slate-binding.ts          # Slate ↔ Yjs sync
└── components/
    └── collaborative-screenplay-editor.tsx  # Integrated editor
```

**Key Challenges:**
1. Bidirectional sync (Slate ↔ Yjs)
2. Cursor position mapping
3. Selection synchronization
4. Handling formatting (bold, italic, etc.)

**Estimated Time:** 8-12 hours

---

### Task 3: State Recovery on Reconnection (Priority: High)

**Scenario:** User disconnects, makes offline changes, reconnects

**Requirements:**
1. Queue local changes during disconnect
2. Merge with server state on reconnect
3. Resolve conflicts (Yjs handles this automatically)
4. Show user if they were offline

**Implementation:**
- Modify `useYjsCollaboration` hook
- Add offline queue (IndexedDB)
- Sync on reconnection
- Show "Offline changes syncing..." indicator

**Estimated Time:** 4-6 hours

---

### Task 4: Update WebSocket Endpoint for Persistence

**File:** `backend/app/routers/websocket.py`

**Changes:**
```python
@router.websocket("/ws/scenes/{scene_id}")
async def scene_collaboration_endpoint(...):
    # EXISTING: Connect, authenticate, verify access
    
    # NEW: Load initial state from database
    persistence = YjsPersistence(db)
    initial_state = await persistence.get_scene_state(scene_id)
    if initial_state:
        await websocket.send_bytes(initial_state)
    
    while True:
        message = await websocket.receive()
        
        if "bytes" in message:
            update_data = message["bytes"]
            
            # NEW: Persist to database
            await persistence.store_update(scene_id, update_data)
            
            # EXISTING: Broadcast to room
            await websocket_manager.broadcast_to_room(...)
```

**Estimated Time:** 2-3 hours

---

### Task 5: Background Compaction Job (Priority: Medium)

**Purpose:** Prevent unlimited growth of `scene_versions` table

**Strategy:**
1. Keep all updates for last 24 hours (real-time sync)
2. Compact older updates into periodic snapshots
3. Delete redundant individual updates

**Implementation:**
```python
# backend/app/services/compaction_job.py

async def compact_scene_updates():
    """
    Background job to compact old Yjs updates.
    Run daily via scheduler (e.g., APScheduler, Celery, or cron).
    """
    cutoff = datetime.utcnow() - timedelta(hours=24)
    
    for scene_id in get_active_scenes():
        persistence = YjsPersistence(db)
        await persistence.compact_updates(scene_id, before=cutoff)
```

**Scheduling Options:**
- APScheduler (in-process)
- Celery (distributed)
- Cron job calling API endpoint

**Estimated Time:** 3-4 hours

---

### Task 6: Testing & Validation (Priority: Critical)

**Test Scenarios:**

1. **Two-User Real-Time Editing**
   - Open same scene in two browsers
   - Type simultaneously
   - Verify changes appear in both
   - No conflicts or data loss

2. **Offline → Online Recovery**
   - Disconnect one client
   - Make changes offline
   - Reconnect
   - Verify changes sync correctly

3. **Server Restart**
   - Edit scene
   - Restart backend server
   - Reconnect
   - Verify state restored from database

4. **Large Document Performance**
   - Create scene with 10,000+ words
   - Test sync speed
   - Verify no lag or freezing

5. **Concurrent Edits at Same Position**
   - Two users edit same line simultaneously
   - Verify Yjs resolves correctly
   - No overwrites or corruption

**Estimated Time:** 6-8 hours

---

## Detailed Implementation Order

### Week 3: Core Functionality

**Days 1-2:** Yjs Persistence Service
- [ ] Create `YjsPersistence` class
- [ ] Implement `store_update()`
- [ ] Implement `get_scene_state()`
- [ ] Write unit tests
- [ ] Integrate with WebSocket endpoint

**Days 3-4:** Editor Binding
- [ ] Research Slate ↔ Yjs binding
- [ ] Decide on approach (custom vs migration)
- [ ] Implement bidirectional sync
- [ ] Test cursor synchronization
- [ ] Handle formatting preservation

**Day 5:** State Recovery
- [ ] Add offline queue to hook
- [ ] Implement reconnection logic
- [ ] Test disconnect/reconnect scenarios
- [ ] Add "Syncing..." indicators

### Week 4: Polish & Testing

**Days 1-2:** Compaction & Cleanup
- [ ] Implement compaction algorithm
- [ ] Create background job
- [ ] Test with large update history
- [ ] Monitor database size

**Days 3-4:** Integration Testing
- [ ] Two-user simultaneous editing
- [ ] Offline editing recovery
- [ ] Server restart recovery
- [ ] Performance testing

**Day 5:** Documentation & Handoff
- [ ] Update API documentation
- [ ] Write integration guide
- [ ] Create demo video
- [ ] Prepare for Phase 2.3

---

## Critical Dependencies

### Technical
- Phase 2.1 infrastructure working
- Database `scene_versions` table ready
- Redis operational (or single-server mode)

### Product
- Decision on Slate vs ProseMirror
- Acceptance criteria for conflict resolution
- Performance targets for large documents

### Resources
- Access to staging environment
- Test users for multi-user scenarios
- Monitoring tools setup

---

## Risk Mitigation

### Risk 1: Editor Binding Complexity
**Impact:** High  
**Probability:** Medium  
**Mitigation:**
- Start with simple text sync first
- Add formatting later
- Consider ProseMirror migration if Slate too complex

### Risk 2: State Synchronization Bugs
**Impact:** High  
**Probability:** Medium  
**Mitigation:**
- Extensive testing with edge cases
- Log all Yjs updates for debugging
- Feature flag for gradual rollout

### Risk 3: Performance Degradation
**Impact:** Medium  
**Probability:** Low  
**Mitigation:**
- Load testing before launch
- Database query optimization
- Compaction to prevent unbounded growth

---

## Success Criteria

**Phase 2.2 is complete when:**

- [ ] Two users can edit same scene simultaneously
- [ ] Changes sync in < 100ms (p95)
- [ ] Offline changes recover on reconnection
- [ ] Server restarts don't lose data
- [ ] Formatting preserved during sync
- [ ] No data corruption or conflicts
- [ ] Database size controlled via compaction
- [ ] All integration tests passing
- [ ] Documentation complete

---

## Open Questions

1. **Editor Choice:** Stick with Slate or migrate to ProseMirror?
   - **Recommendation:** Evaluate over 1 day, decide by end of Day 1

2. **Compaction Schedule:** How often to compact?
   - **Recommendation:** Daily at 3am for scenes inactive > 24h

3. **Update Size Limits:** Max size per Yjs update?
   - **Recommendation:** 1MB per update, handled at WebSocket level

4. **History Retention:** How long to keep individual updates?
   - **Recommendation:** 24h full detail, then compact to hourly snapshots

---

## Resources Needed

- **Development Time:** ~30-40 hours over 2 weeks
- **Testing Environment:** Staging with multi-server setup
- **Test Data:** Realistic screenplay scenes (various sizes)
- **Monitoring:** WebSocket metrics dashboard

---

## After Phase 2.2

**Phase 2.3: Presence & UX Polish (Week 5)**
- Cursor tracking
- Selection highlights
- Active user indicators
- Typing notifications
- Connection status refinements

**Phase 2.4: Migration & Rollout (Week 6)**
- Feature flags
- Gradual rollout
- Monitoring & alerts
- Production deployment

---

## Getting Started

**Immediate Next Steps:**

1. **Install dependencies** (if not done)
   ```bash
   cd backend && pip install -r requirements.txt
   cd frontend && npm install
   ```

2. **Start Redis** (if not running)
   ```bash
   brew services start redis  # or redis-server
   ```

3. **Test Phase 2.1**
   ```bash
   # Backend
   cd backend && uvicorn main:app --reload
   
   # Frontend
   cd frontend && npm run dev
   ```

4. **Create Phase 2.2 branch**
   ```bash
   git checkout -b feature/phase-2-2-core-collaboration
   ```

5. **Begin with Yjs Persistence**
   - Create `backend/app/services/yjs_persistence.py`
   - Start with `store_update()` method
   - Write tests first (TDD)

---

**Ready to start Phase 2.2? You've got a solid foundation from 2.1! 🚀**
