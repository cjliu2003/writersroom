/**
 * Shared TypeScript types for Screenplay extensions
 */

/**
 * Screenplay element types
 */
export type ScreenplayElementType =
  | 'action'
  | 'sceneHeading'
  | 'character'
  | 'dialogue'
  | 'parenthetical'
  | 'transition';

/**
 * Map of element types to their transition targets (for Smart Enter)
 */
export interface ElementTransitionMap {
  [key: string]: string;
}

/**
 * Keyboard navigation cycle sequence
 */
export const ELEMENT_CYCLE: ScreenplayElementType[] = [
  'action',
  'sceneHeading',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
];

/**
 * Smart Enter transition map
 */
export const SMART_ENTER_TRANSITIONS: ElementTransitionMap = {
  'sceneHeading': 'action',
  'character': 'dialogue',
  'parenthetical': 'dialogue',
  'transition': 'sceneHeading',
  // 'action' and 'dialogue' use default Enter behavior
};
