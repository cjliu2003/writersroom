# Performance Timing Diagnostics

## Overview
Comprehensive timing instrumentation has been added to diagnose slow API responses, particularly for high-latency connections (e.g., Croatia → California).

## Implementation

### 1. Timing Middleware (`app/middleware/timing.py`)
Provides reusable timing utilities:

- **`TimingContext`**: Sync context manager for timing code blocks
- **`async_timing_context()`**: Async context manager with detailed logging
- **`@time_function`**: Decorator for automatic function timing

**Features**:
- Color-coded output based on duration (✅ <100ms, ⚠️ 100-1000ms, 🔴 >1000ms)
- Millisecond precision timing using `time.perf_counter()`
- Automatic error handling and failure logging

### 2. Instrumented Endpoints

#### GET `/api/users/me/scripts`
**Purpose**: Fetch user's owned scripts

**Timing Breakdown**:
- 🔍 **DB Query**: Time spent executing `SELECT` on scripts table
- 📦 **Serialization**: Time converting SQLAlchemy objects to JSON
- ⚙️  **Total Processing**: Combined processing + serialization time
- ✅ **Total Endpoint**: Complete request-response cycle

**Example Output**:
```
[get_user_scripts] ⏱️  ENDPOINT START - user_id: 2157d1b1...
[get_user_scripts] 🔍 DB Query took 23450.25ms
[get_user_scripts] 📊 Found 3 scripts
[get_user_scripts] 📦 Serialization took 1.23ms
[get_user_scripts] ⚙️  Total processing took 15.67ms
[get_user_scripts] ✅ ENDPOINT COMPLETE - Total: 23465.92ms
[get_user_scripts] 📊 Breakdown: Query=23450.25ms, Processing=15.67ms
```

#### GET `/api/users/me/collaborations`
**Purpose**: Fetch scripts where user is a collaborator

**Timing Breakdown**:
- 🔍 **DB Query (JOIN)**: Time for `SELECT` with `JOIN` on `script_collaborators`
- 📦 **Serialization**: JSON conversion time
- ⚙️  **Total Processing**: Combined processing time
- ✅ **Total Endpoint**: Complete cycle

**Notes**: JOIN operations may be slower than simple SELECT queries due to additional table lookups.

## Interpreting Results

### Normal Performance (Local/Low Latency)
- **DB Query**: 10-50ms
- **Serialization**: <5ms
- **Total**: <100ms

### High Latency (Croatia → California)
- **DB Query**: 10,000-30,000ms (10-30 seconds!) ⚠️
- **Serialization**: <5ms
- **Total**: ~10,000-30,000ms

### Root Cause Identification
Compare timing breakdown to identify bottlenecks:

1. **Database Latency**: If DB Query >> Processing
   - **Cause**: Network roundtrip time to Supabase (us-west-1)
   - **Solution**: Already using connection pooler, increased timeouts to 60s
   - **Mitigation**: Use Supabase Edge Functions or CDN caching

2. **Serialization Overhead**: If Serialization >> DB Query
   - **Cause**: Large result sets, complex object graphs
   - **Solution**: Optimize serialization, use pagination

3. **Processing Logic**: If Processing >> DB Query
   - **Cause**: Complex business logic, N+1 queries
   - **Solution**: Optimize algorithms, batch queries

## Usage

### View Timing Logs
```bash
# Backend logs with timing info
tail -f backendLogs.txt | grep "TIMING\|⏱️\|✅\|⚠️\|🔴"
```

### Add Timing to New Endpoints
```python
from app.middleware.timing import async_timing_context
import time

@router.get("/my/endpoint")
async def my_endpoint(db: AsyncSession = Depends(get_db)):
    endpoint_start = time.perf_counter()
    print(f"[my_endpoint] ⏱️  ENDPOINT START")

    try:
        # Time specific operations
        async with async_timing_context("my_endpoint - DB Query"):
            query_start = time.perf_counter()
            result = await db.execute(...)
            query_duration = (time.perf_counter() - query_start) * 1000
            print(f"[my_endpoint] 🔍 DB Query took {query_duration:.2f}ms")

        endpoint_duration = (time.perf_counter() - endpoint_start) * 1000
        print(f"[my_endpoint] ✅ ENDPOINT COMPLETE - Total: {endpoint_duration:.2f}ms")

        return result
    except Exception as e:
        endpoint_duration = (time.perf_counter() - endpoint_start) * 1000
        print(f"[my_endpoint] ❌ ERROR after {endpoint_duration:.2f}ms: {e}")
        raise
```

## Current Findings

### WebSocket Connection Issue (FIXED)
**Problem**: Script WebSocket connections timing out before acceptance

**Root Cause**: Database queries (auth + script verification) taking 10-20+ seconds due to Croatia → California latency. Connection closed BEFORE `websocket.accept()` was called.

**Solution**: Moved `await websocket.accept()` to the START of the handler, BEFORE any slow database operations. This keeps the connection alive while queries complete.

**Files Modified**:
- `backend/app/routers/script_websocket.py`: Accept connection first (line 125)

### HTTP Endpoint Slowness (FIXED - SQLAlchemy N+1 Query Problem)
**Problem**: `/api/users/me/scripts` taking 31+ seconds

**Root Cause**: SQLAlchemy eager loading 8 unnecessary relationships via `lazy='selectin'`
- Script model has 11 relationships, 8 with `lazy='selectin'` strategy
- Each relationship triggers separate SELECT query
- Total: 9 database roundtrips (1 main query + 8 relationship queries)
- With Croatia → California latency: 9 queries × 3.5s = 31.5 seconds
- **None of the loaded relationship data was used in the response!**

**Solution**: Select only the specific columns needed instead of loading entire Script objects
```python
# Before: Loading entire Script objects with all relationships
scripts = await db.execute(
    select(Script).where(Script.owner_id == current_user.user_id)
)

# After: Select only the 5 columns we need
result = await db.execute(
    select(
        Script.script_id,
        Script.title,
        Script.description,
        Script.created_at,
        Script.updated_at
    )
    .where(Script.owner_id == current_user.user_id)
)
```

**Impact**:
- Reduces 9 queries → 1 lightweight query
- Prevents loading 18 columns + 8 relationships
- Response time: 31.5s → 3.5s (88% improvement!)
- Smaller network payload (5 columns vs 18 columns)
- Still has geographic latency, but 9x faster

**Files Modified**:
- `backend/app/routers/user_router.py`: Changed to column-specific SELECT (lines 88-97)

### Script Content Loading Optimization (FIXED - Multiple N+1 Query Problems)
**Problem**: `GET /scripts/{script_id}/content` experiencing similar N+1 query issues

**Root Causes Identified**:
1. **Script Access Check** (`script_websocket.py:54`): Loading entire Script object → 9 queries (1 main + 8 relationships)
2. **Content Endpoint Helper** (`script_router.py:51`): Loading entire Script object → 9 queries (1 main + 8 relationships)
3. **Scene Fallback Logic** (`script_router.py:157-162`): Loading all Scene objects → 1 + (N scenes × 3 relationships) queries
   - For 10 scenes: 31 total queries (1 main + 30 relationship queries)
   - **Each scene triggers 3 additional queries**: script, last_editor, versions relationships

**Solutions Implemented**:
1. **WebSocket Access Check**: Select only 5 needed columns (script_id, owner_id, title, updated_at, content_blocks)
   - Reduces 9 queries → 1 lightweight query
   - File: `script_websocket.py` lines 52-117

2. **REST Content Helper**: Select only 13 columns actually used in response
   - Prevents loading 8 unnecessary relationships
   - Reduces 9 queries → 1 lightweight query
   - File: `script_router.py` lines 54-143

3. **Scene Fallback**: Select only 2 needed columns (position, content_blocks)
   - Prevents loading 3 relationships per scene
   - For 10 scenes: reduces 31 queries → 1 query (97% query reduction!)
   - File: `script_router.py` lines 214-239

**Impact**:
- Script content loading: 9 queries → 1 query (89% reduction)
- Scene fallback (10 scenes): 31 queries → 1 query (97% reduction)
- Combined with 3.5s latency: potential savings of 28s+ for scene-heavy scripts
- Fixes "script won't load" issue caused by slow content loading timing out frontend

**Files Modified**:
- `backend/app/routers/script_websocket.py`: Optimized access check (lines 52-117)
- `backend/app/routers/script_router.py`: Optimized helper and scene fallback (lines 54-239)

**Bug Fix** (2024-12-12):
- Fixed AttributeError where ScriptAccessInfo was missing `updated_at` and `content_blocks` attributes
- WebSocket handler needs these fields for Yjs initialization logic (comparing REST vs Yjs timestamps)
- Updated ScriptAccessInfo to include all 5 required fields

**Remaining Optimization Opportunities**:
1. Redis caching for frequently accessed user scripts and content
2. Database read replicas in EU region (would reduce 3.5s → <100ms)
3. Similar optimization audit needed for other endpoints using Script/Scene models

## Related Files
- `backend/app/middleware/timing.py`: Timing utilities
- `backend/app/routers/user_router.py`: Instrumented user endpoints
- `backend/app/routers/script_websocket.py`: Fixed WebSocket timing issue
- `backend/TIMING_DIAGNOSTICS.md`: This document
