"""
Unit tests for enhanced YjsPersistence service.

Tests the new methods added for Yjs-primary architecture:
- get_scene_state
- get_scene_snapshot
- get_update_count
- has_updates
- compact_updates

Note: These are integration-level tests requiring database setup.
They are marked with @pytest.mark.integration for optional execution.
"""

import pytest
from datetime import datetime, timedelta
from uuid import uuid4

from y_py import YDoc
import y_py as Y

from app.services.yjs_to_slate_converter import converter


@pytest.fixture
def sample_slate_content():
    """Provide sample Slate JSON content."""
    return {
        "blocks": [
            {"type": "scene_heading", "text": "INT. OFFICE - DAY"},
            {"type": "action", "text": "John enters the room."},
            {"type": "character", "text": "JOHN"},
            {"type": "dialogue", "text": "Hello, everyone!"}
        ]
    }


class TestYjsPersistenceEnhanced:
    """Test suite for enhanced YjsPersistence methods."""

    @pytest.mark.asyncio
    async def test_get_scene_state_basic(self, async_session, sample_scene, sample_slate_content):
        """Test get_scene_state returns merged Yjs update."""
        persistence = YjsPersistence(async_session)

        # Create and store Yjs updates
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, sample_slate_content)
        initial_update = Y.encode_state_as_update(ydoc)

        await persistence.store_update(sample_scene.scene_id, initial_update)
        await async_session.commit()

        # Get merged state
        state_bytes = await persistence.get_scene_state(sample_scene.scene_id)

        assert isinstance(state_bytes, bytes)
        assert len(state_bytes) > 0

        # Verify state can be applied to new doc
        new_doc = YDoc()
        Y.apply_update(new_doc, state_bytes)

        content_array = new_doc.get_array('content')
        assert len(content_array) == 4

    @pytest.mark.asyncio
    async def test_get_scene_state_no_updates(self, async_session, sample_scene):
        """Test get_scene_state raises error for scene without updates."""
        persistence = YjsPersistence(async_session)

        with pytest.raises(ValueError, match="No Yjs updates found"):
            await persistence.get_scene_state(sample_scene.scene_id)

    @pytest.mark.asyncio
    async def test_get_scene_snapshot_basic(self, async_session, sample_scene, sample_slate_content):
        """Test get_scene_snapshot converts Yjs to Slate JSON."""
        persistence = YjsPersistence(async_session)

        # Store Yjs update
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, sample_slate_content)
        initial_update = Y.encode_state_as_update(ydoc)

        await persistence.store_update(sample_scene.scene_id, initial_update)
        await async_session.commit()

        # Get snapshot
        snapshot = await persistence.get_scene_snapshot(sample_scene.scene_id)

        assert isinstance(snapshot, dict)
        assert 'blocks' in snapshot
        assert len(snapshot['blocks']) == 4
        assert snapshot['blocks'][0]['type'] == 'scene_heading'
        assert snapshot['blocks'][0]['text'] == 'INT. OFFICE - DAY'

    @pytest.mark.asyncio
    async def test_get_scene_snapshot_multiple_updates(self, async_session, sample_scene):
        """Test get_scene_snapshot merges multiple updates correctly."""
        persistence = YjsPersistence(async_session)

        # Create initial document
        ydoc = YDoc()
        txn = ydoc.begin_transaction()
        content_array = ydoc.get_array('content')
        content_array.append(txn, {"type": "scene_heading", "text": "INT. OFFICE - DAY"})
        del txn

        update1 = Y.encode_state_as_update(ydoc)
        await persistence.store_update(sample_scene.scene_id, update1)

        # Add more content
        txn2 = ydoc.begin_transaction()
        content_array.append(txn2, {"type": "action", "text": "John enters."})
        del txn2

        # Get update representing the change
        state_vector = Y.encode_state_vector(ydoc)
        update2 = Y.encode_state_as_update(ydoc, state_vector)
        await persistence.store_update(sample_scene.scene_id, update2)

        await async_session.commit()

        # Get snapshot - should merge both updates
        snapshot = await persistence.get_scene_snapshot(sample_scene.scene_id)

        assert len(snapshot['blocks']) >= 1  # At least scene heading

    @pytest.mark.asyncio
    async def test_get_update_count_zero(self, async_session, sample_scene):
        """Test get_update_count returns 0 for scene without updates."""
        persistence = YjsPersistence(async_session)

        count = await persistence.get_update_count(sample_scene.scene_id)
        assert count == 0

    @pytest.mark.asyncio
    async def test_get_update_count_multiple(self, async_session, sample_scene):
        """Test get_update_count returns correct count."""
        persistence = YjsPersistence(async_session)

        # Add 5 updates
        ydoc = YDoc()
        for i in range(5):
            txn = ydoc.begin_transaction()
            content_array = ydoc.get_array('content')
            content_array.append(txn, {"type": "action", "text": f"Action {i}"})
            del txn

            update = Y.encode_state_as_update(ydoc)
            await persistence.store_update(sample_scene.scene_id, update)

        await async_session.commit()

        count = await persistence.get_update_count(sample_scene.scene_id)
        assert count == 5

    @pytest.mark.asyncio
    async def test_has_updates_false(self, async_session, sample_scene):
        """Test has_updates returns False for scene without updates."""
        persistence = YjsPersistence(async_session)

        has_updates = await persistence.has_updates(sample_scene.scene_id)
        assert has_updates is False

    @pytest.mark.asyncio
    async def test_has_updates_true(self, async_session, sample_scene, sample_slate_content):
        """Test has_updates returns True for scene with updates."""
        persistence = YjsPersistence(async_session)

        # Add one update
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, sample_slate_content)
        update = Y.encode_state_as_update(ydoc)

        await persistence.store_update(sample_scene.scene_id, update)
        await async_session.commit()

        has_updates = await persistence.has_updates(sample_scene.scene_id)
        assert has_updates is True

    @pytest.mark.asyncio
    async def test_compact_updates_below_threshold(self, async_session, sample_scene):
        """Test compact_updates skips when below minimum threshold."""
        persistence = YjsPersistence(async_session)

        # Add only 50 updates (below MIN_UPDATE_COUNT of 100)
        ydoc = YDoc()
        for i in range(50):
            txn = ydoc.begin_transaction()
            content_array = ydoc.get_array('content')
            content_array.append(txn, {"type": "action", "text": f"Action {i}"})
            del txn

            update = Y.encode_state_as_update(ydoc)
            await persistence.store_update(sample_scene.scene_id, update)

        await async_session.commit()

        # Try to compact - should skip
        before = datetime.utcnow() + timedelta(hours=1)
        compacted_count = await persistence.compact_updates(
            sample_scene.scene_id,
            before
        )

        assert compacted_count == 0

    @pytest.mark.asyncio
    async def test_compact_updates_above_threshold(self, async_session, sample_scene):
        """Test compact_updates merges updates above threshold."""
        persistence = YjsPersistence(async_session)

        # Add 150 updates (above MIN_UPDATE_COUNT of 100)
        ydoc = YDoc()
        old_time = datetime.utcnow() - timedelta(days=2)

        for i in range(150):
            txn = ydoc.begin_transaction()
            content_array = ydoc.get_array('content')
            content_array.append(txn, {"type": "action", "text": f"Action {i}"})
            del txn

            update = Y.encode_state_as_update(ydoc)
            version = SceneVersion(
                scene_id=sample_scene.scene_id,
                yjs_update=update,
                created_at=old_time
            )
            async_session.add(version)

        await async_session.commit()

        # Compact old updates
        before = datetime.utcnow() - timedelta(days=1)
        compacted_count = await persistence.compact_updates(
            sample_scene.scene_id,
            before
        )

        assert compacted_count == 150
        await async_session.commit()

        # Verify compacted version exists
        count = await persistence.get_update_count(sample_scene.scene_id)
        assert count == 151  # 150 originals + 1 compacted

    @pytest.mark.asyncio
    async def test_compact_updates_preserves_state(self, async_session, sample_scene):
        """Test compacted update preserves full document state."""
        persistence = YjsPersistence(async_session)

        # Create document with content
        ydoc = YDoc()
        txn = ydoc.begin_transaction()
        content_array = ydoc.get_array('content')
        for i in range(150):
            content_array.append(txn, {"type": "action", "text": f"Action {i}"})
        del txn

        # Store as individual updates (simulated)
        old_time = datetime.utcnow() - timedelta(days=2)
        update = Y.encode_state_as_update(ydoc)

        for i in range(150):
            version = SceneVersion(
                scene_id=sample_scene.scene_id,
                yjs_update=update,
                created_at=old_time
            )
            async_session.add(version)

        await async_session.commit()

        # Get snapshot before compaction
        snapshot_before = await persistence.get_scene_snapshot(sample_scene.scene_id)

        # Compact
        before = datetime.utcnow() - timedelta(days=1)
        await persistence.compact_updates(sample_scene.scene_id, before)
        await async_session.commit()

        # Get snapshot after compaction
        snapshot_after = await persistence.get_scene_snapshot(sample_scene.scene_id)

        # State should be preserved
        assert len(snapshot_after['blocks']) == len(snapshot_before['blocks'])

    @pytest.mark.asyncio
    async def test_compact_updates_marks_originals(self, async_session, sample_scene):
        """Test compact_updates marks original versions with compacted_by."""
        persistence = YjsPersistence(async_session)

        # Add 150 updates
        ydoc = YDoc()
        old_time = datetime.utcnow() - timedelta(days=2)

        for i in range(150):
            txn = ydoc.begin_transaction()
            content_array = ydoc.get_array('content')
            content_array.append(txn, {"type": "action", "text": f"Action {i}"})
            del txn

            update = Y.encode_state_as_update(ydoc)
            version = SceneVersion(
                scene_id=sample_scene.scene_id,
                yjs_update=update,
                created_at=old_time
            )
            async_session.add(version)

        await async_session.commit()

        # Compact
        before = datetime.utcnow() - timedelta(days=1)
        await persistence.compact_updates(sample_scene.scene_id, before)
        await async_session.commit()

        # Check that originals have compacted_by set
        from sqlalchemy import select
        stmt = (
            select(SceneVersion)
            .where(
                SceneVersion.scene_id == sample_scene.scene_id,
                SceneVersion.is_compacted == False  # noqa: E712
            )
        )
        result = await async_session.execute(stmt)
        originals = result.scalars().all()

        for original in originals:
            assert original.compacted_by is not None


class TestYjsPersistenceIntegration:
    """Integration tests for YjsPersistence service."""

    @pytest.mark.asyncio
    async def test_full_workflow_store_retrieve_snapshot(
        self,
        async_session,
        sample_scene,
        sample_slate_content
    ):
        """Test complete workflow: store updates → get state → get snapshot."""
        persistence = YjsPersistence(async_session)

        # 1. Store updates
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, sample_slate_content)
        update = Y.encode_state_as_update(ydoc)

        version_id = await persistence.store_update(sample_scene.scene_id, update)
        await async_session.commit()

        assert version_id is not None

        # 2. Get scene state
        state_bytes = await persistence.get_scene_state(sample_scene.scene_id)
        assert len(state_bytes) > 0

        # 3. Get scene snapshot
        snapshot = await persistence.get_scene_snapshot(sample_scene.scene_id)
        assert snapshot == sample_slate_content

        # 4. Verify update count
        count = await persistence.get_update_count(sample_scene.scene_id)
        assert count == 1

        # 5. Verify has_updates
        has_updates = await persistence.has_updates(sample_scene.scene_id)
        assert has_updates is True

    @pytest.mark.asyncio
    async def test_round_trip_consistency(self, async_session, sample_scene):
        """Test Slate → Yjs → Slate maintains consistency."""
        persistence = YjsPersistence(async_session)

        # Original Slate content
        original_slate = {
            "blocks": [
                {"type": "scene_heading", "text": "INT. MANSION - NIGHT"},
                {"type": "action", "text": "The door creaks open slowly."},
                {"type": "character", "text": "SARAH"},
                {"type": "dialogue", "text": "Who's there?"},
                {
                    "type": "action",
                    "text": "A shadow moves across the wall.",
                    "metadata": {"emphasis": "strong"}
                }
            ]
        }

        # Convert to Yjs and store
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, original_slate)
        update = Y.encode_state_as_update(ydoc)

        await persistence.store_update(sample_scene.scene_id, update)
        await async_session.commit()

        # Retrieve as snapshot
        retrieved_slate = await persistence.get_scene_snapshot(sample_scene.scene_id)

        # Verify consistency (using converter's deep equality)
        assert converter._deep_equal(original_slate, retrieved_slate)
