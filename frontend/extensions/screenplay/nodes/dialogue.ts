/**
 * Dialogue Extension
 *
 * Purpose: The spoken words of a character
 * Format: Normal case, indented 1" from left margin, max width 3.5"
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { getNextElementType, getPreviousElementType } from '../utils/keyboard-navigation';
import { createAutoCapitalizeRules } from '../utils/auto-capitalize';
import {
  isInsideDualDialogue,
  findColumnAncestor,
  getNextColumnElementType,
  getPreviousColumnElementType
} from '../dual-dialogue';

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
      'data-type': 'dialogue',
      class: 'screenplay-dialogue',
    }), 0];
  },

  addKeyboardShortcuts() {
    return {
      // Enter: At END creates new Action block, in MIDDLE allows split (new dialogue paragraph)
      // This matches Final Draft behavior for continuing long speeches
      // EXCEPTION: Inside dual dialogue column, Enter at end creates new dialogue in same column
      'Enter': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle if we're in a dialogue block
        if (node.type.name !== this.name) {
          return false;
        }

        // Check if cursor is at the very end of the node content
        const isAtEnd = $from.parentOffset === node.content.size;

        if (!isAtEnd) {
          // In middle: allow default split behavior (creates new dialogue paragraph)
          return false;
        }

        // Check if inside dual dialogue column
        if (isInsideDualDialogue($from)) {
          // Inside dual dialogue: add another dialogue line in same column
          const endOfNode = $from.after();
          return this.editor.chain()
            .insertContentAt(endOfNode, { type: 'dialogue' })
            .focus(endOfNode + 1)
            .run();
        }

        // Normal behavior: At end, insert new Action block after this node
        const endOfNode = $from.after();
        return this.editor.chain()
          .insertContentAt(endOfNode, { type: 'action' })
          .focus(endOfNode + 1)
          .run();
      },

      // Tab: Dialogue → Parenthetical
      // - Empty dialogue: converts block to parenthetical
      // - Non-empty dialogue: splits and inserts parenthetical mid-dialogue
      //   (useful for beats, pauses, hesitations breaking up speech)
      // Inside dual dialogue: cycles within valid column types
      'Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;
        const isEmpty = node.textContent.trim().length === 0;

        // Only handle Tab if we're actually in a dialogue block
        if (node.type.name !== this.name) {
          return false; // Let other handlers process this
        }

        // Empty dialogue: convert to parenthetical
        if (isEmpty) {
          // Check if inside dual dialogue - use column-specific cycling
          if (isInsideDualDialogue($from)) {
            const nextType = getNextColumnElementType(this.name);
            if (nextType === 'parenthetical') {
              return this.editor.commands.setParenthetical();
            }
            return this.editor.commands.setNode(nextType);
          }
          // Normal behavior: use setParenthetical to get automatic () insertion
          return this.editor.commands.setParenthetical();
        }

        // Non-empty dialogue: split and insert parenthetical mid-dialogue
        // This creates: [dialogue before cursor] [parenthetical] [dialogue after cursor]
        const cursorOffset = $from.parentOffset;
        const textContent = node.textContent;
        const textBefore = textContent.slice(0, cursorOffset).trimEnd();
        const textAfter = textContent.slice(cursorOffset).trimStart();

        // Get position before the dialogue node for replacement
        const beforeNode = $from.before();

        return this.editor.chain()
          .command(({ tr, dispatch }) => {
            if (!dispatch) return true;

            const schema = tr.doc.type.schema;
            const nodes = [];

            // First dialogue (text before cursor) - only if there's content
            if (textBefore.length > 0) {
              nodes.push(schema.nodes.dialogue.create(null,
                textBefore ? schema.text(textBefore) : null
              ));
            }

            // Parenthetical with empty () - cursor will go between them
            nodes.push(schema.nodes.parenthetical.create(null,
              schema.text('()')
            ));

            // Second dialogue (text after cursor) - only if there's content
            if (textAfter.length > 0) {
              nodes.push(schema.nodes.dialogue.create(null,
                schema.text(textAfter)
              ));
            }

            // Replace the original dialogue node with our new nodes
            tr.replaceWith(beforeNode, $from.after(), nodes);

            // Calculate position to place cursor between () in parenthetical
            // Position after first dialogue (if exists) + into parenthetical + after "("
            let parenPos = beforeNode;
            if (textBefore.length > 0) {
              // Account for first dialogue node: 1 (open) + text + 1 (close)
              parenPos += 1 + textBefore.length + 1;
            }
            // Now at start of parenthetical, go inside: 1 (open tag) + 1 (after "(")
            parenPos += 2;

            tr.setSelection(TextSelection.create(tr.doc, parenPos));

            return true;
          })
          .run();
      },

      // Shift-Tab: Dialogue → Character (go back to who's speaking) - only if empty
      // Inside dual dialogue: cycles within valid column types
      'Shift-Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;
        const isEmpty = node.textContent.trim().length === 0;

        // Only handle Shift-Tab if we're actually in a dialogue block
        if (node.type.name !== this.name) {
          return false;
        }

        // Only change block type if empty - otherwise do nothing
        if (!isEmpty) {
          return false;
        }

        // Check if inside dual dialogue - use column-specific cycling
        if (isInsideDualDialogue($from)) {
          const prevType = getPreviousColumnElementType(this.name);
          if (prevType) {
            return this.editor.commands.setNode(prevType);
          }
          return true; // Consume event but do nothing if no previous type
        }

        // Normal behavior
        const prevType = getPreviousElementType(this.name);
        return this.editor.commands.setNode(prevType);
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

  addInputRules() {
    return createAutoCapitalizeRules();
  },
});
