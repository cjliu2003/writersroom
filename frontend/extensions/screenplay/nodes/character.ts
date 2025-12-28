/**
 * Character Name (Character Cue) Extension
 *
 * Purpose: Indicates which character is speaking
 * Format: ALL CAPS, indented 2.2" from left margin
 * Special notations: (V.O.), (O.S.), (CONT'D), (filtered)
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { getNextElementType, getPreviousElementType } from '../utils/keyboard-navigation';
import {
  isInsideDualDialogue,
  findColumnAncestor,
  getNextColumnElementType,
  toggleDualDialogue,
} from '../dual-dialogue';

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

  addAttributes() {
    return {
      // Legacy attribute for migration - parsed from old docs but not rendered to new docs
      isDualDialogue: {
        default: false,
        parseHTML: element => element.getAttribute('data-dual-dialogue') === 'true',
        renderHTML: () => ({}), // Don't output - migration handles structure
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'character',
      class: 'screenplay-character',
    }), 0];
  },

  addKeyboardShortcuts() {
    return {
      // Enter: Only works at the END of text - creates new Dialogue block
      // In the middle of text, Enter does nothing (Final Draft behavior)
      'Enter': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle if we're in a character block
        if (node.type.name !== this.name) {
          return false;
        }

        // Check if cursor is at the very end of the node content
        const isAtEnd = $from.parentOffset === node.content.size;

        if (!isAtEnd) {
          // Block Enter in the middle of character name
          return true;
        }

        // At end: insert new Dialogue block after this node
        const endOfNode = $from.after();
        return this.editor.chain()
          .insertContentAt(endOfNode, { type: 'dialogue' })
          .focus(endOfNode + 1)
          .run();
      },

      // Tab: Character → Parenthetical
      // - Empty character: converts to transition (Final Draft behavior)
      // - Non-empty character: inserts parenthetical after (for V.O., O.S., CONT'D, etc.)
      // Inside dual dialogue: cycles within valid column types
      'Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle Tab if we're actually in a character block
        if (node.type.name !== this.name) {
          return false; // Let other handlers process this
        }

        const isEmpty = node.textContent.trim().length === 0;

        // Empty character: convert to next element type
        if (isEmpty) {
          // Check if inside dual dialogue - use column-specific cycling
          if (isInsideDualDialogue($from)) {
            const nextType = getNextColumnElementType(this.name);
            return this.editor.commands.setNode(nextType);
          }
          // Normal behavior: empty character → transition
          const nextType = getNextElementType(this.name, isEmpty);
          return this.editor.commands.setNode(nextType);
        }

        // Non-empty character: insert parenthetical after
        // Useful for adding (V.O.), (O.S.), (CONT'D), etc.
        const endOfNode = $from.after();
        return this.editor.chain()
          .insertContentAt(endOfNode, {
            type: 'parenthetical',
            content: [{ type: 'text', text: '()' }]
          })
          .command(({ tr, dispatch }) => {
            if (dispatch) {
              // Position cursor between the parentheses
              // endOfNode + 1 (into parenthetical) + 1 (after opening paren)
              const cursorPos = endOfNode + 2;
              tr.setSelection(TextSelection.create(tr.doc, cursorPos));
            }
            return true;
          })
          .run();
      },

      // Shift-Tab: Character → Action (go back to scene description) - only if empty
      // Inside dual dialogue: BLOCKED because character is required first in column
      'Shift-Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;
        const isEmpty = node.textContent.trim().length === 0;

        // Only handle Shift-Tab if we're actually in a character block
        if (node.type.name !== this.name) {
          return false;
        }

        // Only change block type if empty - otherwise do nothing
        if (!isEmpty) {
          return false;
        }

        // Inside dual dialogue: block Shift-Tab on character
        // Character is required first in column schema: 'character (dialogue | parenthetical)*'
        // Use Backspace at start to unwrap instead
        if (isInsideDualDialogue($from)) {
          // Return true to consume the event but do nothing
          // This preserves schema validity
          return true;
        }

        // Normal behavior (outside dual dialogue)
        const prevType = getPreviousElementType(this.name);
        return this.editor.commands.setNode(prevType);
      },

      // Backspace at start of character in left column: unwrap dual dialogue
      'Backspace': () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        const node = $from.parent;

        // Only handle if we're in a character block
        if (node.type.name !== this.name) {
          return false;
        }

        // Only handle if cursor is at the very start
        if ($from.parentOffset !== 0) {
          return false;
        }

        // Only handle if selection is collapsed (no selection)
        if (!empty) {
          return false;
        }

        // Check if inside dual dialogue column
        const columnInfo = findColumnAncestor($from);
        if (!columnInfo) {
          return false; // Not in dual dialogue, let default handle it
        }

        // Check if this is the first element in the column (the required character)
        const isFirstInColumn = $from.index(columnInfo.depth) === 0;
        const isEmpty = node.textContent.trim().length === 0;

        // LEFT column's character: Backspace at start unwraps dual dialogue
        if (columnInfo.side === 'left' && isFirstInColumn) {
          console.log('[DualDialogue] Backspace at start of left column character → unwrapping');
          return toggleDualDialogue(this.editor);
        }

        // RIGHT column's empty character: Block backspace to prevent schema violation
        // The column schema requires a character first: 'character (dialogue | parenthetical)*'
        // User must use Cmd+D to unwrap the dual dialogue instead
        if (columnInfo.side === 'right' && isFirstInColumn && isEmpty) {
          console.log('[DualDialogue] Blocking backspace on empty right column character');
          return true; // Block - consume event but do nothing
        }

        return false; // Let default Backspace behavior handle other cases
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
