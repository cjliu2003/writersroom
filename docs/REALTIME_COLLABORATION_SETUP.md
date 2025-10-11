# Real-time Collaboration Setup Guide
## Phase 2.1 Development Environment

**Last Updated:** 2025-09-30

---

## Prerequisites

- Python 3.10+
- Node.js 18+
- PostgreSQL 14+
- Redis 7.0+ (optional for single-server development)

---

## Quick Start

### 1. Install Redis (Optional but Recommended)

**macOS:**
```bash
brew install redis
brew services start redis
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get install redis-server
sudo systemctl start redis
```

**Docker (All platforms):**
```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

**Windows:**
Download from: https://redis.io/download

**Verify Redis is running:**
```bash
redis-cli ping
# Should return: PONG
```

### 2. Install Backend Dependencies

```bash
cd backend
pip install -r requirements.txt
```

**New dependencies installed:**
- `websockets==12.0`
- `redis==5.0.1`
- `aioredis==2.0.1`
- `y-py==0.6.2`

### 3. Configure Environment Variables

**Copy example file:**
```bash
cp .env.example .env
```

**Add Redis URL to `.env`:**
```bash
# Add this line to your .env file
REDIS_URL=redis://localhost:6379
```

**For production with password:**
```bash
REDIS_URL=redis://:your-password@redis-host:6379
```

### 4. Verify Database Schema

**Run the index migration:**
```bash
# Connect to your PostgreSQL database
psql -d writersroom -U your_user

# Run the migration
\i migrations/add_scene_versions_indexes.sql
```

**Or manually verify:**
```sql
-- Check if scene_versions table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_name = 'scene_versions';

-- Check columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'scene_versions';

-- Check indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'scene_versions';
```

Expected indexes:
- `scene_versions_pkey` on `version_id`
- `idx_scene_versions_scene_id_created_at` on `(scene_id, created_at DESC)`

### 5. Install Frontend Dependencies

```bash
cd frontend
npm install
```

**New dependencies installed:**
- `yjs@^13.6.10`
- `y-websocket@^1.5.0`
- `lib0@^0.2.94`

### 6. Start Services

**Terminal 1 - Redis (if not running as service):**
```bash
redis-server
```

**Terminal 2 - Backend:**
```bash
cd backend
uvicorn main:app --reload --port 8000
```

Look for startup messages:
```
✅ Redis connected at redis://localhost:6379
INFO:     Application startup complete.
```

**Terminal 3 - Frontend:**
```bash
cd frontend
npm run dev
```

Frontend will start at `http://localhost:3102`

---

## Testing the Setup

### 1. Check Backend Health

```bash
curl http://localhost:8000/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "version": "1.0.0"
}
```

### 2. Test WebSocket Connection

Open browser DevTools (F12) and run:

```javascript
// Replace with your actual JWT token and scene ID
const token = 'your-jwt-token';
const sceneId = 'your-scene-uuid';

const ws = new WebSocket(
  `ws://localhost:8000/api/ws/scenes/${sceneId}?token=${token}`
);

ws.onopen = () => console.log('✅ Connected');
ws.onmessage = (e) => console.log('📨 Message:', e.data);
ws.onerror = (e) => console.error('❌ Error:', e);
ws.onclose = () => console.log('🔌 Disconnected');
```

Expected output:
```
✅ Connected
📨 Message: {"type":"connected","scene_id":"...","participants":[...]}
```

### 3. Test Collaboration Hook (React)

Create a test page: `frontend/app/test-collaboration/page.tsx`

```tsx
'use client';

import { CollaborativeEditorExample } from '@/components/collaborative-editor-example';

export default function TestCollaborationPage() {
  // Get these from your auth system
  const sceneId = 'test-scene-uuid';
  const authToken = 'your-jwt-token';
  
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4">
        Collaboration Test
      </h1>
      <CollaborativeEditorExample 
        sceneId={sceneId}
        authToken={authToken}
      />
    </div>
  );
}
```

Navigate to `http://localhost:3102/test-collaboration`

### 4. Multi-User Test

1. Open the test page in two browser windows
2. Use same `sceneId` in both
3. Verify both see each other in participant count
4. Check browser DevTools Network tab for WebSocket connection

---

## Troubleshooting

### Redis Connection Failed

**Symptom:**
```
⚠️  Redis connection failed: Error connecting to Redis
   Running in single-server mode
```

**Solution:**
- Verify Redis is running: `redis-cli ping`
- Check REDIS_URL in `.env`
- For development, app will work without Redis (single server)

### WebSocket Connection Error 4001 (Authentication Failed)

**Symptom:**
```
WebSocket connection failed: code 4001
```

**Solution:**
- Verify JWT token is valid
- Check token expiration
- Ensure Firebase is configured correctly

### WebSocket Connection Error 4003 (Access Denied)

**Symptom:**
```
WebSocket connection failed: code 4003
```

**Solution:**
- Verify user has access to the scene
- Check if scene exists in database
- Ensure user is owner or collaborator

### Connection Closes Immediately

**Symptom:**
WebSocket connects then closes after < 1 second

**Solution:**
- Check backend logs for errors
- Verify scene_id is valid UUID
- Ensure database connection is working

### Frontend Can't Connect

**Symptom:**
```
Failed to construct 'WebSocket': The URL is invalid
```

**Solution:**
- Verify `NEXT_PUBLIC_API_URL` in frontend `.env.local`
- Check WebSocket URL construction in hook
- Ensure backend is running on correct port

---

## Development Tips

### Debug Mode

**Enable verbose logging:**

Backend (`main.py`):
```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

Frontend (Browser DevTools Console):
```javascript
localStorage.setItem('DEBUG', 'yjs:*,y-websocket:*');
```

### Monitor Redis

**Watch pub/sub activity:**
```bash
redis-cli MONITOR
```

**Check active connections:**
```bash
redis-cli CLIENT LIST
```

**Check channel subscriptions:**
```bash
redis-cli PUBSUB CHANNELS scene:*
```

### WebSocket Inspector

Use browser DevTools:
1. Network tab → Filter by "WS"
2. Click on WebSocket connection
3. View Messages tab for traffic
4. Check frames for binary (Yjs updates)

---

## Production Deployment Checklist

- [ ] Use Redis with password authentication
- [ ] Use `rediss://` (TLS) for Redis URL
- [ ] Configure proper CORS origins
- [ ] Set up Redis persistence (AOF or RDB)
- [ ] Enable Redis cluster for high availability
- [ ] Monitor WebSocket connection metrics
- [ ] Set up Redis memory limits and eviction policy
- [ ] Configure WebSocket load balancer with sticky sessions
- [ ] Test failover scenarios
- [ ] Set up logging aggregation (e.g., DataDog, Sentry)

---

## Next Steps

Once setup is verified:

1. **Test basic connectivity** - Two browsers, same scene
2. **Verify presence tracking** - See participant count update
3. **Check message flow** - Monitor WebSocket traffic
4. **Test reconnection** - Stop/start Redis, verify reconnect
5. **Proceed to Phase 2.2** - Editor integration with Yjs

---

## Resources

- **Yjs Documentation:** https://docs.yjs.dev/
- **y-websocket Provider:** https://github.com/yjs/y-websocket
- **Redis Documentation:** https://redis.io/documentation
- **FastAPI WebSockets:** https://fastapi.tiangolo.com/advanced/websockets/

---

## Support

If you encounter issues not covered here:

1. Check backend logs: `uvicorn main:app --reload`
2. Check frontend console: Browser DevTools
3. Check Redis logs: `redis-cli MONITOR`
4. Review WebSocket traffic: DevTools Network → WS
5. Verify database schema: Run migration SQL

**Common Log Locations:**
- Backend: stdout/stderr
- Redis: `/var/log/redis/redis-server.log` (Linux)
- Redis: `brew services list` (macOS)
