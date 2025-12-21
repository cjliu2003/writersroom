/**
 * Transition Extension
 *
 * Purpose: Indicates how one scene transitions to the next
 * Format: ALL CAPS, right-aligned, with colon
 * Common values: CUT TO:, DISSOLVE TO:, FADE TO BLACK, etc.
 * Guidelines: Use sparingly in modern screenplays
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { getNextElementType, getPreviousElementType } from '../utils/keyboard-navigation';

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
      // Tab: Transition → Scene Heading (start new scene)
      'Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle Tab if we're actually in a transition block
        if (node.type.name !== this.name) {
          return false; // Let other handlers process this
        }

        const nextType = getNextElementType(this.name);
        return this.editor.commands.setNode(nextType);
      },

      // Shift-Tab: Transition → Action (go back to scene description)
      'Shift-Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle Shift-Tab if we're actually in a transition block
        if (node.type.name !== this.name) {
          return false;
        }

        const prevType = getPreviousElementType(this.name);
        return this.editor.commands.setNode(prevType);
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
