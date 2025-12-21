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
 *
 * Defines what element type to create when pressing Enter at the end of each element.
 * Matches Final Draft behavior for natural screenplay writing flow.
 */
export const SMART_ENTER_TRANSITIONS: ElementTransitionMap = {
  'sceneHeading': 'action',      // Scene heading → describe what happens
  'action': 'action',            // Action continues as action
  'character': 'dialogue',       // Character name → their words
  'dialogue': 'action',          // Dialogue ends → back to action
  'parenthetical': 'dialogue',   // Direction → back to speech
  'transition': 'sceneHeading',  // CUT TO: → next scene
};
