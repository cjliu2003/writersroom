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
      // Enter: Only works at the END of text - creates new Dialogue block
      // In the middle of text, Enter does nothing (Final Draft behavior)
      'Enter': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle if we're in a character block
        if (node.type.name !== this.name) {
          return false;
        }

        // Check if cursor is at the very end of the node content
        const isAtEnd = $from.parentOffset === node.content.size;

        if (!isAtEnd) {
          // Block Enter in the middle of character name
          return true;
        }

        // At end: insert new Dialogue block after this node
        const endOfNode = $from.after();
        return this.editor.chain()
          .insertContentAt(endOfNode, { type: 'dialogue' })
          .focus(endOfNode + 1)
          .run();
      },

      // Tab: Only works when empty - converts to Transition
      // (If block has text, Tab does nothing to preserve content)
      'Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle Tab if we're actually in a character block
        if (node.type.name !== this.name) {
          return false; // Let other handlers process this
        }

        const isEmpty = node.textContent.trim().length === 0;

        // Only change block type if empty - otherwise do nothing
        if (!isEmpty) {
          return false;
        }

        const nextType = getNextElementType(this.name, isEmpty);
        return this.editor.commands.setNode(nextType);
      },

      // Shift-Tab: Character → Action (go back to scene description) - only if empty
      'Shift-Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;
        const isEmpty = node.textContent.trim().length === 0;

        // Only handle Shift-Tab if we're actually in a character block
        if (node.type.name !== this.name) {
          return false;
        }

        // Only change block type if empty - otherwise do nothing
        if (!isEmpty) {
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
