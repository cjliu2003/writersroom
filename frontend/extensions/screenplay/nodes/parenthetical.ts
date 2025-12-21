/**
 * Parenthetical (Wryly) Extension
 *
 * Purpose: Provides brief direction about how dialogue is delivered
 * Format: Indented, wrapped in parentheses (parentheses are real editable text)
 * Guidelines: Use sparingly, keep brief (3-4 words max)
 *
 * Note: Parentheses are stored as actual text characters, not CSS pseudo-elements.
 * This allows users to edit/delete them like normal text, matching Final Draft behavior.
 */

import { Node, mergeAttributes, CommandProps } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { getNextElementType, getPreviousElementType } from '../utils/keyboard-navigation';
import { createAutoCapitalizeRules } from '../utils/auto-capitalize';

// Declare the custom command type
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    parenthetical: {
      setParenthetical: () => ReturnType;
    };
  }
}

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
      // Tab: Parenthetical → Dialogue (back to speech after direction)
      'Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle Tab if we're actually in a parenthetical block
        if (node.type.name !== this.name) {
          return false; // Let other handlers process this
        }

        const nextType = getNextElementType(this.name);
        return this.editor.commands.setNode(nextType);
      },

      // Shift-Tab: Parenthetical → Character (go back to character name)
      'Shift-Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle Shift-Tab if we're actually in a parenthetical block
        if (node.type.name !== this.name) {
          return false;
        }

        const prevType = getPreviousElementType(this.name);
        return this.editor.commands.setNode(prevType);
      },

      // Cmd/Ctrl+Alt+5: Direct shortcut to Parenthetical
      'Mod-Alt-5': () => this.editor.commands.setParenthetical(),
    };
  },

  addCommands() {
    return {
      setParenthetical: () => ({ chain, state }: CommandProps) => {
        const { selection } = state;
        const { $from } = selection;

        // Get current node content
        const currentNode = $from.parent;
        const currentText = currentNode.textContent;

        // Check if content already has parentheses
        const hasParens = currentText.startsWith('(') && currentText.endsWith(')');

        if (hasParens || currentText.length === 0) {
          // If already has parens or empty, just set node type and add () if empty
          return chain()
            .setNode(this.name)
            .command(({ tr, state, dispatch }: CommandProps) => {
              if (state.selection.$from.parent.textContent.length === 0) {
                // Insert () and position cursor between them
                const pos = state.selection.from;
                tr.insertText('()', pos);
                // Position cursor between the parentheses
                const newSelection = TextSelection.create(tr.doc, pos + 1);
                tr.setSelection(newSelection);
                if (dispatch) dispatch(tr);
                return true;
              }
              return true;
            })
            .run();
        } else {
          // Wrap existing content in parentheses
          return chain()
            .setNode(this.name)
            .command(({ tr, state, dispatch }: CommandProps) => {
              const range = state.selection.$from.blockRange();
              if (!range) return false;

              const nodeStart = range.start + 1; // After the opening tag
              const nodeEnd = range.end - 1; // Before the closing tag

              // Insert closing paren at end, then opening paren at start
              tr.insertText(')', nodeEnd);
              tr.insertText('(', nodeStart);

              if (dispatch) dispatch(tr);
              return true;
            })
            .run();
        }
      },
    };
  },

  addInputRules() {
    return createAutoCapitalizeRules();
  },
});
