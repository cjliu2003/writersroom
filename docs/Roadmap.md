# WritersRoom Roadmap

Last updated: 2025-09-26

## Vision
WritersRoom is a collaborative screenwriting tool that enhances, not replaces, the writer. We provide real‑time collaboration, structured project knowledge, and AI assistance for summarization, character and prop tracking, thematic analysis, and brainstorming.

## Guiding Principles
- **Assist, don’t author**: AI proposes; humans decide. Keep transparent controls and traceability.
- **Low-friction collaboration**: Autosave, presence, conflict-safe edits, role-based access.
- **Structured knowledge first**: Scenes are the atomic unit. Derive project-level insights from scenes.
- **Scalable context**: Move from “pass everything” to retrieval (RAG) as scripts grow.
- **Safe and observable**: Strong logging, metrics, rate-limits, privacy, and versioning.

## Architecture Snapshot (Today)
- Backend: FastAPI + SQLAlchemy (async). Dual DB URLs: `DB_URL_ASYNC` (asyncpg) and `DB_URL_SYNC` (psycopg2 for Alembic).
- Data: Postgres (scripts, scenes, embeddings, scene_versions, chat tables).
- Frontend: Next.js 14 (app router), Tailwind v4.
- Auth: Firebase (configured). Supabase storage planned for FDX uploads.

Key tables already present and referenced in code/logs:
- `scripts`, `scenes`, `scene_embeddings`, `scene_versions` (Yjs-ready), chat tables.

## Phase 0 — Stabilization and Foundations (immediate)
- **Finalize Tailwind v4 setup** and restore existing theming (done).
- **Dependency hygiene**: lock Next.js >= 14.2.33; install missing UI libs (Radix), Slate.
- **DX/Prod parity**: `.env.example` and docs for `DB_URL_ASYNC`, `DB_URL_SYNC`, `FIREBASE_CREDENTIALS_JSON`, plus Supabase vars (see below).
- **Observability seed**: structured logs + request IDs; basic error boundaries.

Acceptance criteria
- App boots locally with styles, basic editor loads existing scripts, dialogs work.
- Readme docs allow a new dev to stand up the stack in <15 minutes.

## Phase 1 — Autosave and Collaboration (P1 now, P2 later)
### P1: Debounced autosave with optimistic UI
- **Frontend**
  - Debounce scene edits (e.g., 1–2s idle). Show “Saving…/Saved” indicator.
  - Save granularity: per scene. Include scene `position`, `scene_heading`, and serialized blocks.
  - Offline-friendly queue (retry on backoff; mark unsynced state).
- **Backend**
  - `PATCH /api/scenes/{scene_id}` upsert text/blocks, update `updated_at`.
  - Write ahead: store previous version as a row for quick rollback.
  - Rate limit by user/script (basic protection).

### P2: Realtime presence + CRDT (Yjs) alignment
- **Transport**: WebSocket endpoint broadcasting Yjs updates per scene.
- **Persistence**: Append-only `scene_versions (scene_id, version_id, yjs_update, created_at)` (table exists). Compact periodically.
- **Conflict safety**: CRDT gives last-write wins semantics without locks.
- **Migration path**: P1 autosave → toggle Yjs per script. Coexist while stabilizing.

Acceptance criteria
- P1: No data loss on navigation; explicit save no longer required. Simple offline edits sync when online.
- P2: Two users can edit the same scene without conflicts; presence cursors visible.

## Phase 2 — RAG Chatbot (context at scale)
### Ingestion & Embeddings
- **Scene embeddings**: Persist in `scene_embeddings` (exists). Only re-embed changed scenes.
- **Metadata**: characters, props, locations, themes on each scene row to filter retrieval.

### Retrieval
- **Hybrid**: Vector (cosine) + BM25 (PG full-text) with weighted merge. Optional keyword pre-filter by characters/locations.
- **Top‑K policy**: K = 5–10 scenes by default; dynamic by token budget.

### Context Assembly
- **Layers**
  - Global synopsis (≤ 500 tokens), updated by background job.
  - Character bios for entities found in the question (≤ 300 tokens per entity).
  - Top‑K scenes (title, slugline, short summary, quoted snippets).
  - Conversation summary (rolling; see Phase 3).
- **Policies**
  - Token budget gate with backoff: drop least relevant scenes first, then shorten bios, then compress synopsis.
  - For “general” questions: always include synopsis + outline (scene list with 1-liners).

### APIs
- `POST /api/chat/ask` → retrieval → prompt assembly → LLM call → stream response.
- Background: cron to (re)build synopsis, entity bios when scripts change.

Acceptance criteria
- Questions referencing prior scenes/characters return grounded answers with citations (scene ids/lines).
- General questions use synopsis and outline effectively.

## Phase 3 — Autotracking (props, characters, themes)
### Triggering model
- **On edit**: mark scene dirty; throttle to background worker.
- **On import**: enqueue all scenes.

### Processing pipeline
- **Background worker** (FastAPI BackgroundTasks initially; migrate to Celery/RQ later if needed).
- **LLM calls** with structured output (JSON schema) for:
  - Scene summary (short and detailed)
  - Detected characters, locations, props
  - Themes/tones
- **Storage**
  - Update `scenes` derived columns (summary, tokens, word_count, characters, themes).
  - Maintain project-level indexes: character registry, prop registry with references (scene_ids, counts).

### UX
- Show “Auto‑tracked” sidebars: Characters, Props, Themes. Click-through to source scenes.
- “Mark wrong” feedback loop to correct or dismiss items. Store feedback and retrain prompts.

Acceptance criteria
- Editing a scene updates its derived data within seconds to a minute.
- Registries remain consistent across script versions.

## Phase 4 — Chat History Strategy
- **Sessions**: Per-script conversation sessions. Allow renaming and archiving.
- **Rolling memory**: Keep last N messages raw (e.g., 10–20). Summarize older into a compact digest stored per session.
- **Pinning**: Allow users to pin facts; pins join the context ahead of retrieval output.
- **Privacy**: Scope chat strictly to the selected script unless user opts into cross-project recall.

Acceptance criteria
- Long chats remain coherent; token use remains bounded; summaries are surfaced in UI.

## Phase 5 — Sharing & Permissions
- **Roles**: owner, editor, commenter, viewer (no access). Already aligned with `script_collaborators`.
- **Invites**: email invite flow with accept/decline; backend validates permissions on every route and socket.
- **Audit**: basic audit log for changes and invites.

Acceptance criteria
- A commenter cannot modify scenes; a viewer cannot see private scripts; invitations work end‑to‑end.

## Phase 6 — Editor Enhancements (rolling backlog)
- Type system refinements; better dual dialogue handling.
- Snippet actions (rewrite line, punch‑up, shorten) with inline AI suggestions.
- Scene outline view; drag‑to‑reorder scenes.
- FDX export; PDF export with proper pagination.

## Phase 7 — Observability & Quality
- **Logging**: structured logs with request_id across FE/BE.
- **Metrics**: success rates, latency for chat/autotrack, token usage per feature.
- **Error capture**: Sentry in FE/BE.
- **Test**: regression tests for parser and scene extraction (fixtures in `frontend/__tests__/fixtures/`).

## Phase 8 — Security & Privacy
- Secrets in `.env` (never in repo). Rate limiting sensitive routes.
- PII redaction in logs. Per-tenant isolation by script_id checks everywhere.
- Content safety for LLM prompts/outputs.

## Phase 9 — Deployments & Environments
- **Envs**: dev/staging/prod with distinct DBs.
- **Migrations**: Alembic via `DB_URL_SYNC`; app uses `DB_URL_ASYNC`.
- **Workers**: background queue (start with FastAPI BackgroundTasks; plan Celery/RQ if load grows).
- **Static hosting**: Next.js on Vercel or containerized; FastAPI on a managed VM/container service.

## Supabase Storage (FDX)
Add to `.env` and config:
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_BUCKET=fdx
```
Use for source FDX uploads and raw file versions; parse → DB. Keep file to allow re‑parse with improved logic.

## Milestones & Order of Work
1. **Phase 0 – Stabilization** (1 week)
   - Styling fixed, missing deps installed, docs refreshed.
2. **Phase 1 – Autosave P1** (1–2 weeks)
   - Debounced per‑scene save, offline queue, save indicator, endpoint + basic versioning.
3. **Phase 2 – RAG P1** (2–3 weeks)
   - Embeddings pipeline, hybrid retrieval, context assembler, streaming chat endpoints.
4. **Phase 3 – Autotracking P1** (2 weeks)
   - Background extraction for summaries/props/characters/themes; basic sidebars.
5. **Phase 1 – Autosave P2 (Realtime/Yjs)** (2–3 weeks)
   - WebSocket + Yjs updates; persist to `scene_versions`; presence cursors.
6. **Phase 4 – Chat History** (1 week)
   - Sessions, rolling summaries, pins.
7. **Phase 5 – Permissions** (1 week)
   - Roles enforced across API and UI.
8. **Phase 7/8 – Observability & Security** (ongoing)
   - Sentry, metrics, rate limits.

## Acceptance Criteria by Theme
- **Autosave**: No accidental data loss; visual save state; 500ms–2s save latency.
- **RAG**: Answers cite scenes; general questions coherent without manual scene selection.
- **Autotracking**: Derived data updates within 60s; user corrections stick.
- **Chat history**: Long sessions remain coherent; token usage bounded.
- **Permissions**: Role enforcement validated by integration tests.

## Open Questions
- When to migrate to a dedicated worker (Celery/RQ) vs. FastAPI BackgroundTasks?
- Which LLM(s) to standardize on for structured extraction vs. chat? (cost/latency tradeoffs)
- Vector index inside Postgres vs. external (e.g., pgvector vs. hosted vector DB)?

## Next 3 Action Items (Now)
- Fix any lingering FE dependency gaps; lock versions.
- Implement Phase 1 P1 debounced autosave + backend endpoint.
- Add embeddings job for scenes + a minimal retrieval API consumed by chatbot.
