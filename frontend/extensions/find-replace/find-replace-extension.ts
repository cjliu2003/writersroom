/**
 * Find/Replace TipTap Extension
 *
 * Wraps the ProseMirror plugin and provides TipTap commands and keyboard shortcuts
 * for find and replace functionality.
 */

import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import {
  createFindReplacePlugin,
  FindReplacePluginKey,
  FindReplaceState,
  dispatchFindReplaceAction,
  getFindReplaceState,
} from './find-replace-plugin';

export interface FindReplaceOptions {
  // Future options can be added here
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      /**
       * Open the find panel
       */
      openFind: () => ReturnType;
      /**
       * Open the find panel in replace mode
       */
      openReplace: () => ReturnType;
      /**
       * Close the find panel
       */
      closeFind: () => ReturnType;
      /**
       * Toggle the find panel
       */
      toggleFind: () => ReturnType;
      /**
       * Set the search query
       */
      setSearchQuery: (query: string) => ReturnType;
      /**
       * Set the replacement text
       */
      setReplaceText: (text: string) => ReturnType;
      /**
       * Toggle case sensitivity
       */
      toggleCaseSensitive: () => ReturnType;
      /**
       * Go to the next match
       */
      findNext: () => ReturnType;
      /**
       * Go to the previous match
       */
      findPrevious: () => ReturnType;
      /**
       * Replace the current match and move to next
       */
      replaceCurrent: () => ReturnType;
      /**
       * Replace all matches
       */
      replaceAll: () => ReturnType;
      /**
       * Go to a specific match by index
       */
      goToMatch: (index: number) => ReturnType;
    };
  }
}

export const FindReplaceExtension = Extension.create<FindReplaceOptions>({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [createFindReplacePlugin()];
  },

  addCommands() {
    return {
      openFind:
        () =>
        ({ view }) => {
          dispatchFindReplaceAction(view, { type: 'open', replaceMode: false });
          return true;
        },

      openReplace:
        () =>
        ({ view }) => {
          dispatchFindReplaceAction(view, { type: 'open', replaceMode: true });
          return true;
        },

      closeFind:
        () =>
        ({ view }) => {
          dispatchFindReplaceAction(view, { type: 'close' });
          return true;
        },

      toggleFind:
        () =>
        ({ view, state }) => {
          const pluginState = getFindReplaceState(state);
          if (pluginState?.isOpen) {
            dispatchFindReplaceAction(view, { type: 'close' });
          } else {
            dispatchFindReplaceAction(view, { type: 'open' });
          }
          return true;
        },

      setSearchQuery:
        (query: string) =>
        ({ view }) => {
          dispatchFindReplaceAction(view, { type: 'setQuery', query });
          return true;
        },

      setReplaceText:
        (text: string) =>
        ({ view }) => {
          dispatchFindReplaceAction(view, { type: 'setReplaceText', replaceText: text });
          return true;
        },

      toggleCaseSensitive:
        () =>
        ({ view }) => {
          dispatchFindReplaceAction(view, { type: 'toggleCaseSensitive' });
          return true;
        },

      findNext:
        () =>
        ({ view, state }) => {
          const pluginState = getFindReplaceState(state);
          if (!pluginState || pluginState.matches.length === 0) {
            return false;
          }

          // Calculate the new index BEFORE dispatching (same logic as getNextMatchIndex)
          const { currentIndex, matches } = pluginState;
          let newIndex = currentIndex === -1 ? 0 : currentIndex + 1;
          if (newIndex >= matches.length) newIndex = 0;

          // Update plugin state
          dispatchFindReplaceAction(view, { type: 'nextMatch' });

          // Scroll to the match using our pre-calculated index
          const match = matches[newIndex];
          if (match) {
            // Use setTimeout to ensure state is updated before scrolling
            setTimeout(() => {
              const tr = view.state.tr.setSelection(
                TextSelection.near(view.state.doc.resolve(match.from))
              );
              tr.scrollIntoView();
              view.dispatch(tr);
            }, 0);
          }

          return true;
        },

      findPrevious:
        () =>
        ({ view, state }) => {
          const pluginState = getFindReplaceState(state);
          if (!pluginState || pluginState.matches.length === 0) {
            return false;
          }

          // Calculate the new index BEFORE dispatching (same logic as getNextMatchIndex)
          const { currentIndex, matches } = pluginState;
          let newIndex = currentIndex === -1 ? matches.length - 1 : currentIndex - 1;
          if (newIndex < 0) newIndex = matches.length - 1;

          // Update plugin state
          dispatchFindReplaceAction(view, { type: 'previousMatch' });

          // Scroll to the match using our pre-calculated index
          const match = matches[newIndex];
          if (match) {
            setTimeout(() => {
              const tr = view.state.tr.setSelection(
                TextSelection.near(view.state.doc.resolve(match.from))
              );
              tr.scrollIntoView();
              view.dispatch(tr);
            }, 0);
          }

          return true;
        },

      replaceCurrent:
        () =>
        ({ tr, dispatch, state }) => {
          // Use TipTap's provided tr and dispatch to work correctly with Yjs collaboration
          const pluginState = getFindReplaceState(state);
          if (!pluginState || pluginState.currentIndex < 0) {
            return false;
          }

          // Allow empty string (delete) but not undefined
          if (pluginState.replaceText === undefined || pluginState.replaceText === null) {
            return false;
          }

          const match = pluginState.matches[pluginState.currentIndex];
          if (!match) {
            return false;
          }

          // Validate positions are still valid in current document
          if (match.from < 0 || match.to > state.doc.content.size) {
            return false;
          }

          if (dispatch) {
            // Chain off the provided tr - do NOT create new transaction
            let newTr = tr.delete(match.from, match.to);
            if (pluginState.replaceText !== '') {
              newTr = newTr.insertText(pluginState.replaceText, match.from);
            }
            // Add meta action to trigger plugin state refresh
            newTr = newTr.setMeta(FindReplacePluginKey, { type: 'replace' });

            console.log('[FindReplace] replaceCurrent pre-dispatch:', {
              docSize: state.doc.content.size,
              trSteps: newTr.steps.length,
              matchFrom: match.from,
              matchTo: match.to,
            });

            dispatch(newTr);
          }

          return true;
        },

      replaceAll:
        () =>
        ({ tr, dispatch, state }) => {
          // Use TipTap's provided tr and dispatch to work correctly with Yjs collaboration
          const pluginState = getFindReplaceState(state);
          if (!pluginState || pluginState.matches.length === 0) {
            return false;
          }

          const { matches, replaceText } = pluginState;

          // Allow empty string (delete all) but not undefined
          if (replaceText === undefined || replaceText === null) {
            return false;
          }

          // Validate all match positions are still valid in current document
          const docSize = state.doc.content.size;
          const validMatches = matches.filter(m => m.from >= 0 && m.to <= docSize);
          if (validMatches.length === 0) {
            return false;
          }

          // Replace all matches in reverse order to preserve positions
          const sortedMatches = [...validMatches].sort((a, b) => b.from - a.from);

          if (dispatch) {
            // Chain off the provided tr - do NOT create new transaction
            let newTr = tr;
            for (const match of sortedMatches) {
              newTr = newTr.delete(match.from, match.to);
              if (replaceText !== '') {
                newTr = newTr.insertText(replaceText, match.from);
              }
            }

            // Add meta action to trigger plugin state refresh
            newTr = newTr.setMeta(FindReplacePluginKey, { type: 'replaceAll' });

            console.log('[FindReplace] replaceAll pre-dispatch:', {
              docSize: state.doc.content.size,
              trSteps: newTr.steps.length,
              matchCount: sortedMatches.length,
            });

            dispatch(newTr);
          }

          return true;
        },

      goToMatch:
        (index: number) =>
        ({ view }) => {
          // Use view.state directly to avoid stale state issues
          const currentState = view.state;
          const pluginState = getFindReplaceState(currentState);
          if (!pluginState || index < 0 || index >= pluginState.matches.length) {
            return false;
          }

          dispatchFindReplaceAction(view, { type: 'goToMatch', index });

          // Scroll to the match
          const match = pluginState.matches[index];
          if (match && match.from >= 0 && match.from <= currentState.doc.content.size) {
            setTimeout(() => {
              const tr = view.state.tr.setSelection(
                TextSelection.near(view.state.doc.resolve(match.from))
              );
              tr.scrollIntoView();
              view.dispatch(tr);
            }, 0);
          }

          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Cmd/Ctrl+F: Open find panel
      'Mod-f': () => {
        this.editor.commands.openFind();
        return true;
      },

      // Cmd/Ctrl+H: Open replace panel
      'Mod-h': () => {
        this.editor.commands.openReplace();
        return true;
      },

      // Escape: Close find panel (only if open)
      Escape: () => {
        const pluginState = getFindReplaceState(this.editor.state);
        if (pluginState?.isOpen) {
          this.editor.commands.closeFind();
          return true;
        }
        return false;
      },

      // Cmd/Ctrl+G or F3: Find next (when panel is open)
      'Mod-g': () => {
        const pluginState = getFindReplaceState(this.editor.state);
        if (pluginState?.isOpen && pluginState.matches.length > 0) {
          this.editor.commands.findNext();
          return true;
        }
        return false;
      },

      // Shift+Cmd/Ctrl+G or Shift+F3: Find previous (when panel is open)
      'Shift-Mod-g': () => {
        const pluginState = getFindReplaceState(this.editor.state);
        if (pluginState?.isOpen && pluginState.matches.length > 0) {
          this.editor.commands.findPrevious();
          return true;
        }
        return false;
      },
    };
  },
});

// Re-export types and utilities for external use
export { FindReplacePluginKey, getFindReplaceState };
export type { FindReplaceState };
