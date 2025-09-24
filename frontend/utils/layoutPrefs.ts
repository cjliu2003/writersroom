/**
 * Editor Layout Preferences
 * Manages persistence of sidebar visibility states
 */

export interface EditorLayoutPrefs {
  sceneListVisible: boolean;
  assistantVisible: boolean;
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
    assistantVisible: true
  };
}

/**
 * Save layout preferences to localStorage
 */
export function saveLayoutPrefs(prefs: EditorLayoutPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.error('Error saving layout preferences:', error);
  }
}