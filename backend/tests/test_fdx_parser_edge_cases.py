"""
Edge Case and Error Handling Tests

These tests ensure the parser handles malformed, edge case, and error conditions gracefully.
"""
from __future__ import annotations

import pytest
from app.services.fdx_parser import FDXParser


def test_empty_fdx_file():
    """Parser should handle empty FDX gracefully."""
    minimal_fdx = """<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Version="12">
  <Content>
    <Body>
    </Body>
  </Content>
</FinalDraft>"""
    
    parsed = FDXParser.parse_fdx_content(minimal_fdx, "empty.fdx")
    
    assert parsed.elements == []
    assert parsed.scenes == []
    assert parsed.title == "empty"


def test_single_scene_heading_only():
    """Parser should handle a file with just a scene heading."""
    fdx = """<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Version="12">
  <Content>
    <Body>
      <Paragraph Type="Scene Heading">
        <Text>INT. ROOM - DAY</Text>
      </Paragraph>
    </Body>
  </Content>
</FinalDraft>"""
    
    parsed = FDXParser.parse_fdx_content(fdx, "single.fdx")
    
    assert len(parsed.elements) == 1
    assert len(parsed.scenes) == 1
    assert parsed.scenes[0].slugline == "INT. ROOM - DAY"


def test_adjacent_scene_headings():
    """Parser should handle adjacent scene headings correctly."""
    fdx = """<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Version="12">
  <Content>
    <Body>
      <Paragraph Type="Scene Heading">
        <Text>INT. ROOM A - DAY</Text>
      </Paragraph>
      <Paragraph Type="Scene Heading">
        <Text>INT. ROOM B - DAY</Text>
      </Paragraph>
      <Paragraph Type="Scene Heading">
        <Text>INT. ROOM C - DAY</Text>
      </Paragraph>
    </Body>
  </Content>
</FinalDraft>"""
    
    parsed = FDXParser.parse_fdx_content(fdx, "adjacent.fdx")
    
    # Should create 3 scenes, even though they have no content
    assert len(parsed.scenes) == 3
    assert parsed.scenes[0].slugline == "INT. ROOM A - DAY"
    assert parsed.scenes[1].slugline == "INT. ROOM B - DAY"
    assert parsed.scenes[2].slugline == "INT. ROOM C - DAY"


def test_incomplete_slugline_filtered():
    """Parser should filter incomplete sluglines like just 'INT.' or 'EXT.'"""
    fdx = """<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Version="12">
  <Content>
    <Body>
      <Paragraph Type="Scene Heading">
        <Text>INT.</Text>
      </Paragraph>
      <Paragraph Type="Scene Heading">
        <Text>EXT. HOUSE - DAY</Text>
      </Paragraph>
      <Paragraph Type="Scene Heading">
        <Text>EXT</Text>
      </Paragraph>
    </Body>
  </Content>
</FinalDraft>"""
    
    parsed = FDXParser.parse_fdx_content(fdx, "incomplete.fdx")
    
    # Should only get 1 valid scene (the complete one)
    assert len(parsed.scenes) == 1
    assert parsed.scenes[0].slugline == "EXT. HOUSE - DAY"


def test_special_transitions_black_white():
    """Parser should handle BLACK., WHITE., etc. correctly."""
    fdx = """<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Version="12">
  <Content>
    <Body>
      <Paragraph Type="Scene Heading">
        <Text>INT. ROOM - DAY</Text>
      </Paragraph>
      <Paragraph Type="Action">
        <Text>Some action.</Text>
      </Paragraph>
      <Paragraph Type="Transition">
        <Text>FADE TO BLACK.</Text>
      </Paragraph>
      <Paragraph Type="Scene Heading">
        <Text>BLACK.</Text>
      </Paragraph>
    </Body>
  </Content>
</FinalDraft>"""
    
    parsed = FDXParser.parse_fdx_content(fdx, "black.fdx")
    
    # Should create 2 scenes
    assert len(parsed.scenes) == 2
    
    # Find BLACK. element
    black_elements = [e for e in parsed.elements if "BLACK" in e.text.upper()]
    assert len(black_elements) >= 1


def test_dialogue_without_character():
    """Parser should handle orphaned dialogue gracefully."""
    fdx = """<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Version="12">
  <Content>
    <Body>
      <Paragraph Type="Scene Heading">
        <Text>INT. ROOM - DAY</Text>
      </Paragraph>
      <Paragraph Type="Dialogue">
        <Text>Orphaned dialogue line.</Text>
      </Paragraph>
      <Paragraph Type="Character">
        <Text>JOHN</Text>
      </Paragraph>
      <Paragraph Type="Dialogue">
        <Text>Proper dialogue.</Text>
      </Paragraph>
    </Body>
  </Content>
</FinalDraft>"""
    
    parsed = FDXParser.parse_fdx_content(fdx, "orphan_dialogue.fdx")
    
    # Should parse without crashing
    assert len(parsed.scenes) == 1
    # Should have all elements
    assert len(parsed.elements) >= 3


def test_unicode_and_special_characters():
    """Parser should handle unicode and special characters correctly."""
    fdx = """<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Version="12">
  <Content>
    <Body>
      <Paragraph Type="Scene Heading">
        <Text>INT. CAFÉ — DAY</Text>
      </Paragraph>
      <Paragraph Type="Character">
        <Text>JOSÉ</Text>
      </Paragraph>
      <Paragraph Type="Dialogue">
        <Text>"Hello!" she said... ¿Cómo estás?</Text>
      </Paragraph>
    </Body>
  </Content>
</FinalDraft>"""
    
    parsed = FDXParser.parse_fdx_content(fdx, "unicode.fdx")
    
    # Should parse without crashing
    assert len(parsed.scenes) == 1
    # Character should be tracked
    assert "JOSÉ" in parsed.scenes[0].characters


def test_very_long_scene():
    """Parser should handle very long scenes without issues."""
    # Create a scene with 100 action lines
    actions = "\n".join([
        f'      <Paragraph Type="Action"><Text>Action line {i}.</Text></Paragraph>'
        for i in range(100)
    ])
    
    fdx = f"""<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Version="12">
  <Content>
    <Body>
      <Paragraph Type="Scene Heading">
        <Text>INT. ROOM - DAY</Text>
      </Paragraph>
{actions}
    </Body>
  </Content>
</FinalDraft>"""
    
    parsed = FDXParser.parse_fdx_content(fdx, "long_scene.fdx")
    
    assert len(parsed.scenes) == 1
    assert len(parsed.scenes[0].content_blocks) == 101  # 1 heading + 100 actions


def test_malformed_xml_raises_error():
    """Parser should raise ValueError for malformed XML."""
    malformed_fdx = """<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Version="12">
  <Content>
    <Body>
      <Paragraph Type="Scene Heading">
        <Text>INT. ROOM - DAY"""  # Missing closing tags
    
    with pytest.raises(ValueError, match="Invalid FDX format"):
        FDXParser.parse_fdx_content(malformed_fdx, "malformed.fdx")


def test_missing_content_section_raises_error():
    """Parser should raise ValueError if Content section is missing."""
    no_content_fdx = """<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Version="12">
  <SomeOtherSection>
  </SomeOtherSection>
</FinalDraft>"""
    
    with pytest.raises(ValueError, match="No Content section found"):
        FDXParser.parse_fdx_content(no_content_fdx, "no_content.fdx")


def test_empty_paragraphs_ignored():
    """Parser should ignore paragraphs with no text."""
    fdx = """<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Version="12">
  <Content>
    <Body>
      <Paragraph Type="Scene Heading">
        <Text>INT. ROOM - DAY</Text>
      </Paragraph>
      <Paragraph Type="Action">
        <Text></Text>
      </Paragraph>
      <Paragraph Type="Action">
        <Text>   </Text>
      </Paragraph>
      <Paragraph Type="Action">
        <Text>Real action.</Text>
      </Paragraph>
    </Body>
  </Content>
</FinalDraft>"""
    
    parsed = FDXParser.parse_fdx_content(fdx, "empty_paras.fdx")
    
    # Should only have 2 elements (heading + real action)
    assert len(parsed.elements) == 2
    assert parsed.elements[0].text == "INT. ROOM - DAY"
    assert parsed.elements[1].text == "Real action."
