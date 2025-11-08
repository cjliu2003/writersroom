/**
 * Character Name (Character Cue) Extension
 *
 * Purpose: Indicates which character is speaking
 * Format: ALL CAPS, indented 2.2" from left margin
 * Special notations: (V.O.), (O.S.), (CONT'D), (filtered)
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { getNextElementType } from '../utils/keyboard-navigation';

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
      // Tab cycles to next element type
      'Tab': () => {
        const nextType = getNextElementType(this.name);
        return this.editor.commands.setNode(nextType);
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
