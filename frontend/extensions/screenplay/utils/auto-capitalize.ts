/**
 * Auto-Capitalization Input Rules
 *
 * Provides automatic capitalization for screenplay elements that use normal case:
 * - Action
 * - Dialogue
 * - Parenthetical
 *
 * Does NOT apply to all-caps elements (Scene Heading, Character, Transition)
 *
 * Capitalization triggers:
 * 1. First character of a new/empty block
 * 2. First character after sentence-ending punctuation (. ! ?)
 */

import { InputRule } from '@tiptap/core';

/**
 * Creates input rules for auto-capitalization
 * @returns Array of InputRule instances
 */
export function createAutoCapitalizeRules(): InputRule[] {
  return [
    // Rule 1: Capitalize first letter at start of block
    // Matches: lowercase letter at the very beginning of content
    new InputRule({
      find: /^([a-z])$/,
      handler: ({ state, range, match, chain }) => {
        const char = match[1];
        const upperChar = char.toUpperCase();

        // Only transform if it would actually change something
        if (char !== upperChar) {
          chain().insertContentAt(range, upperChar).run();
        }
      },
    }),

    // Rule 2: Capitalize after sentence-ending punctuation
    // Matches: . or ! or ? followed by space(s) and a lowercase letter
    new InputRule({
      find: /([.!?]\s+)([a-z])$/,
      handler: ({ state, range, match, chain }) => {
        const punctuationAndSpace = match[1];
        const char = match[2];
        const upperChar = char.toUpperCase();

        // Only transform if it would actually change something
        if (char !== upperChar) {
          const replacement = punctuationAndSpace + upperChar;
          chain().insertContentAt(range, replacement).run();
        }
      },
    }),
  ];
}
