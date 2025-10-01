"""
Ground Truth Regression Tests

These tests compare parser output against known-good snapshots.
If these fail, either the parser has regressed or the ground truth needs updating.
"""
from __future__ import annotations

import json
from pathlib import Path
import pytest

from app.services.fdx_parser import FDXParser
from .utils import normalize_block_text, join_blocks_text, read_text


def load_ground_truth(path: Path):
    """Load ground truth JSON."""
    text = read_text(path)
    return json.loads(text)


def parse_to_dict(fdx_path: Path):
    """Parse FDX and convert to comparable dict format."""
    content = read_text(fdx_path)
    parsed = FDXParser.parse_fdx_content(content, fdx_path.name)
    
    scenes = []
    for s in parsed.scenes:
        scenes.append({
            "slugline": s.slugline,
            "summary": s.summary,
            "tokens": s.tokens,
            "characters": s.characters,
            "themeTags": s.themes,
            "wordCount": s.word_count,
            "fullContent": s.full_content,
            "contentBlocks": [{
                "type": b.type.value,
                "text": b.text,
                "metadata": b.metadata,
            } for b in s.content_blocks],
        })
    return scenes


def test_sr_first_look_matches_ground_truth(repo_root):
    """
    Compare sr_first_look_final.fdx against parsedFdxScenes.txt.
    
    This is our primary regression test against a known-good parse.
    """
    fdx_path = repo_root / "test_assets" / "sr_first_look_final.fdx"
    ground_path = repo_root / "parsedFdxScenes.txt"
    
    if not ground_path.exists():
        pytest.skip(f"Ground truth file not found: {ground_path}")
    
    ground = load_ground_truth(ground_path)
    parsed = parse_to_dict(fdx_path)
    
    # Scene count must match
    assert len(parsed) == len(ground), (
        f"Scene count mismatch:\n"
        f"  Parsed: {len(parsed)}\n"
        f"  Ground truth: {len(ground)}"
    )
    
    # Compare each scene
    for i, (p, g) in enumerate(zip(parsed, ground)):
        # Slugline comparison
        p_slug = normalize_block_text("scene_heading", p["slugline"])
        g_slug = normalize_block_text("scene_heading", g["slugline"])
        assert p_slug == g_slug, (
            f"Slugline mismatch at scene {i}:\n"
            f"  Parsed: {p['slugline']}\n"
            f"  Ground: {g['slugline']}"
        )
        
        # Characters comparison (order-independent)
        p_chars = set(p.get("characters", []))
        g_chars = set(g.get("characters", []))
        assert p_chars == g_chars, (
            f"Characters mismatch at scene {i}:\n"
            f"  Parsed: {sorted(p_chars)}\n"
            f"  Ground: {sorted(g_chars)}"
        )
        
        # Content blocks comparison
        p_text = join_blocks_text(p.get("contentBlocks", []))
        g_text = join_blocks_text(g.get("contentBlocks", []))
        assert p_text == g_text, (
            f"Content mismatch at scene {i} ({p['slugline']}):\n"
            f"--- Parsed ---\n{p_text[:500]}\n"
            f"--- Ground ---\n{g_text[:500]}"
        )


def test_ground_truth_file_validity(repo_root):
    """
    Verify that the ground truth file itself is valid.
    """
    ground_path = repo_root / "parsedFdxScenes.txt"
    
    if not ground_path.exists():
        pytest.skip(f"Ground truth file not found: {ground_path}")
    
    ground = load_ground_truth(ground_path)
    
    # Must be a list
    assert isinstance(ground, list), "Ground truth must be a list of scenes"
    
    # Must have scenes
    assert len(ground) > 0, "Ground truth must have at least one scene"
    
    # Each scene must have required fields
    required_fields = ["slugline", "contentBlocks"]
    for i, scene in enumerate(ground):
        for field in required_fields:
            assert field in scene, (
                f"Scene {i} in ground truth missing required field: {field}"
            )
        
        # Content blocks must be non-empty
        assert len(scene["contentBlocks"]) > 0, (
            f"Scene {i} has no content blocks"
        )
        
        # First block should be scene_heading
        first_block = scene["contentBlocks"][0]
        assert first_block.get("type") == "scene_heading", (
            f"Scene {i} first block is not scene_heading: {first_block.get('type')}"
        )
