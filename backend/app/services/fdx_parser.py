"""
FDX Parser Service

Provides functions for parsing FDX files into database models.
Converted from the frontend TypeScript implementation.
"""

import xml.etree.ElementTree as ET
import re
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from enum import Enum

from app.utils.character_normalization import normalize_character_name


class ScreenplayBlockType(str, Enum):
    SCENE_HEADING = "scene_heading"
    ACTION = "action"
    CHARACTER = "character"
    PARENTHETICAL = "parenthetical"
    DIALOGUE = "dialogue"
    TRANSITION = "transition"
    SHOT = "shot"
    GENERAL = "general"
    CAST_LIST = "cast_list"
    NEW_ACT = "new_act"
    END_OF_ACT = "end_of_act"
    SUMMARY = "summary"


@dataclass
class ScreenplayElement:
    type: ScreenplayBlockType
    text: str
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class SceneData:
    slugline: str
    summary: str
    tokens: int
    characters: List[str]
    themes: List[str]
    word_count: int
    full_content: str
    content_blocks: List[ScreenplayElement]


@dataclass
class ParsedFDXResult:
    elements: List[ScreenplayElement]
    title: str
    scenes: List[SceneData]


class FDXParser:
    """FDX file parser that converts XML to screenplay elements and scene data."""
    
    # Transition patterns (converted from TypeScript regex)
    TRANSITION_PATTERNS = [
        re.compile(r'^(FADE IN|FADE OUT|FADE TO BLACK|SMASH CUT TO|CUT TO|MATCH CUT TO|JUMP CUT TO|DISSOLVE TO|FLASH TO|FLASH CUT TO|FREEZE FRAME|TIME CUT|MONTAGE|END MONTAGE|SPLIT SCREEN|IRIS IN|IRIS OUT|WIPE TO|FLIP TO)[\.\:\;]?$', re.IGNORECASE),
        re.compile(r'^(FADE IN\:|FADE OUT\.|CUT TO\:|DISSOLVE TO\:|FLASH TO\:)$', re.IGNORECASE),
        re.compile(r'^(LATER|CONTINUOUS|MEANWHILE|SIMULTANEOUSLY)$', re.IGNORECASE),
        re.compile(r'^(THE END|END OF FILM|END OF EPISODE|ROLL CREDITS)$', re.IGNORECASE),
        re.compile(r'^(BLACK\.|WHITE\.|DARKNESS\.|SILENCE\.)$', re.IGNORECASE)
    ]
    
    @classmethod
    def parse_fdx_content(cls, fdx_content: str, filename: Optional[str] = None) -> ParsedFDXResult:
        """Parse FDX content string into screenplay elements and scene data."""
        elements: List[ScreenplayElement] = []
        title = "Untitled Script"
        
        # Extract title from filename or XML
        if filename:
            title = filename.replace('.fdx', '').replace('.FDX', '').strip()
        else:
            title_match = re.search(r'<Title>(.*?)</Title>', fdx_content, re.IGNORECASE)
            if title_match:
                title = title_match.group(1).strip()
        
        try:
            # Parse XML
            root = ET.fromstring(fdx_content)
            
            # Find Content section
            content = root.find('.//Content')
            if content is None:
                raise ValueError("No Content section found in FDX file")
            
            # Handle both Content > Body > Paragraph and Content > Paragraph
            body = content.find('Body')
            if body is not None:
                paragraphs = body.findall('Paragraph')
            else:
                paragraphs = content.findall('Paragraph')
            
            # Process each paragraph
            for paragraph in paragraphs:
                element = cls._parse_paragraph(paragraph)
                if element:
                    elements.append(element)
                    
        except ET.ParseError as e:
            raise ValueError(f"Invalid FDX format: {str(e)}")
        
        # Generate scene data from elements
        scenes = cls._hydrate_memory_from_elements(elements)
        
        return ParsedFDXResult(elements=elements, title=title, scenes=scenes)
    
    @classmethod
    def _parse_paragraph(cls, paragraph: ET.Element) -> Optional[ScreenplayElement]:
        """Parse a single FDX paragraph into a screenplay element."""
        # Get paragraph type directly from the attribute
        xml_type = paragraph.get('Type', 'Action')
        
        # Extract text content
        text = cls._extract_text_content(paragraph)
        if not text.strip():
            return None
            
        # Direct handling for Scene Heading elements - CRITICAL FIX
        if xml_type == 'Scene Heading':
            return ScreenplayElement(
                type=ScreenplayBlockType.SCENE_HEADING,
                text=text.upper()
            )
        
        # Classify other element types
        element_data = cls._classify_element(xml_type, text)
        if not element_data:
            return None
        
        return ScreenplayElement(
            type=ScreenplayBlockType(element_data['type']),
            text=element_data['text']
        )
    
    @classmethod
    def _extract_text_content(cls, paragraph: ET.Element) -> str:
        """Extract text content from paragraph element.
        
        CRITICAL: FDX files can have multiple <Text> elements in a single paragraph,
        often used for formatting (e.g., <Text AdornmentStyle="-1"> for bold/italic).
        We must concatenate ALL <Text> elements to avoid losing content.
        """
        # Find ALL <Text> elements within the paragraph
        text_elements = paragraph.findall('Text')
        if not text_elements:
            return ""
        
        # Concatenate text from all <Text> elements
        text_parts = []
        for text_elem in text_elements:
            # Get the direct text content of this <Text> element
            if text_elem.text:
                text_parts.append(text_elem.text)
            
            # Get text from any nested elements and their tails
            for child in text_elem:
                if child.text:
                    text_parts.append(child.text)
                if child.tail:
                    text_parts.append(child.tail)
        
        # Join and normalize whitespace
        full_text = ''.join(text_parts)
        # Normalize multiple spaces to single space
        full_text = re.sub(r'\s+', ' ', full_text)
        return full_text.strip()
    
    @classmethod
    def _classify_element(cls, xml_type: str, text: str) -> Optional[Dict[str, str]]:
        """Classify element based on XML type and content."""
        # Check for transitions regardless of XML type
        for pattern in cls.TRANSITION_PATTERNS:
            if pattern.match(text):
                # Strip formatting characters (colon, period) - CSS will add them back
                formatted_text = text.upper().rstrip('.:').strip()
                return {'type': 'transition', 'text': formatted_text}
        
        # Handle Scene Headings
        if xml_type == 'Scene Heading':
            # Special case for BLACK., WHITE., etc. when explicitly marked as scene heading
            if re.match(r'^(BLACK|WHITE|DARKNESS|SILENCE)\.?$', text, re.IGNORECASE):
                formatted_text = text.upper()
                if not formatted_text.endswith('.'):
                    formatted_text += '.'
                return {'type': 'scene_heading', 'text': formatted_text}
            
            # Reject incomplete sluglines
            if re.match(r'^(INT|EXT|INTERIOR|EXTERIOR)\.?$', text, re.IGNORECASE):
                return None
            
            # Reject single words that aren't valid locations
            if re.match(r'^[A-Z]+\.?$', text) and not re.match(r'^(BLACK|WHITE|DARKNESS|SILENCE)\.?$', text, re.IGNORECASE):
                return None
            
            # Valid scene heading must have location info
            if not re.match(r'^(INT|EXT|INTERIOR|EXTERIOR)[\.\s]+.+', text, re.IGNORECASE):
                return None
            
            return {'type': 'scene_heading', 'text': text}
        
        # Handle other element types (using the exact types from FDX)
        type_mapping = {
            # Standard FDX types (using their exact names)
            'Action': {'type': 'action', 'text': text},
            'Character': {'type': 'character', 'text': text.upper()},
            'Dialogue': {'type': 'dialogue', 'text': text},
            'Parenthetical': {
                'type': 'parenthetical',
                # Strip parentheses - CSS will add them back via ::before and ::after
                'text': text.strip('()').strip()
            },
            'Transition': {
                'type': 'transition',
                # Strip colon/period - CSS will add colon back via ::after
                'text': text.upper().rstrip('.:').strip()
            },
            'Scene Heading': {'type': 'scene_heading', 'text': text.upper()},
            'Shot': {'type': 'shot', 'text': text},
            'Cast List': {'type': 'cast_list', 'text': text},
            'General': {'type': 'general', 'text': text},
            'Note': {'type': 'note', 'text': text},
            'Act Break': {'type': 'new_act', 'text': text},
            'End of Act': {'type': 'end_of_act', 'text': text},
        }
        
        if xml_type in type_mapping:
            return type_mapping[xml_type]
        
        # Default case
        element_type = xml_type.lower().replace(' ', '_')
        return {'type': element_type, 'text': text}
    
    @classmethod
    def _hydrate_memory_from_elements(cls, elements: List[ScreenplayElement]) -> List[SceneData]:
        """Generate scene data from screenplay elements."""
        scenes: List[SceneData] = []
        current_scene: Optional[SceneData] = None
        current_content: List[str] = []
        current_characters: set = set()
        current_elements: List[ScreenplayElement] = []
        scene_heading_count = 0
        
        for i, element in enumerate(elements):
            # Scene heading can be either 'scene_heading' or stored as the enum value
            is_scene_heading = element.type == ScreenplayBlockType.SCENE_HEADING or element.type.value == 'scene_heading'
            
            if is_scene_heading:
                scene_heading_count += 1
                
                # Important fix: Always save previous scene, even if it only had a scene heading
                # This ensures we don't miss scenes when there are adjacent scene headings
                if current_scene is not None:  # Changed from 'if current_scene:'
                    current_scene.summary = cls._generate_summary(current_content) if current_content else "Empty scene"
                    current_scene.tokens = cls._estimate_tokens(' '.join(current_content)) if current_content else 0
                    current_scene.word_count = cls._count_words(' '.join(current_content)) if current_content else 0
                    current_scene.characters = list(current_characters)
                    current_scene.themes = cls._extract_themes(current_content) if current_content else []
                    current_scene.full_content = '\n'.join(current_content) if current_content else element.text
                    current_scene.content_blocks = current_elements.copy()
                    scenes.append(current_scene)
                
                # Start new scene
                current_scene = SceneData(
                    slugline=element.text,
                    summary="",
                    tokens=0,
                    characters=[],
                    themes=[],
                    word_count=0,
                    full_content="",
                    content_blocks=[]
                )
                current_content = [element.text]
                current_characters = set()
                current_elements = [element]
                
            elif current_scene:
                # Add content to current scene
                current_content.append(element.text)
                current_elements.append(element)

                # Track characters (normalize to remove parentheticals like (O.S.), (V.O.), etc.)
                if element.type == ScreenplayBlockType.CHARACTER:
                    normalized_name = normalize_character_name(element.text)
                    current_characters.add(normalized_name)
        
        # Save last scene
        if current_scene:
            current_scene.summary = cls._generate_summary(current_content)
            current_scene.tokens = cls._estimate_tokens(' '.join(current_content))
            current_scene.word_count = cls._count_words(' '.join(current_content))
            current_scene.characters = list(current_characters)
            current_scene.themes = cls._extract_themes(current_content)
            current_scene.full_content = '\n'.join(current_content)
            current_scene.content_blocks = current_elements.copy()
            scenes.append(current_scene)
        
        return scenes
    
    @classmethod
    def _generate_summary(cls, content: List[str]) -> str:
        """Generate a summary from scene content."""
        if not content:
            return "Empty scene"
        
        # Take first few lines of action/dialogue for summary
        meaningful = [line.strip() for line in content[1:4] if line.strip()]
        if not meaningful:
            return "Scene with minimal content"
        
        summary = ' '.join(meaningful)
        return summary[:150] + ('...' if len(summary) > 150 else '')
    
    @classmethod
    def _estimate_tokens(cls, text: str) -> int:
        """Estimate token count for content."""
        # Rough estimate: 1 token per 4 characters
        return max(1, len(text) // 4)
    
    @classmethod
    def _count_words(cls, text: str) -> int:
        """Count words in text."""
        return len(text.split())
    
    @classmethod
    def _extract_themes(cls, content: List[str]) -> List[str]:
        """Extract themes from content."""
        themes = []
        text = ' '.join(content).lower()
        
        # Simple theme detection
        theme_keywords = {
            'romance': ['love', 'kiss', 'heart', 'romantic', 'romance'],
            'action': ['fight', 'gun', 'kill', 'battle', 'explosion'],
            'suspense': ['dark', 'night', 'shadow', 'mysterious', 'tension'],
            'comedy': ['laugh', 'joke', 'funny', 'humor', 'comic'],
            'drama': ['cry', 'tears', 'emotional', 'dramatic', 'intense'],
            'thriller': ['chase', 'danger', 'threat', 'escape', 'pursuit']
        }
        
        for theme, keywords in theme_keywords.items():
            if any(keyword in text for keyword in keywords):
                themes.append(theme)
        
        return themes


# Convenience functions for backward compatibility
def parse_fdx_content(fdx_content: str, filename: Optional[str] = None) -> ParsedFDXResult:
    """Parse FDX content string into screenplay elements and scene data."""
    return FDXParser.parse_fdx_content(fdx_content, filename)


def parse_uploaded_file(file_content: str, filename: str) -> ParsedFDXResult:
    """Parse an uploaded FDX file content."""
    return FDXParser.parse_fdx_content(file_content, filename)
