/**
 * SmartType Module
 *
 * Exports all SmartType functionality for screenplay editor autocomplete.
 */

export { SmartTypeExtension, SmartTypePluginKey, getSmartTypeState } from './smart-type-extension';
export type { SmartTypeState, SmartTypeStorage, SmartTypeOptions } from './smart-type-extension';

export { SmartTypePopup } from './SmartTypePopup';

export {
  extractCharacterName,
  extractLocation,
  filterSuggestions,
  hasCompletePrefix,
  getLocationPortion,
  getMatchingPrefixes,
  formatCharacterName,
  formatLocation,
  isInTimeContext,
  getTimeQuery,
  filterTimeSuggestions,
  SCENE_HEADING_PREFIXES,
  TIME_OF_DAY,
} from './smart-type-utils';
