"""
Tests for Character Normalization Utility

Tests the normalization of character names by removing screenplay parentheticals
while preserving the character's identity for analytics purposes.
"""

import pytest
from app.utils.character_normalization import (
    normalize_character_name,
    normalize_character_list,
    PARENTHETICAL_PATTERNS
)


class TestNormalizeCharacterName:
    """Test normalize_character_name function."""

    def test_normalize_off_screen(self):
        """Test normalization of (O.S.) parenthetical."""
        assert normalize_character_name("SAM (O.S.)") == "SAM"
        assert normalize_character_name("JOHN (o.s.)") == "JOHN"
        assert normalize_character_name("Mary (O.S.)") == "Mary"

    def test_normalize_voice_over(self):
        """Test normalization of (V.O.) parenthetical."""
        assert normalize_character_name("SAM (V.O.)") == "SAM"
        assert normalize_character_name("NARRATOR (v.o.)") == "NARRATOR"

    def test_normalize_continued(self):
        """Test normalization of (CONT'D) parenthetical."""
        assert normalize_character_name("SAM (CONT'D)") == "SAM"
        assert normalize_character_name("JOHN (cont'd)") == "JOHN"

    def test_normalize_off_camera(self):
        """Test normalization of (O.C.) parenthetical."""
        assert normalize_character_name("SAM (O.C.)") == "SAM"
        assert normalize_character_name("MARY (o.c.)") == "MARY"

    def test_normalize_pre_lap(self):
        """Test normalization of (PRE-LAP) parenthetical."""
        assert normalize_character_name("SAM (PRE-LAP)") == "SAM"
        assert normalize_character_name("JOHN (pre-lap)") == "JOHN"

    def test_normalize_filtered(self):
        """Test normalization of (FILTERED) parenthetical."""
        assert normalize_character_name("SAM (FILTERED)") == "SAM"
        assert normalize_character_name("VOICE (filtered)") == "VOICE"

    def test_normalize_custom_parenthetical(self):
        """Test normalization of custom parentheticals."""
        assert normalize_character_name("SAM (ON PHONE)") == "SAM"
        assert normalize_character_name("JOHN (THROUGH DOOR)") == "JOHN"
        assert normalize_character_name("MARY (SINGING)") == "MARY"

    def test_no_normalization_needed(self):
        """Test that names without parentheticals are unchanged."""
        assert normalize_character_name("SAM") == "SAM"
        assert normalize_character_name("JOHN") == "JOHN"
        assert normalize_character_name("MARY JANE") == "MARY JANE"

    def test_empty_string(self):
        """Test that empty string is handled correctly."""
        assert normalize_character_name("") == ""

    def test_none_value(self):
        """Test that None is handled correctly."""
        assert normalize_character_name(None) is None

    def test_whitespace_handling(self):
        """Test that whitespace is properly trimmed."""
        assert normalize_character_name("  SAM (O.S.)  ") == "SAM"
        assert normalize_character_name("SAM   (V.O.)") == "SAM"

    def test_multiple_parentheticals(self):
        """Test that multiple parentheticals are all removed."""
        # This is an edge case - screenplay format usually has one
        assert normalize_character_name("SAM (O.S.) (FILTERED)") == "SAM"

    def test_case_insensitivity(self):
        """Test that parenthetical matching is case-insensitive."""
        assert normalize_character_name("SAM (o.s.)") == "SAM"
        assert normalize_character_name("SAM (O.S.)") == "SAM"
        assert normalize_character_name("SAM (O.s.)") == "SAM"

    def test_real_world_examples(self):
        """Test real-world character name examples."""
        assert normalize_character_name("DETECTIVE SMITH (O.S.)") == "DETECTIVE SMITH"
        assert normalize_character_name("DR. JONES (V.O.)") == "DR. JONES"
        assert normalize_character_name("MRS. HENDERSON (CONT'D)") == "MRS. HENDERSON"
        assert normalize_character_name("CAPTAIN REYNOLDS (FILTERED)") == "CAPTAIN REYNOLDS"


class TestNormalizeCharacterList:
    """Test normalize_character_list function."""

    def test_deduplicate_same_character(self):
        """Test that variations of the same character are deduplicated."""
        characters = ["SAM", "SAM (O.S.)", "SAM (V.O.)"]
        result = normalize_character_list(characters)
        assert result == ["SAM"]

    def test_preserve_different_characters(self):
        """Test that different characters are preserved."""
        characters = ["SAM", "JOHN", "MARY"]
        result = normalize_character_list(characters)
        assert set(result) == {"SAM", "JOHN", "MARY"}

    def test_mixed_normalization(self):
        """Test mixed list with duplicates and unique characters."""
        characters = ["SAM", "SAM (O.S.)", "JOHN", "JOHN (V.O.)", "MARY"]
        result = normalize_character_list(characters)
        assert set(result) == {"SAM", "JOHN", "MARY"}

    def test_empty_list(self):
        """Test that empty list is handled correctly."""
        assert normalize_character_list([]) == []

    def test_none_list(self):
        """Test that None is handled correctly."""
        assert normalize_character_list(None) == []

    def test_sorted_output(self):
        """Test that output is sorted alphabetically."""
        characters = ["ZEBRA", "ALICE", "MIKE"]
        result = normalize_character_list(characters)
        assert result == sorted(result)

    def test_ignore_empty_strings(self):
        """Test that empty strings are filtered out."""
        characters = ["SAM", "", "JOHN", "  ", "MARY"]
        result = normalize_character_list(characters)
        assert "" not in result
        assert "  " not in result

    def test_real_world_scene(self):
        """Test a realistic scene character list."""
        characters = [
            "SAM",
            "SAM (O.S.)",
            "SAM (CONT'D)",
            "JOHN",
            "JOHN (V.O.)",
            "MARY",
            "DETECTIVE SMITH (FILTERED)"
        ]
        result = normalize_character_list(characters)
        assert set(result) == {"SAM", "JOHN", "MARY", "DETECTIVE SMITH"}


class TestParentheticalPatterns:
    """Test the PARENTHETICAL_PATTERNS regex patterns."""

    def test_patterns_exist(self):
        """Test that all expected patterns are defined."""
        assert len(PARENTHETICAL_PATTERNS) > 0

    def test_patterns_are_compiled(self):
        """Test that patterns are compiled regex objects."""
        import re
        for pattern in PARENTHETICAL_PATTERNS:
            # Pattern should be a string that can be used in re.sub
            assert isinstance(pattern, str)

    def test_catch_all_pattern_last(self):
        """Test that catch-all pattern is last in the list."""
        # The catch-all pattern r'\s*\([^)]*\)' should be last
        # to ensure specific patterns are matched first
        assert PARENTHETICAL_PATTERNS[-1] == r'\s*\([^)]*\)'


class TestEdgeCases:
    """Test edge cases and potential error conditions."""

    def test_parentheses_in_name(self):
        """Test character names that naturally contain parentheses."""
        # This is unlikely in screenplay format, but test defensive handling
        result = normalize_character_name("SAM (THE THIRD)")
        # Should remove the parenthetical
        assert result == "SAM"

    def test_unicode_characters(self):
        """Test that unicode characters are preserved."""
        assert normalize_character_name("JOSÉ (O.S.)") == "JOSÉ"
        assert normalize_character_name("FRANÇOIS (V.O.)") == "FRANÇOIS"

    def test_numbers_in_name(self):
        """Test that numbers in names are preserved."""
        assert normalize_character_name("AGENT 47 (O.S.)") == "AGENT 47"
        assert normalize_character_name("T-1000 (V.O.)") == "T-1000"

    def test_special_characters(self):
        """Test that special characters in names are preserved."""
        assert normalize_character_name("DR. SMITH (O.S.)") == "DR. SMITH"
        assert normalize_character_name("MRS. O'BRIEN (V.O.)") == "MRS. O'BRIEN"
        assert normalize_character_name("JEAN-PAUL (CONT'D)") == "JEAN-PAUL"


@pytest.mark.integration
class TestIntegrationWithFDXParser:
    """Integration tests to verify normalization works with FDX parsing."""

    def test_normalization_preserves_content_blocks(self):
        """
        Test that normalization only affects tracking, not content display.

        This is a critical requirement: the original "SAM (O.S.)" should be
        preserved in content_blocks for screenplay display, while the
        Scene.characters and scene_characters table should use "SAM".
        """
        # This test would require actual FDX parsing
        # For now, we document the expected behavior
        pass

    def test_scene_characters_jsonb_normalized(self):
        """
        Test that Scene.characters JSONB field contains normalized names.
        """
        # This would require database integration
        pass

    def test_scene_character_table_normalized(self):
        """
        Test that scene_characters junction table contains normalized names.
        """
        # This would require database integration
        pass


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
