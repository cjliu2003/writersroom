/**
 * Find/Replace ProseMirror Plugin
 *
 * Manages search state and decorations for highlighting matches in the editor.
 * Provides actions for navigating between matches and performing replacements.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  findAllMatches,
  getNextMatchIndex,
  findClosestMatchIndex,
  SearchMatch,
  SearchOptions,
  DEFAULT_SEARCH_OPTIONS,
} from './find-replace-utils';

/**
 * Plugin state for Find/Replace
 */
export interface FindReplaceState {
  /** Whether the find panel is open */
  isOpen: boolean;
  /** Whether replace mode is active */
  replaceMode: boolean;
  /** Current search query */
  query: string;
  /** Replacement text */
  replaceText: string;
  /** All matches found in document */
  matches: SearchMatch[];
  /** Currently highlighted match index (-1 if none) */
  currentIndex: number;
  /** Search options */
  options: SearchOptions;
  /** Decoration set for highlighting */
  decorations: DecorationSet;
}

/**
 * Initial plugin state
 */
const INITIAL_STATE: Omit<FindReplaceState, 'decorations'> = {
  isOpen: false,
  replaceMode: false,
  query: '',
  replaceText: '',
  matches: [],
  currentIndex: -1,
  options: DEFAULT_SEARCH_OPTIONS,
};

/**
 * Plugin key for accessing Find/Replace state
 */
export const FindReplacePluginKey = new PluginKey<FindReplaceState>('findReplace');

/**
 * Meta actions for the plugin
 */
export type FindReplaceAction =
  | { type: 'open'; replaceMode?: boolean }
  | { type: 'close' }
  | { type: 'setQuery'; query: string }
  | { type: 'setReplaceText'; replaceText: string }
  | { type: 'toggleReplaceMode' }
  | { type: 'toggleCaseSensitive' }
  | { type: 'nextMatch' }
  | { type: 'previousMatch' }
  | { type: 'goToMatch'; index: number }
  | { type: 'replace' }
  | { type: 'replaceAll' }
  | { type: 'refresh' }; // Re-search after document changes

/**
 * CSS class names for decorations
 */
const MATCH_CLASS = 'find-match';
const CURRENT_MATCH_CLASS = 'find-current-match';

/**
 * Create decorations for all matches
 */
function createDecorations(
  doc: any,
  matches: SearchMatch[],
  currentIndex: number
): DecorationSet {
  if (matches.length === 0) {
    return DecorationSet.empty;
  }

  const decorations = matches.map((match, index) => {
    const className = index === currentIndex ? CURRENT_MATCH_CLASS : MATCH_CLASS;
    return Decoration.inline(match.from, match.to, {
      class: className,
    });
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * Create the Find/Replace ProseMirror plugin
 */
export function createFindReplacePlugin(): Plugin<FindReplaceState> {
  return new Plugin<FindReplaceState>({
    key: FindReplacePluginKey,

    state: {
      init(_, state): FindReplaceState {
        return {
          ...INITIAL_STATE,
          decorations: DecorationSet.empty,
        };
      },

      apply(tr, prev, oldState, newState): FindReplaceState {
        // Check for meta actions
        const action = tr.getMeta(FindReplacePluginKey) as FindReplaceAction | undefined;

        // If document changed, remap decorations and refresh matches
        let { matches, currentIndex, decorations } = prev;
        let needsRefresh = false;

        if (tr.docChanged) {
          // Remap decorations for document changes
          decorations = decorations.map(tr.mapping, tr.doc);
          needsRefresh = prev.query.length > 0;
        }

        if (!action && !needsRefresh) {
          return { ...prev, decorations };
        }

        // Handle refresh (document changed while searching)
        if (needsRefresh && !action) {
          matches = findAllMatches(newState.doc, prev.query, prev.options);
          // Try to keep the current match position
          if (matches.length === 0) {
            currentIndex = -1;
          } else if (currentIndex >= matches.length) {
            currentIndex = matches.length - 1;
          }
          decorations = createDecorations(newState.doc, matches, currentIndex);
          return { ...prev, matches, currentIndex, decorations };
        }

        if (!action) {
          return { ...prev, decorations };
        }

        // Handle actions
        switch (action.type) {
          case 'open': {
            const replaceMode = action.replaceMode ?? prev.replaceMode;
            // If already open and has query, refresh matches
            if (prev.isOpen && prev.query) {
              matches = findAllMatches(newState.doc, prev.query, prev.options);
              currentIndex = findClosestMatchIndex(matches, newState.selection.from);
              decorations = createDecorations(newState.doc, matches, currentIndex);
            }
            return {
              ...prev,
              isOpen: true,
              replaceMode,
              matches,
              currentIndex,
              decorations,
            };
          }

          case 'close': {
            return {
              ...INITIAL_STATE,
              decorations: DecorationSet.empty,
            };
          }

          case 'setQuery': {
            const query = action.query;
            matches = findAllMatches(newState.doc, query, prev.options);
            // Find match closest to cursor
            currentIndex = findClosestMatchIndex(matches, newState.selection.from);
            decorations = createDecorations(newState.doc, matches, currentIndex);
            return {
              ...prev,
              query,
              matches,
              currentIndex,
              decorations,
            };
          }

          case 'setReplaceText': {
            return {
              ...prev,
              replaceText: action.replaceText,
            };
          }

          case 'toggleReplaceMode': {
            return {
              ...prev,
              replaceMode: !prev.replaceMode,
            };
          }

          case 'toggleCaseSensitive': {
            const newOptions = {
              ...prev.options,
              caseSensitive: !prev.options.caseSensitive,
            };
            matches = findAllMatches(newState.doc, prev.query, newOptions);
            currentIndex = findClosestMatchIndex(matches, newState.selection.from);
            decorations = createDecorations(newState.doc, matches, currentIndex);
            return {
              ...prev,
              options: newOptions,
              matches,
              currentIndex,
              decorations,
            };
          }

          case 'nextMatch': {
            if (prev.matches.length === 0) {
              return prev;
            }
            currentIndex = getNextMatchIndex(prev.currentIndex, prev.matches.length, 1);
            decorations = createDecorations(newState.doc, prev.matches, currentIndex);
            return {
              ...prev,
              currentIndex,
              decorations,
            };
          }

          case 'previousMatch': {
            if (prev.matches.length === 0) {
              return prev;
            }
            currentIndex = getNextMatchIndex(prev.currentIndex, prev.matches.length, -1);
            decorations = createDecorations(newState.doc, prev.matches, currentIndex);
            return {
              ...prev,
              currentIndex,
              decorations,
            };
          }

          case 'goToMatch': {
            if (action.index < 0 || action.index >= prev.matches.length) {
              return prev;
            }
            currentIndex = action.index;
            decorations = createDecorations(newState.doc, prev.matches, currentIndex);
            return {
              ...prev,
              currentIndex,
              decorations,
            };
          }

          case 'replace': {
            // Replace is handled by the extension command, this just refreshes state
            matches = findAllMatches(newState.doc, prev.query, prev.options);
            // Adjust current index after replacement
            if (matches.length === 0) {
              currentIndex = -1;
            } else if (prev.currentIndex >= matches.length) {
              currentIndex = 0; // Wrap to start
            } else {
              currentIndex = prev.currentIndex; // Stay at same index (next match)
            }
            decorations = createDecorations(newState.doc, matches, currentIndex);
            return {
              ...prev,
              matches,
              currentIndex,
              decorations,
            };
          }

          case 'replaceAll': {
            // After replace all, no matches remain
            return {
              ...prev,
              matches: [],
              currentIndex: -1,
              decorations: DecorationSet.empty,
            };
          }

          case 'refresh': {
            matches = findAllMatches(newState.doc, prev.query, prev.options);
            currentIndex = findClosestMatchIndex(matches, newState.selection.from);
            decorations = createDecorations(newState.doc, matches, currentIndex);
            return {
              ...prev,
              matches,
              currentIndex,
              decorations,
            };
          }

          default:
            return prev;
        }
      },
    },

    props: {
      decorations(state) {
        const pluginState = FindReplacePluginKey.getState(state);
        return pluginState?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

/**
 * Helper to dispatch a Find/Replace action
 */
export function dispatchFindReplaceAction(
  view: any,
  action: FindReplaceAction
): void {
  const tr = view.state.tr.setMeta(FindReplacePluginKey, action);
  view.dispatch(tr);
}

/**
 * Get current Find/Replace state from editor
 */
export function getFindReplaceState(state: any): FindReplaceState | null {
  return FindReplacePluginKey.getState(state) ?? null;
}
