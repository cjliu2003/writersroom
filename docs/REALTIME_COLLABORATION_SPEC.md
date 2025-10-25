# Realtime Collaboration Implementation Spec
## Phase 1 P2: Realtime Presence + CRDT (Yjs) Alignment

**Document Version:** 1.0  
**Created:** 2025-09-30  
**Status:** Planning Phase

---

## Executive Summary

### Goals
- Enable real-time collaborative editing of screenplay scenes
- Implement CRDT-based conflict resolution using Yjs
- Add user presence indicators (cursors, selections, active users)
- Maintain compatibility with existing P1 autosave system
- Zero data loss during transition

### Success Metrics
- **Latency**: WebSocket round-trip < 100ms (p95)
- **Availability**: 99.9% WebSocket uptime
- **Conflict Resolution**: 100% automatic merge success
- **Data Integrity**: 0 data loss events
- **User Experience**: Presence updates < 50ms visible delay

---

## Architecture Overview

### High-Level Design

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Frontend A    │◄───────►│   WebSocket      │◄───────►│   Frontend B    │
│  (Yjs Client)   │         │   Server         │         │  (Yjs Client)   │
│                 │         │  (FastAPI)       │         │                 │
└────────┬────────┘         └────────┬─────────┘         └────────┬────────┘
         │                           │                            │
         │                  ┌────────▼─────────┐                 │
         │                  │   Redis PubSub   │                 │
         │                  │  (Multi-server)  │                 │
         │                  └────────┬─────────┘                 │
         │                           │                            │
         │                  ┌────────▼─────────┐                 │
         └─────────────────►│   PostgreSQL     │◄────────────────┘
                            │  scene_versions  │
                            │  (Persistence)   │
                            └──────────────────┘
```

### Key Components

1. **Yjs Document (Frontend)** - CRDT data structure for scene content
2. **WebSocket Server (Backend)** - FastAPI WebSocket endpoints  
3. **Redis PubSub** - Multi-server coordination
4. **PostgreSQL Persistence** - Append-only `scene_versions` table (exists)
5. **Presence System** - User cursor positions, active selections

---

## Implementation Phases

### Phase 2.1: Foundation (Week 1-2)

**Goal:** Set up WebSocket infrastructure and basic Yjs integration

#### Backend Tasks
- [ ] Install dependencies: `fastapi-websocket`, `redis`, `y-py`
- [ ] Create WebSocket endpoint: `/ws/scenes/{scene_id}`
- [ ] Implement Redis PubSub manager
- [ ] Create connection manager for room-based broadcasting
- [ ] Add WebSocket authentication middleware (JWT)
- [ ] Implement heartbeat/ping-pong for connection health

#### Frontend Tasks
- [ ] Install dependencies: `yjs`, `y-websocket`, `y-prosemirror`
- [ ] Create Yjs document provider
- [ ] Implement WebSocket connection hook (`useYjsWebSocket`)
- [ ] Add connection status indicator
- [ ] Create Yjs awareness for presence data
- [ ] Handle connection/disconnection events

#### Database
- [ ] Verify `scene_versions` table schema (already exists)
- [ ] Add indexes for efficient querying
- [ ] Set up retention policy queries

**Deliverables:** Working WebSocket connection with Yjs syncing

---

### Phase 2.2: Core Collaboration (Week 3-4)

**Goal:** Enable real-time editing with conflict resolution

#### Backend Components

**1. WebSocket Manager** (`app/services/websocket_manager.py`)
```python
class WebSocketManager:
    async def connect(websocket, scene_id, user_id)
    async def disconnect(websocket, scene_id)
    async def broadcast_to_room(scene_id, message, exclude=None)
    async def get_room_participants(scene_id) -> List[dict]
```

**2. Yjs Persistence** (`app/services/yjs_persistence.py`)
```python
class YjsPersistence:
    async def store_update(scene_id, update: bytes) -> UUID
    async def get_scene_state(scene_id) -> bytes
    async def compact_updates(scene_id, before: datetime)
```

**3. WebSocket Endpoint** (`app/routers/websocket.py`)
```python
@router.websocket("/ws/scenes/{scene_id}")
async def scene_collaboration_endpoint(websocket, scene_id, token):
    # 1. Validate JWT token
    # 2. Check scene access permissions
    # 3. Load initial Yjs state from DB
    # 4. Send state to client
    # 5. Enter message loop (receive updates, persist, broadcast)
```

**4. Redis PubSub** (`app/services/redis_pubsub.py`)
```python
class RedisPubSub:
    async def publish_update(scene_id, update: bytes, sender_id)
    async def subscribe_to_scene(scene_id, callback)
    async def publish_presence(scene_id, presence: dict)
```

#### Frontend Components

**1. Yjs Provider Hook** (`hooks/use-yjs-collaboration.ts`)
```typescript
export function useYjsCollaboration({
  sceneId,
  authToken,
  onSyncStatusChange
}) {
  const [doc] = useState(() => new Y.Doc());
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  
  // Connect to WebSocket, handle sync events, manage awareness
  return { doc, provider, awareness, isConnected };
}
```

**2. Collaborative Editor** (`components/collaborative-screenplay-editor.tsx`)
```typescript
export function CollaborativeScreenplayEditor({
  sceneId,
  authToken,
  initialContent,
}) {
  const { doc, provider, awareness } = useYjsCollaboration({ sceneId, authToken });
  
  // Bind Yjs doc to editor
  // Show presence indicators
}
```

**3. Presence UI** (`components/presence-avatars.tsx`)
```typescript
export function PresenceAvatars({ awareness }) {
  // Display user avatars, cursor positions, selections
}
```

**Deliverables:** Multiple users editing same scene simultaneously

---

### Phase 2.3: Presence & UX Polish (Week 5)

**Goal:** Rich presence features and seamless UX

#### Features

1. **Cursor Tracking** - Show other users' cursor positions with color coding
2. **Selection Highlights** - Highlight text selected by other users  
3. **Active User Indicators** - Avatar list in toolbar
4. **Typing Indicators** - Show "User X is typing..." status
5. **Connection Status UI** - Green/yellow/red indicators
6. **Graceful Degradation** - Fall back to P1 autosave if WebSocket fails

#### Components

```typescript
// components/collaboration-status-bar.tsx
export function CollaborationStatusBar({ isConnected, activeUsers })

// components/user-cursor.tsx  
export function UserCursor({ user, position, color })

// components/typing-indicator.tsx
export function TypingIndicator({ users })
```

**Deliverables:** Full presence feature set with polished UX

---

### Phase 2.4: Migration & Coexistence (Week 6)

**Goal:** Safely migrate from P1 autosave to P2 collaboration

#### Migration Strategy

**Feature Flag System**
```typescript
interface CollaborationFlags {
  enableYjs: boolean;              // Master kill switch
  enablePresence: boolean;         // Presence indicators
  enableRealtimeEditing: boolean;  // Live editing
  fallbackToAutosave: boolean;     // Fallback behavior
}
```

**Hybrid Mode (Recommended)**
- Both systems active simultaneously
- Yjs for real-time, autosave as backup
- Autosave triggers less frequently
- Yjs updates take precedence

#### Data Migration Steps

1. **Backfill Yjs State** - Convert existing `content_blocks` to Yjs format
2. **Dual-Write Period** - Write to both systems for 2 weeks
3. **Read Migration** - Start reading from Yjs, fall back if needed
4. **Deprecate P1 Writes** - Stop writing to `content_blocks` for collaborative scenes

#### Rollback Triggers
- Data loss detected
- Sync failures > 5%
- WebSocket success rate < 95%
- Latency > 200ms p95

**Deliverables:** Safe migration with monitoring and rollback procedures

---

## Testing Strategy

### Unit Tests

**Backend:**
```python
# tests/test_websocket_manager.py
async def test_broadcast_to_room()
async def test_user_disconnect_cleanup()
async def test_unauthorized_connection()

# tests/test_yjs_persistence.py  
async def test_store_update()
async def test_compact_updates()
async def test_concurrent_updates()
```

**Frontend:**
```typescript
// hooks/__tests__/use-yjs-collaboration.test.ts
test('connects to WebSocket on mount')
test('syncs initial document state')
test('broadcasts local changes')
test('applies remote changes')
test('reconnects after disconnect')
```

### Integration Tests

```typescript
// e2e/collaboration.spec.ts
test('two users can edit simultaneously')
test('handles network interruption')
test('displays presence indicators')
```

### Load Testing

- 50 concurrent editors per scene: p95 < 100ms
- 1000 active scenes per server: CPU < 70%
- Cross-server latency: < 20ms

**Tools:** k6, Grafana, custom WebSocket load tester

---

## Monitoring & Observability

### Key Metrics

**WebSocket:**
- `websocket.connections.active` (gauge)
- `websocket.latency.ms` (histogram)
- `websocket.errors` (counter)

**Yjs:**
- `yjs.updates.stored` (counter)
- `yjs.conflicts.resolved` (counter)
- `yjs.compaction.runs` (counter)

**Business:**
- `scenes.collaborative.active` (gauge)
- `users.collaborating.total` (gauge)

### Dashboards

1. **Real-time Operations** - Active connections, latency, error rate
2. **Data Integrity** - Updates stored, compaction health
3. **User Experience** - Session duration, users per scene

### Alerting

**Critical (Page):**
- WebSocket error rate > 1%
- Data loss detected
- Connection success < 95%

**Warning (Slack):**
- Latency p95 > 200ms
- Compaction failure

---

## Rollback Plan

### Scenario 1: Feature Flag Disable
**Trigger:** Minor issues  
**Action:** Set feature flag to false  
**Recovery:** < 1 minute

### Scenario 2: Code Rollback  
**Trigger:** Critical bugs  
**Action:** `kubectl rollout undo deployment/api`  
**Recovery:** 5 minutes

### Scenario 3: Data Recovery
**Trigger:** Data loss  
**Action:** Restore from `content_blocks`, notify users  
**Recovery:** 30 minutes

---

## Dependencies

### Backend
```python
fastapi-websocket==0.1.0
redis==5.0.0
y-py==0.6.0
```

### Frontend
```json
{
  "yjs": "^13.6.0",
  "y-websocket": "^1.5.0",
  "y-prosemirror": "^1.2.0"
}
```

### Infrastructure
- Redis 7.0+
- PostgreSQL 14+
- Load balancer with WebSocket support

---

## Next Steps

1. Review this spec with team
2. Create detailed task breakdown in project management tool
3. Set up development environment
4. Begin Phase 2.1 implementation
5. Schedule weekly progress reviews

**Estimated Timeline:** 6-8 weeks for full implementation
