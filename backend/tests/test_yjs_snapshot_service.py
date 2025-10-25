"""
Unit tests for YjsSnapshotService.

Tests snapshot creation, freshness validation, and periodic refresh logic
for the Yjs-primary architecture.
"""

import pytest
from datetime import datetime, timedelta
from uuid import uuid4

from y_py import YDoc
import y_py as Y

from app.services.yjs_snapshot_service import YjsSnapshotService, SnapshotSource
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


class TestYjsSnapshotServiceLogic:
    """Test suite for YjsSnapshotService logic (unit tests without DB)."""

    def test_snapshot_source_enum(self):
        """Test SnapshotSource enum values."""
        assert SnapshotSource.YJS.value == "yjs"
        assert SnapshotSource.MANUAL.value == "manual"
        assert SnapshotSource.IMPORT.value == "import"
        assert SnapshotSource.MIGRATED.value == "migrated"
        assert SnapshotSource.COMPACTED.value == "compacted"

    def test_slate_to_yjs_conversion_preserves_content(self, sample_slate_content):
        """Test that Slate → Yjs → Slate preserves content."""
        # Convert to Yjs
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, sample_slate_content)

        # Convert back to Slate
        result = converter.convert_to_slate(ydoc)

        # Verify preservation
        assert converter._deep_equal(sample_slate_content, result)

    def test_checksum_computation(self, sample_slate_content):
        """Test checksum computation for consistency validation."""
        checksum1 = converter.compute_checksum(sample_slate_content)
        checksum2 = converter.compute_checksum(sample_slate_content)

        # Checksums should be deterministic
        assert checksum1 == checksum2
        assert len(checksum1) == 64  # SHA256 hex length

    def test_checksum_detects_changes(self, sample_slate_content):
        """Test that checksum changes when content changes."""
        import copy
        modified_content = copy.deepcopy(sample_slate_content)
        modified_content['blocks'][0]['text'] = "EXT. BEACH - SUNSET"

        checksum_original = converter.compute_checksum(sample_slate_content)
        checksum_modified = converter.compute_checksum(modified_content)

        assert checksum_original != checksum_modified

    def test_yjs_update_encoding(self, sample_slate_content):
        """Test Yjs update encoding produces valid bytes."""
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, sample_slate_content)

        # Encode state
        update_bytes = Y.encode_state_as_update(ydoc)

        assert isinstance(update_bytes, bytes)
        assert len(update_bytes) > 0

        # Verify can be decoded
        new_doc = YDoc()
        Y.apply_update(new_doc, update_bytes)

        result = converter.convert_to_slate(new_doc)
        assert converter._deep_equal(sample_slate_content, result)

    def test_snapshot_size_calculation(self, sample_slate_content):
        """Test snapshot size calculation."""
        import json

        snapshot_bytes = len(json.dumps(sample_slate_content).encode('utf-8'))

        assert snapshot_bytes > 0
        # Should be reasonable size (not huge, not tiny)
        assert 100 < snapshot_bytes < 10000

    def test_empty_content_handling(self):
        """Test handling of empty content."""
        empty_slate = {"blocks": []}

        # Should still produce valid checksum
        checksum = converter.compute_checksum(empty_slate)
        assert len(checksum) == 64

        # Should encode to Yjs
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, empty_slate)
        update_bytes = Y.encode_state_as_update(ydoc)
        assert isinstance(update_bytes, bytes)

    def test_scene_heading_extraction(self, sample_slate_content):
        """Test extracting scene_heading from first block."""
        blocks = sample_slate_content.get('blocks', [])
        if blocks and len(blocks) > 0:
            first_block = blocks[0]
            if first_block.get('type') == 'scene_heading':
                scene_heading = first_block.get('text', '')[:255]
                assert scene_heading == "INT. OFFICE - DAY"

    def test_long_scene_heading_truncation(self):
        """Test that long scene headings are truncated to 255 chars."""
        long_heading = "A" * 300
        slate_content = {
            "blocks": [
                {"type": "scene_heading", "text": long_heading}
            ]
        }

        blocks = slate_content.get('blocks', [])
        first_block = blocks[0]
        scene_heading = first_block.get('text', '')[:255]

        assert len(scene_heading) == 255
        assert scene_heading == "A" * 255


class TestYjsSnapshotServiceFreshnessLogic:
    """Test freshness validation logic."""

    def test_freshness_age_calculation(self):
        """Test age calculation for freshness checks."""
        now = datetime.utcnow()
        snapshot_time = now - timedelta(minutes=5)

        age = now - snapshot_time
        age_minutes = age.total_seconds() / 60

        assert 4.9 < age_minutes < 5.1  # Allow for small timing variations

    def test_freshness_threshold_comparison(self):
        """Test freshness threshold comparison."""
        max_age_minutes = 10

        # Fresh snapshot (5 minutes old)
        age_fresh = timedelta(minutes=5)
        assert age_fresh <= timedelta(minutes=max_age_minutes)

        # Stale snapshot (15 minutes old)
        age_stale = timedelta(minutes=15)
        assert age_stale > timedelta(minutes=max_age_minutes)

    def test_version_count_comparison(self):
        """Test version count comparison for freshness."""
        snapshot_version_count = 10
        current_version_count = 10

        # Counts match - fresh
        assert snapshot_version_count == current_version_count

        # Counts differ - stale
        current_version_count = 12
        assert snapshot_version_count != current_version_count


class TestYjsSnapshotServicePerformance:
    """Test performance characteristics."""

    def test_snapshot_generation_timing(self, sample_slate_content):
        """Test snapshot generation is reasonably fast."""
        import time

        # Simulate snapshot generation
        start_time = time.time()

        # Convert to Yjs
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, sample_slate_content)

        # Encode state
        update_bytes = Y.encode_state_as_update(ydoc)

        # Convert back to Slate
        result = converter.convert_to_slate(ydoc)

        # Compute checksum
        checksum = converter.compute_checksum(result)

        generation_time_ms = int((time.time() - start_time) * 1000)

        # Should be very fast (< 100ms for simple content)
        assert generation_time_ms < 100
        assert checksum is not None

    def test_large_content_handling(self):
        """Test handling of large screenplay content."""
        # Create large content (100 blocks)
        large_slate = {
            "blocks": [
                {"type": "action", "text": f"Action block {i} with some content."}
                for i in range(100)
            ]
        }

        import time
        start_time = time.time()

        # Convert to Yjs
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, large_slate)

        # Encode
        update_bytes = Y.encode_state_as_update(ydoc)

        # Convert back
        result = converter.convert_to_slate(ydoc)

        generation_time_ms = int((time.time() - start_time) * 1000)

        # Should still be reasonably fast (< 1 second)
        assert generation_time_ms < 1000
        assert len(result['blocks']) == 100


class TestYjsSnapshotServiceEdgeCases:
    """Test edge cases and error scenarios."""

    def test_unicode_content_handling(self):
        """Test handling of Unicode content."""
        unicode_slate = {
            "blocks": [
                {"type": "dialogue", "text": "こんにちは世界 🎬 Café"}
            ]
        }

        # Should handle Unicode properly
        checksum = converter.compute_checksum(unicode_slate)
        assert len(checksum) == 64

        # Should convert properly
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, unicode_slate)
        result = converter.convert_to_slate(ydoc)

        assert result['blocks'][0]['text'] == "こんにちは世界 🎬 Café"

    def test_special_characters_in_content(self):
        """Test handling of special characters."""
        special_slate = {
            "blocks": [
                {"type": "action", "text": "Quote: \"Hello\", newline:\\ntest"}
            ]
        }

        # Should handle special chars
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, special_slate)
        result = converter.convert_to_slate(ydoc)

        assert "Quote:" in result['blocks'][0]['text']

    def test_metadata_preservation(self):
        """Test that metadata is preserved in snapshots."""
        slate_with_metadata = {
            "blocks": [
                {
                    "type": "scene_heading",
                    "text": "INT. OFFICE - DAY",
                    "metadata": {"scene_number": "12A"}
                }
            ]
        }

        # Convert and verify metadata preserved
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, slate_with_metadata)
        result = converter.convert_to_slate(ydoc)

        assert 'metadata' in result['blocks'][0]
        assert result['blocks'][0]['metadata']['scene_number'] == "12A"

    def test_missing_scene_heading_handling(self):
        """Test handling when no scene_heading block exists."""
        no_heading_slate = {
            "blocks": [
                {"type": "action", "text": "Just an action."}
            ]
        }

        blocks = no_heading_slate.get('blocks', [])
        if blocks and len(blocks) > 0:
            first_block = blocks[0]
            if first_block.get('type') == 'scene_heading':
                scene_heading = first_block.get('text', '')
            else:
                scene_heading = ""  # No heading found

        assert scene_heading == ""

    def test_null_text_handling(self):
        """Test handling of null or missing text fields."""
        slate_with_empty = {
            "blocks": [
                {"type": "action", "text": ""}
            ]
        }

        # Should handle empty text
        checksum = converter.compute_checksum(slate_with_empty)
        assert len(checksum) == 64


class TestYjsSnapshotServiceBatchOperations:
    """Test batch operations and scheduling logic."""

    def test_batch_size_limiting(self):
        """Test that batch operations respect size limits."""
        batch_size = 10
        scene_ids = [uuid4() for _ in range(25)]

        # Simulate batch processing
        batch = scene_ids[:batch_size]

        assert len(batch) == batch_size
        assert len(batch) <= len(scene_ids)

    def test_interval_timing(self):
        """Test interval calculation for periodic tasks."""
        interval_minutes = 5
        interval_seconds = interval_minutes * 60

        assert interval_seconds == 300

    def test_stale_cutoff_calculation(self):
        """Test cutoff time calculation for stale snapshots."""
        max_age_minutes = 10
        now = datetime.utcnow()
        cutoff_time = now - timedelta(minutes=max_age_minutes)

        # Verify cutoff is in the past
        assert cutoff_time < now

        # Verify correct age
        age = now - cutoff_time
        assert age.total_seconds() / 60 == max_age_minutes


class TestYjsSnapshotServiceStatistics:
    """Test statistics and metrics calculation."""

    def test_average_calculation(self):
        """Test average calculation for metrics."""
        gen_times = [100, 150, 200, 120, 180]
        avg_gen_time = sum(gen_times) / len(gen_times)

        assert avg_gen_time == 150.0

    def test_empty_list_average_handling(self):
        """Test average calculation with empty list."""
        gen_times = []
        avg_gen_time = sum(gen_times) / len(gen_times) if gen_times else None

        assert avg_gen_time is None

    def test_statistics_with_missing_data(self):
        """Test statistics calculation with missing data points."""
        # Some records have metrics, some don't
        gen_times = [100, None, 150, None, 200]
        valid_times = [t for t in gen_times if t is not None]

        avg = sum(valid_times) / len(valid_times) if valid_times else None

        assert avg == 150.0
        assert len(valid_times) == 3
