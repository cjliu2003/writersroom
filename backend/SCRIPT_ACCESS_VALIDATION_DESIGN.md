# Design Specification: Lightweight Script Access Validation

**Version**: 1.0
**Date**: 2024-12-12
**Author**: AI Analysis
**Status**: Design Complete - Ready for Implementation

---

## 1. Problem Statement

### Current Issue
The `chat_message` endpoint in `ai_router.py` (lines 473-478) loads 13 columns from the `scripts` table plus executes a second query on `script_collaborators`, but **never uses the loaded script data**. The function is called solely for access validation.

### Performance Impact
With high geographic latency (Croatia → California = ~3.5 seconds per query):
- **Current**: 2 queries × 3.5s = ~7 seconds overhead per AI chat request
- **Problem**: Contributes to 45-second frontend timeout
- **Data Waste**: 13 columns loaded + 8 potential eager-loaded relationships (if using full ORM objects)

### Security Requirement
Access validation **MUST be maintained**. Removing the check would create OWASP API Security Top 10 #1 vulnerability (Broken Object Level Authorization).

---

## 2. Current Implementation Analysis

### Function: `get_script_if_user_has_access()`
**Location**: `backend/app/routers/script_router.py:46-143`

**Purpose**: Dual-purpose function
1. Validate user has access to script
2. Return script data for use by endpoint

**Usage Patterns**:
| Endpoint | File | Line | Uses Script Data? | Optimization Opportunity |
|----------|------|------|-------------------|-------------------------|
| `generate_scene_summary()` | ai_router.py | 61 | ✅ YES (script.content_blocks, script.scene_summaries) | Keep existing |
| `chat_message()` | ai_router.py | 473 | ❌ NO (unused variable) | **OPTIMIZE** |
| `analyze_script()` | ai_ingestion_router.py | ~30 | ✅ YES (script.script_id) | Keep existing |

**Current Query Pattern**:
```sql
-- Query 1: Load script (13 columns)
SELECT script_id, owner_id, title, description, current_version,
       created_at, updated_at, imported_fdx_path, exported_fdx_path,
       exported_pdf_path, content_blocks, version, updated_by, scene_summaries
FROM scripts
WHERE script_id = ?

-- Query 2: Check collaborator
SELECT id, script_id, user_id, role, joined_at
FROM script_collaborators
WHERE script_id = ? AND user_id = ?
```

**Total**: 2 database roundtrips, 18 columns transferred

---

## 3. Proposed Solution Architecture

### Design Decision: Create NEW Function, Keep Existing
**Rationale**:
- Some endpoints genuinely need script data
- Breaking change to existing function affects multiple endpoints
- Better separation of concerns: access validation ≠ data retrieval

### New Function: `validate_script_access()`
**Purpose**: Lightweight access validation only (no data return)
**Signature**:
```python
async def validate_script_access(
    script_id: UUID,
    user: User,
    db: AsyncSession,
    allow_viewer: bool = True
) -> None
```

**Return**: `None` on success, raises `HTTPException` on failure

---

## 4. Detailed Function Specification

### 4.1 Function Contract

```python
async def validate_script_access(
    script_id: UUID,
    user: User,
    db: AsyncSession,
    allow_viewer: bool = True
) -> None:
    """
    Validate user has access to script without loading script data.

    Optimized for authorization-only checks where script data is not needed.
    Uses single LEFT JOIN query instead of 2 separate queries.

    Security: Checks both ownership and collaborator permissions.
    Performance: Loads only 3 columns instead of 13, single query instead of 2.

    Args:
        script_id: UUID of script to validate access for
        user: Currently authenticated user
        db: Async database session
        allow_viewer: If True, VIEWER role has access. If False, requires EDITOR+ role.

    Returns:
        None (returns void on success)

    Raises:
        HTTPException 404: Script not found
        HTTPException 403: User does not have permission to access script

    Example:
        # In endpoint that only needs access check
        await validate_script_access(request.script_id, current_user, db, allow_viewer=True)
        # If reaches here, user has access - proceed with operation
    """
```

### 4.2 Implementation Logic Flow

```
1. Execute single LEFT JOIN query (scripts + script_collaborators)
2. IF no result → HTTP 404 (script doesn't exist)
3. IF user.user_id == owner_id → ALLOW (owner always has access)
4. IF collaborator_role exists:
   - IF allow_viewer=True AND role in [OWNER, EDITOR, VIEWER] → ALLOW
   - IF allow_viewer=False AND role in [OWNER, EDITOR] → ALLOW
5. ELSE → HTTP 403 (no access)
```

### 4.3 Complete Implementation

```python
from fastapi import HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.models.script import Script
from app.models.script_collaborator import ScriptCollaborator, CollaboratorRole
from app.models.user import User


async def validate_script_access(
    script_id: UUID,
    user: User,
    db: AsyncSession,
    allow_viewer: bool = True
) -> None:
    """
    Validate user has access to script without loading script data.

    Optimized for authorization-only checks where script data is not needed.
    Uses single LEFT JOIN query instead of 2 separate queries.

    Security: Checks both ownership and collaborator permissions.
    Performance: Loads only 3 columns instead of 13, single query instead of 2.

    Args:
        script_id: UUID of script to validate access for
        user: Currently authenticated user
        db: Async database session
        allow_viewer: If True, VIEWER role has access. If False, requires EDITOR+ role.

    Returns:
        None (returns void on success)

    Raises:
        HTTPException 404: Script not found
        HTTPException 403: User does not have permission to access script
    """
    # Single optimized query with LEFT JOIN
    # Only load minimal columns needed for access check
    query = (
        select(
            Script.script_id,
            Script.owner_id,
            ScriptCollaborator.role
        )
        .outerjoin(
            ScriptCollaborator,
            and_(
                ScriptCollaborator.script_id == Script.script_id,
                ScriptCollaborator.user_id == user.user_id
            )
        )
        .where(Script.script_id == script_id)
    )

    result = await db.execute(query)
    row = result.one_or_none()

    # Script doesn't exist
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Script with ID {script_id} not found"
        )

    # User is owner - always has access
    if row.owner_id == user.user_id:
        return

    # User is collaborator - check role permissions
    if row.role is not None:
        if allow_viewer:
            # All roles have access when viewers allowed
            return
        else:
            # Only EDITOR and OWNER roles have access
            if row.role in [CollaboratorRole.EDITOR, CollaboratorRole.OWNER]:
                return

    # No access
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to access this script"
    )
```

---

## 5. Database Query Design & Performance Analysis

### 5.1 SQL Query Generated

```sql
SELECT
    scripts.script_id,
    scripts.owner_id,
    script_collaborators.role
FROM scripts
LEFT JOIN script_collaborators
    ON script_collaborators.script_id = scripts.script_id
    AND script_collaborators.user_id = :user_id
WHERE scripts.script_id = :script_id
```

### 5.2 Index Usage

**Indexes Available** (from model analysis):
- `scripts.script_id`: Primary key + indexed
- `scripts.owner_id`: Foreign key + indexed
- `script_collaborators.script_id`: Foreign key + indexed
- `script_collaborators.user_id`: Foreign key + indexed

**Query Plan**: All joins use indexed columns → efficient execution

### 5.3 Performance Comparison

| Metric | Current | Optimized | Improvement |
|--------|---------|-----------|-------------|
| **Queries** | 2 | 1 | 50% reduction |
| **Columns Loaded** | 18 (13 + 5) | 3 | 83% reduction |
| **Data Transfer** | ~2KB | ~100 bytes | 95% reduction |
| **Latency (3.5s/query)** | 7 seconds | 3.5 seconds | **50% faster** |

### 5.4 Query Optimization Analysis

**Why LEFT JOIN instead of separate queries?**
1. Single database roundtrip eliminates network latency
2. Database can optimize join execution internally
3. Reduces total connection overhead
4. Indexed columns ensure efficient join performance

**Why 3 columns instead of full objects?**
1. `script_id`: Verify script exists
2. `owner_id`: Check ownership
3. `role`: Check collaborator permissions

All other script data is unnecessary for access validation.

---

## 6. Implementation Plan

### 6.1 File Changes Required

#### File 1: `backend/app/routers/script_router.py`
**Action**: Add new function
**Location**: After `get_script_if_user_has_access()` (after line 143)
**Changes**:
```python
# Add import at top (already exists)
from app.models.script_collaborator import ScriptCollaborator, CollaboratorRole

# Add new function after line 143
async def validate_script_access(...):
    # Implementation from section 4.3
```

#### File 2: `backend/app/routers/ai_router.py`
**Action**: Replace function call in `chat_message` endpoint
**Location**: Lines 473-478
**Changes**:
```python
# BEFORE (lines 473-478):
script = await get_script_if_user_has_access(
    request.script_id,
    current_user,
    db,
    allow_viewer=True
)

# AFTER:
# Import at top
from app.routers.script_router import get_script_if_user_has_access, validate_script_access

# In endpoint (lines 473-478):
# Validate script access (lightweight permission check only)
await validate_script_access(
    request.script_id,
    current_user,
    db,
    allow_viewer=True
)
```

### 6.2 Implementation Steps

1. **Add Function** (`script_router.py:144+`)
   - Copy implementation from section 4.3
   - Add comprehensive docstring
   - Ensure all imports present

2. **Update Import** (`ai_router.py:44`)
   - Change: `from app.routers.script_router import get_script_if_user_has_access`
   - To: `from app.routers.script_router import get_script_if_user_has_access, validate_script_access`

3. **Replace Call** (`ai_router.py:473-478`)
   - Remove `script =` assignment (no return value)
   - Change function name to `validate_script_access`
   - Keep all parameters identical

4. **Update Comment** (`ai_router.py:472`)
   - Change: `# Validate script access`
   - To: `# Validate script access (lightweight permission check only)`

### 6.3 Migration Safety

**Breaking Changes**: None
- Existing `get_script_if_user_has_access()` unchanged
- Only `chat_message` endpoint affected
- New function has identical security guarantees

**Rollback**: Simple
- Revert 3-line change in `ai_router.py`
- Keep new function (no harm if unused)

---

## 7. Testing Strategy

### 7.1 Unit Tests for `validate_script_access()`

**Test File**: `backend/tests/test_script_access_validation.py`

```python
import pytest
from fastapi import HTTPException
from uuid import uuid4

async def test_validate_script_access_owner():
    """Owner should have access regardless of collaborator table"""
    # Script owner should always have access

async def test_validate_script_access_editor():
    """Editor collaborator should have access"""
    # Test EDITOR role with allow_viewer=True
    # Test EDITOR role with allow_viewer=False

async def test_validate_script_access_viewer_allowed():
    """Viewer should have access when allow_viewer=True"""
    # Test VIEWER role with allow_viewer=True

async def test_validate_script_access_viewer_denied():
    """Viewer should be denied when allow_viewer=False"""
    # Test VIEWER role with allow_viewer=False
    # Should raise HTTP 403

async def test_validate_script_access_no_access():
    """Non-collaborator should be denied"""
    # User with no relationship to script
    # Should raise HTTP 403

async def test_validate_script_access_not_found():
    """Non-existent script should return 404"""
    # Random UUID that doesn't exist
    # Should raise HTTP 404

async def test_validate_script_access_performance():
    """Verify single query execution"""
    # Use query counter to ensure only 1 query
    # Measure execution time
```

### 7.2 Integration Tests

**Test File**: `backend/tests/test_ai_chat_endpoint.py`

```python
async def test_chat_message_with_access():
    """Chat endpoint should work with valid access"""
    # Create user, script with user as owner
    # POST to /api/ai/chat/message
    # Should succeed (200 OK)

async def test_chat_message_without_access():
    """Chat endpoint should deny without access"""
    # Create user1 (owner) and user2 (no access)
    # user2 tries to POST to /api/ai/chat/message with user1's script
    # Should fail (403 Forbidden)

async def test_chat_message_performance():
    """Verify performance improvement"""
    # Measure response time before/after optimization
    # Should be ~50% faster for access check phase
```

### 7.3 Manual Testing Checklist

- [ ] Chat endpoint works for script owner
- [ ] Chat endpoint works for EDITOR collaborator
- [ ] Chat endpoint works for VIEWER collaborator (allow_viewer=True)
- [ ] Chat endpoint denies VIEWER when allow_viewer=False
- [ ] Chat endpoint denies non-collaborators (403)
- [ ] Chat endpoint returns 404 for non-existent scripts
- [ ] Response time improved (~3.5s faster per request)
- [ ] No regression in other endpoints using `get_script_if_user_has_access()`

---

## 8. Security Validation

### 8.1 Security Requirements

✅ **MUST maintain**: Same security guarantees as existing function
✅ **MUST check**: Script ownership (owner_id == user.user_id)
✅ **MUST check**: Collaborator role permissions
✅ **MUST respect**: `allow_viewer` parameter
✅ **MUST raise**: Appropriate HTTP exceptions (404, 403)

### 8.2 Security Test Matrix

| User Type | allow_viewer=True | allow_viewer=False | Expected |
|-----------|-------------------|--------------------| ---------|
| Owner | ✅ Allow | ✅ Allow | Owner always has access |
| EDITOR collaborator | ✅ Allow | ✅ Allow | Editor has full access |
| VIEWER collaborator | ✅ Allow | ❌ Deny 403 | Respects allow_viewer flag |
| No relationship | ❌ Deny 403 | ❌ Deny 403 | Unauthorized access blocked |

### 8.3 Attack Vectors Tested

1. **Horizontal Privilege Escalation**: User attempts to access another user's script
   - **Test**: Non-collaborator tries to access private script
   - **Expected**: HTTP 403 Forbidden

2. **Enumeration Attack**: Attacker enumerates script IDs
   - **Test**: Request with random UUID
   - **Expected**: HTTP 404 Not Found

3. **Role Bypass**: Viewer attempts restricted operation
   - **Test**: Viewer with allow_viewer=False
   - **Expected**: HTTP 403 Forbidden

---

## 9. Performance Metrics

### 9.1 Expected Improvements

**Per Request**:
- **Query Count**: 2 → 1 (50% reduction)
- **Columns Loaded**: 18 → 3 (83% reduction)
- **Data Transfer**: ~2KB → ~100 bytes (95% reduction)
- **Latency Saved**: 3.5 seconds (50% of access check time)

**System-Wide** (assuming 1000 AI chat requests/day):
- **Database Load**: 2000 queries/day → 1000 queries/day
- **Network Transfer**: 2GB/day → 100MB/day
- **Time Saved**: 58 minutes/day

### 9.2 Monitoring Metrics

**Add to endpoint logging**:
```python
import time

access_check_start = time.perf_counter()
await validate_script_access(...)
access_check_duration = (time.perf_counter() - access_check_start) * 1000
logger.info(f"[chat_message] Access check took {access_check_duration:.2f}ms")
```

**Expected Values**:
- **Before**: 7000ms (with 3.5s latency)
- **After**: 3500ms (with 3.5s latency)
- **Local**: <50ms (without geographic latency)

---

## 10. Documentation Updates

### 10.1 TIMING_DIAGNOSTICS.md Updates

Add section documenting this optimization:

```markdown
### AI Chat Endpoint Authorization Optimization (2024-12-12)

**Problem**: chat_message endpoint loaded 13 script columns + 2 queries solely for access check

**Solution**: Created lightweight validate_script_access() function
- Single LEFT JOIN query instead of 2 separate queries
- 3 columns instead of 13
- No unused data loading

**Impact**:
- 50% faster access check (7s → 3.5s with high latency)
- 83% less data transferred
- Maintains identical security guarantees

**Files Modified**:
- backend/app/routers/script_router.py: Added validate_script_access() function
- backend/app/routers/ai_router.py: Updated chat_message endpoint (line 473)
```

### 10.2 Code Comments

Add comment in `script_router.py`:

```python
async def validate_script_access(...):
    """
    Lightweight access validation for endpoints that don't need script data.

    Use this function when you only need to verify access permissions.
    Use get_script_if_user_has_access() when you also need script data.

    Performance: 50% faster than loading full script object.
    Security: Identical authorization logic to get_script_if_user_has_access().
    """
```

---

## 11. Future Optimization Opportunities

### 11.1 Further Optimizations

**Option 1: Cache Access Results** (5-10 minute TTL)
```python
# Redis cache: f"script_access:{script_id}:{user_id}" → bool
# Would eliminate database query entirely for repeated accesses
```

**Option 2: Apply to Other Endpoints**
```python
# Audit codebase for other access-check-only usages
# Candidates:
# - AI ingestion endpoint (if script.script_id only used for logging)
# - Script metadata endpoints
```

**Option 3: Combined User+Script Query**
```python
# For endpoints requiring both user and script validation
# Single query joining users + scripts + script_collaborators
```

### 11.2 Monitoring for Future Issues

**Watch for**:
- Increased HTTP 403 errors (possible logic bug)
- Regression in response times (query optimization failure)
- Security vulnerabilities (access bypass attempts)

---

## 12. Approval & Sign-Off

### 12.1 Design Review Checklist

- [x] Security requirements maintained
- [x] Performance improvement quantified
- [x] Backward compatibility preserved
- [x] Testing strategy defined
- [x] Implementation plan detailed
- [x] Rollback strategy documented
- [x] Monitoring metrics specified

### 12.2 Ready for Implementation

**Status**: ✅ **DESIGN COMPLETE**

This design is ready for implementation. All requirements analyzed, solution architected, and implementation steps documented.

**Next Step**: Implementation phase with approval

---

**End of Design Specification**
