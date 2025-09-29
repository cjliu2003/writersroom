# Phase 1 — Autosave & Optimistic UI (Implementation-Ready)

## Frontend
**States:** `idle → dirty → debouncing → saving → saved | offlineQueued | error`

**Debounce**
- Idle delay: **1500ms** trailing, with **maxWait 5000ms** (flush even if user keeps typing).
- Flush immediately on: blur, tab change (visibilitychange), route change, beforeunload.

**Queue (offline-friendly)**
- Persisted in IndexedDB: `scene_save_queue` items `{opId, sceneId, payload, baseVersion, createdAt, attempts}`.
- Exponential backoff with jitter: `min 1s → max 60s`, `attempts++`.
- Background worker drains queue when `navigator.onLine === true` or manual retry.

**Optimistic UI**
- On local edit: set `dirty`.
- On enqueue: show “Saving…”; on 200: “Saved”; on offline detection: “Offline — changes queued”; on 409: “Update available — reloading scene (your change kept in draft)”.

**Client payload (per save)**
```json
{
  "position": 3,
  "scene_heading": "INT. KITCHEN — DAY",
  "blocks": [/* serialized editor blocks */],
  "updated_at_client": "2025-09-27T02:12:00Z",
  "base_version": 42,
  "op_id": "uuid-v4"
}
```

**Pseudocode sketch**
```ts
useAutosave(sceneId, doc, baseVersion) {
  const q = useQueue(); // IndexedDB-backed
  const schedule = debounce(flush, 1500, {maxWait: 5000});
  onEdit(() => setDirty(true), schedule);

  async function flush() {
    const op = {opId: uuid(), sceneId, payload: doc, baseVersion};
    await q.enqueue(op);
    drain();
  }

  async function drain() {
    for await (const op of q.items()) {
      const res = await save(op).catch(e => e);
      if (res.status === 200) { baseVersion = res.body.new_version; q.ack(op) }
      else if (res.status === 409) { handleConflict(res.body); q.nack(op, {retry:false}) }
      else if (!navigator.onLine || res.status === 0) { q.retry(op) }
      else if (res.status === 429) { q.retry(op, {backoff:true}) }
      else { q.fail(op) }
    }
  }
}
```

## Backend
**Endpoint**
```
PATCH /api/scenes/{scene_id}
Headers:
  Authorization: Bearer <token>
  Idempotency-Key: <op_id>           // mirrors op_id
Body: { position, scene_heading, blocks, updated_at_client, base_version, op_id }
```

**Responses**
- `200 OK`
  ```json
  {"scene":{"id":"...","version":43,"updated_at":"..."},"new_version":43,"conflict":false}
  ```
- `409 Conflict` (base_version stale). Include server copy + latest version:
  ```json
  {"latest":{"version":45,"blocks":[...]}, "your_base_version":42, "conflict":true}
  ```
- `429 Too Many Requests` with `Retry-After`.
- `401/403` auth failures; `413` if payload too large; `422` validation errors.

**Semantics**
- **Compare-and-swap:** `base_version` must match current `scenes.version`; otherwise 409.
- **Idempotency:** If `Idempotency-Key` (or `op_id`) already seen for that user+scene, return prior 200.
- **Write-ahead versions (rollback)**
  - Tables:
    - `scenes(id, script_id, position, scene_heading, blocks JSONB, version INT, updated_at TIMESTAMPTZ, updated_by UUID)`
    - `scene_versions(id PK, scene_id, version INT, payload JSONB, saved_at TIMESTAMPTZ, saved_by UUID)`
    - `scene_write_ops(op_id UUID PK, scene_id, user_id, result JSONB, created_at)`
  - Transaction:
    1) if `op_id` exists → return stored `result`
    2) check `version == base_version` else 409
    3) `INSERT scene_versions(..., version = version+1, payload = newPayload, saved_by = user)`
    4) `UPDATE scenes SET ..., version = version+1`
    5) store `result` in `scene_write_ops` (for idempotency)

**Rate limiting (starter)**
- **Per user+scene:** 10 req / 10s (burst 5).
- **Per user total:** 100/min.
- Return `429` with `Retry-After`.

**Validation**
- `position`: integer 0..n
- `scene_heading`: ≤ 200 chars
- `blocks`: JSON schema check; size ≤ 256KB

## Conflict policy (P1)
- Default: **CAS + 409**. Frontend can either:
  1) Auto-refresh to latest and re-apply pending local change (safe if change is small), or
  2) Keep user’s unsaved delta in editor draft and show “Reloaded latest; your change is preserved locally”.
- (You’ll move to CRDT/OT in P2 collaboration.)

## UX copy (short & clear)
- Saving… → Saved
- Offline — changes queued
- Couldn’t save — retrying…
- Newer version available — reloading (your edit kept)

## Observability
- Emit: `save_latency_ms`, `save_result` (ok/409/429/5xx), `queue_depth`, `retry_count`, `conflict_rate`.
- Log op_id with user_id/scene_id for traceability.

## Definition of Done
- Debounced autosave works with idle + maxWait flush.
- Offline: disable network → edits queued and later flushed automatically.
- Idempotent PATCH (duplicate op_id doesn’t double-save).
- CAS conflict returns 409 and FE handles without data loss.
- Previous versions appear in `scene_versions` and can be rolled back quickly.
- Basic rate limit returns 429 and FE backs off.

## Minimal test matrix
- Typing pause <1.5s (no call) vs >1.5s (one call) vs continuous typing (maxWait flush).
- Toggle offline during edit; reconnect drains queue.
- Duplicate requests with same `op_id` → single version bump.
- 409 path: second tab edits then first tab saves.
- 429 path: rapid programmatic saves trigger backoff.
- 5xx transient → exponential retry with jitter.
