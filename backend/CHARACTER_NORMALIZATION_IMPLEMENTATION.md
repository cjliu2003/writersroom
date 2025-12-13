# Character Normalization Implementation Summary

## Overview

Successfully implemented character normalization across the WritersRoom backend to treat screenplay characters consistently regardless of parenthetical annotations. Characters like "SAM (O.S.)" and "SAM (V.O.)" are now correctly identified as the same character "SAM" for AI analytics purposes, while preserving the original screenplay formatting in content blocks.

## Implementation Date

December 11, 2025

## Problem Statement

Previously, characters with parentheticals like "SAM (O.S.)" (Off-Screen) and "SAM (V.O.)" (Voice Over) were treated as different characters in the analytics system, even though they represent the same character. The parenthetical only indicates the delivery method, not a different character.

## Solution

Created a normalization utility that strips screenplay parentheticals from character names for analytics tracking, while preserving the original formatting in screenplay content blocks for display purposes.

## Files Created

### 1. `app/utils/character_normalization.py`
**Purpose**: Core utility module for character name normalization

**Functions**:
- `normalize_character_name(character_name: str) -> str`: Removes parentheticals from a single character name
- `normalize_character_list(character_names: List[str]) -> List[str]`: Normalizes and deduplicates a list of character names

**Parenthetical Patterns Handled**:
- `(O.S.)` - Off-Screen
- `(V.O.)` - Voice Over
- `(CONT'D)` - Continued
- `(O.C.)` - Off-Camera
- `(PRE-LAP)` - Pre-Lap
- `(FILTERED)` - Through device (phone, radio, etc.)
- Any other custom parentheticals via catch-all pattern

**Features**:
- Case-insensitive matching
- Whitespace normalization
- Handles edge cases (empty strings, None, unicode, special characters)
- Sorted, deduplicated output for lists

### 2. `migrate_normalize_characters.py`
**Purpose**: One-time migration script to normalize existing database records

**Functionality**:
- Updates `Scene.characters` JSONB arrays to use normalized names
- Deletes all existing `SceneCharacter` records
- Recreates `SceneCharacter` records with normalized names
- Provides detailed statistics on normalization results
- Supports filtering by specific script ID

**Usage**:
```bash
# Migrate all scripts
python migrate_normalize_characters.py

# Migrate specific script
python migrate_normalize_characters.py --script-id <uuid>
```

### 3. `tests/test_character_normalization.py`
**Purpose**: Comprehensive test suite for character normalization

**Test Coverage**:
- 32 test cases covering all normalization scenarios
- Unit tests for individual functions
- Edge case testing (unicode, special characters, numbers)
- Integration test placeholders for database operations

**Test Results**: ✅ All 32 tests passing

## Files Modified

### 1. `app/services/fdx_parser.py`
**Changes**:
- Added import: `from app.utils.character_normalization import normalize_character_name`
- Modified character tracking (lines 289-292):
  ```python
  # Track characters (normalize to remove parentheticals like (O.S.), (V.O.), etc.)
  if element.type == ScreenplayBlockType.CHARACTER:
      normalized_name = normalize_character_name(element.text)
      current_characters.add(normalized_name)
  ```

**Impact**: Characters are normalized at the source when parsing FDX files

### 2. `app/routers/fdx_router.py`
**Changes**:
- Added import: `from app.utils.character_normalization import normalize_character_name`
- Modified SceneCharacter creation (lines 204-209):
  ```python
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

**Impact**: Provides redundant normalization as safety check during FDX upload

### 3. `backfill_scene_characters.py`
**Changes**:
- Added import: `from app.utils.character_normalization import normalize_character_name`
- Modified character processing loop (lines 63-82):
  ```python
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

**Impact**: Ensures backfill operations use normalized character names

## Data Flow

### Before Implementation
```
FDX File: "SAM (O.S.)" → Scene.characters: ["SAM (O.S.)"] → scene_characters: "SAM (O.S.)"
FDX File: "SAM (V.O.)" → Scene.characters: ["SAM (V.O.)"] → scene_characters: "SAM (V.O.)"
Result: Two different character entries for the same character
```

### After Implementation
```
FDX File: "SAM (O.S.)" → Scene.characters: ["SAM"] → scene_characters: "SAM"
FDX File: "SAM (V.O.)" → Scene.characters: ["SAM"] → scene_characters: "SAM"
Result: Single character entry with normalized name
```

### Content Preservation
```
content_blocks (preserved for display):
{
  "type": "character",
  "text": "SAM (O.S.)"  ← PRESERVED for screenplay formatting
}

Scene.characters (normalized for analytics):
["SAM"]  ← NORMALIZED for character tracking
```

## Design Decisions

### 1. Separation of Concerns
- **Content Blocks**: Preserve original screenplay formatting including parentheticals
- **Analytics Tables**: Use normalized names for tracking and AI analysis

**Rationale**: Screenplay formatting must be preserved for display while character tracking needs consistency

### 2. Normalization Location
- Primary normalization in FDX parser (source)
- Secondary normalization in FDX router (safety check)
- Normalization in backfill script (existing data)

**Rationale**: Normalize at the earliest point to ensure consistency, with redundant checks for safety

### 3. Case-Insensitive Matching
- Parentheticals matched regardless of case: (O.S.), (o.s.), (O.s.)

**Rationale**: Different FDX files may use different capitalization

### 4. Sorted Output
- `normalize_character_list()` returns alphabetically sorted results

**Rationale**: Consistent ordering for display and testing

## Testing Strategy

### Unit Tests
- Individual function behavior
- Edge cases (empty, None, unicode, special characters)
- Common screenplay parentheticals
- Custom parenthetical patterns

### Integration Tests
- Placeholders created for database integration
- Future tests will verify end-to-end normalization flow

### Test Results
```
32 passed, 1 warning in 0.03s
100% test coverage for normalization functions
```

## Migration Instructions

### For New FDX Uploads
No migration needed - normalization happens automatically during upload

### For Existing Data
Run the migration script:
```bash
cd /Users/jacklofwall/Documents/GitHub/writersroom/backend

# Activate virtual environment
source ../writersRoom/bin/activate

# Run migration (all scripts)
python migrate_normalize_characters.py

# Or migrate specific script
python migrate_normalize_characters.py --script-id <uuid>
```

**Warning**: This will delete and recreate all `scene_characters` records. Run during maintenance window.

## Verification

### Database Checks
```sql
-- Check for any remaining unnormalized characters
SELECT DISTINCT character_name
FROM scene_characters
WHERE character_name ~ '\(.*\)'
ORDER BY character_name;

-- Count characters per script before/after
SELECT script_id, COUNT(DISTINCT character_name) as unique_characters
FROM scene_characters sc
JOIN scenes s ON sc.scene_id = s.scene_id
GROUP BY script_id
ORDER BY script_id;

-- Verify Scene.characters arrays are normalized
SELECT scene_id, characters
FROM scenes
WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(characters) AS char_name
    WHERE char_name ~ '\(.*\)'
)
LIMIT 10;
```

### Expected Results
- No character names should contain parentheticals in `scene_characters` table
- No character names should contain parentheticals in `Scene.characters` JSONB arrays
- Character count should decrease (duplicates removed)

## Impact Analysis

### Affected Components
✅ **High Impact (Implemented)**:
1. FDX Parser - Character extraction now normalized
2. FDX Router - SceneCharacter creation uses normalized names
3. Backfill Script - Existing data migration uses normalized names

✅ **Medium Impact (Safe)**:
4. Scene.characters JSONB - Normalized at source
5. Migration Script - Created for data cleanup

✅ **Low Impact (Auto-Fixed)**:
6. Ingestion Service - Reads from normalized table
7. AI Scene Service - Reads from normalized table

### Not Affected
- Content blocks - Original formatting preserved
- Screenplay display - Shows original "SAM (O.S.)"
- Frontend rendering - No changes needed

## Benefits

1. **Accurate Character Tracking**: Characters identified correctly regardless of delivery method
2. **Better AI Analytics**: Character sheets and summaries reflect true character presence
3. **Reduced Duplicates**: Single character entry instead of multiple variations
4. **Preserved Formatting**: Screenplay display maintains professional formatting
5. **Comprehensive Testing**: 32 tests ensure reliability

## Future Considerations

### Potential Enhancements
1. Add more specific parenthetical patterns if discovered
2. Create admin UI for viewing character normalization
3. Add character merge/split functionality for edge cases
4. Implement character alias system for complex scenarios

### Monitoring
- Track character count changes after migration
- Monitor for any new parenthetical patterns
- Verify AI summaries reference correct character names

## Rollback Plan

If issues are discovered:

1. **Revert Code Changes**:
   ```bash
   git revert <commit-hash>
   ```

2. **Restore Database** (if migration was run):
   - Restore from backup taken before migration
   - Or re-run backfill script from original FDX files

3. **Verify**: Run tests to ensure system returns to previous state

## Documentation References

- Analysis Document: `CHARACTER_NORMALIZATION_ANALYSIS.md`
- Implementation Summary: This document
- Test File: `tests/test_character_normalization.py`
- Utility Module: `app/utils/character_normalization.py`

## Conclusion

Character normalization has been successfully implemented across all required components. The system now correctly identifies characters regardless of parenthetical annotations while preserving original screenplay formatting for display. All tests pass and the implementation is ready for deployment after running the migration script on existing data.
