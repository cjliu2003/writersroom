"""
Shared test utilities for FDX parser testing.
"""
from __future__ import annotations

from pathlib import Path
import json
import re
import xml.etree.ElementTree as ET
from typing import Any, Dict, List


def read_text(path: Path) -> str:
    """Read text file with UTF-8 encoding."""
    return path.read_text(encoding="utf-8")


def read_json_any(path: Path) -> Any:
    """Read and parse JSON file."""
    text = read_text(path)
    return json.loads(text)


def normalize_ws(s: str) -> str:
    """Normalize whitespace and special characters."""
    # Normalize fancy quotes/dashes
    s = s.replace("\u2019", "'").replace("\u2018", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u2013", "-").replace("\u2014", "—")
    s = s.replace("\xa0", " ")
    # Remove stray FinalDraft soft hyphen or oddities
    s = s.replace("\u00AD", "")
    # Collapse whitespace
    return " ".join(s.split()).strip()


def normalize_scene_heading(text: str) -> str:
    """Normalize scene headings for comparison."""
    t = normalize_ws(text).upper()
    # Ensure typical prefixes are standardized
    t = re.sub(r"^(INTERIOR)\b", "INT", t, flags=re.I)
    t = re.sub(r"^(EXTERIOR)\b", "EXT", t, flags=re.I)
    return t


def normalize_parenthetical(text: str) -> str:
    """Normalize parentheticals to ensure proper wrapping."""
    t = normalize_ws(text)
    if not (t.startswith("(") and t.endswith(")")):
        t = f"({t.strip('()')})"
    return t


def normalize_transition(text: str) -> str:
    """Normalize transitions to ensure proper formatting."""
    t = normalize_ws(text).upper()
    # For general transitions, ensure trailing colon
    if re.match(r"^(FADE IN|FADE OUT|CUT TO|DISSOLVE TO|FLASH TO|MATCH CUT TO|SMASH CUT TO|WIPE TO|IRIS IN|IRIS OUT|TIME CUT|MONTAGE|END MONTAGE|SPLIT SCREEN|FREEZE FRAME)\b", t):
        if not t.endswith(":"):
            t = t + ":"
        return t
    # Special words like BLACK. WHITE., etc.
    if re.match(r"^(BLACK|WHITE|DARKNESS|SILENCE)\.?$", t):
        if not t.endswith("."):
            t = t + "."
        return t
    # Fallback: ensure a colon
    if not t.endswith(":") and not t.endswith("."):
        t = t + ":"
    return t


def normalize_block_text(block_type: str, text: str) -> str:
    """Normalize text based on block type."""
    bt = block_type.lower()
    if bt == "scene_heading":
        return normalize_scene_heading(text)
    if bt == "character":
        return normalize_ws(text).upper()
    if bt == "parenthetical":
        return normalize_parenthetical(text)
    if bt == "transition":
        return normalize_transition(text)
    # Default: action/dialogue/general
    return normalize_ws(text)


def join_blocks_text(blocks: List[Dict[str, Any]]) -> str:
    """Produce a comparable single text body from blocks."""
    return "\n".join(
        normalize_block_text(b.get("type", ""), b.get("text", "")) 
        for b in blocks
    )


def count_xml_elements(fdx_content: str) -> Dict[str, int]:
    """
    Count all paragraph elements in FDX XML by type.
    This is critical for detecting content loss.
    """
    try:
        root = ET.fromstring(fdx_content)
    except ET.ParseError:
        return {}
    
    counts = {}
    
    # Find Content section
    content = root.find('.//Content')
    if content is None:
        return counts
    
    # Handle both Content > Body > Paragraph and Content > Paragraph
    body = content.find('Body')
    if body is not None:
        paragraphs = body.findall('Paragraph')
    else:
        paragraphs = content.findall('Paragraph')
    
    for p in paragraphs:
        # Get type
        p_type = p.get('Type', 'Action')
        
        # Extract text to ensure it's not empty
        text_elem = p.find('Text')
        if text_elem is not None:
            text = ET.tostring(text_elem, encoding='unicode', method='text').strip()
            if text:  # Only count non-empty paragraphs
                counts[p_type] = counts.get(p_type, 0) + 1
    
    return counts


def extract_all_text_from_xml(fdx_content: str) -> str:
    """
    Extract ALL text content from FDX for content preservation verification.
    Returns a normalized string of all text that should appear in parsed output.
    """
    try:
        root = ET.fromstring(fdx_content)
    except ET.ParseError:
        return ""
    
    all_text = []
    
    # Find Content section
    content = root.find('.//Content')
    if content is None:
        return ""
    
    # Handle both Content > Body > Paragraph and Content > Paragraph
    body = content.find('Body')
    if body is not None:
        paragraphs = body.findall('Paragraph')
    else:
        paragraphs = content.findall('Paragraph')
    
    for p in paragraphs:
        text_elem = p.find('Text')
        if text_elem is not None:
            # Get all text including nested elements
            text = ET.tostring(text_elem, encoding='unicode', method='text').strip()
            if text:
                all_text.append(normalize_ws(text))
    
    return "\n".join(all_text)
