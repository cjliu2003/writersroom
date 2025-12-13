"""
Unit tests for scene content hashing functionality.

Tests the hash-based change detection system for scene content.
"""

import pytest
from uuid import uuid4
from app.services.scene_service import SceneService
from app.models.scene import Scene


class TestSceneHashing:
    """Test scene content hashing functions."""

    def test_normalize_scene_text(self):
        """Test text normalization removes formatting variations."""
        # Both texts should normalize to the same thing despite formatting differences
        text1 = "  INT. HOUSE - DAY  \n\nJohn walks in.  \n\n"
        text2 = "INT. HOUSE - DAY\nJohn walks in."
        text3 = "INT.   HOUSE   -   DAY\nJohn   walks   in."  # Multiple spaces

        norm1 = SceneService.normalize_scene_text(text1)
        norm2 = SceneService.normalize_scene_text(text2)
        norm3 = SceneService.normalize_scene_text(text3)

        # All should normalize to same content (extra spaces and lines removed)
        assert norm1 == norm2
        assert norm2 == norm3
        # Verify empty lines are filtered out
        assert '\n\n' not in norm1

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
        script_id = uuid4()

        scene = Scene(
            script_id=script_id,
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
        script_id = uuid4()
        scene_text = "John walks in."
        original_hash = SceneService.compute_scene_hash(scene_text)

        scene = Scene(
            script_id=script_id,
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
        script_id = uuid4()
        old_text = "John walks in."
        old_hash = SceneService.compute_scene_hash(old_text)

        scene = Scene(
            script_id=script_id,
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
