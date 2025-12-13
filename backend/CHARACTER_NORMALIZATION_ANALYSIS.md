# Character Normalization Analysis

## Problem Statement

Currently, characters with parentheticals like "SAM (O.S.)" and "SAM (V.O.)" are treated as different characters from "SAM", even though they represent the same character. The parenthetical only indicates the delivery method (off-screen, voice-over, etc.), not a different character.

## Common Screenplay Parentheticals

- **(O.S.)** - Off-Screen
- **(V.O.)** - Voice Over
- **(CONT'D)** - Continued (character continues speaking)
- **(O.C.)** - Off-Camera
- **(PRE-LAP)** - Pre-Lap (audio before visual)
- **(FILTERED)** - Through device (phone, radio, etc.)

## Files Requiring Changes

### 1. **FDX Parser** (`app/services/fdx_parser.py`)

**Location**: Lines 287-289
```python
# Track characters
if element.type == ScreenplayBlockType.CHARACTER:
    current_characters.add(element.text)
```

**Issue**: Adds the full character string including parentheticals to the set.

**Solution**: Create a helper function to normalize character names by stripping parentheticals before adding to the set.

---

### 2. **FDX Upload Router** (`app/routers/fdx_router.py`)

**Location**: Lines 200-208
```python
for db_scene in db_scenes:
    if db_scene.characters:  # Scene.characters is a JSONB array
        for character_name in db_scene.characters:
            scene_char = SceneCharacter(
                scene_id=db_scene.scene_id,
                character_name=character_name
            )
            db.add(scene_char)
```

**Issue**: Uses character names from `scene_data.characters` (which come from FDX parser) without normalization.

**Solution**: The fix in fdx_parser.py will propagate here, but we should add validation/normalization as a safety check.

---

### 3. **Backfill Script** (`backfill_scene_characters.py`)

**Location**: Lines 62-78
```python
for character_name in scene.characters:
    # Check if record already exists
    existing = await db.execute(
        select(SceneCharacter)
        .where(SceneCharacter.scene_id == scene.scene_id)
        .where(SceneCharacter.character_name == character_name)
    )

    if existing.scalar_one_or_none() is None:
        scene_char = SceneCharacter(
            scene_id=scene.scene_id,
            character_name=character_name
        )
        db.add(scene_char)
```

**Issue**: Uses character names from Scene.characters JSONB field without normalization.

**Solution**: Apply normalization before creating SceneCharacter records. This is critical for existing data migration.

---

### 4. **Character Sheet Generation** (`app/services/ingestion_service.py`)

**Location**: Lines 412-419
```python
# Get all unique characters
chars_result = await self.db.execute(
    select(SceneCharacter.character_name)
    .join(Scene, SceneCharacter.scene_id == Scene.scene_id)
    .where(Scene.script_id == script_id)
    .distinct()
)

character_names = [row[0] for row in chars_result]
```

**Issue**: This retrieves from scene_characters table, so if the table is already normalized, this should work correctly. However, we should verify character name consistency.

**Impact**: LOW - If upstream normalization is correct, this will automatically get normalized names.

---

### 5. **Scene.characters JSONB Field**

**Database Model**: `app/models/scene.py`

**Issue**: The Scene model has a `characters` JSONB field that stores the original array of character names. This is currently populated with unnormalized names.

**Solution**: We need to decide if:
- A) Keep Scene.characters normalized (recommended)
- B) Keep Scene.characters with parentheticals but normalize when creating SceneCharacter records

**Recommendation**: Option A - normalize at the source (FDX parser) so Scene.characters is always normalized.

---

### 6. **AI Scene Service** (`app/services/ai_scene_service.py`)

**Location**: Lines 206-224
```python
async def extract_character_names(self, scene: Scene) -> List[str]:
    """
    Extract character names from scene content.
    """
    # For now, get existing scene_characters
    result = await self.db.execute(
        select(SceneCharacter.character_name)
        .where(SceneCharacter.scene_id == scene.scene_id)
    )

    return [row[0] for row in result]
```

**Issue**: Retrieves from scene_characters table.

**Impact**: LOW - If upstream is normalized, this is fine.

---

### 7. **Content Block Processing**

**Potential Issue**: If character blocks in `content_blocks` JSONB still have parentheticals, the UI might display them.

**Files to Check**:
- `app/services/yjs_to_slate_converter.py` - Handles conversion between Yjs and Slate formats
- Frontend components that display character names

**Note**: The CHARACTER block type in content_blocks might still show "SAM (O.S.)" for screenplay formatting purposes, which is actually correct for display. The normalization should only apply to the character tracking/analysis system.

---

## Recommended Implementation Strategy

### Phase 1: Create Normalization Utility

Create a new utility function in a shared location:

```python
# app/utils/character_normalization.py

import re
from typing import List

# Parenthetical patterns to strip
PARENTHETICAL_PATTERNS = [
    r'\s*\(O\.S\.\)',
    r'\s*\(V\.O\.\)',
    r'\s*\(CONT\'D\)',
    r'\s*\(O\.C\.\)',
    r'\s*\(PRE-LAP\)',
    r'\s*\(FILTERED\)',
    r'\s*\([^)]*\)',  # Catch-all for any other parentheticals
]

def normalize_character_name(character_name: str) -> str:
    """
    Remove parentheticals from character names for tracking purposes.

    Examples:
        "SAM (O.S.)" -> "SAM"
        "JOHN (CONT'D)" -> "JOHN"
        "MARY (V.O.)" -> "MARY"

    Args:
        character_name: Original character name with possible parentheticals

    Returns:
        Normalized character name without parentheticals
    """
    if not character_name:
        return character_name

    normalized = character_name.strip()

    # Apply all parenthetical patterns
    for pattern in PARENTHETICAL_PATTERNS:
        normalized = re.sub(pattern, '', normalized, flags=re.IGNORECASE)

    # Clean up any trailing/leading whitespace
    normalized = normalized.strip()

    return normalized


def normalize_character_list(character_names: List[str]) -> List[str]:
    """
    Normalize a list of character names, removing duplicates after normalization.

    Args:
        character_names: List of character names with possible parentheticals

    Returns:
        List of unique normalized character names
    """
    if not character_names:
        return []

    # Normalize and deduplicate
    normalized = set()
    for name in character_names:
        norm = normalize_character_name(name)
        if norm:  # Only add non-empty names
            normalized.add(norm)

    return list(normalized)
```

### Phase 2: Update FDX Parser

**File**: `app/services/fdx_parser.py`

**Changes**:
```python
from app.utils.character_normalization import normalize_character_name

# Line 288-289
if element.type == ScreenplayBlockType.CHARACTER:
    # Normalize character name before adding to set
    normalized_name = normalize_character_name(element.text)
    current_characters.add(normalized_name)

# Line 261 (when setting scene.characters)
current_scene.characters = list(current_characters)  # Already normalized
```

### Phase 3: Update FDX Router

**File**: `app/routers/fdx_router.py`

**Changes**:
```python
from app.utils.character_normalization import normalize_character_name

# Lines 200-208 - Add normalization as safety check
for db_scene in db_scenes:
    if db_scene.characters:
        for character_name in db_scene.characters:
            # Normalize as safety check (should already be normalized from parser)
            normalized_name = normalize_character_name(character_name)
            scene_char = SceneCharacter(
                scene_id=db_scene.scene_id,
                character_name=normalized_name
            )
            db.add(scene_char)
```

### Phase 4: Update Backfill Script

**File**: `backfill_scene_characters.py`

**Changes**:
```python
from app.utils.character_normalization import normalize_character_name

# Lines 62-78
for character_name in scene.characters:
    # Normalize character name before checking/creating
    normalized_name = normalize_character_name(character_name)

    # Check if record already exists
    existing = await db.execute(
        select(SceneCharacter)
        .where(SceneCharacter.scene_id == scene.scene_id)
        .where(SceneCharacter.character_name == normalized_name)
    )

    if existing.scalar_one_or_none() is None:
        scene_char = SceneCharacter(
            scene_id=scene.scene_id,
            character_name=normalized_name
        )
        db.add(scene_char)
        total_records_created += 1
        unique_characters.add(normalized_name)
```

### Phase 5: Data Migration Script

Create a migration script to normalize existing data in the database:

```python
# app/scripts/migrate_normalize_characters.py

"""
Migrate existing scene_characters and Scene.characters data to use normalized names.
"""

import asyncio
from sqlalchemy import select, delete
from app.db.base import async_session_maker
from app.models.scene import Scene
from app.models.scene_character import SceneCharacter
from app.utils.character_normalization import normalize_character_list, normalize_character_name

async def migrate_normalize_characters(script_id: str = None):
    """
    Normalize all character names in database.

    Steps:
    1. Update Scene.characters JSONB arrays to use normalized names
    2. Delete all SceneCharacter records
    3. Recreate SceneCharacter records with normalized names
    """
    async with async_session_maker() as db:
        # Get scenes to update
        query = select(Scene)
        if script_id:
            query = query.where(Scene.script_id == script_id)

        result = await db.execute(query)
        scenes = result.scalars().all()

        print(f"Normalizing {len(scenes)} scenes...")

        # Update Scene.characters
        for scene in scenes:
            if scene.characters:
                normalized = normalize_character_list(scene.characters)
                scene.characters = normalized

        await db.commit()

        # Delete existing SceneCharacter records
        delete_query = delete(SceneCharacter)
        if script_id:
            delete_query = delete_query.where(
                SceneCharacter.scene_id.in_([s.scene_id for s in scenes])
            )

        await db.execute(delete_query)
        await db.commit()

        # Recreate SceneCharacter records with normalized names
        for scene in scenes:
            if scene.characters:
                for char_name in scene.characters:
                    scene_char = SceneCharacter(
                        scene_id=scene.scene_id,
                        character_name=char_name  # Already normalized
                    )
                    db.add(scene_char)

        await db.commit()
        print("Migration complete!")
```

### Phase 6: Testing

**Test Cases**:
1. Upload new FDX with characters like "SAM (O.S.)" and verify normalized storage
2. Run backfill script on old data and verify normalization
3. Verify character sheets are generated with correct normalized names
4. Verify scene_characters junction table has no duplicate characters with parentheticals
5. Verify UI displays character names correctly

### Phase 7: Database Cleanup

After migration, verify:
```sql
-- Check for any remaining unnormalized characters
SELECT DISTINCT character_name
FROM scene_characters
WHERE character_name ~ '\(.*\)';

-- Count characters per script before/after
SELECT script_id, COUNT(DISTINCT character_name)
FROM scene_characters sc
JOIN scenes s ON sc.scene_id = s.scene_id
GROUP BY script_id;
```

---

## Impact Analysis

### High Impact (Must Change)
1. ✅ `fdx_parser.py` - Line 288-289 (character extraction)
2. ✅ `fdx_router.py` - Lines 200-208 (SceneCharacter creation)
3. ✅ `backfill_scene_characters.py` - Lines 62-78 (backfill logic)

### Medium Impact (Safety/Validation)
4. ⚠️ `Scene.characters` JSONB field - Should be normalized at source
5. ⚠️ Existing database data - Needs migration script

### Low Impact (Likely Auto-Fixed)
6. ℹ️ `ingestion_service.py` - Character sheet generation (reads from normalized table)
7. ℹ️ `ai_scene_service.py` - Extract character names (reads from normalized table)

---

## Next Steps

1. Create `app/utils/character_normalization.py` with normalization utilities
2. Update `fdx_parser.py` to use normalization
3. Update `fdx_router.py` to use normalization
4. Update `backfill_scene_characters.py` to use normalization
5. Create data migration script
6. Run migration on existing data
7. Test with new FDX uploads
8. Verify character tracking across all features

---

## Notes

- The CHARACTER content block type in `content_blocks` should **keep** the parenthetical for screenplay formatting display purposes
- Only the character tracking/analysis system (Scene.characters JSONB and scene_characters table) should use normalized names
- This ensures screenplay formatting is preserved while analytics work correctly
