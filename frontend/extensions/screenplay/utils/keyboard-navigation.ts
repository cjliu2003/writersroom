/**
 * Keyboard Navigation Utilities for Screenplay Extensions
 */

import { ELEMENT_CYCLE, type ScreenplayElementType } from '../types';

/**
 * Get the next element type in the TAB cycle sequence
 *
 * @param currentType - Current screenplay element type
 * @returns Next element type in cycle
 */
export function getNextElementType(currentType: string): ScreenplayElementType {
  const currentIndex = ELEMENT_CYCLE.indexOf(currentType as ScreenplayElementType);

  // If current type not found, default to 'action'
  if (currentIndex === -1) {
    return 'action';
  }

  // Return next element in cycle (wraps around)
  return ELEMENT_CYCLE[(currentIndex + 1) % ELEMENT_CYCLE.length];
}

/**
 * Get the previous element type in the TAB cycle sequence (for Shift+Tab)
 *
 * @param currentType - Current screenplay element type
 * @returns Previous element type in cycle
 */
export function getPreviousElementType(currentType: string): ScreenplayElementType {
  const currentIndex = ELEMENT_CYCLE.indexOf(currentType as ScreenplayElementType);

  // If current type not found, default to 'action'
  if (currentIndex === -1) {
    return 'action';
  }

  // Return previous element in cycle (wraps around)
  const previousIndex = (currentIndex - 1 + ELEMENT_CYCLE.length) % ELEMENT_CYCLE.length;
  return ELEMENT_CYCLE[previousIndex];
}
