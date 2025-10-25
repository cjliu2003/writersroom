# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WritersRoom is a collaborative screenplay editing platform with real-time collaboration, autosave, and AI-powered features. The architecture consists of:

- **Frontend**: Next.js 14 application with Slate-based screenplay editor
- **Backend**: FastAPI application with PostgreSQL database
- **Real-time**: WebSocket collaboration using Yjs CRDT and Redis pub/sub for multi-server coordination
- **Persistence**: Yjs-primary (Yjs updates are our source of truth; REST autosave is fallback snapshot only)

## Development Setup

### Backend

```bash
# From repository root
cd backend

# Activate virtual environment (if using venv)
source .venv/bin/activate  # or: .venv\Scripts\activate on Windows

# Install dependencies
pip install -r requirements.txt

# Set up environment variables
cp .env.example .env
# Edit .env with your database credentials, Firebase config, OpenAI key, Redis URL

# Run database migrations
alembic upgrade head

# Start development server (port 8000)
python main.py
# Or with uvicorn directly:
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
# From repository root
cd frontend

# Install dependencies
npm install

# Start development server (port 3102)
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Lint code
npm run lint
```

### Environment Variables

**Backend** requires:
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (or `DB_URL_ASYNC`)
- Firebase credentials (multiple `FIREBASE_*` variables - see `.env.example`)
- `OPENAI_API_KEY` for AI features
- `REDIS_URL` for real-time collaboration (optional - falls back to single-server mode)

**Frontend** typically uses Next.js environment variables (check for `.env.local` or similar).

## Testing

### Backend Tests

```bash
cd backend

# Run all tests
pytest

# Run with verbose output
pytest -v

# Run specific test file
pytest tests/test_fdx_parser_ground_truth.py

# Run specific test function
pytest tests/test_fdx_parser_edge_cases.py::test_empty_fdx_file

# Run tests matching a pattern
pytest -k "fdx"

# Run with coverage
pytest --cov=app.services.fdx_parser --cov-report=html

# Run tests by marker
pytest -m critical        # Critical tests only
pytest -m "not slow"      # Skip slow tests
pytest -m integration     # Integration tests only
```

Test markers available: `critical`, `slow`, `integration`, `edge_case`, `performance`

### Frontend Tests

(No test framework currently configured - would use Jest/React Testing Library when added)

## Database Migrations

```bash
cd backend

# Create a new migration
alembic revision --autogenerate -m "Description of changes"

# Apply migrations
alembic upgrade head

# Rollback one migration
alembic downgrade -1

# View migration history
alembic history

# View current version
alembic current
```

Database configuration is in `backend/alembic.ini` and migration scripts are in `backend/alembic/versions/`.

## Architecture Highlights

### Real-time Collaboration System

The project implements a sophisticated multi-layer collaboration system:

1. **WebSocket Layer** (`backend/app/routers/websocket.py`)
   - Endpoint: `/api/ws/scenes/{scene_id}`
   - Implements y-websocket protocol with binary message framing
   - Message types: `MESSAGE_SYNC` (with SYNC_STEP1/STEP2/UPDATE), `MESSAGE_AWARENESS`, `MESSAGE_QUERY_AWARENESS`
   - JWT authentication via query parameter
   - Handles Yjs document synchronization with state vector exchange

2. **Redis Pub/Sub Manager** (`backend/app/services/redis_pubsub.py`)
   - Enables horizontal scaling across multiple server instances
   - Channel types per scene: `updates`, `awareness`, `join`, `leave`
   - Background listener task continuously monitors Redis channels
   - Falls back gracefully to single-server mode if Redis unavailable

3. **WebSocket Manager** (`backend/app/services/websocket_manager.py`)
   - Room-based connection tracking
   - Broadcasts messages to all participants in a scene
   - Tracks connection info with user identity, timestamps, awareness state

4. **Yjs Persistence** (`backend/app/services/yjs_persistence.py`)
   - Stores binary Yjs updates in `scene_versions` table (append-only log)
   - Supports document reconstruction by replaying all updates
   - Enables version history and recovery

### Autosave System (Optimistic Concurrency)

Implements compare-and-swap (CAS) semantics with conflict detection:

1. **Frontend Hook** (`frontend/hooks/use-autosave.ts`)
   - Debounced saves: 1500ms trailing, maxWait 5000ms
   - Save states: `idle`, `pending`, `saving`, `saved`, `offline`, `conflict`, `error`, `rate_limited`
   - IndexedDB offline queue for resilience
   - Automatic conflict resolution with manual fallback UI

2. **Backend Router** (`backend/app/routers/scene_autosave_router.py`)
   - Endpoint: `PATCH /api/scenes/{scene_id}`
   - Idempotency via `Idempotency-Key` header or `op_id` UUID
   - Rate limiting: 10 req/10s per user+scene, 100/min per user
   - Returns HTTP 409 on version conflicts with latest server state

3. **Scene Service** (`backend/app/services/scene_service.py`)
   - `update_scene_with_cas()` implements optimistic locking
   - Uses `SELECT FOR UPDATE` to prevent race conditions
   - Creates `SceneSnapshot` for version history
   - Tracks `SceneWriteOp` for idempotency

### FDX Parser

The Final Draft XML parser (`backend/app/services/fdx_parser.py`) is a critical component with extensive testing:

- Preserves all content elements during import/export
- Handles screenplay-specific formatting (scene headings, dialogue, parentheticals, transitions)
- Test suite includes ground truth validation, content preservation checks, and edge case handling
- Test files in `test_assets/` directory (various real-world FDX files)

### Database Schema Key Tables

- **scenes**: Scene content with `version` (integer) for optimistic locking, `blocks` (JSONB)
- **scene_versions**: Append-only Yjs updates (`update` binary field, sequential by `created_at`)
- **scene_snapshots**: Point-in-time snapshots for version history
- **scene_write_ops**: Idempotency tracking (`op_id` → result mapping)
- **scripts**: Screenplay documents
- **script_collaborators**: User access control with roles (OWNER, EDITOR, VIEWER)
- **chat_conversations** / **chat_messages**: AI chat history
- **scene_embeddings**: Vector embeddings for semantic search (uses `pgvector`)

### Frontend Architecture

1. **Yjs Collaboration Hook** (`frontend/hooks/use-yjs-collaboration.ts`)
   - Manages WebSocket connection lifecycle
   - Connection states: `connecting`, `connected`, `synced`, `offline`, `error`
   - Exponential backoff retry (max 5 attempts)
   - Heartbeat timer (10s intervals) for presence
   - Returns: `doc`, `provider`, `awareness`, `isConnected`, `syncStatus`

2. **Editor Components**
   - `screenplay-editor.tsx`: Base Slate-based editor with screenplay formatting
   - `screenplay-editor-with-autosave.tsx`: Wrapper integrating autosave + Yjs + conflict resolution
   - Implements "seeded document" pattern to handle scene-level editing within full script Yjs doc

3. **Conflict Resolution**
   - `conflict-resolution-dialog.tsx`: UI for manual conflict resolution
   - `autosave-indicator.tsx`: Visual save state feedback
   - Auto-fast-forward on first conflict, manual resolution if that fails

## Key Implementation Patterns

### Hybrid Persistence Model

The system runs **both** autosave and Yjs simultaneously:
- Yjs provides real-time CRDT-based merging during active collaboration
- Autosave provides snapshot-based versioning and offline resilience
- Yjs updates take precedence during collaboration
- Both systems write to database (Yjs → `scene_versions`, autosave → `scenes` + `scene_snapshots`)

### Multi-Server Coordination

Redis pub/sub enables multiple FastAPI instances to coordinate:
- Each server subscribes to scene channels on WebSocket connect
- Updates published to Redis are broadcast to all connected servers
- Servers forward updates to their local WebSocket clients
- Graceful degradation if Redis unavailable (single-server mode)

### Authentication Flow

1. Frontend obtains Firebase JWT token
2. Token passed in `Authorization: Bearer <token>` header (REST) or query param (WebSocket)
3. Backend verifies token via Firebase Admin SDK
4. Firebase UID mapped to internal User UUID
5. Access control via `ScriptCollaborator` relationship checks

## Common Patterns

### Adding a New API Endpoint

1. Create router file in `backend/app/routers/`
2. Define Pydantic schemas in `backend/app/schemas/`
3. Add business logic in `backend/app/services/` (if complex)
4. Include router in `backend/main.py`
5. Add authentication dependency: `current_user: User = Depends(get_current_user)`
6. Check authorization via `scene_service.validate_scene_access()` or similar

### Adding a New Database Model

1. Create model in `backend/app/models/` inheriting from `Base`
2. Import in `backend/alembic/env.py` to ensure autogenerate picks it up
3. Run `alembic revision --autogenerate -m "Add model_name"`
4. Review generated migration, edit if necessary
5. Apply: `alembic upgrade head`

### Adding a New React Hook

1. Create in `frontend/hooks/use-*.ts`
2. Follow naming convention: `use` prefix
3. Use TypeScript for type safety
4. Handle cleanup in `useEffect` return functions
5. Memoize expensive computations with `useMemo`/`useCallback`

## File Upload / FDX Import

FDX files are parsed server-side:
- Endpoint: `POST /api/fdx/upload` (check `backend/app/routers/fdx_router.py`)
- Uses `fdx_parser.parse_fdx()` to extract scenes
- Creates `Script` and multiple `Scene` records
- Stores original FDX in Supabase storage (via `storage3` client)

## AI Features

OpenAI integration (`backend/app/services/openai_service.py`):
- `generate_scene_summary()`: Summarizes scene content
- `generate_chat_response()`: Context-aware chat using recent scene summaries
- Uses GPT-3.5-turbo via httpx async HTTP client
- Endpoints in `backend/app/routers/ai_router.py`

## Documentation

Extensive documentation in `docs/` directory:
- `autosave_spec.md`: Phase 1 autosave implementation details
- `REALTIME_COLLABORATION_SPEC.md`: Phase 2 Yjs collaboration architecture
- `FDX_PARSER_TESTING.md`: FDX parser test strategy
- `TESTING_STRATEGY.md`: Overall testing approach
- Various implementation summaries and diagnostic reports

## Important Constraints

### Rate Limiting

Autosave endpoints are rate-limited:
- Per user+scene: 10 requests per 10 seconds
- Per user total: 100 requests per minute
- Returns HTTP 429 with `Retry-After` header

Frontend must implement exponential backoff on 429 responses.

### Payload Size Limits

Scene content limited to **256KB** via `PayloadSizeLimiter` middleware.

### WebSocket Lifecycle

- Clients must handle reconnection (exponential backoff, max 5 attempts)
- Awareness state removed on disconnect
- Heartbeat required to maintain presence (10s intervals recommended)

### Optimistic Locking

All scene updates MUST include `base_version` for CAS semantics. Missing or stale version → HTTP 409 conflict response.

### Idempotency

All mutating operations should include `op_id` (UUID v4) for idempotency. Backend stores results keyed by `op_id` to deduplicate retries.

## Technology Stack

**Backend:**
- FastAPI 0.109.2
- SQLAlchemy 2.0.28 (async with asyncpg driver)
- Alembic (migrations)
- PostgreSQL 14+ with pgvector extension
- Redis 7.0+ for pub/sub
- y-py 0.6.2 (Python Yjs bindings)
- Firebase Admin SDK (authentication)
- OpenAI API (via httpx)

**Frontend:**
- Next.js 14.2
- React 18
- Slate 0.118 (rich text editor)
- Yjs 13.6 with y-websocket 1.5
- Tailwind CSS 4.1
- Radix UI components
- Firebase client SDK

**Infrastructure:**
- Supabase (managed PostgreSQL)
- Redis (local or managed service)
- WebSocket-capable load balancer required for production
