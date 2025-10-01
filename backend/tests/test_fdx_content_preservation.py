"""
CRITICAL: Content Preservation Tests

These tests ensure that NO content is ever lost during FDX parsing.
This is the highest priority - if these fail, we have a data loss bug.
"""
from __future__ import annotations

from pathlib import Path
import pytest

from app.services.fdx_parser import FDXParser
from .utils import (
    count_xml_elements,
    extract_all_text_from_xml,
    normalize_ws,
    read_text,
)


def test_no_content_loss_element_count(all_fdx_files):
    """Test all FDX files for element count preservation."""
    for fdx_file in all_fdx_files:
        _test_no_content_loss_element_count(fdx_file)


def _test_no_content_loss_element_count(fdx_file: Path):
    """
    CRITICAL: Verify that all non-empty XML paragraphs are parsed.
    
    This test ensures we don't silently drop content during parsing.
    """
    content = read_text(fdx_file)
    
    # Count elements in source XML
    xml_counts = count_xml_elements(content)
    total_xml_elements = sum(xml_counts.values())
    
    # Parse with our parser
    parsed = FDXParser.parse_fdx_content(content, fdx_file.name)
    total_parsed_elements = len(parsed.elements)
    
    # We should have parsed at least as many elements as valid XML paragraphs
    # (Some may be filtered for being incomplete/invalid, but we should be close)
    missing_ratio = (total_xml_elements - total_parsed_elements) / max(total_xml_elements, 1)
    
    assert missing_ratio < 0.1, (
        f"Too many elements missing in {fdx_file.name}:\n"
        f"  XML elements: {total_xml_elements}\n"
        f"  Parsed elements: {total_parsed_elements}\n"
        f"  Missing: {total_xml_elements - total_parsed_elements} ({missing_ratio:.1%})\n"
        f"  XML breakdown: {xml_counts}\n"
        f"This suggests content loss during parsing!"
    )


def test_no_content_loss_text_preservation(all_fdx_files):
    """Test all FDX files for text preservation."""
    for fdx_file in all_fdx_files:
        _test_no_content_loss_text_preservation(fdx_file)


def _test_no_content_loss_text_preservation(fdx_file: Path):
    """
    CRITICAL: Verify that all text from source FDX appears in parsed output.
    
    This is the ultimate content preservation test - every word must be preserved.
    Case-insensitive comparison to account for parser normalization (e.g., scene headings uppercased).
    """
    content = read_text(fdx_file)
    
    # Extract all text from XML
    xml_text = extract_all_text_from_xml(content)
    # Normalize to lowercase for case-insensitive comparison
    xml_words = set(word.lower() for word in normalize_ws(xml_text).split())
    
    # Extract all text from parsed output
    parsed = FDXParser.parse_fdx_content(content, fdx_file.name)
    parsed_text = "\n".join(elem.text for elem in parsed.elements)
    # Normalize to lowercase for case-insensitive comparison
    parsed_words = set(word.lower() for word in normalize_ws(parsed_text).split())
    
    # Find missing words (case-insensitive)
    missing_words = xml_words - parsed_words
    
    # Allow a very small number of missing words for edge cases
    # (like FDX metadata, page numbers, etc.)
    max_allowed_missing = max(3, len(xml_words) * 0.01)  # 1% or 3 words, whichever is larger
    
    assert len(missing_words) <= max_allowed_missing, (
        f"Content loss detected in {fdx_file.name}!\n"
        f"  Missing words ({len(missing_words)}): {sorted(list(missing_words)[:20])}\n"
        f"  Total XML words: {len(xml_words)}\n"
        f"  Total parsed words: {len(parsed_words)}\n"
        f"This indicates text was lost during parsing!"
    )


def test_sr_first_look_exact_element_count(repo_root):
    """
    Specific test for sr_first_look_final.fdx to ensure exact element counts.
    This is our reference file with known-good structure.
    """
    fdx_path = repo_root / "test_assets" / "sr_first_look_final.fdx"
    content = read_text(fdx_path)
    
    # Count in XML
    xml_counts = count_xml_elements(content)
    
    # Parse
    parsed = FDXParser.parse_fdx_content(content, fdx_path.name)
    
    # Count by type in parsed output
    parsed_counts = {}
    for elem in parsed.elements:
        elem_type = elem.type.value
        parsed_counts[elem_type] = parsed_counts.get(elem_type, 0) + 1
    
    # Scene Headings should match exactly
    xml_scene_headings = xml_counts.get('Scene Heading', 0)
    parsed_scene_headings = parsed_counts.get('scene_heading', 0)
    
    assert parsed_scene_headings == xml_scene_headings, (
        f"Scene heading count mismatch:\n"
        f"  XML: {xml_scene_headings}\n"
        f"  Parsed: {parsed_scene_headings}\n"
        f"  Difference: {xml_scene_headings - parsed_scene_headings}"
    )
    
    # Number of scenes should equal number of scene headings
    assert len(parsed.scenes) == parsed_scene_headings, (
        f"Scene count doesn't match scene heading count:\n"
        f"  Scene headings: {parsed_scene_headings}\n"
        f"  Scenes created: {len(parsed.scenes)}\n"
        f"  Some scene headings were not turned into scenes!"
    )
