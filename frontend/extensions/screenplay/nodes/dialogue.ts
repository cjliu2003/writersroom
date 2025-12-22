/**
 * Dialogue Extension
 *
 * Purpose: The spoken words of a character
 * Format: Normal case, indented 1" from left margin, max width 3.5"
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { getNextElementType, getPreviousElementType } from '../utils/keyboard-navigation';
import { createAutoCapitalizeRules } from '../utils/auto-capitalize';

export const Dialogue = Node.create({
  name: 'dialogue',

  group: 'block',

  content: 'inline*',

  defining: true, // Mark as structural boundary

  parseHTML() {
    return [
      { tag: 'p[data-type="dialogue"]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'dialogue',
      class: 'screenplay-dialogue',
    }), 0];
  },

  addKeyboardShortcuts() {
    return {
      // Enter: At END creates new Action block, in MIDDLE allows split (new dialogue paragraph)
      // This matches Final Draft behavior for continuing long speeches
      'Enter': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle if we're in a dialogue block
        if (node.type.name !== this.name) {
          return false;
        }

        // Check if cursor is at the very end of the node content
        const isAtEnd = $from.parentOffset === node.content.size;

        if (!isAtEnd) {
          // In middle: allow default split behavior (creates new dialogue paragraph)
          return false;
        }

        // At end: insert new Action block after this node
        const endOfNode = $from.after();
        return this.editor.chain()
          .insertContentAt(endOfNode, { type: 'action' })
          .focus(endOfNode + 1)
          .run();
      },

      // Tab: Dialogue → Parenthetical (add wryly, beat, etc.) - only if empty
      'Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;
        const isEmpty = node.textContent.trim().length === 0;

        // Only handle Tab if we're actually in a dialogue block
        if (node.type.name !== this.name) {
          return false; // Let other handlers process this
        }

        // Only change block type if empty - otherwise do nothing
        if (!isEmpty) {
          return false;
        }

        // Use setParenthetical to get automatic () insertion
        return this.editor.commands.setParenthetical();
      },

      // Shift-Tab: Dialogue → Character (go back to who's speaking) - only if empty
      'Shift-Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;
        const isEmpty = node.textContent.trim().length === 0;

        // Only handle Shift-Tab if we're actually in a dialogue block
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

      // Cmd/Ctrl+Alt+4: Direct shortcut to Dialogue
      'Mod-Alt-4': () => this.editor.commands.setNode(this.name),
    };
  },

  addCommands() {
    return {
      setDialogue: () => ({ commands }) => {
        return commands.setNode(this.name);
      },
    };
  },

  addInputRules() {
    return createAutoCapitalizeRules();
  },
});
