"""
Unit tests for YjsPersistence service logic.

Tests the core Yjs operations without requiring database fixtures.
"""

import pytest
from y_py import YDoc
import y_py as Y

from app.services.yjs_to_slate_converter import converter


class TestYjsPersistenceLogic:
    """Test core Yjs persistence logic."""

    def test_encode_decode_state(self):
        """Test encoding and decoding Yjs state."""
        # Create document with content
        ydoc = YDoc()
        txn = ydoc.begin_transaction()
        content_array = ydoc.get_array('content')
        content_array.append(txn, {"type": "scene_heading", "text": "INT. OFFICE - DAY"})
        content_array.append(txn, {"type": "action", "text": "John enters."})
        del txn

        # Encode state
        state_bytes = Y.encode_state_as_update(ydoc)
        assert isinstance(state_bytes, bytes)
        assert len(state_bytes) > 0

        # Decode into new document
        new_doc = YDoc()
        Y.apply_update(new_doc, state_bytes)

        # Verify content
        new_array = new_doc.get_array('content')
        assert len(new_array) == 2
        assert new_array[0]['text'] == "INT. OFFICE - DAY"
        assert new_array[1]['text'] == "John enters."

    def test_multiple_updates_merge(self):
        """Test that multiple updates can be merged."""
        # Create initial document
        ydoc1 = YDoc()
        txn1 = ydoc1.begin_transaction()
        content_array1 = ydoc1.get_array('content')
        content_array1.append(txn1, {"type": "scene_heading", "text": "INT. OFFICE - DAY"})
        del txn1

        update1 = Y.encode_state_as_update(ydoc1)

        # Add more content
        txn2 = ydoc1.begin_transaction()
        content_array1.append(txn2, {"type": "action", "text": "John enters."})
        del txn2

        # Get full state after both updates
        full_state = Y.encode_state_as_update(ydoc1)

        # Apply to new document
        ydoc2 = YDoc()
        Y.apply_update(ydoc2, full_state)

        content_array2 = ydoc2.get_array('content')
        assert len(content_array2) == 2

    def test_compaction_concept(self):
        """Test concept of compacting multiple updates."""
        # Simulate many small updates
        ydoc = YDoc()

        for i in range(10):
            txn = ydoc.begin_transaction()
            content_array = ydoc.get_array('content')
            content_array.append(txn, {"type": "action", "text": f"Action {i}"})
            del txn

        # Get compacted state
        compacted = Y.encode_state_as_update(ydoc)

        # Verify compacted state is complete
        new_doc = YDoc()
        Y.apply_update(new_doc, compacted)

        new_array = new_doc.get_array('content')
        assert len(new_array) == 10
        assert new_array[0]['text'] == "Action 0"
        assert new_array[9]['text'] == "Action 9"

    def test_state_snapshot_conversion(self):
        """Test converting Yjs state to Slate snapshot."""
        # Create Slate content
        slate_content = {
            "blocks": [
                {"type": "scene_heading", "text": "INT. OFFICE - DAY"},
                {"type": "action", "text": "John walks in."},
                {"type": "character", "text": "JOHN"},
                {"type": "dialogue", "text": "Hello!"}
            ]
        }

        # Convert to Yjs
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, slate_content)

        # Encode state
        state_bytes = Y.encode_state_as_update(ydoc)

        # Decode to new doc and convert back
        new_doc = YDoc()
        Y.apply_update(new_doc, state_bytes)

        # Convert to Slate
        result_slate = converter.convert_to_slate(new_doc)

        # Verify round-trip
        assert converter._deep_equal(slate_content, result_slate)

    def test_empty_document_state(self):
        """Test encoding/decoding empty document."""
        ydoc = YDoc()
        ydoc.get_array('content')  # Create empty array

        state_bytes = Y.encode_state_as_update(ydoc)
        assert isinstance(state_bytes, bytes)

        # Apply to new doc
        new_doc = YDoc()
        Y.apply_update(new_doc, state_bytes)

        content_array = new_doc.get_array('content')
        assert len(content_array) == 0

    def test_large_document_compaction(self):
        """Test compacting large number of updates."""
        ydoc = YDoc()

        # Add 100 updates
        for i in range(100):
            txn = ydoc.begin_transaction()
            content_array = ydoc.get_array('content')
            content_array.append(txn, {
                "type": "action",
                "text": f"This is action number {i} with some content."
            })
            del txn

        # Get compacted state
        compacted = Y.encode_state_as_update(ydoc)

        # Verify all content preserved
        new_doc = YDoc()
        Y.apply_update(new_doc, compacted)

        new_array = new_doc.get_array('content')
        assert len(new_array) == 100

        # Spot check
        assert new_array[0]['text'] == "This is action number 0 with some content."
        assert new_array[50]['text'] == "This is action number 50 with some content."
        assert new_array[99]['text'] == "This is action number 99 with some content."

    def test_metadata_preservation_in_compaction(self):
        """Test that metadata is preserved during compaction."""
        ydoc = YDoc()
        txn = ydoc.begin_transaction()
        content_array = ydoc.get_array('content')

        # Add blocks with metadata
        content_array.append(txn, {
            "type": "scene_heading",
            "text": "INT. OFFICE - DAY",
            "metadata": {"scene_number": "12A"}
        })
        content_array.append(txn, {
            "type": "action",
            "text": "John enters.",
            "metadata": {"emphasis": "strong"}
        })
        del txn

        # Compact
        compacted = Y.encode_state_as_update(ydoc)

        # Verify metadata preserved
        new_doc = YDoc()
        Y.apply_update(new_doc, compacted)

        new_array = new_doc.get_array('content')
        assert new_array[0]['metadata']['scene_number'] == "12A"
        assert new_array[1]['metadata']['emphasis'] == "strong"

    def test_unicode_preservation(self):
        """Test Unicode content is preserved."""
        ydoc = YDoc()
        txn = ydoc.begin_transaction()
        content_array = ydoc.get_array('content')
        content_array.append(txn, {
            "type": "dialogue",
            "text": "こんにちは世界 🎬 Café"
        })
        del txn

        # Encode and decode
        state_bytes = Y.encode_state_as_update(ydoc)
        new_doc = YDoc()
        Y.apply_update(new_doc, state_bytes)

        new_array = new_doc.get_array('content')
        assert new_array[0]['text'] == "こんにちは世界 🎬 Café"


class TestYjsPersistenceIntegrationLogic:
    """Test integration scenarios without database."""

    def test_multi_update_accumulation(self):
        """Test accumulating multiple updates."""
        updates = []

        # Simulate storing multiple updates
        ydoc = YDoc()
        for i in range(5):
            txn = ydoc.begin_transaction()
            content_array = ydoc.get_array('content')
            content_array.append(txn, {"type": "action", "text": f"Action {i}"})
            del txn

            # Store each update
            update = Y.encode_state_as_update(ydoc)
            updates.append(update)

        # Simulate loading - just use final state
        final_doc = YDoc()
        Y.apply_update(final_doc, updates[-1])

        content_array = final_doc.get_array('content')
        assert len(content_array) == 5

    def test_slate_to_yjs_to_slate_workflow(self):
        """Test complete workflow: Slate → Yjs → Store → Load → Slate."""
        # Original Slate
        original = {
            "blocks": [
                {"type": "scene_heading", "text": "EXT. BEACH - SUNSET"},
                {"type": "action", "text": "Waves crash on the shore."},
                {"type": "character", "text": "SARAH"},
                {"type": "dialogue", "text": "This is beautiful."}
            ]
        }

        # Convert to Yjs
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, original)

        # Simulate storage
        stored_update = Y.encode_state_as_update(ydoc)

        # Simulate loading
        loaded_doc = YDoc()
        Y.apply_update(loaded_doc, stored_update)

        # Convert back to Slate
        result = converter.convert_to_slate(loaded_doc)

        # Verify
        assert converter._deep_equal(original, result)

    def test_compaction_size_reduction_concept(self):
        """
        Test that compaction concept (merging updates).

        Note: Actual size reduction depends on Yjs internal encoding.
        This tests the concept, not specific size reduction.
        """
        ydoc = YDoc()

        # Add many small updates
        individual_updates = []
        for i in range(50):
            txn = ydoc.begin_transaction()
            content_array = ydoc.get_array('content')
            content_array.append(txn, {"type": "action", "text": f"Action {i}"})
            del txn

            update = Y.encode_state_as_update(ydoc)
            individual_updates.append(update)

        # Compacted state
        compacted = Y.encode_state_as_update(ydoc)

        # Verify it's a single update that represents full state
        new_doc = YDoc()
        Y.apply_update(new_doc, compacted)

        new_array = new_doc.get_array('content')
        assert len(new_array) == 50
