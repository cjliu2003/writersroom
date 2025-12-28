/**
 * Dual Dialogue Column Extension
 *
 * A column container within a dualDialogueBlock that holds one character's
 * dialogue group (character + dialogue/parenthetical elements).
 *
 * Schema: character (dialogue | parenthetical)*
 * - Must start with a character
 * - Followed by zero or more dialogue or parenthetical elements
 *
 * This node is NOT in the 'block' group - it can only exist inside dualDialogueBlock.
 */

import { Node, mergeAttributes } from '@tiptap/core';

export const DualDialogueColumn = Node.create({
  name: 'dualDialogueColumn',

  // Not in 'block' group - only valid inside dualDialogueBlock
  group: '',

  // Column must start with character, followed by dialogue/parenthetical
  // Using * instead of + to allow empty state during editing
  content: 'character (dialogue | parenthetical)*',

  // Structural boundary - prevents content from merging across columns
  defining: true,

  // Isolate from adjacent content (prevents unwanted joins)
  isolating: true,

  addAttributes() {
    return {
      side: {
        default: 'left',
        parseHTML: element => element.getAttribute('data-side') || 'left',
        renderHTML: attributes => ({
          'data-side': attributes.side,
        }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="dual-dialogue-column"]' },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const side = node.attrs.side || 'left';
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'dual-dialogue-column',
      'class': `dual-dialogue-column dual-dialogue-column--${side}`,
    }), 0];
  },
});
