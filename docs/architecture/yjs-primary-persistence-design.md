# Yjs-Primary Persistence Architecture Design

**Document Version:** 1.0
**Date:** 2025-01-22
**Status:** Approved
**Author:** System Architect

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Design Principles](#design-principles)
4. [System Components](#system-components)
5. [Data Models](#data-models)
6. [Data Flow Diagrams](#data-flow-diagrams)
7. [API Specifications](#api-specifications)
8. [State Management](#state-management)
9. [Consistency Guarantees](#consistency-guarantees)
10. [Performance Characteristics](#performance-characteristics)
11. [Migration Strategy](#migration-strategy)
12. [Operational Procedures](#operational-procedures)
13. [Security Considerations](#security-considerations)
14. [Appendices](#appendices)

---

## Executive Summary

### Problem Statement

The current dual-write architecture creates consistency risks where Yjs CRDT updates and REST autosave operate independently, leading to:
- Data divergence on partial failures
- Undefined authority during conflicts
- Transaction boundary violations
- Silent data loss in conflict resolution

### Solution: Yjs-Primary Architecture

Establish **Yjs updates as the single source of truth** with REST serving as a periodic snapshot fallback mechanism. This eliminates dual-write consistency issues while preserving offline resilience.

### Key Benefits

- ✅ **Single Source of Truth**: Eliminates consistency ambiguity
- ✅ **CRDT Conflict Resolution**: No manual conflict handling needed
- ✅ **Simplified Architecture**: Removes CAS enforcement complexity
- ✅ **Offline Resilience**: REST snapshots provide fallback
- ✅ **Performance**: CRDT operations are O(1) for most edits

### Trade-offs Accepted

- ⚠️ **Yjs Dependency**: System relies on Yjs CRDT library
- ⚠️ **Binary Storage**: Debugging requires Yjs decoding
- ⚠️ **Compaction Needed**: Updates accumulate, require periodic compaction
- ⚠️ **Migration Complexity**: Existing data must be converted

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        WritersRoom System                        │
│                                                                  │
│  ┌────────────────┐         ┌──────────────────┐               │
│  │   Frontend     │         │    Backend       │               │
│  │   (Next.js)    │◄───────►│   (FastAPI)      │               │
│  │                │  WebSocket │                │               │
│  │  ┌──────────┐  │         │  ┌────────────┐  │               │
│  │  │ Y.Doc    │  │         │  │ YDoc       │  │               │
│  │  │ (CRDT)   │  │         │  │ (y-py)     │  │               │
│  │  └──────────┘  │         │  └────────────┘  │               │
│  │       │        │         │        │         │               │
│  │       │ Yjs    │         │        │ Yjs    │               │
│  │       │ Updates│         │        │ Updates│               │
│  │       ▼        │         │        ▼         │               │
│  │  ┌──────────┐  │         │  ┌────────────┐  │               │
│  │  │ Provider │  │         │  │Persistence │  │               │
│  │  └──────────┘  │         │  └────────────┘  │               │
│  └────────────────┘         │        │         │               │
│                              │        ▼         │               │
│                              │  ┌────────────┐  │               │
│                              │  │PostgreSQL  │  │               │
│                              │  │            │  │               │
│                              │  │scene_      │  │               │
│                              │  │versions    │  │  PRIMARY      │
│                              │  │(Yjs binary)│◄─┼─ SOURCE OF   │
│                              │  └────────────┘  │  TRUTH        │
│                              │        │         │               │
│                              │        │ Snapshot│               │
│                              │        │ Worker  │               │
│                              │        ▼         │               │
│                              │  ┌────────────┐  │               │
│                              │  │  scenes    │  │               │
│                              │  │  (JSON)    │  │  FALLBACK     │
│                              │  │            │◄─┼─ SNAPSHOT     │
│                              │  └────────────┘  │  ONLY         │
│                              └──────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

### Architecture Layers

**Layer 1: Real-Time Collaboration (Primary)**
- Yjs CRDT operations via WebSocket
- Binary update storage in `scene_versions`
- Append-only event log
- Multi-server coordination via Redis

**Layer 2: Snapshot Fallback (Secondary)**
- Periodic JSON snapshots in `scenes` table
- Read-only from application perspective
- Emergency offline fallback
- Audit trail and debugging aid

**Layer 3: Coordination**
- Redis pub/sub for multi-server broadcast
- Background workers for compaction
- Health monitoring and divergence detection

---

## Design Principles

### 1. Single Source of Truth (SSOT)

**Principle:** Yjs updates in `scene_versions` are the authoritative representation of scene content.

**Implications:**
- All reads derive from Yjs state
- REST snapshots are computed, not authoritative
- Conflicts resolved by CRDT, not application logic

### 2. Append-Only Event Log

**Principle:** `scene_versions` maintains an immutable history of all edits.

**Implications:**
- Never delete or modify existing updates
- Compaction creates new entries, marks old as compacted
- Enables time-travel debugging and audit trails

### 3. Eventual Consistency

**Principle:** REST snapshots eventually reflect Yjs state, but may lag.

**Implications:**
- Snapshots updated periodically (every 5 minutes)
- Temporary inconsistency is acceptable
- Divergence detection alerts on prolonged inconsistency

### 4. Graceful Degradation

**Principle:** System remains functional even if components fail.

**Implications:**
- Redis failure → single-server mode
- Yjs failure → REST fallback for offline users
- Snapshot failure → system continues with stale snapshots

### 5. Performance Isolation

**Principle:** Real-time operations don't block on snapshot creation.

**Implications:**
- Snapshots created asynchronously
- Compaction runs in background workers
- No blocking operations in WebSocket loop

---

## System Components

### 4.1 Yjs Document Manager

**Responsibility:** Manage Yjs Y.Doc lifecycle and state.

**Location:**
- Frontend: `frontend/hooks/use-yjs-collaboration.ts`
- Backend: `backend/app/routers/websocket.py`

**Key Operations:**
- Initialize Y.Doc per scene
- Apply incoming updates
- Extract state snapshots
- Encode/decode updates

**State Management:**
```typescript
// Frontend Y.Doc lifecycle
const doc = new Y.Doc(); // Per scene, persistent across re-renders
const provider = new WebsocketProvider(wsUrl, sceneId, doc);

// Backend Y.Doc lifecycle
ydoc = YDoc() # Per WebSocket connection
await persistence.load_persisted_updates(scene_id, ydoc)
# Apply updates as they arrive
Y.apply_update(ydoc, update)
```

### 4.2 Yjs Persistence Service

**Responsibility:** Store and retrieve Yjs updates from database.

**Location:** `backend/app/services/yjs_persistence.py`

**Interface:**
```python
class YjsPersistence:
    async def store_update(self, scene_id: UUID, update: bytes) -> UUID:
        """Store a single Yjs update. Returns version_id."""

    async def load_persisted_updates(self, scene_id: UUID, ydoc: YDoc) -> int:
        """Load all updates and apply to ydoc. Returns count applied."""

    async def get_scene_state(self, scene_id: UUID) -> bytes:
        """Get merged Yjs state as single update."""

    async def get_scene_snapshot(self, scene_id: UUID) -> dict:
        """Convert Yjs state to Slate JSON format."""

    async def compact_updates(self, scene_id: UUID, before: datetime) -> int:
        """Merge old updates into compacted snapshot. Returns count merged."""
```

**Storage Model:**
```sql
CREATE TABLE scene_versions (
    version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id UUID NOT NULL REFERENCES scenes(scene_id),
    yjs_update BYTEA NOT NULL,
    is_compacted BOOLEAN DEFAULT FALSE,
    compacted_count INT DEFAULT 1,  -- Number of updates merged
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(user_id),

    INDEX idx_scene_versions_scene_id_created_at (scene_id, created_at)
);
```

### 4.3 Snapshot Service

**Responsibility:** Create periodic REST snapshots from Yjs state.

**Location:** `backend/app/services/yjs_snapshot_service.py`

**Interface:**
```python
class YjsSnapshotService:
    async def create_snapshot(
        self,
        scene_id: UUID,
        source: SnapshotSource = SnapshotSource.YJS
    ) -> SceneSnapshot:
        """Create REST snapshot from current Yjs state."""

    async def schedule_periodic_snapshots(self, interval_minutes: int = 5):
        """Background task for periodic snapshot creation."""

    async def validate_snapshot_freshness(self, scene_id: UUID) -> bool:
        """Check if snapshot is up-to-date with Yjs state."""
```

**Snapshot Metadata:**
```python
class SnapshotSource(str, Enum):
    YJS = "yjs"           # Derived from Yjs state
    MANUAL = "manual"     # User-triggered snapshot
    IMPORT = "import"     # From FDX import
    MIGRATED = "migrated" # Converted from old REST data
    COMPACTED = "compacted" # From Yjs compaction
```

### 4.4 Yjs-to-Slate Converter

**Responsibility:** Convert between Yjs CRDT representation and Slate JSON format.

**Location:** `backend/app/services/yjs_to_slate_converter.py`

**Interface:**
```python
class YjsToSlateConverter:
    def convert_to_slate(self, ydoc: YDoc) -> dict:
        """Extract Slate JSON from Y.Doc."""

    def populate_from_slate(self, ydoc: YDoc, slate_json: dict):
        """Populate Y.Doc from Slate JSON."""

    def validate_round_trip(self, original: dict) -> bool:
        """Verify lossless conversion."""
```

**Conversion Strategy:**
```
Yjs Y.XmlFragment (screenplay structure)
    ↓ traverse
Slate JSON blocks (scene elements)
    ↓ preserve
{
  "blocks": [
    {"type": "scene-heading", "text": "INT. OFFICE - DAY"},
    {"type": "action", "text": "John enters."},
    {"type": "dialogue", "character": "JOHN", "text": "Hello."}
  ]
}
```

### 4.5 Divergence Detector

**Responsibility:** Monitor consistency between Yjs and REST representations.

**Location:** `backend/app/services/divergence_detector.py`

**Interface:**
```python
class DivergenceDetector:
    async def check_scene_consistency(
        self,
        scene_id: UUID
    ) -> DivergenceReport:
        """Compare Yjs state vs REST snapshot."""

    async def auto_repair_divergence(
        self,
        scene_id: UUID,
        strategy: RepairStrategy = RepairStrategy.PREFER_YJS
    ) -> bool:
        """Attempt to fix divergence automatically."""
```

**Divergence Report:**
```python
@dataclass
class DivergenceReport:
    diverged: bool
    scene_id: UUID
    yjs_block_count: int
    rest_block_count: int
    yjs_checksum: str
    rest_checksum: str
    diff: Optional[dict]  # Detailed diff if diverged
    severity: DivergenceSeverity  # MINOR, MODERATE, CRITICAL
    recommended_action: str
```

### 4.6 Compaction Worker

**Responsibility:** Merge old Yjs updates to prevent unbounded growth.

**Location:** `backend/app/tasks/yjs_compaction_worker.py`

**Strategy:**
```python
class CompactionStrategy:
    # Compact updates older than threshold
    MIN_UPDATE_COUNT = 100  # Don't compact if fewer updates
    COMPACTION_AGE = timedelta(hours=24)  # Compact updates >24h old
    RETENTION_PERIOD = timedelta(days=30)  # Delete compacted after 30d

    async def compact_scene(self, scene_id: UUID) -> CompactionResult:
        """
        1. Get updates older than COMPACTION_AGE
        2. If count >= MIN_UPDATE_COUNT:
           - Build YDoc from updates
           - Encode as single update
           - Store with is_compacted=True, compacted_count=N
           - Mark originals as compacted_by=new_version_id
        3. Schedule deletion of originals after RETENTION_PERIOD
        """
```

---

## Data Models

### 5.1 Scene Versions (Primary Storage)

**Table:** `scene_versions`

```sql
CREATE TABLE scene_versions (
    -- Identity
    version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id UUID NOT NULL REFERENCES scenes(scene_id) ON DELETE CASCADE,

    -- Yjs Data (PRIMARY SOURCE OF TRUTH)
    yjs_update BYTEA NOT NULL,

    -- Compaction Metadata
    is_compacted BOOLEAN DEFAULT FALSE,
    compacted_count INT DEFAULT 1,
    compacted_by UUID REFERENCES scene_versions(version_id),

    -- Audit Trail
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(user_id),

    -- Constraints
    CONSTRAINT yjs_update_not_empty CHECK (length(yjs_update) > 0),
    CONSTRAINT compacted_count_positive CHECK (compacted_count > 0)
);

-- Indexes for performance
CREATE INDEX idx_scene_versions_scene_created
    ON scene_versions(scene_id, created_at);

CREATE INDEX idx_scene_versions_compacted
    ON scene_versions(scene_id, is_compacted, created_at)
    WHERE is_compacted = FALSE;
```

**Key Characteristics:**
- **Append-only**: Never UPDATE or DELETE, only INSERT
- **Immutable**: Updates are never modified after insertion
- **Ordered**: created_at determines replay order
- **Compactable**: Old updates merged, originals retained for audit

### 5.2 Scenes (Snapshot Storage)

**Table:** `scenes`

```sql
ALTER TABLE scenes
    -- Existing columns (unchanged)
    -- scene_id, script_id, position, scene_heading, etc.

    -- New metadata columns
    ADD COLUMN snapshot_source VARCHAR(20) DEFAULT 'rest'
        CHECK (snapshot_source IN ('yjs', 'manual', 'import', 'migrated', 'compacted')),
    ADD COLUMN snapshot_at TIMESTAMP DEFAULT NOW(),
    ADD COLUMN yjs_derived BOOLEAN DEFAULT FALSE,
    ADD COLUMN yjs_checksum VARCHAR(64),  -- SHA256 of Yjs state for comparison

    -- Version becomes metadata (not enforced by CAS)
    ADD COLUMN version_metadata_only INT DEFAULT 0;

-- Note: Keep existing 'version' column for backward compatibility
-- but don't enforce it in CAS operations when USE_YJS_PRIMARY=true
```

**Semantic Change:**
```
BEFORE (Dual-Write):
- scenes.content_blocks = SOURCE OF TRUTH
- scenes.version = ENFORCED via CAS
- scene_versions = auxiliary/optional

AFTER (Yjs-Primary):
- scene_versions.yjs_update = SOURCE OF TRUTH
- scenes.content_blocks = DERIVED SNAPSHOT (fallback)
- scenes.version = METADATA ONLY (not enforced)
```

### 5.3 Snapshot Metadata

**Purpose:** Track snapshot creation history and freshness.

```sql
CREATE TABLE scene_snapshot_metadata (
    snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id UUID NOT NULL REFERENCES scenes(scene_id),

    -- Snapshot details
    snapshot_source VARCHAR(20) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(user_id),

    -- Freshness tracking
    yjs_version_count INT NOT NULL,  -- Number of Yjs updates at snapshot time
    yjs_latest_version_id UUID REFERENCES scene_versions(version_id),
    yjs_checksum VARCHAR(64) NOT NULL,

    -- Performance metrics
    generation_time_ms INT,
    snapshot_size_bytes INT,

    INDEX idx_snapshot_metadata_scene (scene_id, created_at DESC)
);
```

---

## Data Flow Diagrams

### 6.1 User Edit Flow (Real-Time Path)

```
┌─────────────┐
│   User      │
│   Types     │
└──────┬──────┘
       │
       │ 1. Edit in Slate
       ▼
┌─────────────────────────┐
│  Frontend Y.Doc         │
│  (Local CRDT state)     │
└──────┬──────────────────┘
       │
       │ 2. Y.Doc generates update
       ▼
┌─────────────────────────┐
│  WebSocket Provider     │
│  (y-websocket)          │
└──────┬──────────────────┘
       │
       │ 3. Binary Yjs update via WebSocket
       ▼
┌─────────────────────────┐
│  Backend WebSocket      │
│  (FastAPI + y-py)       │
└──────┬──────────────────┘
       │
       │ 4. Apply to server Y.Doc
       ├──────────────┬─────────────┐
       │              │             │
       ▼              ▼             ▼
┌──────────┐  ┌──────────┐  ┌──────────────┐
│ Persist  │  │Broadcast │  │  Broadcast   │
│ to DB    │  │ to Peers │  │  via Redis   │
│          │  │ (local)  │  │ (multi-srv)  │
└────┬─────┘  └──────────┘  └──────────────┘
     │
     │ 5. INSERT into scene_versions
     ▼
┌─────────────────────────────┐
│   PostgreSQL                │
│   scene_versions            │
│   (Append-only Yjs updates) │
└─────────────────────────────┘
     │
     │ 6. Snapshot worker (async, periodic)
     ▼
┌─────────────────────────────┐
│   scenes table              │
│   (JSON snapshot, fallback) │
└─────────────────────────────┘
```

**Key Points:**
- Steps 1-5 happen in <50ms (real-time)
- Step 6 happens asynchronously (every 5 minutes)
- No blocking on snapshot creation
- CAS enforcement removed (no version checking)

### 6.2 Scene Load Flow

```
┌─────────────┐
│  User       │
│  Opens Scene│
└──────┬──────┘
       │
       │ 1. GET /api/scripts/{id}/scenes
       ▼
┌─────────────────────────────┐
│  Backend API                │
│  (Scene Router)             │
└──────┬──────────────────────┘
       │
       │ 2. Query database
       ▼
┌─────────────────────────────┐
│  Check scene_versions       │
│  for Yjs data existence     │
└──────┬──────────────────────┘
       │
       ├─── Has Yjs data? ───┬─── No ───┐
       │                      │          │
       │ Yes                  │          ▼
       │                      │    ┌─────────────────┐
       │                      │    │ Return REST     │
       │                      │    │ snapshot        │
       │                      │    │ (fallback)      │
       │                      │    │ source='rest'   │
       │                      │    └─────────────────┘
       │                      │
       ▼                      │
┌─────────────────────────┐  │
│ Load all Yjs updates    │  │
│ from scene_versions     │  │
└──────┬──────────────────┘  │
       │                      │
       │ 3. Build Y.Doc      │
       ▼                      │
┌─────────────────────────┐  │
│ Replay updates          │  │
│ Y.apply_update(...)     │  │
└──────┬──────────────────┘  │
       │                      │
       │ 4. Extract state    │
       ▼                      │
┌─────────────────────────┐  │
│ Convert Yjs → Slate     │  │
│ JSON format             │  │
└──────┬──────────────────┘  │
       │                      │
       │ 5. Return to client │
       ▼                      ▼
┌─────────────────────────────────┐
│  Frontend receives scene data   │
│  source='yjs' or 'rest'         │
│  Initialize Y.Doc               │
│  Connect WebSocket              │
└─────────────────────────────────┘
```

**Key Points:**
- Prefer Yjs data if available
- Fall back to REST snapshot if no Yjs data (backward compatibility)
- Include `source` field in response for transparency
- WebSocket connection syncs after initial load

### 6.3 Snapshot Creation Flow (Background Worker)

```
┌─────────────────────────────┐
│  Background Worker          │
│  (Periodic: every 5 min)    │
└──────┬──────────────────────┘
       │
       │ 1. Enumerate scenes needing snapshots
       ▼
┌─────────────────────────────┐
│  Query: scenes where        │
│  snapshot_at < NOW() - 5min │
│  AND has scene_versions     │
└──────┬──────────────────────┘
       │
       │ 2. For each scene
       ▼
┌─────────────────────────────┐
│  Load Yjs updates           │
│  Build Y.Doc                │
└──────┬──────────────────────┘
       │
       │ 3. Convert to Slate JSON
       ▼
┌─────────────────────────────┐
│  YjsToSlateConverter        │
│  Extract screenplay blocks  │
└──────┬──────────────────────┘
       │
       │ 4. Compute checksum
       ▼
┌─────────────────────────────┐
│  SHA256(Yjs state)          │
└──────┬──────────────────────┘
       │
       │ 5. Update scenes table
       ▼
┌─────────────────────────────┐
│  UPDATE scenes SET          │
│    content_blocks = $1,     │
│    snapshot_source = 'yjs', │
│    snapshot_at = NOW(),     │
│    yjs_checksum = $2        │
│  WHERE scene_id = $3        │
└──────┬──────────────────────┘
       │
       │ 6. Record metadata
       ▼
┌─────────────────────────────┐
│  INSERT INTO                │
│  scene_snapshot_metadata    │
└─────────────────────────────┘
```

**Key Points:**
- Non-blocking operation
- Runs independently of user edits
- Provides audit trail via metadata table
- Enables offline fallback

### 6.4 Compaction Flow

```
┌─────────────────────────────┐
│  Compaction Worker          │
│  (Periodic: daily)          │
└──────┬──────────────────────┘
       │
       │ 1. Find scenes with >100 updates older than 24h
       ▼
┌─────────────────────────────┐
│  Query: scene_versions      │
│  WHERE created_at < NOW()-24h│
│  GROUP BY scene_id          │
│  HAVING COUNT(*) > 100      │
└──────┬──────────────────────┘
       │
       │ 2. For each qualifying scene
       ▼
┌─────────────────────────────┐
│  Load old updates           │
│  (created_at < threshold)   │
└──────┬──────────────────────┘
       │
       │ 3. Build Y.Doc from updates
       ▼
┌─────────────────────────────┐
│  YDoc()                     │
│  for upd in updates:        │
│    Y.apply_update(ydoc, upd)│
└──────┬──────────────────────┘
       │
       │ 4. Encode as single update
       ▼
┌─────────────────────────────┐
│  compacted_update =         │
│    Y.encode_state_as_update(│
│      ydoc                   │
│    )                        │
└──────┬──────────────────────┘
       │
       │ 5. Store compacted version
       ▼
┌─────────────────────────────┐
│  INSERT INTO scene_versions │
│    (scene_id, yjs_update,   │
│     is_compacted=TRUE,      │
│     compacted_count=N)      │
└──────┬──────────────────────┘
       │
       │ 6. Mark originals as compacted
       ▼
┌─────────────────────────────┐
│  UPDATE scene_versions      │
│  SET compacted_by = $new_id │
│  WHERE version_id IN (...)  │
└──────┬──────────────────────┘
       │
       │ 7. Schedule deletion (after retention)
       ▼
┌─────────────────────────────┐
│  DELETE FROM scene_versions │
│  WHERE compacted_by IS NOT  │
│    NULL                     │
│  AND created_at < NOW()-30d │
└─────────────────────────────┘
```

**Key Points:**
- Preserves complete history temporarily
- Reduces database bloat over time
- Improves load performance for old scenes
- Maintains audit trail via compaction metadata

---

## API Specifications

### 7.1 Scene Retrieval API

**Endpoint:** `GET /api/scripts/{script_id}/scenes`

**Response Schema:**
```json
{
  "scenes": [
    {
      "sceneUUID": "uuid-v4",
      "slugline": "INT. OFFICE - DAY",
      "sceneIndex": 0,
      "version": 42,  // Metadata only, not enforced
      "content": {
        "blocks": [...]  // Slate JSON format
      },
      "metadata": {
        "source": "yjs",  // 'yjs' | 'rest' | 'migrated'
        "snapshot_at": "2025-01-22T10:30:00Z",
        "yjs_update_count": 156,
        "last_modified": "2025-01-22T10:35:42Z"
      }
    }
  ]
}
```

**Implementation:**
```python
@router.get("/{script_id}/scenes")
async def get_script_scenes(
    script_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Verify access
    await validate_script_access(script_id, current_user.user_id, db)

    # Get scenes
    scenes = await db.execute(
        select(Scene).where(Scene.script_id == script_id).order_by(Scene.position)
    )

    result = []
    for scene in scenes.scalars():
        # Check if Yjs data exists
        has_yjs = await yjs_persistence.has_updates(scene.scene_id)

        if has_yjs:
            # Derive from Yjs (preferred)
            snapshot = await yjs_persistence.get_scene_snapshot(scene.scene_id)
            update_count = await yjs_persistence.get_update_count(scene.scene_id)
            source = "yjs"
            content = snapshot
        else:
            # Use REST snapshot (fallback)
            content = scene.content_blocks
            update_count = 0
            source = scene.snapshot_source or "rest"

        result.append({
            "sceneUUID": str(scene.scene_id),
            "slugline": scene.scene_heading,
            "sceneIndex": scene.position,
            "version": scene.version,  // Metadata
            "content": {"blocks": content},
            "metadata": {
                "source": source,
                "snapshot_at": scene.snapshot_at.isoformat() if scene.snapshot_at else None,
                "yjs_update_count": update_count,
                "last_modified": scene.updated_at.isoformat()
            }
        })

    return {"scenes": result}
```

### 7.2 Snapshot Creation API

**Endpoint:** `POST /api/scenes/{scene_id}/snapshot`

**Purpose:** Manually trigger snapshot creation (admin/debugging tool)

**Request:**
```json
{
  "force": false,  // Create even if recent snapshot exists
  "validate": true  // Compare Yjs vs current REST snapshot
}
```

**Response:**
```json
{
  "snapshot_id": "uuid-v4",
  "scene_id": "uuid-v4",
  "source": "yjs",
  "created_at": "2025-01-22T10:40:00Z",
  "yjs_update_count": 156,
  "generation_time_ms": 45,
  "snapshot_size_bytes": 12456,
  "validation": {
    "passed": true,
    "diverged": false,
    "checksum_match": true
  }
}
```

**Implementation:**
```python
@router.post("/{scene_id}/snapshot")
async def create_scene_snapshot(
    scene_id: UUID,
    request: SnapshotRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Verify access (admin or owner)
    await validate_scene_access(scene_id, current_user.user_id, require_admin=True)

    # Check if recent snapshot exists
    if not request.force:
        recent = await snapshot_service.get_latest_snapshot_age(scene_id)
        if recent and recent < timedelta(minutes=5):
            raise HTTPException(
                status_code=400,
                detail=f"Recent snapshot exists (age: {recent}). Use force=true to override."
            )

    # Create snapshot
    start_time = time.time()
    snapshot_result = await snapshot_service.create_snapshot(scene_id)
    generation_time = int((time.time() - start_time) * 1000)

    # Validate if requested
    validation_result = None
    if request.validate:
        validation_result = await divergence_detector.check_scene_consistency(scene_id)

    return {
        "snapshot_id": str(snapshot_result.snapshot_id),
        "scene_id": str(scene_id),
        "source": snapshot_result.source,
        "created_at": snapshot_result.created_at.isoformat(),
        "yjs_update_count": snapshot_result.yjs_version_count,
        "generation_time_ms": generation_time,
        "snapshot_size_bytes": snapshot_result.snapshot_size_bytes,
        "validation": validation_result.dict() if validation_result else None
    }
```

### 7.3 Health Check API

**Endpoint:** `GET /api/health/persistence`

**Response:**
```json
{
  "status": "healthy",  // 'healthy' | 'degraded' | 'unhealthy'
  "yjs_persistence": {
    "operational": true,
    "avg_load_time_ms": 45,
    "scenes_with_updates": 1523
  },
  "snapshot_service": {
    "operational": true,
    "snapshots_behind_threshold": 12,
    "avg_snapshot_age_minutes": 4.2
  },
  "divergence_detection": {
    "enabled": true,
    "divergence_rate": 0.002,  // 0.2%
    "scenes_diverged": 3
  },
  "compaction": {
    "last_run": "2025-01-22T02:00:00Z",
    "scenes_compacted": 45,
    "storage_saved_mb": 234
  }
}
```

---

## State Management

### 8.1 Scene State Lifecycle

```
┌─────────────┐
│   CREATED   │  Initial state (from FDX import or manual)
└──────┬──────┘  - No Yjs updates yet
       │          - Only REST snapshot exists
       │ User connects via WebSocket
       ▼
┌─────────────┐
│YJS_INITIAL  │  First Yjs update stored
└──────┬──────┘  - scene_versions: 1 entry
       │          - Yjs becomes authoritative
       │ Background snapshot worker
       ▼
┌─────────────┐
│ YJS_SYNCED  │  REST snapshot created from Yjs
└──────┬──────┘  - scenes.snapshot_source = 'yjs'
       │          - scenes.yjs_derived = true
       │ Continuous edits
       ▼
┌─────────────┐
│YJS_ACTIVE   │  Normal operation state
└──────┬──────┘  - Multiple Yjs updates
       │          - Periodic snapshots
       │ Time passes (>24h)
       ▼
┌─────────────┐
│YJS_COMPACTED│  Old updates merged
└──────┬──────┘  - Compacted update stored
       │          - Original updates marked
       │ Retention period expires
       ▼
┌─────────────┐
│YJS_ARCHIVED │  Historical updates pruned
└─────────────┘  - Only compacted updates remain
                  - Recent updates still append-only
```

### 8.2 Snapshot Freshness States

```python
class SnapshotFreshness(str, Enum):
    FRESH = "fresh"          # <5 minutes old
    STALE = "stale"          # 5-30 minutes old
    VERY_STALE = "very_stale"  # >30 minutes old
    NEVER_SNAPSHOTTED = "never"  # No snapshot exists

def get_snapshot_freshness(snapshot_at: datetime) -> SnapshotFreshness:
    if snapshot_at is None:
        return SnapshotFreshness.NEVER_SNAPSHOTTED

    age = datetime.utcnow() - snapshot_at

    if age < timedelta(minutes=5):
        return SnapshotFreshness.FRESH
    elif age < timedelta(minutes=30):
        return SnapshotFreshness.STALE
    else:
        return SnapshotFreshness.VERY_STALE
```

---

## Consistency Guarantees

### 9.1 Strong Consistency (Yjs Path)

**Guarantee:** All users connected via WebSocket see eventually consistent state via CRDT.

**Mechanism:**
- Yjs Y.Doc maintains causal consistency
- Updates applied in causal order
- Concurrent edits merged deterministically
- All replicas converge to same state

**Trade-off:** Requires active WebSocket connection

### 9.2 Eventual Consistency (Snapshot Path)

**Guarantee:** REST snapshots eventually reflect Yjs state within snapshot interval.

**Mechanism:**
- Background worker creates snapshots every 5 minutes
- Snapshots may lag behind real-time Yjs state
- Divergence detection alerts on prolonged inconsistency

**Trade-off:** Snapshots may be stale by up to 5 minutes

### 9.3 Consistency During Transition

**Scenario:** System transitioning from dual-write to Yjs-primary

**Guarantee:** No data loss during transition

**Mechanism:**
- Feature flag controls behavior
- When flag=false: Dual-write (old behavior)
- When flag=true: Yjs-primary (new behavior)
- Migration script backfills Yjs data for existing scenes

### 9.4 Recovery Consistency

**Scenario:** Server crash or network partition

**Guarantee:** Yjs state recoverable from database

**Mechanism:**
- All Yjs updates persisted before broadcast (after fix)
- Replay all updates to reconstruct state
- Compacted updates serve as checkpoints

---

## Performance Characteristics

### 10.1 Write Performance

**Real-Time Path (Yjs):**
- **Latency:** <50ms p95 (local edit to peer receive)
- **Throughput:** 1000+ edits/sec per scene
- **Bottleneck:** Database insert (mitigated by batching)

**Snapshot Path (REST):**
- **Latency:** Async, non-blocking
- **Frequency:** Every 5 minutes
- **Duration:** ~100-500ms per snapshot

### 10.2 Read Performance

**Scene Load (Yjs):**
- **Cold start:** 100ms + (updates × 0.1ms)
  - 100 updates: ~110ms
  - 1000 updates: ~200ms
  - 10000 updates: ~1100ms (needs compaction)
- **With compaction:** <100ms p95

**Scene Load (REST fallback):**
- **Latency:** <20ms (single DB query)

### 10.3 Storage Characteristics

**Yjs Updates:**
- **Growth rate:** ~200 bytes per edit on average
- **100 edits:** ~20KB
- **10000 edits:** ~2MB (pre-compaction)

**After compaction:**
- **10000 edits → 1 compacted update:** ~100KB
- **Compression ratio:** ~20:1

---

## Migration Strategy

### 11.1 Migration Phases

**Phase 0: Pre-Migration (Week 0)**
- [ ] Deploy monitoring and divergence detection
- [ ] Run dual-write with divergence alerts
- [ ] Collect baseline metrics
- [ ] Validate migration scripts in staging

**Phase 1: Backfill (Week 1)**
- [ ] Run migration script for existing scenes
- [ ] Convert REST snapshots → initial Yjs updates
- [ ] Verify lossless conversion
- [ ] Mark scenes as migrated

**Phase 2: Feature Flag Rollout (Week 2-3)**
- [ ] Enable `USE_YJS_PRIMARY` for internal team (5 users)
- [ ] Monitor divergence rate (<0.1% threshold)
- [ ] Expand to beta users (5%)
- [ ] Gradual rollout: 25% → 50% → 100%

**Phase 3: Cleanup (Week 4)**
- [ ] Remove dual-write code paths
- [ ] Deploy compaction workers
- [ ] Remove feature flags
- [ ] Update documentation

### 11.2 Migration Script

**Location:** `backend/scripts/migrate_rest_to_yjs.py`

**Usage:**
```bash
# Dry run (no changes)
python scripts/migrate_rest_to_yjs.py --dry-run

# Migrate specific script
python scripts/migrate_rest_to_yjs.py --script-id=<uuid>

# Migrate all scenes
python scripts/migrate_rest_to_yjs.py --all

# Verify migration
python scripts/migrate_rest_to_yjs.py --verify-only
```

**Algorithm:**
```python
async def migrate_scene(scene_id: UUID, dry_run: bool = False):
    """
    Convert REST snapshot to initial Yjs update.
    """
    # 1. Load scene from database
    scene = await db.get(Scene, scene_id)
    if not scene:
        raise ValueError(f"Scene {scene_id} not found")

    # 2. Check if already migrated
    existing_updates = await yjs_persistence.get_update_count(scene_id)
    if existing_updates > 0:
        logger.info(f"Scene {scene_id} already has {existing_updates} Yjs updates, skipping")
        return MigrationResult.SKIPPED

    # 3. Convert REST blocks to Yjs
    ydoc = YDoc()
    try:
        yjs_to_slate_converter.populate_from_slate(ydoc, scene.content_blocks)
    except Exception as e:
        logger.error(f"Failed to convert scene {scene_id}: {e}")
        return MigrationResult.FAILED

    # 4. Encode as initial Yjs update
    initial_update = Y.encode_state_as_update(ydoc)

    # 5. Verify round-trip conversion
    ydoc_verify = YDoc()
    Y.apply_update(ydoc_verify, initial_update)
    converted_back = yjs_to_slate_converter.convert_to_slate(ydoc_verify)

    if converted_back != scene.content_blocks:
        logger.error(f"Round-trip conversion failed for scene {scene_id}")
        return MigrationResult.CONVERSION_ERROR

    if dry_run:
        logger.info(f"[DRY RUN] Would migrate scene {scene_id}, update size: {len(initial_update)} bytes")
        return MigrationResult.SUCCESS_DRY_RUN

    # 6. Store initial update
    version_id = await yjs_persistence.store_update(
        scene_id,
        initial_update,
        created_by=MIGRATION_USER_ID
    )

    # 7. Mark scene as migrated
    await db.execute(
        update(Scene)
        .where(Scene.scene_id == scene_id)
        .values(
            snapshot_source='migrated',
            yjs_derived=True,
            snapshot_at=datetime.utcnow()
        )
    )
    await db.commit()

    logger.info(f"Successfully migrated scene {scene_id}, version_id: {version_id}")
    return MigrationResult.SUCCESS
```

### 11.3 Validation Procedures

**Pre-Migration Validation:**
```python
async def validate_migration_readiness():
    """Verify system is ready for migration."""
    checks = []

    # Check 1: Database schema up-to-date
    has_metadata_cols = await check_schema_version()
    checks.append(("Schema", has_metadata_cols))

    # Check 2: Yjs persistence service operational
    can_persist = await yjs_persistence.health_check()
    checks.append(("Yjs Persistence", can_persist))

    # Check 3: Conversion library working
    can_convert = await test_slate_to_yjs_conversion()
    checks.append(("Slate<->Yjs Conversion", can_convert))

    # Check 4: Background workers configured
    workers_configured = await check_worker_configuration()
    checks.append(("Background Workers", workers_configured))

    all_passed = all(result for _, result in checks)
    return ValidationReport(checks=checks, ready=all_passed)
```

**Post-Migration Validation:**
```python
async def validate_migration_success(scene_id: UUID):
    """Verify scene was migrated correctly."""
    # 1. Check Yjs data exists
    has_updates = await yjs_persistence.has_updates(scene_id)
    assert has_updates, "No Yjs updates found after migration"

    # 2. Load Yjs state
    yjs_snapshot = await yjs_persistence.get_scene_snapshot(scene_id)

    # 3. Load REST snapshot
    scene = await db.get(Scene, scene_id)

    # 4. Compare
    assert yjs_snapshot == scene.content_blocks, "Yjs and REST snapshots differ"

    # 5. Check metadata
    assert scene.snapshot_source == 'migrated', "Snapshot source not set"
    assert scene.yjs_derived is True, "yjs_derived flag not set"

    return ValidationResult.SUCCESS
```

### 11.4 Rollback Procedures

**Immediate Rollback (Feature Flag):**
```bash
# Disable Yjs-primary globally
curl -X POST https://api.writersroom.com/admin/feature-flags \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"flag": "USE_YJS_PRIMARY", "enabled": false}'

# System reverts to dual-write mode immediately
# No data loss, seamless fallback
```

**Database Rollback (Last Resort):**
```sql
-- 1. Restore from pre-migration snapshot
pg_restore -d writersroom writersroom_backup_20250122.dump

-- 2. Verify scenes table restored
SELECT COUNT(*) FROM scenes WHERE snapshot_source != 'migrated';

-- 3. Clear migrated Yjs updates if necessary
DELETE FROM scene_versions
WHERE created_by = '<migration-user-id>';
```

---

## Operational Procedures

### 12.1 Monitoring & Alerts

**Key Metrics:**
```yaml
yjs_primary.divergence_rate:
  type: gauge
  unit: percentage
  alert_threshold: 0.1  # Alert if >0.1% divergence
  critical_threshold: 1.0

yjs_primary.snapshot_lag_minutes:
  type: gauge
  unit: minutes
  alert_threshold: 30  # Alert if snapshot >30min old
  critical_threshold: 60

yjs_primary.scene_load_time_p95:
  type: histogram
  unit: milliseconds
  alert_threshold: 200  # Alert if p95 >200ms
  critical_threshold: 500

yjs_primary.update_persist_errors:
  type: counter
  alert_threshold: 10 per minute
  critical_threshold: 50 per minute
```

**Alert Runbook:**
```markdown
# Alert: High Divergence Rate

**Severity:** Critical
**Threshold:** Divergence rate >1%

**Diagnosis:**
1. Check `/api/health/divergence-status` endpoint
2. Query diverged scenes: `SELECT * FROM scenes WHERE yjs_checksum != computed_checksum`
3. Check snapshot worker logs for failures

**Remediation:**
1. Trigger manual snapshots for diverged scenes
2. Investigate snapshot worker errors
3. If widespread: disable USE_YJS_PRIMARY flag temporarily
4. Create incident report

**Escalation:**
- Divergence >5%: Page on-call engineer
- Data loss detected: Immediate incident response
```

### 12.2 Backup & Recovery

**Backup Strategy:**
```bash
# Daily full backup
pg_dump -Fc writersroom > writersroom_$(date +%Y%m%d).dump

# Continuous WAL archiving (PostgreSQL PITR)
archive_command = 'cp %p /backup/wal/%f'

# Backup scene_versions table separately (large)
pg_dump -t scene_versions -Fc writersroom > scene_versions_$(date +%Y%m%d).dump
```

**Recovery Procedures:**
```bash
# Recover to point-in-time (before bad migration)
pg_restore -d writersroom writersroom_20250122.dump
# Then replay WAL logs to desired timestamp
```

### 12.3 Performance Tuning

**Database Indexes:**
```sql
-- Optimize Yjs update queries
CREATE INDEX CONCURRENTLY idx_scene_versions_scene_created
    ON scene_versions(scene_id, created_at)
    WHERE is_compacted = FALSE;

-- Optimize snapshot freshness queries
CREATE INDEX CONCURRENTLY idx_scenes_snapshot_at
    ON scenes(snapshot_at)
    WHERE yjs_derived = TRUE;
```

**Connection Pooling:**
```python
# AsyncPG pool configuration
DATABASE_POOL_SIZE = 20
DATABASE_MAX_OVERFLOW = 10
DATABASE_POOL_TIMEOUT = 30
DATABASE_POOL_RECYCLE = 3600
```

**Caching Strategy:**
```python
# Redis cache for frequently accessed scenes
@cache(ttl=300)  # 5 minutes
async def get_scene_snapshot_cached(scene_id: UUID):
    return await yjs_persistence.get_scene_snapshot(scene_id)
```

---

## Security Considerations

### 13.1 Access Control

**Yjs Update Authorization:**
```python
# WebSocket connection requires JWT authentication
async def websocket_endpoint(
    websocket: WebSocket,
    scene_id: UUID,
    token: str = Query(...)
):
    # Verify JWT
    user_info = await verify_token_websocket(token)
    user_id = user_info['uid']

    # Check scene access
    has_access = await scene_service.validate_scene_access(scene_id, user_id)
    if not has_access:
        await websocket.close(code=4003, reason="Access denied")
        return

    # Proceed with Yjs sync
    ...
```

**Snapshot Creation Authorization:**
```python
@router.post("/{scene_id}/snapshot")
async def create_snapshot(
    scene_id: UUID,
    current_user: User = Depends(get_current_user)
):
    # Require owner or admin role
    if not current_user.is_admin:
        scene = await get_scene(scene_id)
        if scene.script.owner_id != current_user.user_id:
            raise HTTPException(403, "Insufficient permissions")

    # Create snapshot
    ...
```

### 13.2 Data Integrity

**Yjs Update Validation:**
```python
async def store_update(self, scene_id: UUID, update: bytes) -> UUID:
    # Validate update is valid Yjs encoding
    try:
        # Attempt to decode (doesn't modify anything)
        test_doc = YDoc()
        Y.apply_update(test_doc, update)
    except Exception as e:
        logger.error(f"Invalid Yjs update rejected: {e}")
        raise ValueError("Invalid Yjs update encoding")

    # Validate update size
    if len(update) > MAX_UPDATE_SIZE:
        raise ValueError(f"Update exceeds max size: {len(update)} > {MAX_UPDATE_SIZE}")

    # Store
    version = SceneVersion.create_version(scene_id=scene_id, yjs_update=update)
    self.db.add(version)
    await self.db.flush()
    return version.version_id
```

**Rate Limiting:**
```python
# Limit Yjs updates per connection
class RateLimiter:
    def __init__(self, max_per_minute: int = 100):
        self.max_per_minute = max_per_minute
        self.windows: Dict[WebSocket, deque] = {}

    async def check_rate_limit(self, websocket: WebSocket) -> bool:
        now = time.time()
        window = self.windows.setdefault(websocket, deque())

        # Remove old entries
        while window and window[0] < now - 60:
            window.popleft()

        # Check limit
        if len(window) >= self.max_per_minute:
            return False

        window.append(now)
        return True
```

### 13.3 Audit Trail

**Update Tracking:**
```sql
-- scene_versions tracks all edits
SELECT
    sv.version_id,
    sv.created_at,
    sv.created_by,
    u.email AS user_email,
    length(sv.yjs_update) AS update_size_bytes
FROM scene_versions sv
JOIN users u ON sv.created_by = u.user_id
WHERE sv.scene_id = '<scene-id>'
ORDER BY sv.created_at DESC;
```

**Snapshot Audit:**
```sql
-- scene_snapshot_metadata provides snapshot history
SELECT
    ssm.snapshot_id,
    ssm.created_at,
    ssm.snapshot_source,
    ssm.yjs_version_count,
    ssm.generation_time_ms
FROM scene_snapshot_metadata ssm
WHERE ssm.scene_id = '<scene-id>'
ORDER BY ssm.created_at DESC;
```

---

## Appendices

### A. Glossary

- **CRDT (Conflict-free Replicated Data Type):** Data structure enabling concurrent editing without conflicts
- **Yjs:** JavaScript CRDT library for collaborative editing
- **y-py:** Python bindings for Yjs
- **Y.Doc:** Yjs document container holding shared types
- **Update:** Binary-encoded Yjs state change
- **Compaction:** Process of merging multiple updates into single update
- **Snapshot:** Point-in-time JSON representation derived from Yjs state
- **Divergence:** Inconsistency between Yjs state and REST snapshot

### B. Related Documents

- **Phase 2 Spec:** `docs/REALTIME_COLLABORATION_SPEC.md`
- **Autosave Spec:** `docs/autosave_spec.md`
- **Testing Strategy:** `docs/TESTING_STRATEGY.md`
- **Sprint Workflow:** Generated by `/sc:workflow`

### C. Decision Rationale

**Why Yjs-Primary over REST-Primary?**

1. **CRDT Advantages:** Automatic conflict resolution without manual logic
2. **Real-time First:** System designed for collaborative editing
3. **Alignment:** Matches existing "Yjs takes precedence" documentation
4. **Simplicity:** Removes complex CAS enforcement from application layer
5. **Performance:** CRDT operations are O(1) for most edits

**Why Not Hybrid (Dual-Write)?**

1. **Consistency Risk:** Two sources of truth create ambiguity
2. **Complexity:** Synchronization logic adds significant complexity
3. **Failure Modes:** Partial failures lead to divergence
4. **Operational Burden:** Monitoring and maintaining dual writes

### D. Open Questions

- [ ] **Compaction Frequency:** Should compaction run daily or on-demand based on update count?
- [ ] **Snapshot Interval:** Is 5 minutes appropriate or should it be configurable per-scene?
- [ ] **Retention Policy:** 30 days for compacted updates or longer for audit requirements?
- [ ] **Migration Timeline:** Can we complete migration in 4 weeks or need more time?

### E. Future Enhancements

- [ ] **Time-Travel Debugging:** Replay Yjs updates to specific point in time
- [ ] **Branching:** Support for screenplay version branches
- [ ] **Offline-First:** Enhanced offline editing with conflict-free sync
- [ ] **Real-Time Analytics:** Track editing patterns and collaboration metrics
- [ ] **Compression:** Compress Yjs updates before storage (gzip/zstd)

---

**Document End**

*This design document serves as the authoritative specification for the Yjs-primary persistence architecture. All implementation work should reference this document for design decisions, data models, and operational procedures.*
