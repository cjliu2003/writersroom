#!/usr/bin/env python3
"""
Generate ground truth snapshots for FDX parser tests.

Usage:
    python tests/generate_ground_truth.py test_assets/sr_first_look_final.fdx > parsedFdxScenes.txt
    python tests/generate_ground_truth.py test_assets/my_script.fdx > test_assets/my_script_ground_truth.json
"""
from __future__ import annotations

import sys
import json
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.fdx_parser import FDXParser


def generate_ground_truth(fdx_path: Path) -> dict:
    """Parse FDX file and generate ground truth JSON."""
    content = fdx_path.read_text(encoding="utf-8")
    parsed = FDXParser.parse_fdx_content(content, fdx_path.name)
    
    scenes = []
    for i, scene in enumerate(parsed.scenes):
        scene_dict = {
            "projectId": "test-project-id",
            "slugline": scene.slugline,
            "sceneId": f"test-project-id_{i}",
            "sceneUUID": f"test-uuid-{i:04d}",
            "version": 0,
            "sceneIndex": i,
            "characters": scene.characters,
            "summary": scene.summary,
            "tone": None,
            "themeTags": scene.themes,
            "tokens": scene.tokens,
            "timestamp": "2025-09-29T16:03:43.740806",
            "wordCount": scene.word_count,
            "fullContent": scene.full_content,
            "projectTitle": fdx_path.stem,
            "contentBlocks": [
                {
                    "text": block.text,
                    "type": block.type.value,
                    "metadata": block.metadata
                }
                for block in scene.content_blocks
            ]
        }
        scenes.append(scene_dict)
    
    return scenes


def main():
    if len(sys.argv) < 2:
        print("Usage: python generate_ground_truth.py <fdx_file_path>", file=sys.stderr)
        print("Example: python generate_ground_truth.py test_assets/sr_first_look_final.fdx", file=sys.stderr)
        sys.exit(1)
    
    fdx_path = Path(sys.argv[1])
    
    if not fdx_path.exists():
        print(f"Error: File not found: {fdx_path}", file=sys.stderr)
        sys.exit(1)
    
    if not fdx_path.suffix.lower() in ['.fdx', '.xml']:
        print(f"Error: File must be .fdx or .xml, got: {fdx_path.suffix}", file=sys.stderr)
        sys.exit(1)
    
    # Generate ground truth
    print(f"Parsing {fdx_path}...", file=sys.stderr)
    scenes = generate_ground_truth(fdx_path)
    print(f"Generated ground truth for {len(scenes)} scenes", file=sys.stderr)
    
    # Output JSON to stdout
    print(json.dumps(scenes, indent=4, ensure_ascii=False))


if __name__ == "__main__":
    main()
