/**
 * Keyboard Navigation Utilities for Screenplay Extensions
 *
 * Implements Final Draft-style context-sensitive Tab navigation.
 * NOT a linear cycle - uses logical element pairs for natural writing flow.
 */

import { type ScreenplayElementType } from '../types';

/**
 * Get the next element type for Tab key (Final Draft style)
 *
 * Context-sensitive pairs:
 * - Action → Character (ready to write who speaks)
 * - Character (empty) → Transition (Final Draft behavior)
 * - Character (with text) → Parenthetical (add direction)
 * - Dialogue → Parenthetical (add wryly, beat, etc.)
 * - Parenthetical → Dialogue (back to speech)
 * - Transition → Scene Heading (start new scene)
 * - Scene Heading → Action (fallback after complete heading)
 *
 * @param currentType - Current screenplay element type
 * @param isEmpty - Whether the current block is empty (affects Character behavior)
 * @returns Next element type based on context
 */
export function getNextElementType(currentType: string, isEmpty: boolean = false): ScreenplayElementType {
  switch (currentType) {
    case 'action':
      return 'character';

    case 'character':
      // Empty character → Transition (Final Draft behavior)
      // Character with text → Parenthetical (add direction)
      return isEmpty ? 'transition' : 'parenthetical';

    case 'dialogue':
      return 'parenthetical';

    case 'parenthetical':
      return 'dialogue';

    case 'transition':
      return 'sceneHeading';

    case 'sceneHeading':
      return 'action';

    default:
      return 'action';
  }
}

/**
 * Get the previous element type for Shift+Tab key (Final Draft style)
 *
 * Reverse navigation:
 * - Character → Action
 * - Parenthetical → Character
 * - Dialogue → Character
 * - Scene Heading → Transition
 * - Action → Dialogue
 * - Transition → Action
 *
 * @param currentType - Current screenplay element type
 * @returns Previous element type based on context
 */
export function getPreviousElementType(currentType: string): ScreenplayElementType {
  switch (currentType) {
    case 'character':
      return 'action';

    case 'parenthetical':
      return 'character';

    case 'dialogue':
      return 'character';

    case 'sceneHeading':
      return 'transition';

    case 'action':
      return 'dialogue';

    case 'transition':
      return 'action';

    default:
      return 'action';
  }
}
