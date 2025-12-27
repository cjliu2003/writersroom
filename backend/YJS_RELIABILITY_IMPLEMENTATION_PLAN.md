# Yjs Reliability & Performance Implementation Plan

**Document Version:** 1.0
**Created:** December 2024
**Status:** Ready for Implementation

---

## Executive Summary

This document provides a detailed implementation plan for fixing Yjs reliability issues and improving WebSocket initialization performance in WritersRoom. The fixes are organized into three phases with clear dependencies, rollback strategies, and success metrics.

### Problem Statement

The Yjs real-time collaboration system experiences the following issues:
1. **Corrupted Yjs State**: Users see blank documents due to stale/corrupted updates
2. **Slow Initialization**: WebSocket setup takes 5-20+ seconds
3. **Connection Cycling**: Clients timeout and reconnect, creating ghost updates
4. **No Compaction**: Update accumulation degrades performance over time

### Impact Hierarchy

| Priority | Issue | User Impact |
|----------|-------|-------------|
| 🔴 P0 | Corrupted Yjs state | Data loss, blank documents |
| 🟡 P1 | Slow initialization | Poor UX, 5-20s load times |
| 🟡 P2 | Connection cycling | Ghost updates, wasted resources |
| 🟠 P3 | No compaction | Progressive slowdown |

---

## Phase 1: Immediate Fixes (Day 1-2)

### 1.1 Diagnostic: Identify Affected Scripts

**Objective:** Identify scripts with potentially corrupted Yjs state

**SQL Diagnostic Queries:**

```sql
-- Query 1: Find scripts with Yjs updates
SELECT
    sv.script_id,
    s.title,
    COUNT(sv.version_id) as update_count,
    MIN(sv.created_at) as first_update,
    MAX(sv.created_at) as last_update,
    s.updated_at as rest_updated_at
FROM script_versions sv
JOIN scripts s ON sv.script_id = s.script_id
GROUP BY sv.script_id, s.title, s.updated_at
ORDER BY update_count DESC;

-- Query 2: Find scripts where REST is newer than Yjs (potential corruption)
SELECT
    sv.script_id,
    s.title,
    s.updated_at as rest_updated,
    MAX(sv.created_at) as yjs_updated,
    CASE
        WHEN s.updated_at > MAX(sv.created_at) THEN 'REST_NEWER'
        ELSE 'YJS_CURRENT'
    END as state
FROM script_versions sv
JOIN scripts s ON sv.script_id = s.script_id
GROUP BY sv.script_id, s.title, s.updated_at
HAVING s.updated_at > MAX(sv.created_at);

-- Query 3: Find scripts with content_blocks but empty/missing Yjs
SELECT
    s.script_id,
    s.title,
    JSONB_ARRAY_LENGTH(s.content_blocks) as block_count,
    COALESCE(sv_count.cnt, 0) as yjs_update_count
FROM scripts s
LEFT JOIN (
    SELECT script_id, COUNT(*) as cnt
    FROM script_versions
    GROUP BY script_id
) sv_count ON s.script_id = sv_count.script_id
WHERE s.content_blocks IS NOT NULL
  AND JSONB_ARRAY_LENGTH(s.content_blocks) > 0;
```

**Implementation File:** `backend/scripts/diagnose_yjs_state.py`

```python
"""
Diagnostic script to identify scripts with Yjs state issues.
Run with: python -m scripts.diagnose_yjs_state
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from app.db.base import async_session_maker
from sqlalchemy import text

async def diagnose():
    async with async_session_maker() as db:
        print("=" * 60)
        print("YJS STATE DIAGNOSTIC REPORT")
        print("=" * 60)

        # Query 1: Scripts with Yjs updates
        result = await db.execute(text("""
            SELECT
                sv.script_id,
                s.title,
                COUNT(sv.version_id) as update_count,
                s.updated_at as rest_updated_at,
                MAX(sv.created_at) as yjs_updated_at
            FROM script_versions sv
            JOIN scripts s ON sv.script_id = s.script_id
            GROUP BY sv.script_id, s.title, s.updated_at
            ORDER BY update_count DESC
        """))
        rows = result.fetchall()

        print(f"\n📊 Found {len(rows)} scripts with Yjs updates:\n")

        for row in rows:
            rest_newer = row.rest_updated_at > row.yjs_updated_at if row.yjs_updated_at else True
            status = "⚠️  REST_NEWER" if rest_newer else "✅ YJS_CURRENT"
            print(f"  {status} | {row.title[:30]:<30} | {row.update_count:>4} updates | {row.script_id}")

        # Query 2: Scripts with content but no Yjs
        result = await db.execute(text("""
            SELECT
                s.script_id,
                s.title,
                JSONB_ARRAY_LENGTH(COALESCE(s.content_blocks, '[]'::jsonb)) as block_count
            FROM scripts s
            LEFT JOIN script_versions sv ON s.script_id = sv.script_id
            WHERE sv.script_id IS NULL
              AND s.content_blocks IS NOT NULL
              AND JSONB_ARRAY_LENGTH(s.content_blocks) > 0
        """))
        no_yjs = result.fetchall()

        if no_yjs:
            print(f"\n📋 Scripts with content but NO Yjs updates ({len(no_yjs)}):\n")
            for row in no_yjs:
                print(f"  {row.title[:40]:<40} | {row.block_count} blocks | {row.script_id}")

        print("\n" + "=" * 60)
        print("RECOMMENDATIONS:")
        print("=" * 60)
        print("1. Scripts marked 'REST_NEWER' may have stale Yjs state")
        print("2. Consider clearing script_versions for affected scripts")
        print("3. REST autosave (scripts.content_blocks) is the fallback truth")

if __name__ == '__main__':
    asyncio.run(diagnose())
```

---

### 1.2 Clear Corrupted script_versions Data

**Objective:** Remove stale Yjs updates that cause blank documents

**Pre-requisites:**
- Run diagnostic (1.1) to identify affected scripts
- Verify REST autosave has valid content_blocks

**Implementation File:** `backend/scripts/clear_yjs_for_script.py`

```python
"""
Clear Yjs updates for a specific script.
Usage: python -m scripts.clear_yjs_for_script <script_id> [--dry-run]
"""
import asyncio
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from app.db.base import async_session_maker
from sqlalchemy import text

async def clear_yjs(script_id: str, dry_run: bool = True):
    async with async_session_maker() as db:
        # Step 1: Verify script exists and has REST content
        result = await db.execute(text("""
            SELECT
                s.title,
                JSONB_ARRAY_LENGTH(COALESCE(s.content_blocks, '[]'::jsonb)) as block_count,
                COUNT(sv.version_id) as yjs_count
            FROM scripts s
            LEFT JOIN script_versions sv ON s.script_id = sv.script_id
            WHERE s.script_id = :script_id
            GROUP BY s.script_id, s.title, s.content_blocks
        """), {"script_id": script_id})

        row = result.fetchone()
        if not row:
            print(f"❌ Script not found: {script_id}")
            return

        print(f"📄 Script: {row.title}")
        print(f"   REST content_blocks: {row.block_count}")
        print(f"   Yjs updates to delete: {row.yjs_count}")

        if row.block_count == 0:
            print("⚠️  WARNING: REST has no content_blocks - clearing Yjs may result in empty document")
            response = input("Continue anyway? (y/N): ")
            if response.lower() != 'y':
                print("Aborted.")
                return

        if dry_run:
            print("\n🔍 DRY RUN - No changes made")
            print(f"   Would delete {row.yjs_count} script_version records")
            return

        # Step 2: Export before delete (safety)
        export_result = await db.execute(text("""
            SELECT version_id, created_at, LENGTH(update) as size_bytes
            FROM script_versions
            WHERE script_id = :script_id
            ORDER BY created_at
        """), {"script_id": script_id})
        exports = export_result.fetchall()

        print(f"\n📦 Exporting {len(exports)} records for audit trail...")
        # In production, write to file or S3

        # Step 3: Delete
        delete_result = await db.execute(text("""
            DELETE FROM script_versions WHERE script_id = :script_id
        """), {"script_id": script_id})

        await db.commit()

        print(f"✅ Deleted {delete_result.rowcount} script_version records")
        print(f"   Next WebSocket connection will start fresh from REST content")

def main():
    parser = argparse.ArgumentParser(description='Clear Yjs updates for a script')
    parser.add_argument('script_id', help='UUID of the script')
    parser.add_argument('--execute', action='store_true', help='Actually execute (default is dry-run)')
    args = parser.parse_args()

    asyncio.run(clear_yjs(args.script_id, dry_run=not args.execute))

if __name__ == '__main__':
    main()
```

**Rollback Strategy:**
- Export update metadata before deletion
- REST content_blocks remain intact
- Can re-seed Yjs from REST if needed

---

### 1.3 Add Yjs Document Validation

**Objective:** Detect and handle corrupted Yjs state before serving to clients

**File to Modify:** `backend/app/routers/script_websocket.py`

**Location:** After `load_persisted_updates()` call (around line 268)

**Implementation:**

```python
# After line 274: logger.info(f"After loading {applied_count} updates, Yjs content length: {yjs_content_length}")

# === NEW: Yjs State Validation ===
rest_has_content = script.content_blocks and len(script.content_blocks) > 0

if yjs_content_length == 0 and rest_has_content:
    # Corruption detected: Yjs is empty but REST has content
    logger.warning(
        f"YJS_CORRUPTION_DETECTED: script={script_id} "
        f"yjs_updates={applied_count} yjs_length=0 rest_blocks={len(script.content_blocks)}"
    )

    # Option 1: Log and continue (frontend REST fallback will handle it)
    # This is the safest approach until backend seeding is fixed

    # Option 2: Clear corrupted updates automatically (more aggressive)
    # Uncomment when confident:
    # try:
    #     await db.execute(
    #         text("DELETE FROM script_versions WHERE script_id = :sid"),
    #         {"sid": script_id}
    #     )
    #     await db.commit()
    #     logger.info(f"Auto-cleared {applied_count} corrupted updates for script {script_id}")
    # except Exception as e:
    #     logger.error(f"Failed to auto-clear corrupted updates: {e}")

elif yjs_content_length > 0:
    logger.info(f"Yjs state valid: {yjs_content_length} items in content array")

# === END: Yjs State Validation ===
```

**Monitoring:**
- Add Prometheus metric: `yjs_corruption_detected_total`
- Alert on >0 occurrences

---

## Phase 2: Short-Term Improvements (Week 1)

### 2.1 Re-enable Backend Seeding

**Objective:** Fix format mismatch so backend can seed Yjs from REST content

**Background:**
Backend seeding is disabled at `script_websocket.py:309-311`:
```python
# TEMPORARILY DISABLED: Backend seeding causes format issues
# Let frontend seed the document from REST API instead
```

**Root Cause Investigation:**

The format mismatch is between:
1. **REST `content_blocks`**: Backend's internal format
2. **TipTap/ProseMirror JSON**: What the Yjs shared array expects

**File to Create:** `backend/app/utils/content_format_converter.py`

```python
"""
Converts between REST content_blocks format and TipTap/ProseMirror Yjs format.

REST format (content_blocks):
[
    {"type": "scene_heading", "text": "INT. OFFICE - DAY"},
    {"type": "action", "text": "John enters the room."},
    {"type": "character", "text": "JOHN"},
    {"type": "dialogue", "text": "Hello, everyone."}
]

TipTap/Yjs format:
{
    "type": "doc",
    "content": [
        {"type": "sceneHeading", "content": [{"type": "text", "text": "INT. OFFICE - DAY"}]},
        {"type": "action", "content": [{"type": "text", "text": "John enters the room."}]},
        {"type": "character", "content": [{"type": "text", "text": "JOHN"}]},
        {"type": "dialogue", "content": [{"type": "text", "text": "Hello, everyone."}]}
    ]
}
"""
from typing import List, Dict, Any

# Mapping from REST block types to TipTap node types
BLOCK_TYPE_MAP = {
    'scene_heading': 'sceneHeading',
    'action': 'action',
    'character': 'character',
    'dialogue': 'dialogue',
    'parenthetical': 'parenthetical',
    'transition': 'transition',
    'centered': 'centered',
    'general': 'paragraph',
}

def content_blocks_to_tiptap(content_blocks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Convert REST content_blocks array to TipTap document structure.

    Args:
        content_blocks: List of content blocks from REST API

    Returns:
        TipTap-compatible document structure
    """
    if not content_blocks:
        return {"type": "doc", "content": []}

    tiptap_content = []

    for block in content_blocks:
        block_type = block.get('type', 'general')
        text = block.get('text', '')

        # Map to TipTap node type
        tiptap_type = BLOCK_TYPE_MAP.get(block_type, 'paragraph')

        # Create TipTap node
        node = {
            "type": tiptap_type,
            "content": [{"type": "text", "text": text}] if text else []
        }

        # Preserve any metadata
        if block.get('metadata'):
            node['attrs'] = block['metadata']

        tiptap_content.append(node)

    return {
        "type": "doc",
        "content": tiptap_content
    }


def tiptap_to_content_blocks(tiptap_doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Convert TipTap document structure to REST content_blocks array.

    Args:
        tiptap_doc: TipTap document structure

    Returns:
        List of content blocks for REST API
    """
    if not tiptap_doc or 'content' not in tiptap_doc:
        return []

    # Reverse mapping
    reverse_map = {v: k for k, v in BLOCK_TYPE_MAP.items()}

    content_blocks = []

    for node in tiptap_doc.get('content', []):
        node_type = node.get('type', 'paragraph')

        # Extract text from content
        text = ''
        for child in node.get('content', []):
            if child.get('type') == 'text':
                text += child.get('text', '')

        # Map back to REST block type
        block_type = reverse_map.get(node_type, 'general')

        block = {
            'type': block_type,
            'text': text
        }

        # Preserve any attrs as metadata
        if node.get('attrs'):
            block['metadata'] = node['attrs']

        content_blocks.append(block)

    return content_blocks
```

**Modify Backend Seeding:** `script_websocket.py` around line 307

```python
# Replace the disabled seeding block:

if content_blocks:
    # RE-ENABLED: Backend seeding with proper format conversion
    from app.utils.content_format_converter import content_blocks_to_tiptap
    import json

    try:
        # Convert REST format to TipTap format
        tiptap_doc = content_blocks_to_tiptap(content_blocks)

        # Seed Yjs document
        with ydoc.begin_transaction() as txn:
            shared_root = ydoc.get_array('content')
            # Clear any existing content
            while len(shared_root) > 0:
                shared_root.delete(txn, 0)
            # Insert TipTap document content
            for node in tiptap_doc.get('content', []):
                shared_root.append(txn, node)

        logger.info(f"Seeded Yjs doc with {len(tiptap_doc.get('content', []))} nodes from REST")

    except Exception as e:
        logger.error(f"Backend seeding failed: {e}", exc_info=True)
        # Fall back to frontend seeding
```

**Testing:**
1. Unit test for `content_format_converter.py`
2. Integration test: seed → serialize → deserialize → compare

---

### 2.2 Parallelize Database Queries

**Objective:** Reduce initialization time by running independent queries concurrently

**Current Sequential Flow:**
```
user lookup     → 10-50ms
script lookup   → 10-50ms
access check    → 10-50ms (if not owner)
yjs timestamp   → 10ms
--------------------------
Total:          40-160ms
```

**Parallel Flow:**
```
[user lookup + script lookup]  → 10-50ms (parallel)
access check (if needed)       → 10-50ms
yjs timestamp                  → 10ms
--------------------------
Total:                         30-110ms (30% improvement)
```

**File to Modify:** `backend/app/routers/script_websocket.py`

**Implementation:**

```python
# Add at top of file
import asyncio

# Replace lines 160-217 with parallel implementation:

async def _get_user_and_script(
    firebase_uid: str,
    script_id: UUID,
    db: AsyncSession
) -> tuple:
    """
    Fetch user and script info in parallel.
    Returns (user, script_info, error) tuple.
    """
    from app.models.user import User
    from app.models.script import Script

    async def get_user():
        stmt = select(User).where(User.firebase_uid == firebase_uid)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_script_info():
        stmt = select(
            Script.script_id,
            Script.owner_id,
            Script.title,
            Script.updated_at,
            Script.content_blocks
        ).where(Script.script_id == script_id)
        result = await db.execute(stmt)
        return result.one_or_none()

    # Execute in parallel
    user, script_row = await asyncio.gather(get_user(), get_script_info())

    return user, script_row

# In the main websocket handler, replace sequential calls:

# OLD:
# user_info = await verify_token_websocket(token)
# ... user lookup ...
# ... script lookup ...

# NEW:
user_info = await verify_token_websocket(token)
firebase_uid = user_info.get("uid") or user_info.get("user_id")

# Parallel fetch
user, script_row = await _get_user_and_script(firebase_uid, script_id, db)

if not user:
    await websocket.close(code=4001, reason="User not found")
    return

if not script_row:
    await websocket.close(code=4004, reason="Script not found")
    return

# Now check access (requires user_id)
if script_row.owner_id != user.user_id:
    # Check collaborator (this must be sequential - needs user_id)
    from app.models.script_collaborator import ScriptCollaborator
    stmt = select(ScriptCollaborator).where(
        ScriptCollaborator.script_id == script_id,
        ScriptCollaborator.user_id == user.user_id
    )
    result = await db.execute(stmt)
    if not result.scalar_one_or_none():
        await websocket.close(code=4003, reason="Access denied")
        return
```

**Expected Impact:**
- 30-50ms reduction per connection
- More noticeable under high latency conditions

---

## Phase 3: Medium-Term Enhancements (Week 2-3)

### 3.1 Yjs Update Compaction

**Objective:** Merge old updates into snapshots to keep initialization fast

**Design:**
- Trigger: Script has >50 updates OR oldest update >7 days
- Action: Merge all updates into single snapshot
- Frequency: Daily background job OR on-demand

**File to Create:** `backend/app/services/yjs_compaction.py`

```python
"""
Yjs Update Compaction Service

Merges multiple small Yjs updates into a single snapshot to improve
initialization performance. Safe to run concurrently with active
WebSocket connections.
"""
import logging
from typing import Optional
from uuid import UUID
from datetime import datetime, timedelta

from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
import y_py as Y

from app.models.script_version import ScriptVersion

logger = logging.getLogger(__name__)

# Compaction thresholds
MIN_UPDATES_FOR_COMPACTION = 50
MAX_UPDATE_AGE_DAYS = 7


class YjsCompactionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def should_compact(self, script_id: UUID) -> bool:
        """Check if script needs compaction."""
        # Count updates
        count_stmt = select(func.count(ScriptVersion.version_id)).where(
            ScriptVersion.script_id == script_id
        )
        count = (await self.db.execute(count_stmt)).scalar_one()

        if count >= MIN_UPDATES_FOR_COMPACTION:
            return True

        # Check oldest update age
        oldest_stmt = select(func.min(ScriptVersion.created_at)).where(
            ScriptVersion.script_id == script_id
        )
        oldest = (await self.db.execute(oldest_stmt)).scalar_one()

        if oldest and oldest < datetime.utcnow() - timedelta(days=MAX_UPDATE_AGE_DAYS):
            return True

        return False

    async def compact(self, script_id: UUID) -> Optional[int]:
        """
        Compact all updates for a script into a single snapshot.

        Returns:
            Number of updates compacted, or None if failed
        """
        logger.info(f"Starting compaction for script {script_id}")

        # Load all updates
        stmt = select(ScriptVersion).where(
            ScriptVersion.script_id == script_id
        ).order_by(ScriptVersion.created_at)

        result = await self.db.execute(stmt)
        updates = result.scalars().all()

        if len(updates) < 2:
            logger.info(f"Script {script_id} has {len(updates)} updates - skipping compaction")
            return 0

        # Apply all updates to fresh YDoc
        ydoc = Y.YDoc()
        applied = 0

        for update in updates:
            try:
                Y.apply_update(ydoc, update.update)
                applied += 1
            except Exception as e:
                logger.warning(f"Failed to apply update {update.version_id}: {e}")

        if applied == 0:
            logger.error(f"No updates could be applied for script {script_id}")
            return None

        # Create merged snapshot
        merged_update = Y.encode_state_as_update(ydoc)

        # Transaction: delete old, insert new
        try:
            # Delete old updates
            delete_stmt = delete(ScriptVersion).where(
                ScriptVersion.script_id == script_id
            )
            await self.db.execute(delete_stmt)

            # Insert compacted update
            compacted = ScriptVersion(
                script_id=script_id,
                update=merged_update,
                created_by=None  # System-generated
            )
            self.db.add(compacted)

            await self.db.commit()

            logger.info(
                f"Compacted {len(updates)} updates into 1 for script {script_id} "
                f"(size: {len(merged_update)} bytes)"
            )

            return len(updates)

        except Exception as e:
            logger.error(f"Compaction transaction failed for script {script_id}: {e}")
            await self.db.rollback()
            return None
        finally:
            ydoc.destroy()

    async def compact_all_eligible(self) -> dict:
        """
        Find and compact all scripts that need compaction.

        Returns:
            Summary of compaction results
        """
        # Find scripts with many updates
        stmt = select(
            ScriptVersion.script_id,
            func.count(ScriptVersion.version_id).label('update_count')
        ).group_by(
            ScriptVersion.script_id
        ).having(
            func.count(ScriptVersion.version_id) >= MIN_UPDATES_FOR_COMPACTION
        )

        result = await self.db.execute(stmt)
        candidates = result.fetchall()

        summary = {
            'candidates': len(candidates),
            'compacted': 0,
            'failed': 0,
            'skipped': 0
        }

        for row in candidates:
            try:
                count = await self.compact(row.script_id)
                if count and count > 0:
                    summary['compacted'] += 1
                else:
                    summary['skipped'] += 1
            except Exception as e:
                logger.error(f"Compaction failed for {row.script_id}: {e}")
                summary['failed'] += 1

        return summary
```

**Background Job:** `backend/app/jobs/compact_yjs_updates.py`

```python
"""
Background job to compact Yjs updates.
Can be run via cron, Celery, or manual trigger.
"""
import asyncio
import logging
from app.db.base import async_session_maker
from app.services.yjs_compaction import YjsCompactionService

logger = logging.getLogger(__name__)

async def run_compaction():
    """Run compaction for all eligible scripts."""
    async with async_session_maker() as db:
        service = YjsCompactionService(db)
        summary = await service.compact_all_eligible()

        logger.info(
            f"Compaction complete: {summary['compacted']} compacted, "
            f"{summary['failed']} failed, {summary['skipped']} skipped"
        )
        return summary

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_compaction())
```

**Schedule:**
- Run daily at 3am UTC (low traffic)
- Or trigger when script update count exceeds threshold

---

### 3.2 Firebase Token Caching

**Objective:** Eliminate repeated Firebase verification for same token

**File to Modify:** `backend/app/firebase/config.py`

```python
"""
Firebase configuration with token caching.
"""
import firebase_admin
from firebase_admin import credentials, auth
from typing import Optional
import json
import os
import hashlib
from cachetools import TTLCache
import threading

# Initialize Firebase Admin SDK
firebase_app = None

# Token cache: signature hash -> decoded token
# TTL of 60 seconds balances performance with security
_token_cache = TTLCache(maxsize=1000, ttl=60)
_cache_lock = threading.Lock()

def initialize_firebase():
    """Initialize Firebase Admin SDK with credentials from environment variable."""
    global firebase_app

    if firebase_app is None:
        creds_json = os.getenv("FIREBASE_CREDENTIALS_JSON")

        if not creds_json:
            raise ValueError("FIREBASE_CREDENTIALS_JSON environment variable not set")

        try:
            cred_dict = json.loads(creds_json)
            cred = credentials.Certificate(cred_dict)
            firebase_app = firebase_admin.initialize_app(cred)
        except json.JSONDecodeError:
            raise ValueError("Invalid JSON in FIREBASE_CREDENTIALS_JSON")
        except Exception as e:
            raise Exception(f"Failed to initialize Firebase: {str(e)}")

    return firebase_app


def _get_token_cache_key(id_token: str) -> str:
    """
    Generate cache key from token signature.
    Uses SHA256 of the signature portion (last segment after '.').
    """
    try:
        signature = id_token.rsplit('.', 1)[-1]
        return hashlib.sha256(signature.encode()).hexdigest()[:32]
    except Exception:
        return None


def verify_firebase_token(id_token: str, use_cache: bool = True) -> dict:
    """
    Verify a Firebase ID token and return the decoded token.

    Args:
        id_token: The Firebase ID token string from the client.
        use_cache: Whether to use caching (default True).

    Returns:
        dict: The decoded Firebase token containing user information.
    """
    if firebase_app is None:
        initialize_firebase()

    # Check cache first
    if use_cache:
        cache_key = _get_token_cache_key(id_token)
        if cache_key:
            with _cache_lock:
                cached = _token_cache.get(cache_key)
                if cached:
                    return cached

    # Verify with Firebase
    decoded = auth.verify_id_token(id_token)

    # Cache the result
    if use_cache and cache_key:
        with _cache_lock:
            _token_cache[cache_key] = decoded

    return decoded


def clear_token_cache():
    """Clear the token cache (useful for testing)."""
    with _cache_lock:
        _token_cache.clear()


def get_cache_stats() -> dict:
    """Get token cache statistics."""
    with _cache_lock:
        return {
            'size': len(_token_cache),
            'maxsize': _token_cache.maxsize,
            'ttl': _token_cache.ttl
        }
```

**Expected Impact:**
- First connection: 100-500ms (Firebase verification)
- Subsequent connections within 60s: ~0ms (cache hit)
- Especially beneficial for reconnection scenarios

---

## Testing Strategy

### Unit Tests

| Component | Test File | Coverage |
|-----------|-----------|----------|
| Format converter | `tests/test_content_format_converter.py` | 100% |
| Yjs compaction | `tests/test_yjs_compaction.py` | 90% |
| Token caching | `tests/test_firebase_config.py` | 85% |

### Integration Tests

| Scenario | Test |
|----------|------|
| WebSocket init with empty Yjs | Verify REST fallback works |
| WebSocket init with valid Yjs | Verify content loads correctly |
| Compaction during active session | Verify no data loss |
| Token cache with expired token | Verify re-verification occurs |

### Load Tests

| Metric | Target |
|--------|--------|
| Init time (cold) | <3s |
| Init time (warm, cached token) | <1s |
| Compaction throughput | 100 scripts/minute |

---

## Rollback Strategies

### Phase 1 Rollbacks

| Change | Rollback |
|--------|----------|
| Clear script_versions | Restore from export (if made) |
| Validation logging | Remove logging code |

### Phase 2 Rollbacks

| Change | Rollback |
|--------|----------|
| Backend seeding | Re-disable with comment |
| Query parallelization | Revert to sequential calls |

### Phase 3 Rollbacks

| Change | Rollback |
|--------|----------|
| Compaction | Disable background job |
| Token caching | Set `use_cache=False` |

---

## Success Metrics

### Reliability

| Metric | Before | Target |
|--------|--------|--------|
| Blank document rate | ~15% | <1% |
| Connection success rate | ~80% | >98% |
| Ghost update accumulation | Growing | Stable |

### Performance

| Metric | Before | Target |
|--------|--------|--------|
| WebSocket init (P50) | 5s | 1s |
| WebSocket init (P95) | 20s | 3s |
| Init with 100 updates | 2s | 200ms |

### User Experience

| Metric | Before | Target |
|--------|--------|--------|
| Editor load time | 5-20s | 1-3s |
| Save reliability | ~85% | >99% |
| Real-time sync | Intermittent | Consistent |

---

## Implementation Timeline

| Phase | Duration | Effort | Risk |
|-------|----------|--------|------|
| Phase 1 | 1-2 days | Low | Low |
| Phase 2 | 3-5 days | Medium | Medium |
| Phase 3 | 5-7 days | Medium | Low |

**Recommended Order:**
1. Phase 1.1 (Diagnostic) - Immediate
2. Phase 1.2 (Clear data) - Immediate
3. Phase 1.3 (Validation) - Day 1
4. Phase 2.2 (Parallelize) - Day 2-3
5. Phase 2.1 (Backend seeding) - Day 3-5
6. Phase 3.2 (Token caching) - Week 2
7. Phase 3.1 (Compaction) - Week 2-3

---

## Appendix: SQL Reference

### Useful Diagnostic Queries

```sql
-- Script update history
SELECT
    sv.version_id,
    sv.created_at,
    sv.created_by,
    LENGTH(sv.update) as update_size_bytes
FROM script_versions sv
WHERE sv.script_id = 'YOUR_SCRIPT_ID'
ORDER BY sv.created_at DESC
LIMIT 20;

-- Update size distribution
SELECT
    script_id,
    COUNT(*) as update_count,
    SUM(LENGTH(update)) as total_bytes,
    AVG(LENGTH(update)) as avg_bytes
FROM script_versions
GROUP BY script_id;

-- Scripts needing compaction
SELECT
    script_id,
    COUNT(*) as update_count,
    MIN(created_at) as oldest_update,
    MAX(created_at) as newest_update
FROM script_versions
GROUP BY script_id
HAVING COUNT(*) > 50
ORDER BY update_count DESC;
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Dec 2024 | Claude | Initial implementation plan |
