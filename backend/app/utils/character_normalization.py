"""
Character Normalization Utility

Normalizes character names by removing screenplay parentheticals like (O.S.), (V.O.), etc.
This is used for AI analytics and character tracking while preserving the original
content in screenplay content_blocks for display purposes.
"""

import re
from typing import List


# Parenthetical patterns to strip from character names
# These indicate delivery method, not different characters
PARENTHETICAL_PATTERNS = [
    r'\s*\(O\.S\.\)',      # Off-Screen
    r'\s*\(V\.O\.\)',      # Voice Over
    r'\s*\(CONT\'D\)',     # Continued
    r'\s*\(O\.C\.\)',      # Off-Camera
    r'\s*\(PRE-LAP\)',     # Pre-Lap
    r'\s*\(FILTERED\)',    # Filtered (phone, radio, etc.)
    r'\s*\([^)]*\)',       # Catch-all for any other parentheticals
]


def normalize_character_name(character_name: str) -> str:
    """
    Remove parentheticals from character names for tracking purposes.

    This function strips screenplay delivery indicators (parentheticals) from
    character names so that "SAM (O.S.)" and "SAM (V.O.)" are both tracked
    as "SAM" for analytics purposes.

    Examples:
        >>> normalize_character_name("SAM (O.S.)")
        'SAM'
        >>> normalize_character_name("JOHN (CONT'D)")
        'JOHN'
        >>> normalize_character_name("MARY (V.O.)")
        'MARY'
        >>> normalize_character_name("ALEX")
        'ALEX'

    Args:
        character_name: Original character name with possible parentheticals

    Returns:
        Normalized character name without parentheticals
    """
    if not character_name:
        return character_name

    normalized = character_name.strip()

    # Apply all parenthetical patterns
    for pattern in PARENTHETICAL_PATTERNS:
        normalized = re.sub(pattern, '', normalized, flags=re.IGNORECASE)

    # Clean up any trailing/leading whitespace
    normalized = normalized.strip()

    return normalized


def normalize_character_list(character_names: List[str]) -> List[str]:
    """
    Normalize a list of character names, removing duplicates after normalization.

    This function normalizes all character names in a list and removes duplicates
    that emerge after normalization (e.g., "SAM" and "SAM (O.S.)" both become "SAM").

    Examples:
        >>> normalize_character_list(["SAM", "SAM (O.S.)", "JOHN"])
        ['SAM', 'JOHN']
        >>> normalize_character_list(["MARY (V.O.)", "MARY", "ALEX (CONT'D)"])
        ['MARY', 'ALEX']

    Args:
        character_names: List of character names with possible parentheticals

    Returns:
        List of unique normalized character names, sorted alphabetically
    """
    if not character_names:
        return []

    # Normalize and deduplicate
    normalized = set()
    for name in character_names:
        norm = normalize_character_name(name)
        if norm:  # Only add non-empty names
            normalized.add(norm)

    # Return sorted list for consistency
    return sorted(list(normalized))
