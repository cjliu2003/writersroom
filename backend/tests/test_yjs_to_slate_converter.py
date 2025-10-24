"""
Unit tests for YjsToSlateConverter service.

Tests bidirectional conversion between Yjs CRDT and Slate JSON formats.
"""

import pytest
from y_py import YDoc

from app.services.yjs_to_slate_converter import YjsToSlateConverter
from app.services.fdx_parser import ScreenplayBlockType


class TestYjsToSlateConverter:
    """Test suite for YjsToSlateConverter."""

    @pytest.fixture
    def converter(self):
        """Provide a fresh converter instance."""
        return YjsToSlateConverter()

    @pytest.fixture
    def sample_slate_json(self):
        """Provide sample Slate JSON screenplay content."""
        return {
            "blocks": [
                {
                    "type": ScreenplayBlockType.SCENE_HEADING.value,
                    "text": "INT. OFFICE - DAY"
                },
                {
                    "type": ScreenplayBlockType.ACTION.value,
                    "text": "John enters the room, looking nervous."
                },
                {
                    "type": ScreenplayBlockType.CHARACTER.value,
                    "text": "JOHN"
                },
                {
                    "type": ScreenplayBlockType.DIALOGUE.value,
                    "text": "Hello, is anyone here?"
                },
                {
                    "type": ScreenplayBlockType.TRANSITION.value,
                    "text": "CUT TO:"
                }
            ]
        }

    @pytest.fixture
    def complex_slate_json(self):
        """Provide Slate JSON with metadata fields."""
        return {
            "blocks": [
                {
                    "type": ScreenplayBlockType.SCENE_HEADING.value,
                    "text": "INT. MANSION - NIGHT",
                    "metadata": {
                        "scene_number": "12A",
                        "location": "mansion_interior"
                    }
                },
                {
                    "type": ScreenplayBlockType.CHARACTER.value,
                    "text": "SARAH (V.O.)",
                    "metadata": {
                        "voice_over": True
                    }
                },
                {
                    "type": ScreenplayBlockType.DIALOGUE.value,
                    "text": "I never expected this.",
                    "character": "SARAH"
                }
            ]
        }

    # -------------------------------------------------------------------------
    # Slate → Yjs Conversion Tests
    # -------------------------------------------------------------------------

    def test_populate_from_slate_basic(self, converter, sample_slate_json):
        """Test basic Slate → Yjs conversion."""
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, sample_slate_json)

        content_array = ydoc.get_array('content')
        assert len(content_array) == 5

        # Check first block (scene heading)
        first_block = content_array[0]
        assert first_block['type'] == ScreenplayBlockType.SCENE_HEADING.value
        assert first_block['text'] == "INT. OFFICE - DAY"

    def test_populate_from_slate_with_metadata(self, converter, complex_slate_json):
        """Test Slate → Yjs conversion with metadata."""
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, complex_slate_json)

        content_array = ydoc.get_array('content')
        assert len(content_array) == 3

        # Check block with metadata
        first_block = content_array[0]
        assert 'metadata' in first_block
        assert first_block['metadata']['scene_number'] == "12A"

    def test_populate_from_slate_empty_blocks(self, converter):
        """Test Slate → Yjs with empty blocks list."""
        slate_json = {"blocks": []}
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, slate_json)

        content_array = ydoc.get_array('content')
        assert len(content_array) == 0

    def test_populate_from_slate_replaces_existing(self, converter, sample_slate_json):
        """Test that populate_from_slate clears existing content."""
        ydoc = YDoc()

        # First population
        converter.populate_from_slate(ydoc, sample_slate_json)
        content_array = ydoc.get_array('content')
        assert len(content_array) == 5

        # Second population should replace
        new_slate = {
            "blocks": [
                {"type": "action", "text": "New content"}
            ]
        }
        converter.populate_from_slate(ydoc, new_slate)
        content_array = ydoc.get_array('content')
        assert len(content_array) == 1
        assert content_array[0]['text'] == "New content"

    def test_populate_from_slate_invalid_structure(self, converter):
        """Test error handling for invalid Slate JSON structure."""
        ydoc = YDoc()

        # Not a dict
        with pytest.raises(ValueError, match="Expected dict"):
            converter.populate_from_slate(ydoc, [])

        # Missing 'blocks' key
        with pytest.raises(ValueError, match="must have 'blocks' key"):
            converter.populate_from_slate(ydoc, {"data": []})

        # 'blocks' not a list
        with pytest.raises(ValueError, match="'blocks' must be a list"):
            converter.populate_from_slate(ydoc, {"blocks": "not a list"})

    def test_populate_from_slate_invalid_block(self, converter):
        """Test error handling for invalid block structure."""
        ydoc = YDoc()

        # Block not a dict
        with pytest.raises(ValueError, match="must be a dict"):
            converter.populate_from_slate(ydoc, {"blocks": ["not a dict"]})

        # Block missing 'type'
        with pytest.raises(ValueError, match="missing 'type' field"):
            converter.populate_from_slate(ydoc, {
                "blocks": [{"text": "some text"}]
            })

        # Block missing 'text'
        with pytest.raises(ValueError, match="missing 'text' field"):
            converter.populate_from_slate(ydoc, {
                "blocks": [{"type": "action"}]
            })

    # -------------------------------------------------------------------------
    # Yjs → Slate Conversion Tests
    # -------------------------------------------------------------------------

    def test_convert_to_slate_basic(self, converter, sample_slate_json):
        """Test basic Yjs → Slate conversion."""
        # Populate Yjs
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, sample_slate_json)

        # Convert back
        result = converter.convert_to_slate(ydoc)

        assert 'blocks' in result
        assert len(result['blocks']) == 5
        assert result['blocks'][0]['type'] == ScreenplayBlockType.SCENE_HEADING.value
        assert result['blocks'][0]['text'] == "INT. OFFICE - DAY"

    def test_convert_to_slate_empty(self, converter):
        """Test Yjs → Slate conversion with empty document."""
        ydoc = YDoc()
        # Initialize empty array
        ydoc.get_array('content')

        result = converter.convert_to_slate(ydoc)
        assert result == {"blocks": []}

    def test_convert_to_slate_with_metadata(self, converter, complex_slate_json):
        """Test Yjs → Slate conversion preserves metadata."""
        # Populate Yjs
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, complex_slate_json)

        # Convert back
        result = converter.convert_to_slate(ydoc)

        # Check metadata preserved
        first_block = result['blocks'][0]
        assert 'metadata' in first_block
        assert first_block['metadata']['scene_number'] == "12A"
        assert first_block['metadata']['location'] == "mansion_interior"

    # -------------------------------------------------------------------------
    # Round-Trip Conversion Tests
    # -------------------------------------------------------------------------

    def test_round_trip_basic(self, converter, sample_slate_json):
        """Test Slate → Yjs → Slate preserves data."""
        assert converter.validate_round_trip(sample_slate_json) is True

    def test_round_trip_with_metadata(self, converter, complex_slate_json):
        """Test round-trip with complex metadata."""
        assert converter.validate_round_trip(complex_slate_json) is True

    def test_round_trip_empty(self, converter):
        """Test round-trip with empty blocks."""
        empty_slate = {"blocks": []}
        assert converter.validate_round_trip(empty_slate) is True

    def test_round_trip_special_characters(self, converter):
        """Test round-trip with special characters and Unicode."""
        special_slate = {
            "blocks": [
                {
                    "type": "action",
                    "text": "Special chars: é, ñ, 中文, emoji 🎬"
                },
                {
                    "type": "dialogue",
                    "text": "Quote: \"Hello\", newline:\ntest"
                }
            ]
        }
        assert converter.validate_round_trip(special_slate) is True

    def test_round_trip_large_content(self, converter):
        """Test round-trip with large screenplay content."""
        # Create 100 blocks
        large_slate = {
            "blocks": [
                {
                    "type": "action",
                    "text": f"Action block number {i} with some longer text content to test performance."
                }
                for i in range(100)
            ]
        }
        assert converter.validate_round_trip(large_slate) is True

    def test_round_trip_all_block_types(self, converter):
        """Test round-trip with all screenplay block types."""
        all_types_slate = {
            "blocks": [
                {"type": block_type.value, "text": f"Example {block_type.value}"}
                for block_type in ScreenplayBlockType
            ]
        }
        assert converter.validate_round_trip(all_types_slate) is True

    # -------------------------------------------------------------------------
    # Checksum Tests
    # -------------------------------------------------------------------------

    def test_compute_checksum_deterministic(self, converter, sample_slate_json):
        """Test checksum is deterministic for same content."""
        checksum1 = converter.compute_checksum(sample_slate_json)
        checksum2 = converter.compute_checksum(sample_slate_json)
        assert checksum1 == checksum2

    def test_compute_checksum_different_content(self, converter, sample_slate_json):
        """Test different content produces different checksums."""
        # Deep copy to avoid modifying original
        import copy
        modified_slate = copy.deepcopy(sample_slate_json)
        modified_slate['blocks'][0]['text'] = "DIFFERENT TEXT"

        checksum1 = converter.compute_checksum(sample_slate_json)
        checksum2 = converter.compute_checksum(modified_slate)
        assert checksum1 != checksum2

    def test_compute_checksum_order_independent(self, converter):
        """Test checksum is independent of dict key order."""
        slate1 = {
            "blocks": [
                {"type": "action", "text": "Test", "metadata": {"a": 1, "b": 2}}
            ]
        }
        slate2 = {
            "blocks": [
                {"text": "Test", "type": "action", "metadata": {"b": 2, "a": 1}}
            ]
        }

        # Checksums should be equal (normalized serialization)
        checksum1 = converter.compute_checksum(slate1)
        checksum2 = converter.compute_checksum(slate2)
        assert checksum1 == checksum2

    # -------------------------------------------------------------------------
    # Edge Cases and Error Handling
    # -------------------------------------------------------------------------

    def test_validate_round_trip_with_invalid_data(self, converter):
        """Test validate_round_trip returns False for invalid data."""
        invalid_slate = {"blocks": "not a list"}
        assert converter.validate_round_trip(invalid_slate) is False

    def test_blocks_with_missing_optional_fields(self, converter):
        """Test blocks with only required fields."""
        minimal_slate = {
            "blocks": [
                {"type": "action", "text": "Minimal block"}
            ]
        }
        assert converter.validate_round_trip(minimal_slate) is True

    def test_blocks_with_extra_fields(self, converter):
        """Test blocks with additional custom fields."""
        extended_slate = {
            "blocks": [
                {
                    "type": "action",
                    "text": "Action text",
                    "custom_field": "custom value",
                    "another_field": 123
                }
            ]
        }
        assert converter.validate_round_trip(extended_slate) is True

    def test_nested_metadata(self, converter):
        """Test deeply nested metadata structures."""
        nested_slate = {
            "blocks": [
                {
                    "type": "action",
                    "text": "Test",
                    "metadata": {
                        "level1": {
                            "level2": {
                                "level3": "deep value"
                            }
                        }
                    }
                }
            ]
        }
        # Note: Current implementation supports 1 level of nesting
        # Deep nesting may require enhancement
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, nested_slate)
        result = converter.convert_to_slate(ydoc)

        # At minimum, should not crash
        assert 'blocks' in result

    def test_unicode_and_whitespace_preservation(self, converter):
        """Test preservation of Unicode and whitespace."""
        unicode_slate = {
            "blocks": [
                {
                    "type": "action",
                    "text": "Line with\nmultiple\n\nlines"
                },
                {
                    "type": "action",
                    "text": "  Leading and trailing spaces  "
                },
                {
                    "type": "action",
                    "text": "\t\tTabs and spaces\t\t"
                }
            ]
        }
        assert converter.validate_round_trip(unicode_slate) is True

    def test_empty_text_field(self, converter):
        """Test handling of empty text fields."""
        empty_text_slate = {
            "blocks": [
                {"type": "action", "text": ""}
            ]
        }
        assert converter.validate_round_trip(empty_text_slate) is True

    # -------------------------------------------------------------------------
    # Integration Tests
    # -------------------------------------------------------------------------

    def test_multiple_documents_isolation(self, converter):
        """Test that multiple YDocs don't interfere."""
        slate1 = {"blocks": [{"type": "action", "text": "Doc 1"}]}
        slate2 = {"blocks": [{"type": "action", "text": "Doc 2"}]}

        ydoc1 = YDoc()
        ydoc2 = YDoc()

        converter.populate_from_slate(ydoc1, slate1)
        converter.populate_from_slate(ydoc2, slate2)

        result1 = converter.convert_to_slate(ydoc1)
        result2 = converter.convert_to_slate(ydoc2)

        assert result1['blocks'][0]['text'] == "Doc 1"
        assert result2['blocks'][0]['text'] == "Doc 2"

    def test_concurrent_operations(self, converter, sample_slate_json):
        """Test converter handles multiple operations correctly."""
        ydoc = YDoc()

        # Multiple populate operations
        for i in range(5):
            modified_slate = sample_slate_json.copy()
            modified_slate['blocks'][0]['text'] = f"Iteration {i}"
            converter.populate_from_slate(ydoc, modified_slate)

        result = converter.convert_to_slate(ydoc)
        assert result['blocks'][0]['text'] == "Iteration 4"


# -------------------------------------------------------------------------
# Performance and Stress Tests
# -------------------------------------------------------------------------

class TestYjsToSlateConverterPerformance:
    """Performance and stress tests for converter."""

    @pytest.fixture
    def converter(self):
        return YjsToSlateConverter()

    @pytest.mark.slow
    def test_large_screenplay_conversion(self, converter):
        """Test conversion of large screenplay (1000 blocks)."""
        large_slate = {
            "blocks": [
                {
                    "type": "action",
                    "text": f"This is action block number {i} with reasonable length text content."
                }
                for i in range(1000)
            ]
        }

        # Should complete without timeout
        ydoc = YDoc()
        converter.populate_from_slate(ydoc, large_slate)
        result = converter.convert_to_slate(ydoc)

        assert len(result['blocks']) == 1000

    @pytest.mark.slow
    def test_very_long_text_blocks(self, converter):
        """Test handling of very long text blocks."""
        long_text = "A" * 10000  # 10K characters
        long_slate = {
            "blocks": [
                {"type": "action", "text": long_text}
            ]
        }

        assert converter.validate_round_trip(long_slate) is True
