/**
 * Dual Dialogue Block Extension
 *
 * A wrapper node that contains exactly two dualDialogueColumn nodes,
 * enabling side-by-side display of two characters speaking simultaneously.
 *
 * Schema: dualDialogueColumn dualDialogueColumn
 * - Exactly two columns (left and right)
 *
 * Keyboard behavior:
 * - Escape: Exit dual dialogue, create action after block
 *
 * CSS: Uses CSS Grid for two-column layout (see styles/screenplay.css)
 */

import { Node, mergeAttributes } from '@tiptap/core';

export const DualDialogueBlock = Node.create({
  name: 'dualDialogueBlock',

  // Part of block group - valid at document level
  group: 'block',

  // Contains exactly two columns
  content: 'dualDialogueColumn dualDialogueColumn',

  // Structural boundary
  defining: true,

  // Prevent content from being joined with surrounding blocks
  isolating: true,

  parseHTML() {
    return [
      { tag: 'div[data-type="dual-dialogue-block"]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'dual-dialogue-block',
      'class': 'dual-dialogue-block',
    }), 0];
  },

  addKeyboardShortcuts() {
    return {
      // Escape: Exit dual dialogue block, create action after it
      'Escape': ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;

        // Check if we're inside a dualDialogueBlock
        let blockDepth = -1;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'dualDialogueBlock') {
            blockDepth = d;
            break;
          }
        }

        if (blockDepth === -1) {
          return false; // Not inside dual dialogue block
        }

        // Get position after the block
        const endOfBlock = $from.after(blockDepth);

        // Insert action block after dual dialogue and focus it
        return editor.chain()
          .insertContentAt(endOfBlock, { type: 'action' })
          .focus(endOfBlock + 1)
          .run();
      },
    };
  },
});
