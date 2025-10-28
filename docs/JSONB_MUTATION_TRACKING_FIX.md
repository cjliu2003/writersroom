# JSONB Mutation Tracking Fix - Scene Summary Persistence Issue

## Issue Summary

**Problem**: AI-generated scene summaries were displaying correctly in the UI after generation but not persisting to the database. Database checks showed `scene_summaries` column remained NULL despite successful API calls.

**Date Fixed**: 2025-10-27
**Files Modified**: `backend/app/routers/ai_router.py`

## Root Cause Analysis

### The Problem: SQLAlchemy JSONB Mutation Detection

SQLAlchemy's ORM tracks changes to model attributes through **assignment detection**. When you assign a value to an attribute:

```python
script.title = "New Title"  # ✅ SQLAlchemy detects this
```

The ORM marks that field as "dirty" and includes it in the UPDATE query during commit.

However, for **mutable types** like dicts and lists stored in JSONB columns, **in-place mutations** don't trigger this detection:

```python
# ❌ SQLAlchemy does NOT detect these changes:
script.scene_summaries["Scene 1"] = "Summary text"  # Dict mutation
script.content_blocks.append(new_block)             # List mutation
```

### Why This Happened

In the original implementation (`backend/app/routers/ai_router.py:68-72`):

```python
# Script-level editor: save to script.scene_summaries
if script.scene_summaries is None:
    script.scene_summaries = {}
script.scene_summaries[request.slugline] = summary  # ⚠️ In-place mutation!
script.updated_at = datetime.now(timezone.utc)
```

The code mutated the dictionary in-place with `dict[key] = value`. SQLAlchemy didn't detect this change, so the UPDATE query never included the `scene_summaries` column. The object appeared unchanged to the ORM.

### How It Appeared to Work

The summary appeared in the UI because:
1. Frontend called the API
2. Backend generated summary and modified the in-memory dict
3. API returned the summary in the response
4. Frontend displayed it from the response
5. However, `db.commit()` didn't actually update the database
6. On page reload, database still had NULL → summaries disappeared

## The Solution

Use `attributes.flag_modified()` to explicitly tell SQLAlchemy that a JSONB column has changed:

```python
from sqlalchemy.orm import attributes

# Script-level editor: save to script.scene_summaries
if script.scene_summaries is None:
    script.scene_summaries = {}
script.scene_summaries[request.slugline] = summary
# ✅ Mark the JSONB column as modified
attributes.flag_modified(script, 'scene_summaries')
script.updated_at = datetime.now(timezone.utc)
```

## Implementation Details

### Files Changed

**`backend/app/routers/ai_router.py`**:

1. **Added import** (line 8):
```python
from sqlalchemy.orm import attributes
```

2. **Added flag_modified call** (line 74):
```python
attributes.flag_modified(script, 'scene_summaries')
```

### Complete Fixed Code

```python
if scene:
    # Scene-level editor: save to scene.summary
    scene.summary = summary
    scene.updated_at = datetime.now(timezone.utc)
else:
    # Script-level editor: save to script.scene_summaries
    if script.scene_summaries is None:
        script.scene_summaries = {}
    script.scene_summaries[request.slugline] = summary
    # Mark the JSONB column as modified so SQLAlchemy detects the change
    attributes.flag_modified(script, 'scene_summaries')
    script.updated_at = datetime.now(timezone.utc)

await db.commit()
```

## Alternative Solutions (Not Used)

### Option 1: Full Dict Replacement
Replace the entire dict instead of mutating:

```python
script.scene_summaries = {
    **(script.scene_summaries or {}),
    request.slugline: summary
}
```

**Pros**: SQLAlchemy detects assignment
**Cons**: Less efficient (creates new dict), less readable

### Option 2: MutableDict Type
Use SQLAlchemy's `MutableDict` type in the model:

```python
from sqlalchemy.ext.mutable import MutableDict

scene_summaries: Mapped[Optional[Dict[str, str]]] = mapped_column(
    MutableDict.as_mutable(JSONB),
    nullable=True
)
```

**Pros**: Automatic mutation tracking
**Cons**: Requires model change, adds overhead, more complex

### Why flag_modified() Was Chosen
- Minimal change (one line)
- Explicit and clear intent
- No model changes required
- Standard SQLAlchemy pattern
- No performance overhead

## Pattern for JSONB Mutations

### ✅ Correct Pattern (Full Assignment)
```python
# SQLAlchemy detects this automatically
scene.content_blocks = new_blocks_list
script.scene_summaries = new_summaries_dict
```

### ✅ Correct Pattern (In-Place with flag_modified)
```python
from sqlalchemy.orm import attributes

# Mutate in-place
script.scene_summaries[key] = value
# Tell SQLAlchemy about the change
attributes.flag_modified(script, 'scene_summaries')
```

### ❌ Broken Pattern (In-Place without flag_modified)
```python
# SQLAlchemy won't detect this!
script.scene_summaries[key] = value
# Missing: attributes.flag_modified(script, 'scene_summaries')
```

## Testing

### Manual Testing Steps

1. **Generate a summary**:
   - Open script-level editor
   - Click "Generate AI Summary" on a scene
   - Verify summary appears in sidebar

2. **Check database**:
   ```sql
   SELECT script_id, scene_summaries
   FROM scripts
   WHERE script_id = 'your-script-id';
   ```
   - Should show JSONB object with scene heading → summary mapping

3. **Reload page**:
   - Refresh browser
   - Verify summary still appears in sidebar
   - Confirms persistence

### Automated Test

Run the test script:
```bash
cd backend
python test_jsonb_mutation.py
```

This script verifies:
- JSONB mutations WITHOUT flag_modified don't persist
- JSONB mutations WITH flag_modified DO persist

## Lessons Learned

1. **JSONB Mutations Require Explicit Tracking**: Always use `flag_modified()` or full assignment
2. **Test Persistence Separately**: UI display doesn't guarantee database writes
3. **Reference Existing Patterns**: Codebase had consistent pattern of full assignment
4. **Check Database Directly**: Don't rely only on application-level verification

## Related Code

### Similar JSONB Fields in Codebase

**Scene.content_blocks** - Uses full assignment pattern:
```python
scene.content_blocks = new_content_blocks  # ✅ Correct
```

**Script.content_blocks** - Uses full assignment pattern:
```python
script.content_blocks = content_blocks  # ✅ Correct
```

### Future JSONB Fields

If adding new JSONB fields with in-place mutations, remember to use `flag_modified()`:

```python
from sqlalchemy.orm import attributes

# After any in-place mutation of JSONB fields:
model.jsonb_field[key] = value
attributes.flag_modified(model, 'jsonb_field')
```

## References

- [SQLAlchemy Mutation Tracking Documentation](https://docs.sqlalchemy.org/en/20/orm/session_api.html#sqlalchemy.orm.attributes.flag_modified)
- [SQLAlchemy Mutable Extension](https://docs.sqlalchemy.org/en/20/orm/extensions/mutable.html)
- Issue discussion: Scene summary persistence failure (2025-10-27)

## Impact

**Before Fix**:
- Summaries appeared in UI but didn't persist
- Database `scene_summaries` stayed NULL
- User frustration from data loss

**After Fix**:
- Summaries persist correctly to database
- Survives page reloads and sessions
- Complete scene summary functionality for script-level editor
