/**
 * Transition Extension
 *
 * Purpose: Indicates how one scene transitions to the next
 * Format: ALL CAPS, right-aligned, with colon
 * Common values: CUT TO:, DISSOLVE TO:, FADE TO BLACK, etc.
 * Guidelines: Use sparingly in modern screenplays
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { getNextElementType } from '../utils/keyboard-navigation';

export const Transition = Node.create({
  name: 'transition',

  group: 'block',

  content: 'inline*',

  defining: true, // Mark as structural boundary

  selectable: false, // Optional: prevents independent selection

  parseHTML() {
    return [
      { tag: 'p[data-type="transition"]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'transition',
      class: 'screenplay-transition',
    }), 0];
  },

  addKeyboardShortcuts() {
    return {
      // Tab cycles to next element type
      'Tab': () => {
        const nextType = getNextElementType(this.name);
        return this.editor.commands.setNode(nextType);
      },

      // Cmd/Ctrl+Alt+6: Direct shortcut to Transition
      'Mod-Alt-6': () => this.editor.commands.setNode(this.name),
    };
  },

  addCommands() {
    return {
      setTransition: () => ({ commands }) => {
        return commands.setNode(this.name);
      },
    };
  },
});
