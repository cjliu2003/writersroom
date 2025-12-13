# AI Ingestion Pipeline - Performance Analysis & Optimization Plan

## Executive Summary

The current pipeline runs **entirely sequentially**, taking ~5 minutes for a 100-scene script. With the recommended optimizations, this can be reduced to **~26 seconds** (11x improvement).

---

## Current Architecture Analysis

### Execution Flow (`trigger_full_analysis`)

```
PHASE 1: Scene Summaries
└── FOR each scene (SEQUENTIAL):
    ├── SELECT to check if exists       ← N+1 query
    ├── Claude API call (~2s)           ← Sequential bottleneck
    └── COMMIT                          ← Per-item transaction

PHASE 2: Script Outline
└── Single Claude API call (~5s)

PHASE 3: Character Sheets
└── FOR each character (SEQUENTIAL):
    ├── SELECT to check if exists       ← N+1 query
    ├── SELECT scenes for character     ← N+1 query
    ├── Claude API call (~3s)           ← Sequential bottleneck
    └── COMMIT                          ← Per-item transaction

PHASE 4: Embeddings
└── FOR each scene (SEQUENTIAL):
    ├── SELECT to check if exists       ← N+1 query
    ├── SELECT scene for script_id      ← N+1 query
    ├── OpenAI API call (~0.5s)         ← Sequential bottleneck
    └── COMMIT                          ← Per-item transaction
```

### Current Timing (100 scenes, 10 characters)

| Step | Operations | Time/Op | Total |
|------|-----------|---------|-------|
| Scene Summaries | 100 sequential | ~2s | **200s** |
| Outline | 1 | ~5s | **5s** |
| Character Sheets | 10 sequential | ~3s | **30s** |
| Embeddings | 100 sequential | ~0.5s | **50s** |
| **TOTAL** | | | **~285s (4.75 min)** |

---

## Dependency Graph

```
        ┌─────────────────┐
        │  Scene Summaries │  ← MUST complete first
        │  (can parallelize │
        │   internally)     │
        └────────┬──────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
    ▼            ▼            ▼
┌───────┐  ┌─────────┐  ┌──────────┐
│Outline│  │Character│  │Embeddings│
│       │  │ Sheets  │  │          │
└───────┘  └─────────┘  └──────────┘
    │            │            │
    └────────────┴────────────┘
                 │
        ALL CAN RUN IN PARALLEL
        (read-only on summaries)
```

### Key Insight

Summaries are the only hard dependency. After summaries complete, outline/sheets/embeddings:
- Read from `scene_summaries` table (no writes)
- Write to different tables (no conflicts)
- **Can safely run concurrently**

---

## Optimization Recommendations

### 🔴 HIGH PRIORITY

#### 1. Parallelize Scene Summary Generation

**Location**: `ingestion_service.py:batch_generate_scene_summaries()`

```python
# BEFORE: Sequential
for scene in scenes:
    await generate_scene_summary(scene)  # 100 × 2s = 200s

# AFTER: Parallel with semaphore
async def parallel_summaries(scenes, max_concurrent=10):
    semaphore = asyncio.Semaphore(max_concurrent)

    async def generate_one(scene):
        async with semaphore:
            return await generate_scene_summary(scene)

    return await asyncio.gather(*[generate_one(s) for s in scenes])
# Result: 100 scenes / 10 concurrent = 10 batches × 2s = 20s
```

| Metric | Before | After |
|--------|--------|-------|
| Time | 200s | 20s |
| Improvement | - | **10x faster** |
| Risk | - | Low (scenes independent) |

---

#### 2. Use OpenAI Batch Embeddings API

**Location**: `embedding_service.py:batch_embed_scene_summaries()`

```python
# BEFORE: One API call per scene
for summary in summaries:
    embedding = await generate_embedding(summary.text)  # 100 calls

# AFTER: Single batch call
async def batch_embeddings(summaries):
    texts = [s.summary_text for s in summaries]

    response = await client.post("/embeddings", json={
        "model": "text-embedding-3-small",
        "input": texts,  # Array of ALL texts (up to 2048)
    })

    return response["data"]  # Returns array of embeddings
# Result: 1 API call instead of 100
```

| Metric | Before | After |
|--------|--------|-------|
| API Calls | 100 | 1 |
| Time | 50s | 2s |
| Improvement | - | **25x faster** |
| Risk | - | None (native API support) |

---

### 🟡 MEDIUM PRIORITY

#### 3. Parallelize Phase 2 (Outline + Sheets + Embeddings)

**Location**: `script_state_service.py:trigger_full_analysis()`

```python
# BEFORE: Sequential phases
await generate_outline(script_id)      # 5s
await generate_character_sheets(...)   # 30s
await generate_embeddings(...)         # 50s
# Total: 85s

# AFTER: Concurrent execution
results = await asyncio.gather(
    generate_outline(script_id),
    parallel_character_sheets(script_id),
    batch_embeddings(script_id),
)
# Total: max(5s, 6s, 2s) = 6s
```

| Metric | Before | After |
|--------|--------|-------|
| Time | 85s | 6s |
| Improvement | - | **14x faster** |
| Risk | - | Low (no write conflicts) |

---

#### 4. Parallelize Character Sheet Generation

**Location**: `ingestion_service.py:batch_generate_character_sheets()`

```python
# BEFORE: Sequential
for char_name in characters:
    await generate_character_sheet(char_name)  # 10 × 3s

# AFTER: Parallel
async def parallel_sheets(characters, max_concurrent=5):
    semaphore = asyncio.Semaphore(max_concurrent)

    async def generate_one(name):
        async with semaphore:
            return await generate_character_sheet(name)

    return await asyncio.gather(*[generate_one(c) for c in characters])
# Result: 10 chars / 5 concurrent = 2 batches × 3s = 6s
```

| Metric | Before | After |
|--------|--------|-------|
| Time | 30s | 6s |
| Improvement | - | **5x faster** |
| Risk | - | Low (sheets independent) |

---

### 🟢 LOW PRIORITY (DB Optimizations)

#### 5. Eliminate N+1 Queries with Pre-fetch

**Location**: All batch generation methods

```python
# BEFORE: N+1 pattern
for scene in scenes:
    existing = await db.execute(
        select(SceneSummary).where(SceneSummary.scene_id == scene.scene_id)
    )  # 100 queries!

# AFTER: Single pre-fetch
scene_ids = [s.scene_id for s in scenes]
existing_result = await db.execute(
    select(SceneSummary).where(SceneSummary.scene_id.in_(scene_ids))
)
existing_map = {s.scene_id: s for s in existing_result.scalars()}

for scene in scenes:
    existing = existing_map.get(scene.scene_id)  # In-memory lookup
```

| Metric | Before | After |
|--------|--------|-------|
| Queries | ~300 | ~10 |
| Improvement | - | **30x fewer queries** |
| Risk | - | None |

---

#### 6. Batch Database Commits

**Location**: All generation methods

```python
# BEFORE: Commit per item
for scene in scenes:
    summary = SceneSummary(...)
    db.add(summary)
    await db.commit()  # 100 commits!

# AFTER: Single batch commit
summaries_to_add = []
for scene in scenes:
    summary = SceneSummary(...)
    summaries_to_add.append(summary)

db.add_all(summaries_to_add)
await db.commit()  # 1 commit
```

| Metric | Before | After |
|--------|--------|-------|
| Commits | ~210 | ~4 |
| Improvement | - | **50x fewer commits** |
| Risk | - | Medium (need error handling) |

---

## Optimized Flow

```
PHASE 1: Scene Summaries (Parallel)           ~20s
├── Pre-fetch existing summaries (1 query)
├── Parallel Claude API calls (semaphore=10)
└── Batch commit

PHASE 2: All Concurrent                        ~6s
├── Outline (1 Claude call)                    │
├── Character Sheets (parallel, semaphore=5)   │ CONCURRENT
└── Embeddings (1 batch OpenAI call)           │

TOTAL: ~26 seconds
```

---

## Performance Comparison

| Metric | Current | Optimized | Improvement |
|--------|---------|-----------|-------------|
| **Total Time** | 285s | 26s | **11x faster** |
| Claude API Calls | 111 seq | 111 parallel | Same count, parallel |
| OpenAI API Calls | 100 | 1 | **100x fewer** |
| DB Queries | ~400 | ~10 | **40x fewer** |
| DB Commits | ~210 | ~4 | **50x fewer** |

---

## Implementation Safety Checklist

| Concern | Risk Level | Mitigation |
|---------|------------|------------|
| API Rate Limits | Medium | Semaphore limits concurrent calls |
| DB Conflicts | Low | Each entity has unique ID, no overlap |
| Partial Failures | Medium | Use `return_exceptions=True`, graceful degradation |
| Memory | Low | 100 scenes ≈ 1MB, manageable |
| Connection Pool | Medium | Semaphore + batch commits protect pool |
| Order Dependencies | None | Two-phase design respects dependencies |

---

## Recommended Implementation Order

| Priority | Optimization | Impact | Complexity |
|----------|-------------|--------|------------|
| 1 | OpenAI batch embeddings | 25x faster embeddings | Low |
| 2 | Parallel scene summaries | 10x faster summaries | Medium |
| 3 | Parallel Phase 2 | 14x faster Phase 2 | Medium |
| 4 | Parallel character sheets | 5x faster sheets | Low |
| 5 | DB pre-fetch patterns | 30x fewer queries | Low |
| 6 | Batch commits | 50x fewer commits | Low |

---

## Files to Modify

1. **`backend/app/services/embedding_service.py`**
   - Add `batch_generate_embeddings()` using OpenAI array input
   - Modify `batch_embed_scene_summaries()` to use batch method

2. **`backend/app/services/ingestion_service.py`**
   - Add `parallel_generate_scene_summaries()` with semaphore
   - Add `parallel_generate_character_sheets()` with semaphore
   - Add pre-fetch logic to eliminate N+1 queries

3. **`backend/app/services/script_state_service.py`**
   - Modify `trigger_full_analysis()` to use `asyncio.gather()` for Phase 2
   - Modify `trigger_partial_ingestion()` for parallel summaries

4. **`backend/app/tasks/ai_ingestion_worker.py`**
   - Update worker functions to use optimized service methods

---

## Testing Strategy

1. **Unit Tests**: Test each parallel function in isolation
2. **Integration Tests**: Test full pipeline with mock API responses
3. **Load Tests**: Test with large scripts (100+ scenes)
4. **Failure Tests**: Test partial failure handling and rollback

---

## Rollback Plan

Each optimization can be toggled independently via feature flags:

```python
# settings.py
PARALLEL_SCENE_SUMMARIES = True
PARALLEL_CHARACTER_SHEETS = True
BATCH_EMBEDDINGS = True
PARALLEL_PHASE_2 = True
```

If issues arise, disable specific optimizations without full rollback.
