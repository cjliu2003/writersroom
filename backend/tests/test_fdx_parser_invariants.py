"""
Parser Invariant Tests

These tests ensure the parser maintains critical invariants across ALL FDX files.
These are structural guarantees that should always hold.
"""
from __future__ import annotations

from pathlib import Path
import re
import pytest

from app.services.fdx_parser import FDXParser
from .utils import read_text


def test_no_empty_elements(all_fdx_files):
    """
    INVARIANT: All parsed elements must have non-empty text.
    
    Empty elements indicate a parsing bug or malformed handling.
    """
    for fdx_file in all_fdx_files:
        content = read_text(fdx_file)
        parsed = FDXParser.parse_fdx_content(content, fdx_file.name)
        
        for i, elem in enumerate(parsed.elements):
            assert isinstance(elem.text, str), (
                f"Element {i} has non-string text: {type(elem.text)}"
            )
            assert elem.text.strip() != "", (
                f"Element {i} (type={elem.type}) has empty text in {fdx_file.name}"
            )


def test_scenes_start_with_heading(all_fdx_files):
    """
    INVARIANT: Every scene must start with a scene_heading block.
    
    This is a fundamental screenplay structure requirement.
    """
    for fdx_file in all_fdx_files:
        content = read_text(fdx_file)
        parsed = FDXParser.parse_fdx_content(content, fdx_file.name)
        
        for i, scene in enumerate(parsed.scenes):
            assert len(scene.content_blocks) >= 1, (
                f"Scene {i} has no content blocks in {fdx_file.name}"
            )
            
            first_block = scene.content_blocks[0]
            assert first_block.type.value == "scene_heading", (
                f"Scene {i} doesn't start with scene_heading in {fdx_file.name}\n"
                f"  First block type: {first_block.type.value}\n"
                f"  Text: {first_block.text}"
            )


def test_scene_count_reasonable(all_fdx_files):
    """
    INVARIANT: Number of scenes should be close to number of Scene Heading tags.
    
    Large discrepancies indicate scene hydration bugs.
    """
    for fdx_file in all_fdx_files:
        content = read_text(fdx_file)
        
        # Count Scene Heading tags in XML
        scene_heading_tags = re.findall(
            r'<Paragraph[^>]*Type="Scene Heading"[^>]*>',
            content,
            re.IGNORECASE
        )
        
        parsed = FDXParser.parse_fdx_content(content, fdx_file.name)
        
        # Parser may filter some incomplete headings, but shouldn't create more scenes
        assert len(parsed.scenes) <= len(scene_heading_tags), (
            f"More scenes than scene headings in {fdx_file.name}:\n"
            f"  Scene headings in XML: {len(scene_heading_tags)}\n"
            f"  Scenes created: {len(parsed.scenes)}\n"
            f"  Parser created {len(parsed.scenes) - len(scene_heading_tags)} extra scenes!"
        )
        
        # Should have at least most of them (allow filtering of 1-2 malformed ones)
        min_expected = max(0, len(scene_heading_tags) - 2)
        assert len(parsed.scenes) >= min_expected, (
            f"Too few scenes created in {fdx_file.name}:\n"
            f"  Scene headings in XML: {len(scene_heading_tags)}\n"
            f"  Scenes created: {len(parsed.scenes)}\n"
            f"  Missing: {len(scene_heading_tags) - len(parsed.scenes)}"
        )


def test_scene_sluglines_unique_or_sequential(all_fdx_files):
    """
    INVARIANT: Scene sluglines should be unique or follow screenplay conventions.
    
    Duplicate sluglines often indicate parsing errors (scenes merged incorrectly).
    """
    for fdx_file in all_fdx_files:
        content = read_text(fdx_file)
        parsed = FDXParser.parse_fdx_content(content, fdx_file.name)
        
        sluglines = [s.slugline for s in parsed.scenes]
        
        # Check for exact duplicates
        seen = {}
        duplicates = []
        for i, slug in enumerate(sluglines):
            if slug in seen:
                duplicates.append((i, slug, seen[slug]))
            else:
                seen[slug] = i
        
        # Allow a few duplicates (some scripts legitimately revisit locations)
        # but many duplicates indicate a parsing bug
        max_allowed_duplicates = len(sluglines) * 0.1  # 10%
        assert len(duplicates) <= max_allowed_duplicates, (
            f"Too many duplicate sluglines in {fdx_file.name}:\n"
            f"  Duplicates: {len(duplicates)}\n"
            f"  Examples: {duplicates[:5]}"
        )


def test_character_names_consistent(all_fdx_files):
    """
    INVARIANT: Character names should be consistently formatted.
    
    Ensures character tracking is reliable.
    """
    for fdx_file in all_fdx_files:
        content = read_text(fdx_file)
        parsed = FDXParser.parse_fdx_content(content, fdx_file.name)
        
        for scene in parsed.scenes:
            for block in scene.content_blocks:
                if block.type.value == "character":
                    # Should be uppercase
                    assert block.text == block.text.upper(), (
                        f"Character name not uppercase: '{block.text}' in {fdx_file.name}"
                    )
                    # Should not be empty
                    assert block.text.strip() != "", (
                        f"Empty character name in {fdx_file.name}"
                    )


def test_scene_metadata_populated(all_fdx_files):
    """
    INVARIANT: Scene metadata should be populated for all scenes.
    
    Ensures scene hydration is complete.
    """
    for fdx_file in all_fdx_files:
        content = read_text(fdx_file)
        parsed = FDXParser.parse_fdx_content(content, fdx_file.name)
        
        for i, scene in enumerate(parsed.scenes):
            # Slugline must exist
            assert scene.slugline, f"Scene {i} has no slugline in {fdx_file.name}"
            
            # Summary should exist (even if just "Empty scene")
            assert scene.summary, f"Scene {i} has no summary in {fdx_file.name}"
            
            # Token count should be > 0 for non-empty scenes
            if len(scene.content_blocks) > 1:  # More than just heading
                assert scene.tokens > 0, f"Scene {i} has 0 tokens despite having content in {fdx_file.name}"
            
            # Word count should be > 0 for non-empty scenes
            if len(scene.content_blocks) > 1:
                assert scene.word_count > 0, f"Scene {i} has 0 words despite having content in {fdx_file.name}"


def test_parser_deterministic(repo_root):
    """
    INVARIANT: Parser should produce identical output for identical input.
    
    This ensures parsing is deterministic and reproducible.
    """
    fdx_path = repo_root / "test_assets" / "sr_first_look_final.fdx"
    content = read_text(fdx_path)
    
    # Parse twice
    parsed1 = FDXParser.parse_fdx_content(content, fdx_path.name)
    parsed2 = FDXParser.parse_fdx_content(content, fdx_path.name)
    
    # Should have same number of scenes
    assert len(parsed1.scenes) == len(parsed2.scenes)
    
    # Should have same number of elements
    assert len(parsed1.elements) == len(parsed2.elements)
    
    # Scenes should be identical
    for s1, s2 in zip(parsed1.scenes, parsed2.scenes):
        assert s1.slugline == s2.slugline
        assert s1.summary == s2.summary
        assert s1.tokens == s2.tokens
        assert s1.word_count == s2.word_count
        assert s1.characters == s2.characters
        assert len(s1.content_blocks) == len(s2.content_blocks)
