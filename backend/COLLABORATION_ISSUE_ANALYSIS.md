# Collaboration/Sharing Functionality Issue Analysis

## Problem Statement

Scripts added to the `script_collaborators` table are not showing up for collaborators when they load the site, even though the database records are correctly created.

## Root Cause Analysis

### Issue Identified ✅

The problem is in the **backend endpoint** `/users/me/scripts` (user_router.py:66-90). This endpoint ONLY returns scripts where the current user is the **owner**:

```python
@router.get("/me/scripts", response_model=List[ScriptSummary])
async def get_user_scripts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all scripts owned by the current authenticated user.
    """
    # The relationship is already defined in the User model, so we can use it directly
    scripts = await db.execute(
        select(Script).where(Script.owner_id == current_user.user_id)  # ❌ ONLY OWNED SCRIPTS
    )

    script_list = scripts.scalars().all()
    # ...
```

**This query only checks `Script.owner_id == current_user.user_id`**, which excludes all scripts where the user is a collaborator.

### Correct Implementation Already Exists

There IS a separate endpoint `/users/me/collaborations` (user_router.py:92-121) that correctly queries scripts where the user is a collaborator:

```python
@router.get("/me/collaborations", response_model=List[ScriptSummary])
async def get_user_collaborations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all scripts where the current authenticated user is a collaborator.
    """
    # Using a join to get all scripts where the user is a collaborator
    from app.models.script_collaborator import ScriptCollaborator

    result = await db.execute(
        select(Script)
        .join(ScriptCollaborator, ScriptCollaborator.script_id == Script.script_id)
        .where(ScriptCollaborator.user_id == current_user.user_id)  # ✅ COLLABORATOR SCRIPTS
    )

    script_list = result.scalars().all()
    # ...
```

### Frontend Is Correctly Configured

The frontend (`app/page.tsx:87-103`) is ALREADY calling both endpoints:

```typescript
const load = async () => {
  setLoadingScripts(true);
  try {
    // Fetch both owned and shared scripts in parallel
    const [ownedResult, sharedResult] = await Promise.all([
      getUserScripts(),                                           // GET /users/me/scripts
      getSharedScripts().catch(() => [] as ScriptSummary[])      // GET /users/me/collaborations
    ]);
    if (mounted) {
      setScripts(ownedResult);          // Owned scripts
      setSharedScripts(sharedResult);    // Shared scripts ✅
    }
  } catch (e) {
    console.error("Failed to load user scripts:", e);
  } finally {
    if (mounted) setLoadingScripts(false);
  }
};
```

And the frontend displays shared scripts in a separate section (`app/page.tsx:695-733`):

```typescript
{/* Shared with me section - only shows if user has shared scripts */}
{sharedScripts.length > 0 && (
  <div className="pt-12">
    <h2 className="text-2xl font-semibold text-slate-700 mb-8 tracking-wide">Shared with me</h2>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {sharedScripts.map((p) => (
        <Card /* ... render shared script ... */ />
      ))}
    </div>
  </div>
)}
```

## Why Scripts Aren't Showing Up

The collaboration functionality is **already implemented correctly** on both backend and frontend. Scripts shared with a collaborator SHOULD appear in the "Shared with me" section.

### Possible Reasons for Not Seeing Scripts

1. **No Scripts Shared** - The "Shared with me" section only renders if `sharedScripts.length > 0`
2. **API Error** - The `getSharedScripts()` call has a `.catch(() => [])` that silently fails
3. **User Mismatch** - The collaborator record might be for a different `user_id` than the currently logged-in user
4. **Token/Auth Issue** - The authenticated user might not be resolving to the correct user_id

## Diagnostic Steps

### 1. Check Database Records

Verify the `script_collaborators` table has correct data:

```sql
-- Check what scripts are shared with a specific user
SELECT
    sc.id,
    sc.script_id,
    sc.user_id,
    sc.role,
    u.display_name as collaborator_name,
    u.firebase_uid,
    s.title as script_title
FROM script_collaborators sc
JOIN users u ON sc.user_id = u.user_id
JOIN scripts s ON sc.script_id = s.script_id
WHERE u.firebase_uid = '<firebase-uid-of-collaborator-account>'
OR u.display_name = '<collaborator-display-name>';
```

### 2. Check Frontend Network Requests

Open browser DevTools → Network tab and verify:

1. **Request to `/api/users/me/collaborations`** is being made
2. **Response** contains the expected scripts
3. **HTTP status** is 200 (not 401, 403, or 500)

### 3. Check User Authentication

Verify the logged-in user matches the database user:

```sql
-- Check user accounts
SELECT
    user_id,
    firebase_uid,
    display_name,
    email
FROM users
WHERE firebase_uid = '<firebase-uid>';
```

### 4. Check Console Logs

Add debug logging to frontend (`app/page.tsx:87-103`):

```typescript
const load = async () => {
  setLoadingScripts(true);
  try {
    const [ownedResult, sharedResult] = await Promise.all([
      getUserScripts(),
      getSharedScripts().catch((err) => {
        console.error('[HomePage] Failed to fetch shared scripts:', err);  // DEBUG
        return [] as ScriptSummary[];
      })
    ]);
    console.log('[HomePage] Owned scripts:', ownedResult.length);           // DEBUG
    console.log('[HomePage] Shared scripts:', sharedResult.length);         // DEBUG
    if (mounted) {
      setScripts(ownedResult);
      setSharedScripts(sharedResult);
    }
  } catch (e) {
    console.error("Failed to load user scripts:", e);
  } finally {
    if (mounted) setLoadingScripts(false);
  }
};
```

## Potential Issues and Fixes

### Issue 1: Silent API Failure

The `getSharedScripts()` call has a catch handler that returns an empty array, hiding errors:

```typescript
getSharedScripts().catch(() => [] as ScriptSummary[])  // ❌ Silent failure
```

**Fix**: Add logging to identify why the API call is failing:

```typescript
getSharedScripts().catch((err) => {
  console.error('[HomePage] Failed to fetch shared scripts:', err);
  return [] as ScriptSummary[];
})
```

### Issue 2: User ID Mismatch

The collaborator might have been added with a different `user_id` than the one resolved from Firebase authentication.

**Diagnosis**:
1. Check `script_collaborators.user_id` in database
2. Check what `user_id` is returned from `/api/users/me` endpoint
3. Verify they match

**Fix**: Ensure the collaborator was added using the correct email/Firebase UID

### Issue 3: Authorization Check in `get_user_collaborations`

The endpoint joins on `ScriptCollaborator` but doesn't have any specific access checks. Verify the user authentication is working.

**Diagnosis**: Test the endpoint directly:

```bash
# Get current user's JWT token from browser DevTools → Application → Local Storage
curl -H "Authorization: Bearer <token>" http://localhost:8000/api/users/me/collaborations
```

## Recommended Actions

### 1. Add Debug Logging (Immediate)

Add console logging to the frontend to identify where the failure is occurring:

```typescript
// In app/page.tsx, modify the load function
const load = async () => {
  setLoadingScripts(true);
  console.log('[HomePage] Loading scripts for user:', user?.uid);  // DEBUG

  try {
    const [ownedResult, sharedResult] = await Promise.all([
      getUserScripts(),
      getSharedScripts().catch((err) => {
        console.error('[HomePage] getSharedScripts failed:', err);
        console.error('[HomePage] Error details:', err.response?.data || err.message);
        return [] as ScriptSummary[];
      })
    ]);

    console.log('[HomePage] Owned scripts count:', ownedResult.length);
    console.log('[HomePage] Shared scripts count:', sharedResult.length);
    console.log('[HomePage] Shared scripts:', sharedResult);  // Full data

    if (mounted) {
      setScripts(ownedResult);
      setSharedScripts(sharedResult);
    }
  } catch (e) {
    console.error("Failed to load user scripts:", e);
  } finally {
    if (mounted) setLoadingScripts(false);
  }
};
```

### 2. Verify Database State (Required)

Run this query to confirm scripts are correctly shared:

```sql
SELECT
    sc.id,
    sc.script_id,
    sc.user_id,
    sc.role,
    sc.joined_at,
    u.display_name as collaborator_name,
    u.firebase_uid as collaborator_firebase_uid,
    s.title as script_title,
    owner.display_name as owner_name
FROM script_collaborators sc
JOIN users u ON sc.user_id = u.user_id
JOIN scripts s ON sc.script_id = s.script_id
JOIN users owner ON s.owner_id = owner.user_id
ORDER BY sc.joined_at DESC
LIMIT 20;
```

### 3. Test API Endpoint Directly (Quick Test)

Use browser DevTools or curl to test the `/api/users/me/collaborations` endpoint:

1. Open browser DevTools → Console
2. Run:
```javascript
fetch('http://localhost:8000/api/users/me/collaborations', {
  headers: {
    'Authorization': `Bearer ${await firebase.auth().currentUser.getIdToken()}`
  }
})
  .then(r => r.json())
  .then(data => console.log('Collaborations:', data))
  .catch(err => console.error('Error:', err));
```

### 4. Check User Context (Critical)

Verify the logged-in user's Firebase UID matches the database user_id:

```javascript
// In browser console
firebase.auth().currentUser.uid  // Firebase UID

// Then check database
SELECT user_id, firebase_uid, display_name
FROM users
WHERE firebase_uid = '<uid-from-above>';

// Then check collaborators
SELECT * FROM script_collaborators
WHERE user_id = '<user-id-from-above>';
```

## Expected Behavior

When working correctly:

1. User A creates a script → owns it → appears in "Your Projects"
2. User A adds User B as collaborator via email
3. Backend creates `ScriptCollaborator` record with User B's `user_id`
4. User B logs in → frontend calls `/users/me/collaborations`
5. Backend returns scripts where User B is a collaborator
6. Frontend displays scripts in "Shared with me" section

## Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Backend `/users/me/collaborations` endpoint | ✅ Implemented | Correctly queries collaborator scripts |
| Backend `/scripts/{id}/collaborators` add endpoint | ✅ Implemented | Creates ScriptCollaborator records |
| Frontend API client `getSharedScripts()` | ✅ Implemented | Calls correct endpoint |
| Frontend display "Shared with me" section | ✅ Implemented | Shows shared scripts when available |
| Error logging | ❌ Missing | Silent failures hide issues |

## Conclusion

The collaboration functionality is **fully implemented** on both backend and frontend. The issue is likely one of:

1. **Silent API failure** - The `.catch(() => [])` is hiding an error
2. **User ID mismatch** - The collaborator was added with wrong user
3. **Authentication issue** - Token not resolving to correct user

**Next Step**: Add debug logging to the frontend (as shown above) to identify which of these is the actual issue.
