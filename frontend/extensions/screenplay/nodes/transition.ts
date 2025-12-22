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
      // Enter: Only works at the END of text - creates new Scene Heading block
      // In the middle of text, Enter does nothing (Final Draft behavior)
      'Enter': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle if we're in a transition block
        if (node.type.name !== this.name) {
          return false;
        }

        // Check if cursor is at the very end of the node content
        const isAtEnd = $from.parentOffset === node.content.size;

        if (!isAtEnd) {
          // Block Enter in the middle of transition
          return true;
        }

        // At end: insert new Scene Heading block after this node
        const endOfNode = $from.after();
        return this.editor.chain()
          .insertContentAt(endOfNode, { type: 'sceneHeading' })
          .focus(endOfNode + 1)
          .run();
      },

      // Tab: Transition → Scene Heading (start new scene) - only if empty
      'Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;
        const isEmpty = node.textContent.trim().length === 0;

        // Only handle Tab if we're actually in a transition block
        if (node.type.name !== this.name) {
          return false; // Let other handlers process this
        }

        // Only change block type if empty - otherwise do nothing
        if (!isEmpty) {
          return false;
        }

        const nextType = getNextElementType(this.name);
        return this.editor.commands.setNode(nextType);
      },

      // Shift-Tab: Transition → Action (go back to scene description) - only if empty
      'Shift-Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;
        const isEmpty = node.textContent.trim().length === 0;

        // Only handle Shift-Tab if we're actually in a transition block
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
