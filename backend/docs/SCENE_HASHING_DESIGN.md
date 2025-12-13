# Scene Hashing System - Design Specification

## Overview

This document specifies the design for implementing scene content hashing to enable precise change detection for incremental AI analysis. This completes **Phase 0 and Phase 1** of the AI Implementation Plan.

## Objectives

1. **Content Change Detection**: Detect when scene content has meaningfully changed to trigger re-analysis
2. **Incremental Updates**: Avoid re-analyzing unchanged scenes to optimize LLM token usage
3. **Manual Scene Tagging**: Allow manual flagging of key/important scenes for priority analysis
4. **Integration**: Seamlessly integrate with existing ingestion and staleness tracking systems

## Architecture

### 1. Database Schema Changes

#### 1.1 New Fields on `scenes` Table

```sql
-- Add content hash for change detection
ALTER TABLE scenes ADD COLUMN hash VARCHAR(64);

-- Add manual key scene flag
ALTER TABLE scenes ADD COLUMN is_key_scene BOOLEAN DEFAULT FALSE;

-- Create index for efficient hash lookups
CREATE INDEX idx_scenes_hash ON scenes(hash);

-- Create partial index for key scenes (sparse data optimization)
CREATE INDEX idx_scenes_is_key ON scenes(is_key_scene) WHERE is_key_scene = TRUE;
```

#### 1.2 Field Specifications

| Field | Type | Nullable | Default | Purpose |
|-------|------|----------|---------|---------|
| `hash` | VARCHAR(64) | Yes | NULL | SHA-256 hex digest of normalized scene content |
| `is_key_scene` | BOOLEAN | No | FALSE | Manual flag for important scenes (plot points, character arcs, etc.) |

#### 1.3 Hash Semantics

- **NULL hash**: Scene never analyzed (new import, or pre-migration data)
- **Non-NULL hash**: Represents content state at last AI analysis
- **Hash updates**: Only when generating scene summary (marks "analyzed this content")

---

### 2. Model Changes (`app/models/scene.py`)

```python
from sqlalchemy import String, Boolean
from sqlalchemy.orm import Mapped, mapped_column

class Scene(Base):
    # ... existing fields ...

    # Content hash for change detection (Phase 1)
    hash: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        index=True,
        comment='SHA-256 hash of normalized scene content for change detection'
    )

    # Manual key scene flag (Phase 1)
    is_key_scene: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment='Manually flagged as key scene (plot point, major character moment, etc.)'
    )

    def to_dict(self) -> dict:
        """Convert Scene instance to dictionary."""
        return {
            # ... existing fields ...
            'hash': self.hash,
            'is_key_scene': self.is_key_scene,
        }
```

---

### 3. Service Layer (`app/services/scene_service.py`)

#### 3.1 New Methods

```python
import hashlib
import re
from typing import Optional
from app.models.scene import Scene

class SceneService:
    # ... existing methods ...

    @staticmethod
    def _construct_scene_text(scene: Scene) -> str:
        """
        Reconstruct scene text from content blocks.

        Priority:
        1. content_blocks (primary editor state)
        2. full_content (fallback for imports)
        3. scene_heading (last resort)

        Args:
            scene: Scene object

        Returns:
            Full scene text as string
        """
        # Try content_blocks first (structured format)
        if scene.content_blocks:
            lines = []
            for block in scene.content_blocks:
                if isinstance(block, dict) and 'text' in block:
                    lines.append(block['text'])
            return '\n'.join(lines)

        # Fall back to full_content if available
        if scene.full_content:
            return scene.full_content

        # Last resort: scene_heading only
        return scene.scene_heading or ""

    @staticmethod
    def normalize_scene_text(text: str) -> str:
        """
        Normalize scene text for consistent hashing.

        Eliminates formatting differences that don't represent content changes:
        - Strips leading/trailing whitespace
        - Normalizes line endings (CRLF → LF)
        - Collapses multiple spaces to single space (within lines)
        - Preserves line breaks (important for screenplay structure)

        Args:
            text: Raw scene text

        Returns:
            Normalized text suitable for hashing
        """
        # Strip leading/trailing whitespace
        normalized = text.strip()

        # Normalize line endings
        normalized = normalized.replace('\r\n', '\n')

        # Collapse multiple spaces within lines (but preserve line breaks)
        # Process each line separately to maintain screenplay structure
        lines = normalized.split('\n')
        normalized_lines = [re.sub(r'\s+', ' ', line.strip()) for line in lines]

        # Rejoin with single newlines
        return '\n'.join(normalized_lines)

    @staticmethod
    def compute_scene_hash(scene_text: str) -> str:
        """
        Compute SHA-256 hash of normalized scene content.

        Args:
            scene_text: Scene text to hash

        Returns:
            64-character hex digest
        """
        normalized = SceneService.normalize_scene_text(scene_text)
        return hashlib.sha256(normalized.encode('utf-8')).hexdigest()

    async def detect_scene_changes(self, scene: Scene) -> bool:
        """
        Detect if scene content has changed since last analysis.

        Compares current content hash against stored scene.hash.
        If changed, updates hash to mark current state as "analyzed".

        Args:
            scene: Scene object to check

        Returns:
            True if content changed (needs re-analysis), False otherwise
        """
        # Construct current scene text
        current_text = self._construct_scene_text(scene)

        # Compute current content hash
        current_hash = self.compute_scene_hash(current_text)

        # Compare with stored hash
        if scene.hash != current_hash:
            # Content has changed - update hash to current state
            scene.hash = current_hash
            await self.db.commit()
            return True

        # No change detected
        return False
```

#### 3.2 Method Semantics

| Method | Purpose | Side Effects | Return Value |
|--------|---------|--------------|--------------|
| `_construct_scene_text()` | Build text from content_blocks | None | Scene text string |
| `normalize_scene_text()` | Standardize formatting | None | Normalized text |
| `compute_scene_hash()` | Generate SHA-256 hash | None | 64-char hex string |
| `detect_scene_changes()` | Check for content changes | Updates `scene.hash` if changed | Boolean (True = changed) |

---

### 4. Integration Points

#### 4.1 Ingestion Service (`app/services/ingestion_service.py`)

**Integration**: After generating scene summary, update scene hash

```python
async def generate_scene_summary(
    self,
    scene: Scene,
    force_regenerate: bool = False
) -> SceneSummary:
    """Generate scene summary and update content hash."""

    # ... existing summary generation logic ...

    # Update scene hash to mark "this content was analyzed"
    scene_text = SceneService._construct_scene_text(scene)
    scene.hash = SceneService.compute_scene_hash(scene_text)
    await self.db.commit()

    return summary
```

**Rationale**: Hash represents "content state at last AI analysis". Setting it after summary generation ensures staleness detection works correctly.

#### 4.2 Staleness Service (`app/services/staleness_service.py`)

**New Method**: Check if scenes need re-analysis

```python
async def check_scene_staleness(self, scene_id: UUID) -> bool:
    """
    Check if scene needs re-analysis due to content changes.

    Args:
        scene_id: Scene to check

    Returns:
        True if scene is stale (content changed), False otherwise
    """
    scene_service = SceneService(self.db)

    # Get scene
    scene = await self.db.get(Scene, scene_id)

    if not scene:
        return False

    # Check if content changed since last analysis
    return await scene_service.detect_scene_changes(scene)
```

**Usage**: Called by refresh jobs to determine if scene summary needs regeneration.

#### 4.3 Embedding Service (`app/services/embedding_service.py`)

**Enhancement**: Use hash-based staleness for embeddings

```python
async def should_reembed(self, scene: Scene) -> bool:
    """
    Determine if scene embedding needs regeneration.

    Checks:
    1. No embedding exists
    2. Content hash changed (scene.hash differs from current content)

    Args:
        scene: Scene to check

    Returns:
        True if re-embedding needed
    """
    # No embedding exists
    if not scene.embedding:
        return True

    # Check if content changed
    scene_service = SceneService(self.db)
    return await scene_service.detect_scene_changes(scene)
```

#### 4.4 FDX Parser (`app/services/fdx_parser.py`)

**Optional Enhancement**: Compute hash on import

```python
def create_scene(...) -> Scene:
    """Create scene from FDX data."""

    scene = Scene(
        # ... existing fields ...
    )

    # Optionally compute initial hash (for efficiency)
    # Will be updated when first analyzed anyway
    scene_text = SceneService._construct_scene_text(scene)
    scene.hash = SceneService.compute_scene_hash(scene_text)

    return scene
```

**Rationale**: Pre-computing hash on import avoids re-reading scene content during first analysis. Optional optimization.

---

### 5. Alembic Migration

**Migration File**: `alembic/versions/YYYYMMDD_HHMM_add_scene_hash_fields.py`

```python
"""Add hash and is_key_scene to Scene model

Revision ID: <generated>
Revises: <previous_revision>
Create Date: YYYY-MM-DD HH:MM:SS

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = '<generated>'
down_revision = '<previous_revision>'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add hash and is_key_scene fields to scenes table."""

    # Add hash column (nullable for existing scenes)
    op.add_column('scenes', sa.Column('hash', sa.String(length=64), nullable=True))

    # Add is_key_scene column with default False
    op.add_column('scenes', sa.Column('is_key_scene', sa.Boolean(), nullable=False, server_default='false'))

    # Create index on hash
    op.create_index('idx_scenes_hash', 'scenes', ['hash'], unique=False)

    # Create partial index on is_key_scene (only where TRUE)
    op.create_index(
        'idx_scenes_is_key',
        'scenes',
        ['is_key_scene'],
        unique=False,
        postgresql_where=sa.text('is_key_scene = TRUE')
    )


def downgrade() -> None:
    """Remove hash and is_key_scene fields from scenes table."""

    # Drop indexes
    op.drop_index('idx_scenes_is_key', table_name='scenes')
    op.drop_index('idx_scenes_hash', table_name='scenes')

    # Drop columns
    op.drop_column('scenes', 'is_key_scene')
    op.drop_column('scenes', 'hash')
```

#### Migration Steps

1. **Generate migration**:
   ```bash
   cd backend
   alembic revision --autogenerate -m "Add hash and is_key_scene to Scene model"
   ```

2. **Review generated migration**: Verify column types and indexes match spec

3. **Apply migration**:
   ```bash
   alembic upgrade head
   ```

4. **Verify**:
   ```bash
   alembic current
   # Should show new revision with scene hash fields
   ```

---

### 6. Change Detection Flow

#### 6.1 Initial Analysis (Scene Never Analyzed)

```
1. Scene imported from FDX
   ├─ scene.hash = NULL (never analyzed)
   └─ scene.is_key_scene = FALSE (default)

2. AI ingestion triggered
   ├─ generate_scene_summary() called
   ├─ Summary generated
   ├─ scene.hash = compute_hash(current_content)  ← Hash set to "analyzed state"
   └─ Commit

3. State: scene.hash = "abc123..." (marks content analyzed)
```

#### 6.2 Content Unchanged (No Re-Analysis Needed)

```
1. Staleness check runs
   ├─ detect_scene_changes(scene) called
   ├─ current_hash = compute_hash(current_content)
   ├─ Compare: scene.hash == current_hash
   └─ Return False (no change)

2. Result: Scene summary still valid, no re-analysis
```

#### 6.3 Content Changed (Re-Analysis Needed)

```
1. User edits scene content
   └─ scene.hash still = "abc123..." (old analyzed state)

2. Staleness check runs
   ├─ detect_scene_changes(scene) called
   ├─ current_hash = compute_hash(current_content)
   ├─ Compare: scene.hash != current_hash  ← Mismatch detected!
   ├─ scene.hash = current_hash  ← Update to current state
   ├─ Commit
   └─ Return True (content changed)

3. Re-analysis triggered
   ├─ generate_scene_summary() called
   ├─ New summary generated
   └─ scene.hash already current (from detect step)
```

#### 6.4 Key Design Decisions

- **Hash updates on detection**: `detect_scene_changes()` updates hash immediately when change detected
- **Hash represents analyzed state**: Hash is set/updated when AI analysis completes
- **Lazy computation**: Hash computed on-demand during staleness checks, not on every scene write
- **NULL hash handling**: NULL = never analyzed, triggers initial analysis

---

### 7. Validation Strategy

#### 7.1 Unit Tests

**File**: `tests/test_scene_hashing.py`

```python
import pytest
from app.services.scene_service import SceneService
from app.models.scene import Scene

class TestSceneHashing:
    """Test scene content hashing functions."""

    def test_normalize_scene_text(self):
        """Test text normalization removes formatting variations."""
        text1 = "  INT. HOUSE - DAY  \n\nJohn walks in.  \n\n"
        text2 = "INT. HOUSE - DAY\nJohn walks in."

        norm1 = SceneService.normalize_scene_text(text1)
        norm2 = SceneService.normalize_scene_text(text2)

        assert norm1 == norm2

    def test_compute_scene_hash_consistency(self):
        """Test same content produces same hash."""
        text = "INT. HOUSE - DAY\nJohn walks in."

        hash1 = SceneService.compute_scene_hash(text)
        hash2 = SceneService.compute_scene_hash(text)

        assert hash1 == hash2
        assert len(hash1) == 64  # SHA-256 hex digest

    def test_compute_scene_hash_sensitivity(self):
        """Test different content produces different hash."""
        text1 = "John walks in."
        text2 = "John runs in."

        hash1 = SceneService.compute_scene_hash(text1)
        hash2 = SceneService.compute_scene_hash(text2)

        assert hash1 != hash2

    @pytest.mark.asyncio
    async def test_detect_scene_changes_new_scene(self, db_session):
        """Test detecting changes on scene with no hash (never analyzed)."""
        scene = Scene(
            script_id=some_uuid,
            scene_heading="INT. HOUSE - DAY",
            content_blocks=[{"type": "action", "text": "John walks in."}],
            hash=None  # Never analyzed
        )
        db_session.add(scene)
        await db_session.commit()

        service = SceneService(db_session)
        changed = await service.detect_scene_changes(scene)

        assert changed is True  # New content detected
        assert scene.hash is not None  # Hash now set

    @pytest.mark.asyncio
    async def test_detect_scene_changes_no_change(self, db_session):
        """Test no false positives when content unchanged."""
        scene_text = "John walks in."
        original_hash = SceneService.compute_scene_hash(scene_text)

        scene = Scene(
            script_id=some_uuid,
            scene_heading="INT. HOUSE - DAY",
            content_blocks=[{"type": "action", "text": scene_text}],
            hash=original_hash
        )
        db_session.add(scene)
        await db_session.commit()

        service = SceneService(db_session)
        changed = await service.detect_scene_changes(scene)

        assert changed is False  # No change
        assert scene.hash == original_hash  # Hash unchanged

    @pytest.mark.asyncio
    async def test_detect_scene_changes_content_changed(self, db_session):
        """Test detecting actual content changes."""
        old_text = "John walks in."
        old_hash = SceneService.compute_scene_hash(old_text)

        scene = Scene(
            script_id=some_uuid,
            scene_heading="INT. HOUSE - DAY",
            content_blocks=[{"type": "action", "text": old_text}],
            hash=old_hash
        )
        db_session.add(scene)
        await db_session.commit()

        # Simulate content change
        new_text = "John runs in."
        scene.content_blocks = [{"type": "action", "text": new_text}]

        service = SceneService(db_session)
        changed = await service.detect_scene_changes(scene)

        assert changed is True  # Change detected
        assert scene.hash != old_hash  # Hash updated
        assert scene.hash == SceneService.compute_scene_hash(new_text)
```

#### 7.2 Integration Tests

**File**: `tests/test_scene_staleness_integration.py`

```python
@pytest.mark.asyncio
async def test_staleness_detection_workflow(db_session):
    """Test complete workflow: import → analyze → edit → detect stale."""

    # 1. Import scene (hash = NULL)
    scene = Scene(
        script_id=script_id,
        scene_heading="INT. HOUSE - DAY",
        content_blocks=[{"type": "action", "text": "John walks in."}],
        hash=None
    )
    db_session.add(scene)
    await db_session.commit()

    # 2. Run initial analysis
    ingestion_service = IngestionService(db_session)
    summary = await ingestion_service.generate_scene_summary(scene)

    assert scene.hash is not None  # Hash set after analysis
    original_hash = scene.hash

    # 3. No edits - staleness check should pass
    staleness_service = StalenessService(db_session)
    is_stale = await staleness_service.check_scene_staleness(scene.scene_id)

    assert is_stale is False  # Not stale
    assert scene.hash == original_hash  # Hash unchanged

    # 4. Edit scene content
    scene.content_blocks = [{"type": "action", "text": "John runs in."}]
    await db_session.commit()

    # 5. Staleness check should detect change
    is_stale = await staleness_service.check_scene_staleness(scene.scene_id)

    assert is_stale is True  # Stale detected!
    assert scene.hash != original_hash  # Hash updated
```

#### 7.3 Migration Validation

**Manual verification steps**:

```bash
# 1. Apply migration
alembic upgrade head

# 2. Verify schema
psql -d writersroom -c "\d scenes"
# Should show: hash (varchar(64)), is_key_scene (boolean)

# 3. Verify indexes
psql -d writersroom -c "\di idx_scenes_hash"
psql -d writersroom -c "\di idx_scenes_is_key"

# 4. Test NULL handling (existing scenes)
psql -d writersroom -c "SELECT scene_id, hash, is_key_scene FROM scenes LIMIT 5;"
# Should show: hash = NULL (for existing scenes), is_key_scene = false

# 5. Test downgrade
alembic downgrade -1
# Verify columns and indexes removed

# 6. Re-apply migration
alembic upgrade head
```

---

### 8. Performance Considerations

#### 8.1 Hash Computation Cost

- **Algorithm**: SHA-256 (cryptographically secure, widely optimized)
- **Typical scene size**: 500-2000 characters
- **Computation time**: < 1ms per scene (negligible)
- **Bottleneck**: Database commit, not hash computation

#### 8.2 Index Performance

```sql
-- Hash lookup (exact match)
SELECT * FROM scenes WHERE hash = 'abc123...';
-- Uses idx_scenes_hash, O(log n) lookup

-- Key scene filtering (sparse index)
SELECT * FROM scenes WHERE is_key_scene = TRUE;
-- Uses idx_scenes_is_key (partial index), highly efficient for sparse data
```

#### 8.3 Staleness Check Optimization

**Lazy computation pattern**:
- Hash NOT computed on every scene write
- Hash computed only during staleness checks
- Avoids unnecessary hash computation for scenes never analyzed

**Batch staleness checks**:
```python
async def batch_check_staleness(scene_ids: List[UUID]) -> Dict[UUID, bool]:
    """Check staleness for multiple scenes efficiently."""
    results = {}
    for scene_id in scene_ids:
        results[scene_id] = await check_scene_staleness(scene_id)
    return results
```

---

### 9. Future Enhancements

#### 9.1 Hash-Based Caching

Store hash → summary/embedding mapping for exact content reuse:

```python
# If scene content reverted to previous state, reuse cached analysis
cache_key = f"scene_analysis:{scene.hash}"
cached_summary = await redis.get(cache_key)
if cached_summary:
    return cached_summary
```

#### 9.2 Differential Analysis

Track granular changes for targeted re-analysis:

```python
# Detect which blocks changed
old_blocks = reconstruct_blocks_from_hash(scene.hash)
new_blocks = scene.content_blocks
changed_blocks = diff(old_blocks, new_blocks)

# Only re-analyze affected portions
if len(changed_blocks) < 3:
    await partial_re_analysis(scene, changed_blocks)
```

#### 9.3 Priority Queuing

Use `is_key_scene` flag for priority analysis:

```python
# Process key scenes first in ingestion queue
priority = 1 if scene.is_key_scene else 10
queue.enqueue(analyze_scene, scene_id, priority=priority)
```

---

### 10. Implementation Checklist

- [ ] **Database Migration**
  - [ ] Generate Alembic migration file
  - [ ] Review migration (columns, indexes, defaults)
  - [ ] Test migration in development database
  - [ ] Apply to staging database

- [ ] **Model Updates**
  - [ ] Add `hash` field to Scene model
  - [ ] Add `is_key_scene` field to Scene model
  - [ ] Update `Scene.to_dict()` method
  - [ ] Verify model imports in workers (avoid mapper errors)

- [ ] **Service Layer**
  - [ ] Implement `_construct_scene_text()` in SceneService
  - [ ] Implement `normalize_scene_text()` static method
  - [ ] Implement `compute_scene_hash()` static method
  - [ ] Implement `detect_scene_changes()` async method

- [ ] **Integration**
  - [ ] Update `ingestion_service.generate_scene_summary()` to set hash
  - [ ] Add `staleness_service.check_scene_staleness()` method
  - [ ] Update `embedding_service.should_reembed()` to use hash
  - [ ] (Optional) Update FDX parser to compute initial hash

- [ ] **Testing**
  - [ ] Write unit tests for hash functions
  - [ ] Write integration tests for staleness detection
  - [ ] Validate migration with existing data
  - [ ] Test NULL hash handling (pre-migration scenes)

- [ ] **Documentation**
  - [ ] Update AI_IMPLEMENTATION_PLAN.md progress tracker
  - [ ] Document hash semantics in code comments
  - [ ] Add migration instructions to deployment guide

---

## Summary

This design implements content-based change detection for scenes, enabling precise incremental AI updates. The hash field tracks "last analyzed content state" and is compared against current content during staleness checks. The `is_key_scene` flag provides manual tagging for priority analysis. Integration with existing services is minimal and non-breaking, with lazy hash computation for efficiency.

**Expected Impact**:
- **Token savings**: Avoid re-analyzing unchanged scenes (30-50% reduction in analysis costs)
- **Performance**: Faster incremental updates by skipping unchanged content
- **Precision**: Eliminate false positives from metadata-only changes (timestamps, version counters)
- **Flexibility**: `is_key_scene` flag enables priority queuing and focused analysis
