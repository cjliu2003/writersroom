# Phase 2.1 Quick Reference Card
## Real-time Collaboration Foundation

**Status:** ✅ **COMPLETE**  
**Date:** 2025-09-30

---

## 🚀 Quick Start Commands

```bash
# 1. Start Redis
redis-server  # or: brew services start redis

# 2. Install dependencies
cd backend && pip install -r requirements.txt
cd frontend && npm install

# 3. Configure environment
echo "REDIS_URL=redis://localhost:6379" >> backend/.env

# 4. Start services
# Terminal 1: Backend
cd backend && uvicorn main:app --reload

# Terminal 2: Frontend
cd frontend && npm run dev
```

---

## 📡 WebSocket Endpoint

```
ws://localhost:8000/api/ws/scenes/{scene_id}?token={jwt}
```

**Authentication:** JWT token in query parameter  
**Protocol:** Binary (Yjs updates) + JSON (awareness)

---

## 💻 Frontend Usage

```typescript
import { useYjsCollaboration } from '@/hooks/use-yjs-collaboration';
import { CollaborationStatusIndicator } from '@/components/collaboration-status-indicator';

function MyEditor({ sceneId, authToken }) {
  const { doc, awareness, syncStatus, isConnected } = useYjsCollaboration({
    sceneId,
    authToken,
    enabled: true,
  });
  
  return (
    <div>
      <CollaborationStatusIndicator 
        syncStatus={syncStatus}
        isConnected={isConnected}
      />
      {/* Editor goes here */}
    </div>
  );
}
```

---

## 🔑 Key Files Created

### Backend (7 files)
```
backend/
├── requirements.txt                        # Added: websockets, redis, y-py
├── .env.example                            # Redis config example
├── main.py                                 # Added: Redis startup/shutdown
├── app/
│   ├── auth/dependencies.py               # Added: verify_token_websocket()
│   ├── routers/websocket.py               # NEW: WebSocket endpoint
│   └── services/
│       ├── websocket_manager.py           # NEW: Connection manager
│       └── redis_pubsub.py                # NEW: Redis pub/sub
└── migrations/
    └── add_scene_versions_indexes.sql     # NEW: Database indexes
```

### Frontend (4 files)
```
frontend/
├── package.json                           # Added: yjs, y-websocket
├── hooks/
│   └── use-yjs-collaboration.ts          # NEW: Yjs hook
└── components/
    ├── collaboration-status-indicator.tsx # NEW: Status UI
    └── collaborative-editor-example.tsx   # NEW: Example
```

### Documentation (3 files)
```
docs/
├── REALTIME_COLLABORATION_SPEC.md         # Full specification
├── PHASE_2_1_IMPLEMENTATION_SUMMARY.md    # Detailed summary
├── REALTIME_COLLABORATION_SETUP.md        # Setup guide
└── PHASE_2_1_QUICK_REFERENCE.md          # This file
```

---

## 🧪 Testing

### Test WebSocket in Browser Console
```javascript
const ws = new WebSocket(
  'ws://localhost:8000/api/ws/scenes/YOUR_SCENE_ID?token=YOUR_JWT'
);
ws.onmessage = (e) => console.log('Message:', e.data);
```

### Multi-User Test
1. Open two browser windows
2. Connect both to same `sceneId`
3. Watch participant count update
4. Monitor WebSocket messages in DevTools

---

## 🐛 Debug Commands

```bash
# Check Redis connection
redis-cli ping

# Monitor Redis activity
redis-cli MONITOR

# Check WebSocket connections (browser)
# DevTools → Network → WS → Messages

# Backend logs
# stdout shows connection/disconnection events
```

---

## ⚙️ Configuration

### Backend `.env`
```bash
REDIS_URL=redis://localhost:6379
# Or with password:
# REDIS_URL=redis://:password@host:6379
```

### Redis Not Required for Development
App will run without Redis in single-server mode with warning:
```
⚠️  Redis connection failed
   Running in single-server mode
```

---

## 📊 Connection States

| State | Color | Meaning |
|-------|-------|---------|
| `synced` | 🟢 Green | Fully synced with server |
| `connected` | 🔵 Blue | Connected, syncing |
| `connecting` | 🟡 Yellow | Establishing connection |
| `offline` | ⚫ Gray | Disconnected |
| `error` | 🔴 Red | Connection error |

---

## 🎯 Phase 2.1 Completion Checklist

- [x] WebSocket infrastructure ✅
- [x] Redis pub/sub for multi-server ✅
- [x] JWT authentication ✅
- [x] Yjs document synchronization ✅
- [x] Awareness/presence tracking ✅
- [x] Status indicators ✅
- [x] Connection management ✅
- [x] Error handling ✅
- [x] Documentation ✅

**Phase 2.1: 100% COMPLETE** 🎉

---

## ➡️ Next: Phase 2.2

**Core Collaboration (Weeks 3-4)**
- [ ] Yjs persistence layer
- [ ] Bind Yjs to screenplay editor
- [ ] Persistent state recovery
- [ ] Conflict resolution testing
- [ ] Editor synchronization

**Start with:**
1. Create `YjsPersistence` service
2. Integrate with existing Slate editor
3. Test real-time editing

---

## 📞 Quick Help

**WebSocket won't connect:**
- Check JWT token validity
- Verify scene access permissions
- Ensure backend is running

**No participants showing:**
- Check awareness setup in hook
- Verify WebSocket connection
- Monitor browser console for errors

**Redis errors:**
- Redis optional for development
- Check `REDIS_URL` in `.env`
- Verify Redis is running: `redis-cli ping`

---

## 🔗 Resources

- Full Spec: `docs/REALTIME_COLLABORATION_SPEC.md`
- Setup Guide: `docs/REALTIME_COLLABORATION_SETUP.md`
- Implementation Summary: `docs/PHASE_2_1_IMPLEMENTATION_SUMMARY.md`
- Example Component: `frontend/components/collaborative-editor-example.tsx`

---

**Well done! Phase 2.1 foundation is solid and ready for Phase 2.2 integration! 🚀**
