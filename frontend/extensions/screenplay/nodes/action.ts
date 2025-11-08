/**
 * Action (Scene Description) Extension
 *
 * Purpose: Describes what can be seen or heard in the scene
 * Format: Normal case, flush with left margin
 * Default element type for screenplay content
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { getNextElementType } from '../utils/keyboard-navigation';

export const Action = Node.create({
  name: 'action',

  group: 'block',

  content: 'inline*',

  defining: true, // Mark as structural boundary

  parseHTML() {
    return [
      { tag: 'p[data-type="action"]' },
      { tag: 'p:not([data-type])' }, // Also parse plain <p> as action
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'action',
      class: 'screenplay-action',
    }), 0];
  },

  addKeyboardShortcuts() {
    return {
      // Tab cycles to next element type
      'Tab': () => {
        const nextType = getNextElementType(this.name);
        return this.editor.commands.setNode(nextType);
      },

      // Cmd/Ctrl+Alt+2: Direct shortcut to Action
      'Mod-Alt-2': () => this.editor.commands.setNode(this.name),
    };
  },

  addCommands() {
    return {
      setAction: () => ({ commands }) => {
        return commands.setNode(this.name);
      },
    };
  },
});
