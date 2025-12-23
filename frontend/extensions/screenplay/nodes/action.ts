/**
 * Action (Scene Description) Extension
 *
 * Purpose: Describes what can be seen or heard in the scene
 * Format: Normal case, flush with left margin
 * Default element type for screenplay content
 *
 * Smart Tab Behavior:
 * - If text is "INT", "EXT", or "I/E" → converts to Scene Heading + inserts ". "
 * - Otherwise → converts to Character (standard navigation)
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { getNextElementType, getPreviousElementType } from '../utils/keyboard-navigation';
import { createAutoCapitalizeRules } from '../utils/auto-capitalize';

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
      // Tab: Action → Character (only if empty)
      'Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;
        const isEmpty = node.textContent.trim().length === 0;

        // Only handle Tab if we're in an action block OR a paragraph (default block type)
        if (node.type.name !== this.name && node.type.name !== 'paragraph') {
          return false; // Let other handlers process this
        }

        // Only change block type if empty - otherwise do nothing
        if (!isEmpty) {
          return false;
        }

        // Empty action → Character
        const nextType = getNextElementType(this.name);
        return this.editor.commands.setNode(nextType);
      },

      // Shift-Tab: Action → Dialogue (go back to speech) - only if empty
      'Shift-Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;
        const isEmpty = node.textContent.trim().length === 0;

        // Only handle Shift-Tab if we're in action or paragraph
        if (node.type.name !== this.name && node.type.name !== 'paragraph') {
          return false;
        }

        // Only change block type if empty - otherwise do nothing
        if (!isEmpty) {
          return false;
        }

        const prevType = getPreviousElementType(this.name);
        return this.editor.commands.setNode(prevType);
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

  addInputRules() {
    return createAutoCapitalizeRules();
  },
});
