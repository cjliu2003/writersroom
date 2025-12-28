/**
 * Editor Layout Preferences
 * Manages persistence of sidebar visibility states
 */

/** Position where the AI chat panel is docked */
export type ChatPosition = 'bottom' | 'left' | 'right';

export interface EditorLayoutPrefs {
  sceneListVisible?: boolean;  // Deprecated: scene sidebar removed in favor of nav bar
  assistantVisible: boolean;
  chatCollapsed?: boolean;     // Whether chat panel is collapsed to minimal state
  chatHeight?: number;         // Height of chat panel in pixels when docked at bottom (default: 220)
  chatPosition?: ChatPosition; // Which edge the chat is docked to (default: 'right')
  chatWidth?: number;          // Width of chat panel in pixels when docked left/right (default: 360)
  chatBottomWidth?: number;    // Width of chat panel in pixels when docked at bottom (default: 1200)
}

const STORAGE_KEY = 'editorLayoutPrefs';

/**
 * Load layout preferences from localStorage
 * Returns default values if no preferences are stored
 */
export function loadLayoutPrefs(): EditorLayoutPrefs {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Error loading layout preferences:', error);
  }

  // Return defaults if nothing stored or error occurred
  return {
    sceneListVisible: true,
    assistantVisible: true,
    chatCollapsed: false,
    chatHeight: 220,
    chatPosition: 'right',
    chatWidth: 360,
    chatBottomWidth: 1200
  };
}

/**
 * Save layout preferences to localStorage
 * Merges with existing preferences to support partial updates
 */
export function saveLayoutPrefs(prefs: Partial<EditorLayoutPrefs>): void {
  try {
    const existing = loadLayoutPrefs();
    const merged = { ...existing, ...prefs };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch (error) {
    console.error('Error saving layout preferences:', error);
  }
}