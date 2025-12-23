/**
 * Find/Replace Utility Functions
 *
 * Search algorithms for finding text matches across ProseMirror documents.
 * Supports all screenplay node types and case-insensitive matching.
 */

import { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * Represents a single match in the document
 */
export interface SearchMatch {
  /** Absolute position in document where match starts */
  from: number;
  /** Absolute position in document where match ends */
  to: number;
  /** The actual matched text (preserves original case) */
  text: string;
  /** The node type containing this match */
  nodeType: string;
}

/**
 * Search options
 */
export interface SearchOptions {
  /** Whether search is case-sensitive */
  caseSensitive: boolean;
}

/**
 * Default search options
 */
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
};

/**
 * Screenplay node types that should be searched
 */
const SEARCHABLE_NODE_TYPES = [
  'sceneHeading',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
  'paragraph', // Fallback for any standard paragraphs
];

/**
 * Find all matches of a query string in a ProseMirror document
 *
 * @param doc - ProseMirror document to search
 * @param query - Search query string
 * @param options - Search options (case sensitivity, etc.)
 * @returns Array of matches with positions
 */
export function findAllMatches(
  doc: ProseMirrorNode,
  query: string,
  options: SearchOptions = DEFAULT_SEARCH_OPTIONS
): SearchMatch[] {
  if (!query || query.length === 0) {
    return [];
  }

  const matches: SearchMatch[] = [];
  const searchQuery = options.caseSensitive ? query : query.toLowerCase();

  // Traverse the document and find matches in text nodes
  doc.descendants((node, pos) => {
    // Only search in block-level screenplay elements
    if (!SEARCHABLE_NODE_TYPES.includes(node.type.name)) {
      return true; // Continue traversing
    }

    // Get the text content of this node
    const nodeText = node.textContent;
    if (!nodeText) {
      return true;
    }

    const searchText = options.caseSensitive ? nodeText : nodeText.toLowerCase();

    // Find all occurrences in this node's text
    let searchStart = 0;
    let index: number;

    while ((index = searchText.indexOf(searchQuery, searchStart)) !== -1) {
      // Calculate the absolute position in the document
      // pos is the position before the node, +1 for opening tag
      const absoluteFrom = pos + 1 + index;
      const absoluteTo = absoluteFrom + query.length;

      matches.push({
        from: absoluteFrom,
        to: absoluteTo,
        text: nodeText.slice(index, index + query.length),
        nodeType: node.type.name,
      });

      searchStart = index + 1; // Move past this match to find overlapping matches
    }

    return true; // Continue traversing
  });

  return matches;
}

/**
 * Get the next match index, wrapping around if necessary
 *
 * @param currentIndex - Current match index (-1 if no current match)
 * @param totalMatches - Total number of matches
 * @param direction - 1 for next, -1 for previous
 * @returns New match index
 */
export function getNextMatchIndex(
  currentIndex: number,
  totalMatches: number,
  direction: 1 | -1 = 1
): number {
  if (totalMatches === 0) {
    return -1;
  }

  if (currentIndex === -1) {
    return direction === 1 ? 0 : totalMatches - 1;
  }

  let newIndex = currentIndex + direction;

  // Wrap around
  if (newIndex >= totalMatches) {
    newIndex = 0;
  } else if (newIndex < 0) {
    newIndex = totalMatches - 1;
  }

  return newIndex;
}

/**
 * Find the match index closest to a given position
 *
 * @param matches - Array of matches
 * @param position - Document position to find closest match to
 * @returns Index of closest match, or -1 if no matches
 */
export function findClosestMatchIndex(
  matches: SearchMatch[],
  position: number
): number {
  if (matches.length === 0) {
    return -1;
  }

  // Find the first match that starts at or after the position
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].from >= position) {
      return i;
    }
  }

  // If no match found after position, return the first match (wrap around)
  return 0;
}

/**
 * Escape special regex characters in a string
 * (For future regex support)
 *
 * @param str - String to escape
 * @returns Escaped string safe for regex
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
