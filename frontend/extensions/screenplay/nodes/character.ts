/**
 * Character Name (Character Cue) Extension
 *
 * Purpose: Indicates which character is speaking
 * Format: ALL CAPS, indented 2.2" from left margin
 * Special notations: (V.O.), (O.S.), (CONT'D), (filtered)
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { getNextElementType, getPreviousElementType } from '../utils/keyboard-navigation';

export const Character = Node.create({
  name: 'character',

  group: 'block',

  content: 'inline*',

  defining: true, // Mark as structural boundary

  parseHTML() {
    return [
      { tag: 'p[data-type="character"]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'character',
      class: 'screenplay-character',
    }), 0];
  },

  addKeyboardShortcuts() {
    return {
      // Tab: Character behavior depends on content (Final Draft style)
      // - Empty character → Transition (changed mind, want transition instead)
      // - Character with text → Parenthetical (add direction before dialogue)
      'Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle Tab if we're actually in a character block
        if (node.type.name !== this.name) {
          return false; // Let other handlers process this
        }

        const isEmpty = node.textContent.trim().length === 0;
        const nextType = getNextElementType(this.name, isEmpty);
        return this.editor.commands.setNode(nextType);
      },

      // Shift-Tab: Character → Action (go back to scene description)
      'Shift-Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle Shift-Tab if we're actually in a character block
        if (node.type.name !== this.name) {
          return false;
        }

        const prevType = getPreviousElementType(this.name);
        return this.editor.commands.setNode(prevType);
      },

      // Cmd/Ctrl+Alt+3: Direct shortcut to Character
      'Mod-Alt-3': () => this.editor.commands.setNode(this.name),
    };
  },

  addCommands() {
    return {
      setCharacter: () => ({ commands }) => {
        return commands.setNode(this.name);
      },
    };
  },

  addInputRules() {
    // TODO: Add input rule to auto-convert all-caps lines to character names
    // Example: nodeInputRule({ find: /^([A-Z\s]+)$/,  type: this.type })
    return [];
  },
});
