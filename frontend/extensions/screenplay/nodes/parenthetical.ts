/**
 * Parenthetical (Wryly) Extension
 *
 * Purpose: Provides brief direction about how dialogue is delivered
 * Format: Italicized, indented 1.5" from left margin, wrapped in parentheses
 * Guidelines: Use sparingly, keep brief (3-4 words max)
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { getNextElementType } from '../utils/keyboard-navigation';

export const Parenthetical = Node.create({
  name: 'parenthetical',

  group: 'block',

  content: 'inline*',

  defining: true, // Mark as structural boundary

  parseHTML() {
    return [
      { tag: 'p[data-type="parenthetical"]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'parenthetical',
      class: 'screenplay-parenthetical',
    }), 0];
  },

  addKeyboardShortcuts() {
    return {
      // Tab cycles to next element type
      'Tab': () => {
        const nextType = getNextElementType(this.name);
        return this.editor.commands.setNode(nextType);
      },

      // Cmd/Ctrl+Alt+5: Direct shortcut to Parenthetical
      'Mod-Alt-5': () => this.editor.commands.setNode(this.name),
    };
  },

  addCommands() {
    return {
      setParenthetical: () => ({ commands }) => {
        return commands.setNode(this.name);
      },
    };
  },
});
