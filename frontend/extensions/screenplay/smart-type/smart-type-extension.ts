/**
 * SmartType Extension
 *
 * TipTap extension that manages character name and location autocomplete lists.
 * Scans document content to build lists and updates them as content changes.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  extractCharacterName,
  extractLocation,
  filterSuggestions,
  hasCompletePrefix,
  getLocationPortion,
  getMatchingPrefixes,
  isInTimeContext,
  getTimeQuery,
  filterTimeSuggestions,
  isCompleteSceneHeading,
  getGhostText,
  isInExtensionContext,
  getExtensionQuery,
  filterExtensionSuggestions,
} from './smart-type-utils';

export interface SmartTypeStorage {
  characters: string[];
  locations: string[];
  characterFrequency: Map<string, number>;
  locationFrequency: Map<string, number>;
  /** Timeout ID for debounced list rebuilding */
  rebuildTimeout: ReturnType<typeof setTimeout> | null;
}

export interface SmartTypeState {
  active: boolean;
  type: 'character' | 'location' | 'prefix' | 'time' | 'extension' | null;
  query: string;
  suggestions: string[];
  selectedIndex: number;
  position: { left: number; top: number; bottom: number } | null;
  /** Track last accepted value to prevent immediate re-suggestion */
  lastAccepted: string | null;
}

export const SmartTypePluginKey = new PluginKey<SmartTypeState>('smartType');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    smartType: {
      /**
       * Rebuild SmartType lists from document content
       */
      rebuildSmartTypeLists: () => ReturnType;
      /**
       * Insert a SmartType suggestion
       * @param value - The suggestion value to insert
       * @param type - The type of suggestion (character, location, prefix, time)
       */
      insertSmartTypeSuggestion: (value: string, type: SmartTypeState['type']) => ReturnType;
      /**
       * Close SmartType popup
       */
      closeSmartType: () => ReturnType;
    };
  }
}

export interface SmartTypeOptions {
  /**
   * Maximum suggestions to show
   * @default 7
   */
  maxSuggestions?: number;
}

export const SmartTypeExtension = Extension.create<SmartTypeOptions, SmartTypeStorage>({
  name: 'smartType',

  addOptions() {
    return {
      maxSuggestions: 7,
    };
  },

  addStorage() {
    return {
      characters: [] as string[],
      locations: [] as string[],
      characterFrequency: new Map<string, number>(),
      locationFrequency: new Map<string, number>(),
      rebuildTimeout: null as ReturnType<typeof setTimeout> | null,
    };
  },

  onCreate() {
    // Rebuild lists when editor is created
    this.editor.commands.rebuildSmartTypeLists();
  },

  addCommands() {
    return {
      rebuildSmartTypeLists: () => ({ editor }) => {
        const storage = this.storage;
        const characterSet = new Map<string, number>();
        const locationSet = new Map<string, number>();

        // Scan all nodes in document
        editor.state.doc.descendants((node: ProseMirrorNode) => {
          if (node.type.name === 'character') {
            const name = extractCharacterName(node.textContent);
            if (name) {
              const count = characterSet.get(name) || 0;
              characterSet.set(name, count + 1);
            }
          }

          if (node.type.name === 'sceneHeading') {
            const location = extractLocation(node.textContent);
            if (location) {
              const count = locationSet.get(location) || 0;
              locationSet.set(location, count + 1);
            }
          }

          return true; // Continue traversing
        });

        // Sort by frequency (most used first), then alphabetically
        const sortByFrequency = (map: Map<string, number>) => {
          return Array.from(map.entries())
            .sort((a, b) => {
              if (b[1] !== a[1]) return b[1] - a[1]; // Higher frequency first
              return a[0].localeCompare(b[0]); // Then alphabetical
            })
            .map(([name]) => name);
        };

        storage.characters = sortByFrequency(characterSet);
        storage.locations = sortByFrequency(locationSet);
        storage.characterFrequency = characterSet;
        storage.locationFrequency = locationSet;

        return true;
      },

      insertSmartTypeSuggestion: (value: string, type: SmartTypeState['type']) => ({ state, tr, dispatch }) => {
        const { $from } = state.selection;
        const node = $from.parent;
        const nodeType = node.type.name;
        const text = node.textContent;

        // Get node boundaries
        const nodeStart = $from.start();
        const nodeEnd = $from.end();

        // Helper to mark acceptance and dispatch
        const acceptAndDispatch = () => {
          if (dispatch) {
            // Mark that we accepted this value to prevent immediate re-suggestion
            tr.setMeta(SmartTypePluginKey, { action: 'accepted', value });
            dispatch(tr);
          }
        };

        // Use the type directly instead of re-detecting from text
        // This prevents mismatches between detection and insertion

        if (type === 'extension' && nodeType === 'character') {
          // Extension insertion: find the opening paren and replace from there to cursor
          // Then add the extension value and closing paren
          const parenIndex = text.lastIndexOf('(');
          if (parenIndex !== -1) {
            // Calculate position after the opening paren
            const replaceFrom = nodeStart + parenIndex + 1;
            const replaceTo = nodeEnd;
            // Insert: "V.O.)" - extension + closing paren
            tr.insertText(value + ')', replaceFrom, replaceTo);
            acceptAndDispatch();
            return true;
          }
          return false;
        }

        if (type === 'character' && nodeType === 'character') {
          // Replace entire node content with character name
          tr.insertText(value, nodeStart, nodeEnd);
          acceptAndDispatch();
          return true;
        }

        if (type === 'prefix' && nodeType === 'sceneHeading') {
          // Replace content with prefix + space
          tr.insertText(value + ' ', nodeStart, nodeEnd);
          acceptAndDispatch();
          return true;
        }

        if (type === 'time' && nodeType === 'sceneHeading') {
          // Time suggestions: preserve everything before the dash, append time
          // Use flexible regex to find the dash (handles " -", " - ", " -  ", etc.)
          const dashMatch = text.match(/^(.+\s-\s*)/);
          if (dashMatch) {
            // Normalize to " - " for consistent formatting
            const beforeDash = dashMatch[1].replace(/\s-\s*$/, ' - ');
            tr.insertText(beforeDash + value, nodeStart, nodeEnd);
            acceptAndDispatch();
            return true;
          }
        }

        if (type === 'location' && nodeType === 'sceneHeading') {
          // Location suggestion: preserve the prefix, replace location portion
          const prefixMatch = text.match(/^((?:INT\.?\/?\s*EXT\.?|EXT\.?\/?\s*INT\.?|INT\.?|EXT\.?|I\/E\.?)\.\s*)/i);

          if (prefixMatch) {
            const prefix = prefixMatch[1];
            tr.insertText(prefix + value, nodeStart, nodeEnd);
            acceptAndDispatch();
            return true;
          }
        }

        return false;
      },

      closeSmartType: () => ({ tr, dispatch }) => {
        // Just trigger a state update to close the popup
        if (dispatch) {
          tr.setMeta(SmartTypePluginKey, { action: 'close' });
          dispatch(tr);
        }
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Tab: Accept suggestion if popup is active, otherwise pass through
      'Tab': ({ editor }) => {
        const pluginState = SmartTypePluginKey.getState(editor.state);

        if (pluginState?.active && pluginState.suggestions.length > 0 && pluginState.type) {
          const selectedSuggestion = pluginState.suggestions[pluginState.selectedIndex];
          if (selectedSuggestion) {
            editor.commands.insertSmartTypeSuggestion(selectedSuggestion, pluginState.type);
            return true; // Consume the Tab
          }
        }

        return false; // Let other handlers process
      },

      // Enter: Accept suggestion if popup is active, otherwise pass through
      'Enter': ({ editor }) => {
        const pluginState = SmartTypePluginKey.getState(editor.state);

        if (pluginState?.active && pluginState.suggestions.length > 0 && pluginState.type) {
          const selectedSuggestion = pluginState.suggestions[pluginState.selectedIndex];
          if (selectedSuggestion) {
            editor.commands.insertSmartTypeSuggestion(selectedSuggestion, pluginState.type);
            return true; // Consume the Enter
          }
        }

        return false; // Let other handlers process
      },

      // Escape: Close popup
      'Escape': ({ editor }) => {
        const pluginState = SmartTypePluginKey.getState(editor.state);

        if (pluginState?.active) {
          editor.commands.closeSmartType();
          return true;
        }

        return false;
      },

      // Arrow Down: Navigate suggestions
      'ArrowDown': ({ editor }) => {
        const pluginState = SmartTypePluginKey.getState(editor.state);

        if (pluginState?.active && pluginState.suggestions.length > 0) {
          const newIndex = Math.min(
            pluginState.selectedIndex + 1,
            pluginState.suggestions.length - 1
          );

          const tr = editor.state.tr.setMeta(SmartTypePluginKey, {
            action: 'navigate',
            selectedIndex: newIndex,
          });
          editor.view.dispatch(tr);
          return true;
        }

        return false;
      },

      // Arrow Up: Navigate suggestions
      'ArrowUp': ({ editor }) => {
        const pluginState = SmartTypePluginKey.getState(editor.state);

        if (pluginState?.active && pluginState.suggestions.length > 0) {
          const newIndex = Math.max(pluginState.selectedIndex - 1, 0);

          const tr = editor.state.tr.setMeta(SmartTypePluginKey, {
            action: 'navigate',
            selectedIndex: newIndex,
          });
          editor.view.dispatch(tr);
          return true;
        }

        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin<SmartTypeState>({
        key: SmartTypePluginKey,

        state: {
          init(): SmartTypeState {
            return {
              active: false,
              type: null,
              query: '',
              suggestions: [],
              selectedIndex: 0,
              position: null,
              lastAccepted: null,
            };
          },

          apply(tr, prev, oldState, newState): SmartTypeState {
            // Handle meta actions
            const meta = tr.getMeta(SmartTypePluginKey);
            if (meta) {
              if (meta.action === 'close') {
                return { ...prev, active: false, suggestions: [], selectedIndex: 0 };
              }
              if (meta.action === 'navigate') {
                return { ...prev, selectedIndex: meta.selectedIndex };
              }
              if (meta.action === 'accepted') {
                // Track that we just accepted a suggestion - prevent immediate re-suggestion
                return { ...prev, active: false, suggestions: [], selectedIndex: 0, lastAccepted: meta.value };
              }
            }

            // Don't update if document didn't change and selection didn't change
            if (!tr.docChanged && oldState.selection.eq(newState.selection)) {
              return prev;
            }

            const { $from } = newState.selection;
            const node = $from.parent;
            const nodeType = node.type.name;
            const text = node.textContent;
            const storage = extension.storage;

            // Helper to create inactive state
            const inactiveState = (clearLastAccepted: boolean = false): SmartTypeState => ({
              active: false,
              type: null,
              query: '',
              suggestions: [],
              selectedIndex: 0,
              position: null,
              lastAccepted: clearLastAccepted ? null : prev.lastAccepted,
            });

            // Check if we're in a Character element
            if (nodeType === 'character') {
              // FIRST: Check for extension context (after "(" in character line)
              // This takes priority over character name suggestions
              if (isInExtensionContext(text)) {
                const extQuery = getExtensionQuery(text);

                // If text ends with what we just accepted + ")", don't show suggestions
                if (prev.lastAccepted && text.toUpperCase().includes('(' + prev.lastAccepted.toUpperCase() + ')')) {
                  return inactiveState();
                }

                // Show extension suggestions (V.O., O.S., etc.)
                const extSuggestions = filterExtensionSuggestions(extQuery, extension.options.maxSuggestions);

                // Don't show if exact match
                const exactMatch = extSuggestions.length === 1 &&
                  extSuggestions[0].toUpperCase() === extQuery.toUpperCase();

                if (extSuggestions.length > 0 && !exactMatch) {
                  return {
                    active: true,
                    type: 'extension',
                    query: extQuery,
                    suggestions: extSuggestions,
                    selectedIndex: 0,
                    position: null,
                    lastAccepted: null,
                  };
                }

                // If in extension context but no matching suggestions, stay inactive
                return inactiveState(true);
              }

              const query = text.trim();

              // Only show suggestions after at least 1 character is typed
              if (query.length === 0) {
                return inactiveState(true); // Clear lastAccepted when empty
              }

              // If text matches what we just accepted, don't show suggestions yet
              // User must type another character to see new suggestions
              if (prev.lastAccepted && query.toUpperCase() === prev.lastAccepted.toUpperCase()) {
                return inactiveState();
              }

              // Clear lastAccepted if user has typed more (query changed)
              const suggestions = filterSuggestions(
                storage.characters,
                query,
                extension.options.maxSuggestions
              );

              // Don't show popup if query exactly matches a suggestion (already complete)
              const exactMatch = suggestions.length === 1 &&
                suggestions[0].toUpperCase() === query.toUpperCase();

              if (suggestions.length > 0 && !exactMatch) {
                return {
                  active: true,
                  type: 'character',
                  query,
                  suggestions,
                  selectedIndex: 0,
                  position: null,
                  lastAccepted: null, // Clear when showing new suggestions
                };
              }
            }

            // Check if we're in a SceneHeading element
            if (nodeType === 'sceneHeading') {
              // FIRST: Check if scene heading is already complete (has prefix, location, and valid time)
              // Don't show any suggestions for complete headings
              if (isCompleteSceneHeading(text)) {
                return inactiveState(true);
              }

              // Check if prefix is complete
              if (hasCompletePrefix(text)) {
                // Check for time-of-day context FIRST (after " - ")
                if (isInTimeContext(text)) {
                  const timeQuery = getTimeQuery(text);

                  // Require at least 1 character after dash to show time suggestions
                  // This prevents popup from appearing immediately after typing " - "
                  if (timeQuery.length === 0) {
                    return inactiveState(true);
                  }

                  // If text ends with what we just accepted, don't show suggestions yet
                  if (prev.lastAccepted && text.toUpperCase().endsWith(prev.lastAccepted.toUpperCase())) {
                    return inactiveState();
                  }

                  // Show time suggestions
                  const timeSuggestions = filterTimeSuggestions(timeQuery, extension.options.maxSuggestions);

                  // Don't show if exact match
                  const exactMatch = timeSuggestions.length === 1 &&
                    timeSuggestions[0].toUpperCase() === timeQuery.toUpperCase();

                  if (timeSuggestions.length > 0 && !exactMatch) {
                    return {
                      active: true,
                      type: 'time',
                      query: timeQuery,
                      suggestions: timeSuggestions,
                      selectedIndex: 0,
                      position: null,
                      lastAccepted: null,
                    };
                  }
                }

                // Location suggestions (after prefix, before dash)
                const locationQuery = getLocationPortion(text).trim();

                // Only show suggestions after at least 1 character is typed for location
                if (locationQuery.length === 0) {
                  return inactiveState(true);
                }

                // If text ends with what we just accepted, don't show suggestions yet
                if (prev.lastAccepted && text.toUpperCase().endsWith(prev.lastAccepted.toUpperCase())) {
                  return inactiveState();
                }

                const suggestions = filterSuggestions(
                  storage.locations,
                  locationQuery,
                  extension.options.maxSuggestions
                );

                // Don't show popup if query exactly matches a suggestion
                const exactMatch = suggestions.length === 1 &&
                  suggestions[0].toUpperCase() === locationQuery.toUpperCase();

                if (suggestions.length > 0 && !exactMatch) {
                  return {
                    active: true,
                    type: 'location',
                    query: locationQuery,
                    suggestions,
                    selectedIndex: 0,
                    position: null,
                    lastAccepted: null,
                  };
                }
              } else {
                // Prefix not complete - show prefix suggestions (INT., EXT., etc.)
                const prefixQuery = text.trim();

                // Only show after at least 1 character typed
                if (prefixQuery.length === 0) {
                  return inactiveState(true);
                }

                // If text matches what we just accepted (minus the trailing space), don't show suggestions
                if (prev.lastAccepted) {
                  const acceptedPrefix = prev.lastAccepted.replace(/\.\s*$/, '.');
                  if (prefixQuery.toUpperCase() === acceptedPrefix.toUpperCase() ||
                      text.toUpperCase().startsWith(prev.lastAccepted.toUpperCase())) {
                    return inactiveState();
                  }
                }

                const prefixSuggestions = getMatchingPrefixes(prefixQuery);

                if (prefixSuggestions.length > 0) {
                  return {
                    active: true,
                    type: 'prefix',
                    query: prefixQuery,
                    suggestions: prefixSuggestions,
                    selectedIndex: 0,
                    position: null,
                    lastAccepted: null,
                  };
                }
              }
            }

            // No SmartType suggestions for Action elements

            // Not in a SmartType context
            return inactiveState(true);
          },
        },
      }),

      // Ghost text decoration plugin - shows inline preview of what Tab would complete
      new Plugin({
        props: {
          decorations(state) {
            const smartState = SmartTypePluginKey.getState(state);

            // Only show ghost text when popup is active with suggestions
            if (!smartState?.active || smartState.suggestions.length === 0) {
              return DecorationSet.empty;
            }

            const suggestion = smartState.suggestions[smartState.selectedIndex];
            const query = smartState.query;

            // Calculate ghost text (the completion portion)
            const ghostText = getGhostText(suggestion, query, smartState.type);
            if (!ghostText) {
              return DecorationSet.empty;
            }

            const { from } = state.selection;

            // Create inline widget decoration with ghost text
            const widget = Decoration.widget(
              from,
              () => {
                const span = document.createElement('span');
                span.textContent = ghostText;
                span.className = 'smart-type-ghost';
                return span;
              },
              { side: 1 } // Appears after cursor
            );

            return DecorationSet.create(state.doc, [widget]);
          },
        },
      }),
    ];
  },

  // Update lists when document changes (debounced for performance)
  onTransaction({ transaction }) {
    if (transaction.docChanged) {
      // Clear any pending rebuild
      if (this.storage.rebuildTimeout) {
        clearTimeout(this.storage.rebuildTimeout);
      }
      // Debounce list rebuilding by 250ms to reduce CPU usage during rapid typing
      this.storage.rebuildTimeout = setTimeout(() => {
        this.editor.commands.rebuildSmartTypeLists();
        this.storage.rebuildTimeout = null;
      }, 250);
    }
  },

  // Clean up timeout on destroy
  onDestroy() {
    if (this.storage.rebuildTimeout) {
      clearTimeout(this.storage.rebuildTimeout);
      this.storage.rebuildTimeout = null;
    }
  },
});

/**
 * Helper to get SmartType state from editor
 */
export function getSmartTypeState(editor: { state: { plugins: Plugin[] } }): SmartTypeState | null {
  // @ts-ignore - accessing plugin state
  return SmartTypePluginKey.getState(editor.state) || null;
}
