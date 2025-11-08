/**
 * Dialogue Extension
 *
 * Purpose: The spoken words of a character
 * Format: Normal case, indented 1" from left margin, max width 3.5"
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { getNextElementType } from '../utils/keyboard-navigation';

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
      // Tab cycles to next element type
      'Tab': () => {
        const nextType = getNextElementType(this.name);
        return this.editor.commands.setNode(nextType);
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
});
