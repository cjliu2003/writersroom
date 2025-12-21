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
      // Tab: Smart detection for scene headings, otherwise Action → Character
      'Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;
        const text = node.textContent;
        const textUpper = text.toUpperCase().trim();

        console.log('[Action Tab] Handler triggered', {
          nodeType: node.type.name,
          thisName: this.name,
          text,
          textUpper,
          isSceneHeadingMatch: /^(INT|EXT|I\/E)$/i.test(textUpper),
        });

        // Only handle Tab if we're in an action block OR a paragraph (default block type)
        // Paragraphs are treated as action blocks since action is our default element
        if (node.type.name !== this.name && node.type.name !== 'paragraph') {
          console.log('[Action Tab] Skipping - not action or paragraph, returning false');
          return false; // Let other handlers process this
        }

        // Detect scene heading prefix (INT, EXT, I/E)
        // If found, convert to scene heading AND insert ". " in one step
        if (/^(INT|EXT|I\/E)$/i.test(textUpper)) {
          console.log('[Action Tab] Scene heading prefix detected, converting to sceneHeading');
          const result = this.editor.chain()
            .setTextSelection($from.end())
            .setNode('sceneHeading')
            .insertContent('. ')
            .run();
          console.log('[Action Tab] Chain result:', result);
          return result;
        }

        // Default behavior: Action → Character
        console.log('[Action Tab] Default behavior: converting to Character');
        const nextType = getNextElementType(this.name);
        return this.editor.commands.setNode(nextType);
      },

      // Shift-Tab: Action → Dialogue (go back to speech)
      'Shift-Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle Shift-Tab if we're in action or paragraph
        if (node.type.name !== this.name && node.type.name !== 'paragraph') {
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
});
