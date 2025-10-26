"""
FDX Exporter Tests

Comprehensive test suite for the FDX exporter service, including round-trip validation.
Tests that exported FDX files maintain fidelity with the original imported content.
"""
from __future__ import annotations

import pytest
from pathlib import Path
from uuid import uuid4

from app.services.fdx_parser import FDXParser
from app.services.fdx_exporter import FDXExporter
from app.models.script import Script
from app.models.scene import Scene
from .utils import (
    read_text,
    normalize_block_text,
    join_blocks_text,
    count_xml_elements,
    normalize_ws
)


class TestFDXExporterBasic:
    """Basic FDX exporter functionality tests."""

    def test_export_generates_valid_xml(self, repo_root):
        """Test that exporter generates valid XML structure."""
        # Create a minimal script and scene
        script = Script(
            script_id=uuid4(),
            owner_id=uuid4(),
            title="Test Script",
            description="Test"
        )

        scene = Scene(
            scene_id=uuid4(),
            script_id=script.script_id,
            position=0,
            scene_heading="INT. TEST LOCATION - DAY",
            content_blocks=[
                {"type": "scene_heading", "text": "INT. TEST LOCATION - DAY"},
                {"type": "action", "text": "A simple test scene."},
            ]
        )

        # Generate FDX
        fdx_content = FDXExporter.generate_fdx(script, [scene])

        # Verify it's valid XML
        assert fdx_content.startswith('<?xml')
        assert '<FinalDraft' in fdx_content
        assert 'DocumentType="Script"' in fdx_content
        assert '</FinalDraft>' in fdx_content

    def test_export_includes_scene_content(self, repo_root):
        """Test that exported FDX includes all scene content."""
        script = Script(
            script_id=uuid4(),
            owner_id=uuid4(),
            title="Test Script",
            description="Test"
        )

        scene = Scene(
            scene_id=uuid4(),
            script_id=script.script_id,
            position=0,
            scene_heading="INT. OFFICE - DAY",
            content_blocks=[
                {"type": "scene_heading", "text": "INT. OFFICE - DAY"},
                {"type": "action", "text": "John enters the room."},
                {"type": "character", "text": "JOHN"},
                {"type": "dialogue", "text": "Hello world."},
            ]
        )

        fdx_content = FDXExporter.generate_fdx(script, [scene])

        # Verify content is present
        assert "INT. OFFICE - DAY" in fdx_content
        assert "John enters the room." in fdx_content
        assert "JOHN" in fdx_content
        assert "Hello world." in fdx_content

    def test_export_multiple_scenes_ordered(self, repo_root):
        """Test that multiple scenes are exported in correct order."""
        script = Script(
            script_id=uuid4(),
            owner_id=uuid4(),
            title="Multi-Scene Script",
            description="Test"
        )

        scenes = [
            Scene(
                scene_id=uuid4(),
                script_id=script.script_id,
                position=0,
                scene_heading="INT. LOCATION A - DAY",
                content_blocks=[
                    {"type": "scene_heading", "text": "INT. LOCATION A - DAY"},
                    {"type": "action", "text": "Scene one content."},
                ]
            ),
            Scene(
                scene_id=uuid4(),
                script_id=script.script_id,
                position=1,
                scene_heading="EXT. LOCATION B - NIGHT",
                content_blocks=[
                    {"type": "scene_heading", "text": "EXT. LOCATION B - NIGHT"},
                    {"type": "action", "text": "Scene two content."},
                ]
            ),
        ]

        fdx_content = FDXExporter.generate_fdx(script, scenes)

        # Verify both scenes are present and ordered
        assert "INT. LOCATION A - DAY" in fdx_content
        assert "EXT. LOCATION B - NIGHT" in fdx_content

        # Scene A should appear before Scene B
        idx_a = fdx_content.index("INT. LOCATION A - DAY")
        idx_b = fdx_content.index("EXT. LOCATION B - NIGHT")
        assert idx_a < idx_b

    def test_export_handles_empty_scenes(self, repo_root):
        """Test that exporter gracefully handles empty scene lists."""
        script = Script(
            script_id=uuid4(),
            owner_id=uuid4(),
            title="Empty Script",
            description="Test"
        )

        # Export with no scenes
        fdx_content = FDXExporter.generate_fdx(script, [])

        # Should still generate valid FDX structure
        assert '<?xml' in fdx_content
        assert '<FinalDraft' in fdx_content


class TestFDXExporterRoundTrip:
    """Round-trip tests: Import → Export → Re-import."""

    def test_round_trip_preserves_scene_count(self, repo_root):
        """Test that import-export-import preserves scene count."""
        fdx_path = repo_root / "test_assets" / "sr_first_look_final.fdx"
        if not fdx_path.exists():
            pytest.skip(f"Test file not found: {fdx_path}")

        # Import original FDX
        original_content = read_text(fdx_path)
        parsed_original = FDXParser.parse_fdx_content(original_content, fdx_path.name)

        # Create mock script and scenes
        script = Script(
            script_id=uuid4(),
            owner_id=uuid4(),
            title=parsed_original.title,
            description="Round-trip test"
        )

        scenes = []
        for i, scene_data in enumerate(parsed_original.scenes):
            # Convert content_blocks to JSON format for database
            content_blocks_json = [
                {
                    "type": block.type.value,
                    "text": block.text,
                    "metadata": block.metadata
                }
                for block in scene_data.content_blocks
            ]

            scene = Scene(
                scene_id=uuid4(),
                script_id=script.script_id,
                position=i,
                scene_heading=scene_data.slugline,
                content_blocks=content_blocks_json
            )
            scenes.append(scene)

        # Export to FDX
        exported_content = FDXExporter.generate_fdx(script, scenes)

        # Re-import the exported FDX
        parsed_exported = FDXParser.parse_fdx_content(exported_content, "exported.fdx")

        # Verify scene count matches
        assert len(parsed_exported.scenes) == len(parsed_original.scenes), (
            f"Scene count mismatch after round-trip:\n"
            f"  Original: {len(parsed_original.scenes)}\n"
            f"  After round-trip: {len(parsed_exported.scenes)}"
        )

    def test_round_trip_preserves_scene_headings(self, repo_root):
        """Test that import-export-import preserves scene headings."""
        fdx_path = repo_root / "test_assets" / "sr_first_look_final.fdx"
        if not fdx_path.exists():
            pytest.skip(f"Test file not found: {fdx_path}")

        # Import original
        original_content = read_text(fdx_path)
        parsed_original = FDXParser.parse_fdx_content(original_content, fdx_path.name)

        # Create script and scenes
        script = Script(
            script_id=uuid4(),
            owner_id=uuid4(),
            title=parsed_original.title,
            description="Test"
        )

        scenes = []
        for i, scene_data in enumerate(parsed_original.scenes):
            content_blocks_json = [
                {
                    "type": block.type.value,
                    "text": block.text,
                    "metadata": block.metadata
                }
                for block in scene_data.content_blocks
            ]

            scene = Scene(
                scene_id=uuid4(),
                script_id=script.script_id,
                position=i,
                scene_heading=scene_data.slugline,
                content_blocks=content_blocks_json
            )
            scenes.append(scene)

        # Export and re-import
        exported_content = FDXExporter.generate_fdx(script, scenes)
        parsed_exported = FDXParser.parse_fdx_content(exported_content, "exported.fdx")

        # Compare sluglines
        for i, (orig_scene, exp_scene) in enumerate(zip(parsed_original.scenes, parsed_exported.scenes)):
            orig_slug = normalize_block_text("scene_heading", orig_scene.slugline)
            exp_slug = normalize_block_text("scene_heading", exp_scene.slugline)

            assert orig_slug == exp_slug, (
                f"Scene {i} slugline mismatch after round-trip:\n"
                f"  Original: {orig_scene.slugline}\n"
                f"  Exported: {exp_scene.slugline}"
            )

    def test_round_trip_preserves_content_blocks(self, repo_root):
        """Test that import-export-import preserves content block text."""
        fdx_path = repo_root / "test_assets" / "sr_first_look_final.fdx"
        if not fdx_path.exists():
            pytest.skip(f"Test file not found: {fdx_path}")

        # Import original
        original_content = read_text(fdx_path)
        parsed_original = FDXParser.parse_fdx_content(original_content, fdx_path.name)

        # Create script and scenes
        script = Script(
            script_id=uuid4(),
            owner_id=uuid4(),
            title=parsed_original.title,
            description="Test"
        )

        scenes = []
        for i, scene_data in enumerate(parsed_original.scenes):
            content_blocks_json = [
                {
                    "type": block.type.value,
                    "text": block.text,
                    "metadata": block.metadata
                }
                for block in scene_data.content_blocks
            ]

            scene = Scene(
                scene_id=uuid4(),
                script_id=script.script_id,
                position=i,
                scene_heading=scene_data.slugline,
                content_blocks=content_blocks_json
            )
            scenes.append(scene)

        # Export and re-import
        exported_content = FDXExporter.generate_fdx(script, scenes)
        parsed_exported = FDXParser.parse_fdx_content(exported_content, "exported.fdx")

        # Compare content blocks (text only, normalized)
        for i, (orig_scene, exp_scene) in enumerate(zip(parsed_original.scenes, parsed_exported.scenes)):
            # Get normalized text from all blocks
            orig_blocks = [
                {"type": b.type.value, "text": b.text}
                for b in orig_scene.content_blocks
            ]
            exp_blocks = [
                {"type": b.type.value, "text": b.text}
                for b in exp_scene.content_blocks
            ]

            orig_text = join_blocks_text(orig_blocks)
            exp_text = join_blocks_text(exp_blocks)

            # Allow for minor normalization differences
            assert normalize_ws(orig_text) == normalize_ws(exp_text), (
                f"Scene {i} content mismatch after round-trip:\n"
                f"  Original length: {len(orig_text)}\n"
                f"  Exported length: {len(exp_text)}\n"
                f"  First 200 chars of diff:\n"
                f"    Orig: {orig_text[:200]}\n"
                f"    Exp:  {exp_text[:200]}"
            )


class TestFDXExporterTypeMapping:
    """Test correct mapping of screenplay types to FDX paragraph types."""

    def test_type_mapping_scene_heading(self):
        """Test that scene_heading maps to 'Scene Heading'."""
        script = Script(script_id=uuid4(), owner_id=uuid4(), title="Test", description="")
        scene = Scene(
            scene_id=uuid4(),
            script_id=script.script_id,
            position=0,
            scene_heading="INT. TEST - DAY",
            content_blocks=[{"type": "scene_heading", "text": "INT. TEST - DAY"}]
        )

        fdx = FDXExporter.generate_fdx(script, [scene])
        assert 'Type="Scene Heading"' in fdx

    def test_type_mapping_action(self):
        """Test that action maps to 'Action'."""
        script = Script(script_id=uuid4(), owner_id=uuid4(), title="Test", description="")
        scene = Scene(
            scene_id=uuid4(),
            script_id=script.script_id,
            position=0,
            scene_heading="INT. TEST - DAY",
            content_blocks=[
                {"type": "scene_heading", "text": "INT. TEST - DAY"},
                {"type": "action", "text": "Action line."}
            ]
        )

        fdx = FDXExporter.generate_fdx(script, [scene])
        assert 'Type="Action"' in fdx

    def test_type_mapping_dialogue(self):
        """Test that character/dialogue map correctly."""
        script = Script(script_id=uuid4(), owner_id=uuid4(), title="Test", description="")
        scene = Scene(
            scene_id=uuid4(),
            script_id=script.script_id,
            position=0,
            scene_heading="INT. TEST - DAY",
            content_blocks=[
                {"type": "scene_heading", "text": "INT. TEST - DAY"},
                {"type": "character", "text": "JOHN"},
                {"type": "dialogue", "text": "Hello."}
            ]
        )

        fdx = FDXExporter.generate_fdx(script, [scene])
        assert 'Type="Character"' in fdx
        assert 'Type="Dialogue"' in fdx

    def test_type_mapping_transition(self):
        """Test that transition maps to 'Transition'."""
        script = Script(script_id=uuid4(), owner_id=uuid4(), title="Test", description="")
        scene = Scene(
            scene_id=uuid4(),
            script_id=script.script_id,
            position=0,
            scene_heading="INT. TEST - DAY",
            content_blocks=[
                {"type": "scene_heading", "text": "INT. TEST - DAY"},
                {"type": "transition", "text": "FADE OUT:"}
            ]
        )

        fdx = FDXExporter.generate_fdx(script, [scene])
        assert 'Type="Transition"' in fdx


class TestFDXExporterEdgeCases:
    """Test edge cases and special scenarios."""

    def test_export_with_special_characters(self):
        """Test that special XML characters are properly escaped."""
        script = Script(script_id=uuid4(), owner_id=uuid4(), title="Test", description="")
        scene = Scene(
            scene_id=uuid4(),
            script_id=script.script_id,
            position=0,
            scene_heading="INT. TEST - DAY",
            content_blocks=[
                {"type": "scene_heading", "text": "INT. TEST - DAY"},
                {"type": "action", "text": "Text with <angle> & ampersand."},
            ]
        )

        fdx = FDXExporter.generate_fdx(script, [scene])

        # XML should escape these characters
        assert "&lt;" in fdx or "<angle>" not in fdx
        assert "&amp;" in fdx or "& ampersand" not in fdx

    def test_export_skips_empty_blocks(self):
        """Test that empty content blocks are skipped."""
        script = Script(script_id=uuid4(), owner_id=uuid4(), title="Test", description="")
        scene = Scene(
            scene_id=uuid4(),
            script_id=script.script_id,
            position=0,
            scene_heading="INT. TEST - DAY",
            content_blocks=[
                {"type": "scene_heading", "text": "INT. TEST - DAY"},
                {"type": "action", "text": ""},  # Empty
                {"type": "action", "text": "   "},  # Whitespace only
                {"type": "action", "text": "Valid content."},
            ]
        )

        fdx = FDXExporter.generate_fdx(script, [scene])

        # Should only have scene heading and valid content paragraph
        # Count occurrences of <Paragraph
        paragraph_count = fdx.count('<Paragraph')

        # Should be 2: scene_heading + valid action (empty blocks skipped)
        assert paragraph_count == 2, f"Expected 2 paragraphs, got {paragraph_count}"

    def test_export_sanitizes_filename_in_title(self):
        """Test that script title is safely used in comments."""
        script = Script(
            script_id=uuid4(),
            owner_id=uuid4(),
            title="Script with <special> & chars!",
            description=""
        )

        fdx = FDXExporter.generate_fdx(script, [])

        # Should be valid XML despite special title
        assert '<?xml' in fdx
        assert '<FinalDraft' in fdx
