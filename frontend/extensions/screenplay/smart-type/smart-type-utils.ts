/**
 * SmartType Utility Functions
 *
 * Extraction and filtering helpers for character names, locations, and scene heading prefixes.
 */

/**
 * Common character extensions to strip when extracting names
 */
const CHARACTER_EXTENSIONS = [
  "(V.O.)",
  "(O.S.)",
  "(O.C.)",
  "(CONT'D)",
  "(CONTINUED)",
  "(PRE-LAP)",
  "(FILTERED)",
  "(ON PHONE)",
  "(ON TV)",
  "(ON RADIO)",
  "(SUBTITLE)",
];

/**
 * Common time of day suffixes in scene headings
 * Exported for SmartType suggestions
 */
export const TIME_OF_DAY = [
  "DAY",
  "NIGHT",
  "MORNING",
  "AFTERNOON",
  "EVENING",
  "DUSK",
  "DAWN",
  "LATER",
  "CONTINUOUS",
  "SAME",
  "MOMENTS LATER",
  "SAME TIME",
];

/**
 * Scene heading prefixes for autocomplete
 */
export const SCENE_HEADING_PREFIXES = [
  "INT.",
  "EXT.",
  "INT./EXT.",
  "EXT./INT.",
  "I/E.",
];

/**
 * Extract character name from Character element text
 *
 * Examples:
 * - "JOHN" → "JOHN"
 * - "JOHN (V.O.)" → "JOHN"
 * - "MARY (CONT'D)" → "MARY"
 * - "DR. SMITH (O.S.)" → "DR. SMITH"
 *
 * @param text - Raw text content from Character node
 * @returns Extracted character name (uppercase) or null if invalid
 */
export function extractCharacterName(text: string): string | null {
  if (!text || text.trim().length === 0) {
    return null;
  }

  let name = text.trim().toUpperCase();

  // Remove any parenthetical extensions
  // Match pattern: NAME (EXTENSION) or NAME(EXTENSION)
  const parenMatch = name.match(/^([A-Z][A-Z0-9\s.\-']+?)(?:\s*\([^)]*\))*\s*$/);

  if (parenMatch) {
    name = parenMatch[1].trim();
  }

  // Validate: must start with letter, be at least 1 char
  if (!/^[A-Z]/.test(name) || name.length === 0) {
    return null;
  }

  // Filter out obvious non-names (numbers only, single punctuation, etc.)
  if (/^[0-9\s\-.']+$/.test(name)) {
    return null;
  }

  return name;
}

/**
 * Extract location from Scene Heading element text
 *
 * Examples:
 * - "INT. COFFEE SHOP - DAY" → "COFFEE SHOP"
 * - "EXT. BEACH - NIGHT" → "BEACH"
 * - "INT. COFFEE SHOP - BACK ROOM - DAY" → "COFFEE SHOP - BACK ROOM"
 * - "I/E. CAR - MOVING - DAY" → "CAR - MOVING"
 *
 * @param text - Raw text content from SceneHeading node
 * @returns Extracted location or null if invalid
 */
export function extractLocation(text: string): string | null {
  if (!text || text.trim().length === 0) {
    return null;
  }

  const upperText = text.trim().toUpperCase();

  // Match scene heading pattern: PREFIX. LOCATION - TIME
  // Prefix can be INT, EXT, INT./EXT., I/E, etc.
  const prefixPattern = /^(?:INT\.?\/?\s*EXT\.?|EXT\.?\/?\s*INT\.?|INT\.?|EXT\.?|I\/E\.?)\s+/i;
  const prefixMatch = upperText.match(prefixPattern);

  if (!prefixMatch) {
    return null;
  }

  // Get everything after the prefix
  let afterPrefix = upperText.slice(prefixMatch[0].length).trim();

  if (afterPrefix.length === 0) {
    return null;
  }

  // Strategy: Find the LAST dash in the string.
  // If what follows looks like a time (matches a known time OR is a partial match OR is a single word),
  // strip it. Otherwise keep it as part of the location.
  let location = afterPrefix;

  // First, try to match exact known times of day
  for (const time of TIME_OF_DAY) {
    const timePattern = new RegExp(`\\s*-\\s*${time}\\s*$`, 'i');
    if (timePattern.test(location)) {
      location = location.replace(timePattern, '').trim();
      break;
    }
  }

  // If no exact match, check for partial time matches (e.g., "- D", "- DA", "- NIG")
  // These are incomplete scene headings that shouldn't be stored as locations
  // Pattern: ends with " - " followed by letters that START a known time
  if (location === afterPrefix) {
    for (const time of TIME_OF_DAY) {
      // Check if the ending partial matches the beginning of a known time
      const partialPattern = new RegExp(`\\s-\\s*([A-Z]+)\\s*$`, 'i');
      const partialMatch = location.match(partialPattern);
      if (partialMatch) {
        const partial = partialMatch[1].toUpperCase();
        if (time.startsWith(partial) && partial.length < time.length) {
          // This is a partial time match - strip it
          location = location.replace(partialPattern, '').trim();
          break;
        }
      }
    }
  }

  // Clean up any trailing dash (from incomplete entries like "COFFEE SHOP - ")
  location = location.replace(/\s*-\s*$/, '').trim();

  if (location.length === 0) {
    return null;
  }

  return location;
}

/**
 * Check if text is a partial scene heading prefix
 * Used for INT./EXT. autocomplete
 *
 * @param text - Current text in scene heading or action
 * @returns Matching prefix suggestions
 */
export function getMatchingPrefixes(text: string): string[] {
  if (!text || text.trim().length === 0) {
    return SCENE_HEADING_PREFIXES;
  }

  const upperText = text.trim().toUpperCase();

  // Filter prefixes that start with the typed text
  return SCENE_HEADING_PREFIXES.filter(prefix =>
    prefix.startsWith(upperText) && prefix !== upperText
  );
}

/**
 * Check if scene heading has a complete prefix
 * SmartType for locations should only activate after prefix is complete
 *
 * @param text - Scene heading text
 * @returns True if prefix is complete (e.g., "INT. " or "EXT. ")
 */
export function hasCompletePrefix(text: string): boolean {
  if (!text) return false;

  // Use trimStart() not trim() - we need to preserve trailing space after period
  // to detect "INT. " vs "INT." (space after period means prefix is complete)
  const upperText = text.trimStart().toUpperCase();

  // Check for complete prefix with period and space
  // Matches: "INT. ", "EXT. ", "INT./EXT. ", "I/E. ", etc.
  return /^(?:INT\.?\/?\s*EXT\.?|EXT\.?\/?\s*INT\.?|INT\.?|EXT\.?|I\/E\.?)\.\s+/i.test(upperText) ||
         /^(?:INT|EXT|I\/E)\.\s/i.test(upperText);
}

/**
 * Get the location portion of a scene heading (after prefix)
 *
 * @param text - Full scene heading text
 * @returns Location portion or empty string
 */
export function getLocationPortion(text: string): string {
  if (!text) return '';

  const prefixPattern = /^(?:INT\.?\/?\s*EXT\.?|EXT\.?\/?\s*INT\.?|INT\.?|EXT\.?|I\/E\.?)\.\s*/i;
  const match = text.match(prefixPattern);

  if (!match) return '';

  return text.slice(match[0].length);
}

/**
 * Filter suggestions based on query
 * Case-insensitive prefix matching
 *
 * @param suggestions - Array of suggestions
 * @param query - Search query
 * @param maxResults - Maximum number of results (default 7)
 * @returns Filtered and sorted suggestions
 */
export function filterSuggestions(
  suggestions: string[],
  query: string,
  maxResults: number = 7
): string[] {
  if (!query || query.trim().length === 0) {
    // Return all suggestions (limited) when query is empty
    return suggestions.slice(0, maxResults);
  }

  const upperQuery = query.trim().toUpperCase();

  // Filter by prefix match
  const matches = suggestions.filter(s =>
    s.toUpperCase().startsWith(upperQuery)
  );

  // Sort: exact matches first, then alphabetically
  matches.sort((a, b) => {
    const aUpper = a.toUpperCase();
    const bUpper = b.toUpperCase();

    // Exact match comes first
    if (aUpper === upperQuery) return -1;
    if (bUpper === upperQuery) return 1;

    // Then alphabetical
    return aUpper.localeCompare(bUpper);
  });

  return matches.slice(0, maxResults);
}

/**
 * Format character name for insertion
 * Ensures proper uppercase formatting
 *
 * @param name - Character name
 * @returns Formatted name
 */
export function formatCharacterName(name: string): string {
  return name.trim().toUpperCase();
}

/**
 * Format location for insertion
 * Preserves original case as typed
 *
 * @param location - Location string
 * @returns Formatted location
 */
export function formatLocation(location: string): string {
  return location.trim().toUpperCase();
}

/**
 * Check if cursor is in time-of-day context within a scene heading
 * This means: prefix complete, location present, and after " - "
 *
 * @param text - Scene heading text
 * @returns True if in time-of-day context
 */
export function isInTimeContext(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim().toUpperCase();

  // Must have complete prefix, some location content, and end with " - " or " - PARTIAL"
  // Pattern: PREFIX. LOCATION - [PARTIAL_TIME]
  return /^(?:INT\.?\/?\s*EXT\.?|EXT\.?\/?\s*INT\.?|INT\.?|EXT\.?|I\/E\.?)\.\s+.+\s-\s*[A-Z]*$/i.test(trimmed);
}

/**
 * Get the time query portion after " - " in a scene heading
 *
 * @param text - Scene heading text
 * @returns Query string after dash, or empty string if not in time context
 */
export function getTimeQuery(text: string): string {
  if (!text) return '';

  // Find the last " - " and get everything after it
  const match = text.match(/-\s*([A-Z]*)$/i);
  return match ? match[1].toUpperCase() : '';
}

/**
 * Filter time-of-day suggestions based on query
 *
 * @param query - Search query (partial time like "D" or "DA")
 * @param maxResults - Maximum results to return
 * @returns Filtered time suggestions
 */
export function filterTimeSuggestions(query: string, maxResults: number = 7): string[] {
  if (!query || query.trim().length === 0) {
    return TIME_OF_DAY.slice(0, maxResults);
  }

  const upperQuery = query.trim().toUpperCase();

  return TIME_OF_DAY
    .filter(time => time.startsWith(upperQuery))
    .slice(0, maxResults);
}

/**
 * Check if a scene heading is complete (has prefix, location, and valid time)
 * Used to prevent SmartType from showing suggestions on already-complete headings
 *
 * @param text - Scene heading text
 * @returns True if scene heading has all components complete
 */
export function isCompleteSceneHeading(text: string): boolean {
  if (!text) return false;

  const trimmed = text.trim().toUpperCase();

  // Pattern: PREFIX. LOCATION - TIME
  // Where TIME must be an exact match from TIME_OF_DAY
  const pattern = /^(?:INT\.?\/?\s*EXT\.?|EXT\.?\/?\s*INT\.?|INT\.?|EXT\.?|I\/E\.?)\.\s+.+\s-\s+(.+)$/i;
  const match = trimmed.match(pattern);

  if (!match) return false;

  const timeCandidate = match[1].trim().toUpperCase();
  return TIME_OF_DAY.includes(timeCandidate);
}

/**
 * Get the ghost text (completion preview) for current suggestion
 * Returns the portion of the suggestion that would be inserted on Tab
 *
 * @param suggestion - The full suggestion text
 * @param query - Current query/typed text
 * @param type - Type of suggestion
 * @returns Ghost text to display, or empty string
 */
export function getGhostText(
  suggestion: string,
  query: string,
  type: 'character' | 'location' | 'prefix' | 'time' | null
): string {
  if (!suggestion || !type) return '';

  const upperSuggestion = suggestion.toUpperCase();
  const upperQuery = query.toUpperCase();

  // For all types, show the remaining portion of the suggestion
  if (upperSuggestion.startsWith(upperQuery)) {
    return suggestion.slice(query.length);
  }

  // If query doesn't match start (shouldn't happen), show full suggestion
  return suggestion;
}
