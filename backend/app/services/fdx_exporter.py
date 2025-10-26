"""
FDX Exporter Service

Generates valid Final Draft XML (.fdx) files from Script and Scene database records.
Mirrors the architecture of fdx_parser.py for consistency.
"""

import xml.etree.ElementTree as ET
from typing import List, Optional
from datetime import datetime
import logging

from app.models.script import Script
from app.models.scene import Scene

logger = logging.getLogger(__name__)


class FDXExporter:
    """
    FDX file exporter that converts database screenplay elements
    to valid Final Draft XML format.
    """

    # Mapping from screenplay block types to FDX Paragraph Types
    TYPE_MAPPING = {
        'scene_heading': 'Scene Heading',
        'action': 'Action',
        'character': 'Character',
        'dialogue': 'Dialogue',
        'parenthetical': 'Parenthetical',
        'transition': 'Transition',
        'shot': 'Shot',
        'cast_list': 'Cast List',
        'general': 'General',
        'new_act': 'Act Break',
        'end_of_act': 'End of Act',
        'summary': 'General',  # Summary maps to General
    }

    @classmethod
    def generate_fdx(cls, script: Script, scenes: List[Scene]) -> str:
        """
        Generate a valid Final Draft .fdx XML string from script and scenes.

        Args:
            script: The Script model instance
            scenes: List of Scene models ordered by position

        Returns:
            Complete FDX XML string ready for file writing
        """
        logger.info(f"Generating FDX for script: {script.title}")
        logger.info(f"Processing {len(scenes)} scenes")

        # Create root element
        root = ET.Element('FinalDraft', attrib={
            'DocumentType': 'Script',
            'Template': 'Screenplay',
            'Version': '5'
        })

        # Add Content section
        content = ET.SubElement(root, 'Content')

        # Process scenes in order
        for scene in sorted(scenes, key=lambda s: s.position):
            cls._add_scene_to_content(content, scene)

        # Convert to string with XML declaration
        xml_string = cls._to_xml_string(root, script.title)

        logger.info(f"Successfully generated FDX with {len(scenes)} scenes")
        return xml_string

    @classmethod
    def _add_scene_to_content(cls, content: ET.Element, scene: Scene) -> None:
        """
        Add a single scene's content blocks to the Content element.

        Args:
            content: The Content XML element to append to
            scene: The Scene model with content_blocks
        """
        if not scene.content_blocks:
            logger.warning(f"Scene {scene.scene_id} has no content blocks")
            return

        # content_blocks is a JSONB field, should be a list of dicts
        blocks = scene.content_blocks

        # Handle case where content_blocks might be stored as a dict
        if isinstance(blocks, dict):
            logger.warning(f"Scene {scene.scene_id} has dict content_blocks, expected list")
            return

        for block in blocks:
            cls._add_paragraph(content, block)

    @classmethod
    def _add_paragraph(cls, content: ET.Element, block: dict) -> None:
        """
        Add a single paragraph element to the content.

        Args:
            content: The Content XML element
            block: A screenplay element block dict with 'type' and 'text'
        """
        block_type = block.get('type', 'action')
        text = block.get('text', '')

        # Skip empty blocks
        if not text or not text.strip():
            return

        # Map screenplay type to FDX type
        fdx_type = cls.TYPE_MAPPING.get(block_type, 'Action')

        # Create paragraph element
        paragraph = ET.SubElement(content, 'Paragraph', attrib={'Type': fdx_type})

        # Add text element
        text_elem = ET.SubElement(paragraph, 'Text')
        text_elem.text = cls._sanitize_text(text)

    @classmethod
    def _sanitize_text(cls, text: str) -> str:
        """
        Sanitize text for XML output.
        Preserves meaningful characters while ensuring XML validity.

        Args:
            text: Raw text string

        Returns:
            Sanitized text safe for XML
        """
        if not text:
            return ''

        # ElementTree handles basic XML escaping (&, <, >, etc.)
        # Just strip extreme whitespace while preserving single spaces
        text = text.strip()

        # Normalize line breaks to spaces (FDX uses separate paragraphs for lines)
        text = text.replace('\n', ' ').replace('\r', ' ')

        # Collapse multiple spaces to single space
        import re
        text = re.sub(r'\s+', ' ', text)

        return text

    @classmethod
    def _to_xml_string(cls, root: ET.Element, title: str) -> str:
        """
        Convert XML tree to properly formatted string with declaration.

        Args:
            root: The root XML element
            title: Script title for comment

        Returns:
            Complete XML document as string
        """
        # Create tree
        tree = ET.ElementTree(root)

        # Convert to string with XML declaration
        # Note: ElementTree.tostring doesn't add declaration, so we add it manually
        import io
        output = io.BytesIO()
        tree.write(output, encoding='UTF-8', xml_declaration=True)
        xml_bytes = output.getvalue()

        # Decode to string
        xml_string = xml_bytes.decode('utf-8')

        # Add a comment with generation info (optional, for debugging)
        # Insert after the XML declaration
        if xml_string.startswith('<?xml'):
            first_line_end = xml_string.index('?>') + 2
            comment = f"\n<!-- Generated from WritersRoom: {title} - {datetime.utcnow().isoformat()}Z -->\n"
            xml_string = xml_string[:first_line_end] + comment + xml_string[first_line_end:]

        return xml_string


# Convenience function for backward compatibility
def generate_fdx(script: Script, scenes: List[Scene]) -> str:
    """
    Generate a Final Draft .fdx XML string from script and scenes.

    Convenience function that delegates to FDXExporter.generate_fdx().

    Args:
        script: The Script model instance
        scenes: List of Scene models ordered by position

    Returns:
        Complete FDX XML string
    """
    return FDXExporter.generate_fdx(script, scenes)
