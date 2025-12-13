# Chat Performance Analysis - Database Contention Issue

## Executive Summary

**Total request time**: 282.6 seconds (4 minutes 42 seconds)
**Primary bottlenecks**:
1. Conversation handling: 73.6 seconds
2. Context building: 125.6 seconds (RAG retrieval)

**Root cause**: Database connection pool contention between chat endpoint and websocket operations (Yjs rebuilding from 148 scenes).

## Timing Breakdown from Logs

| Step | Duration | % of Total | Status |
|------|----------|------------|--------|
| Access validation | 1.3s | 0.5% | ✅ Acceptable |
| Service initialization | 0.2s | 0.1% | ✅ Acceptable |
| Intent classification | 1.4s | 0.5% | ✅ Acceptable |
| **Conversation handling** | **73.6s** | **26%** | ⚠️ **SLOW** |
| **Context building (RAG)** | **125.6s** | **44%** | 🚨 **CRITICAL** |
| Tool setup | 0.03s | 0.01% | ✅ Acceptable |
| Tool loop + AI generation | 73.1s | 26% | ⚠️ Expected (Claude API) |
| Message saving | 0.6s | 0.2% | ✅ Acceptable |
| Token tracking | 5.9s | 2.1% | ⚠️ Investigate |
| Summary check | 0.8s | 0.3% | ✅ Acceptable |

## Root Cause Analysis

### Issue 1: Conversation Handling (73.6 seconds)

**Expected**: <1 second (simple INSERT into chat_conversations table)
**Actual**: 73.6 seconds

**Likely cause**: Database connection pool exhaustion or lock contention.

During this time window (19:13:01.922 → 19:14:15.569), concurrent operations were occurring:
- Websocket connections loading 79-80 Yjs updates from database
- Multiple Redis pub/sub subscriptions
- Websocket connect/disconnect cycles

**Evidence**:
```
19:13:05.991 - Applied 79 persisted update(s) for script 01ddb380...
19:13:26.461 - Subscribed to script channels (Redis)
19:13:58.791 - Websocket disconnection
19:14:03.670 - Applied 80 persisted update(s)
19:14:15.569 - Created new conversation (FINALLY completes)
```

### Issue 2: Context Building / RAG Retrieval (125.6 seconds)

**Expected**: 5-15 seconds (global context + vector search + embedding generation)
**Actual**: 125.6 seconds

**Breakdown**:
1. `_get_global_context()` fetches:
   - Script outline (1 query)
   - Top 3 character sheets (1 query)
2. `retrieval_service.retrieve_for_intent()` with GLOBAL_QUESTION intent:
   - Generates embedding for user query (OpenAI API call at 19:16:19.571)
   - Executes `vector_search()` with limit=10 (single JOIN query with pgvector)

During this time window (19:14:15.569 → 19:16:21.199), concurrent operations:
- **19:16:11.207-208**: Yjs rebuilding from 148 scenes (expensive operation)
- **19:15:02.778**: "Rebuilt 3317 blocks from 148 scenes" (12.5 seconds just for rebuild)

The websocket operations are loading ALL scene data from database to rebuild Yjs documents, creating massive contention for:
- Database connections
- Database I/O
- Table locks on scenes table

## Database Connection Pool Analysis

The SQLAlchemy async pool likely has default settings of:
- `pool_size`: 5 connections
- `max_overflow`: 10 connections
- **Total**: 15 concurrent connections maximum

With multiple websockets + HTTP endpoints competing for connections, we're likely hitting pool exhaustion where:
1. Websocket loads 148 scenes for Yjs rebuild (holds connection for 12+ seconds)
2. Chat endpoint waits for available connection
3. Once connection available, queries still slow due to database I/O contention

## Performance Optimization Recommendations

### Immediate Fixes (High Impact, Low Effort)

#### 1. Add Detailed Timing Logs to Context Building

Add timing breakpoints within `build_prompt()` to identify exact bottleneck:

```python
# In context_builder.py build_prompt() method

# After global context fetch
step_start = time.perf_counter()
global_context = await self._get_global_context(script_id, intent)
logger.info(f"[CONTEXT] Global context fetch took {(time.perf_counter() - step_start) * 1000:.2f}ms")

# After retrieval service call
step_start = time.perf_counter()
retrieval_result = await self.retrieval_service.retrieve_for_intent(...)
logger.info(f"[CONTEXT] Retrieval service took {(time.perf_counter() - step_start) * 1000:.2f}ms")

# Within retrieval_service.py vector_search()
step_start = time.perf_counter()
query_embedding = await self.embedding_service.generate_scene_embedding(query)
logger.info(f"[RETRIEVAL] Embedding generation took {(time.perf_counter() - step_start) * 1000:.2f}ms")

step_start = time.perf_counter()
result = await self.db.execute(text(query_sql), params)
logger.info(f"[RETRIEVAL] Vector search query took {(time.perf_counter() - step_start) * 1000:.2f}ms")
```

#### 2. Increase Database Connection Pool

In `app/db/base.py`, increase pool size:

```python
# Current (likely default)
engine = create_async_engine(
    DATABASE_URL_ASYNC,
    echo=False,
    pool_size=5,  # Increase this
    max_overflow=10  # Increase this
)

# Recommended for current load
engine = create_async_engine(
    DATABASE_URL_ASYNC,
    echo=False,
    pool_size=20,  # 4x increase
    max_overflow=30,  # Allow bursts
    pool_pre_ping=True,  # Verify connections before use
    pool_recycle=3600  # Recycle after 1 hour
)
```

**Rationale**:
- 148-scene script with multiple websocket connections + HTTP endpoints
- Each Yjs rebuild holds connection for 12+ seconds
- Need headroom for concurrent operations

#### 3. Add Database Indexes

Check for missing indexes on critical foreign keys:

```sql
-- Check existing indexes
SELECT indexname, tablename FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('scene_embeddings', 'scene_summaries', 'chat_conversations');

-- Add if missing
CREATE INDEX IF NOT EXISTS idx_scene_embeddings_script_id ON scene_embeddings(script_id);
CREATE INDEX IF NOT EXISTS idx_scene_summaries_script_id ON scene_summaries(script_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_script_id ON chat_conversations(script_id);
CREATE INDEX IF NOT EXISTS idx_scenes_script_id_position ON scenes(script_id, position);
```

### Medium-Term Optimizations (High Impact, Medium Effort)

#### 4. Cache Global Context (Outline + Character Sheets)

These change infrequently but are fetched on every chat request:

```python
# In context_builder.py
from functools import lru_cache
from datetime import datetime, timedelta

class ContextBuilder:
    def __init__(self, db: AsyncSession):
        self.db = db
        self._global_context_cache = {}  # {script_id: (context, timestamp)}
        self._cache_ttl = timedelta(minutes=5)

    async def _get_global_context(self, script_id: UUID, intent: IntentType) -> str:
        if intent == IntentType.BRAINSTORM:
            return ""

        # Check cache
        cached = self._global_context_cache.get(script_id)
        if cached:
            context, timestamp = cached
            if datetime.utcnow() - timestamp < self._cache_ttl:
                logger.info(f"[CONTEXT] Global context cache HIT for {script_id}")
                return context

        # Cache miss - fetch from database
        logger.info(f"[CONTEXT] Global context cache MISS for {script_id}")
        # ... existing fetch logic ...

        # Cache result
        self._global_context_cache[script_id] = (context, datetime.utcnow())
        return context
```

**Expected impact**: Reduce global context fetch from ~1-2 seconds to <1ms on cache hits.

#### 5. Optimize Yjs Rebuild - Don't Block on Scene Load

The Yjs rebuild is loading ALL 148 scenes synchronously. Options:

**Option A**: Use connection pooling with separate pool for websockets
```python
# Create dedicated pool for websockets
websocket_engine = create_async_engine(
    DATABASE_URL_ASYNC,
    pool_size=10,
    max_overflow=20
)
```

**Option B**: Load scenes in batches with pagination
```python
# Instead of loading all 148 scenes at once
# Load in batches of 50
BATCH_SIZE = 50
for offset in range(0, total_scenes, BATCH_SIZE):
    batch = await load_scenes_batch(script_id, offset, BATCH_SIZE)
    rebuild_yjs_from_batch(batch)
    await asyncio.sleep(0.01)  # Yield control
```

**Option C**: Pre-build Yjs documents (recommended)
- Maintain pre-built Yjs state in memory or Redis
- Only rebuild when scenes are actually modified
- Don't rebuild on every websocket connection

#### 6. Optimize Vector Search Query

Current query rebuilds Scene and SceneSummary objects from raw SQL. Use ORM relationships instead:

```python
# Instead of raw SQL reconstruction
# Use SQLAlchemy's relationship loading
stmt = (
    select(Scene, SceneSummary, SceneEmbedding)
    .join(SceneSummary)
    .join(SceneEmbedding)
    .where(Scene.script_id == script_id)
    .options(joinedload(Scene.summary), joinedload(Scene.embedding))
    .order_by(text(f"scene_embeddings.embedding <=> CAST(:embedding AS vector)"))
    .limit(limit)
)
```

### Long-Term Optimizations (High Impact, High Effort)

#### 7. Implement Read Replicas

Route read-heavy operations (vector search, scene loading) to read replicas:

```python
# Master for writes
master_engine = create_async_engine(MASTER_DB_URL)

# Replica for reads
replica_engine = create_async_engine(REPLICA_DB_URL)

# In context_builder.py and retrieval_service.py
def __init__(self, db: AsyncSession, read_db: Optional[AsyncSession] = None):
    self.db = db  # Write operations
    self.read_db = read_db or db  # Read operations
```

#### 8. Implement Query Result Caching

Cache frequently accessed vector search results:

```python
# Using Redis for distributed caching
import hashlib

async def vector_search_cached(script_id, query, limit=10):
    cache_key = f"vector_search:{script_id}:{hashlib.md5(query.encode()).hexdigest()}:{limit}"

    # Check cache
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    # Execute query
    results = await self.vector_search(script_id, query, limit)

    # Cache for 5 minutes
    await redis.setex(cache_key, 300, json.dumps(results))
    return results
```

#### 9. Parallelize Independent Database Queries

Global context fetches outline and character sheets sequentially. Parallelize:

```python
# Instead of sequential
outline = await fetch_outline(script_id)
characters = await fetch_characters(script_id)

# Parallel execution
outline_task = asyncio.create_task(fetch_outline(script_id))
characters_task = asyncio.create_task(fetch_characters(script_id))
outline = await outline_task
characters = await characters_task
```

## Immediate Action Plan

**Step 1**: Add detailed timing logs to context building (15 minutes)
- Modify `context_builder.py` and `retrieval_service.py`
- Identify exact slow query/operation

**Step 2**: Increase database connection pool (5 minutes)
- Modify `app/db/base.py`
- Restart backend
- Monitor connection usage with `pg_stat_activity`

**Step 3**: Verify database indexes exist (10 minutes)
- Run index check queries
- Create missing indexes
- Analyze query plans

**Step 4**: Test and measure (30 minutes)
- Send test chat messages
- Monitor logs for timing improvements
- Verify connection pool metrics

**Expected improvement**: 125s → 15-30s for context building (4-8x speedup)

## Monitoring Queries

### Check Active Database Connections
```sql
SELECT count(*) as connections, state, wait_event_type
FROM pg_stat_activity
WHERE datname = 'writersroom'
GROUP BY state, wait_event_type;
```

### Check Long-Running Queries
```sql
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds'
ORDER BY duration DESC;
```

### Check Table Lock Contention
```sql
SELECT l.mode, l.granted, d.datname, c.relname
FROM pg_locks l
JOIN pg_database d ON l.database = d.oid
JOIN pg_class c ON l.relation = c.oid
WHERE d.datname = 'writersroom'
AND NOT l.granted;
```

## Additional Observations

### Token Tracking Slowness (5.9 seconds)

This is also slow and worth investigating:

```
19:17:34.963 - Message saving took 635.10ms
19:17:40.827 - Token tracking took 5863.79ms  ⚠️
```

Likely doing multiple database writes or complex calculations. Should be <500ms.

### Geographic Latency Factor

Croatia → California database roundtrip: ~3.5 seconds per blocking query.

With connection pool contention forcing sequential execution:
- Query 1: 3.5s
- Query 2: 3.5s (waits for connection)
- Query 3: 3.5s (waits for connection)
- Total: 10.5s for 3 queries that could be parallel

This amplifies the impact of pool exhaustion.

## Conclusion

The chat endpoint slowness is NOT due to inefficient SQL queries, but rather **database resource contention** between:
1. HTTP chat endpoints (RAG context building)
2. WebSocket connections (Yjs document rebuilding from 148 scenes)

The solution is multi-faceted:
1. **Immediate**: Increase connection pool, add indexes, add detailed logging
2. **Short-term**: Cache global context, optimize Yjs rebuild strategy
3. **Long-term**: Read replicas, query caching, parallel query execution

The good news: No fundamental architectural changes needed, just resource tuning and strategic caching.
