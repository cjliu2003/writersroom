/**
 * Scene Heading (Slug Line) Extension
 *
 * Purpose: Introduces a new scene by establishing location and time
 * Format: ALL CAPS, bold, flush with left margin
 * Structure: INT./EXT. LOCATION - TIME OF DAY
 *
 * Tab Behavior:
 * - Tab builds the scene heading structure step by step
 * - Tab NEVER changes element type (use Enter to move to Action)
 * - Empty → INT.
 * - Partial prefix (I, E, etc.) → complete prefix
 * - Complete prefix → add ". "
 * - After location → add " - "
 * - After dash/complete → do nothing (consume Tab)
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { getPreviousElementType } from '../utils/keyboard-navigation';

export const SceneHeading = Node.create({
  name: 'sceneHeading',

  group: 'block',

  content: 'inline*',

  defining: true,

  parseHTML() {
    return [
      { tag: 'p[data-type="scene-heading"]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'scene-heading',
      class: 'screenplay-scene-heading',
    }), 0];
  },

  addKeyboardShortcuts() {
    return {
      // Tab: Build scene heading structure (NEVER changes element type)
      'Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle Tab if we're in a scene heading
        if (node.type.name !== this.name) {
          return false;
        }

        const text = node.textContent;
        const textUpper = text.toUpperCase().trim();

        console.log('[SceneHeading Tab]', { text, textUpper });

        // Get node boundaries for reliable text replacement
        const nodeStart = $from.start();
        const nodeEnd = $from.end();

        // STEP 1: Empty → default to "INT. "
        if (textUpper === '') {
          return this.editor.chain()
            .insertContentAt({ from: nodeStart, to: nodeEnd }, 'INT. ')
            .run();
        }

        // STEP 2: Partial or complete prefix without period
        // I, IN → INT.    |  E, EX → EXT.    |  I/ → I/E.    |  INT, EXT, I/E → add ". "
        if (/^I$/i.test(textUpper) || /^IN$/i.test(textUpper)) {
          return this.editor.chain()
            .insertContentAt({ from: nodeStart, to: nodeEnd }, 'INT. ')
            .run();
        }
        if (/^E$/i.test(textUpper) || /^EX$/i.test(textUpper)) {
          return this.editor.chain()
            .insertContentAt({ from: nodeStart, to: nodeEnd }, 'EXT. ')
            .run();
        }
        if (/^I\/$/i.test(textUpper)) {
          return this.editor.chain()
            .insertContentAt({ from: nodeStart, to: nodeEnd }, 'I/E. ')
            .run();
        }
        if (/^(INT|EXT|I\/E)$/i.test(textUpper)) {
          // Preserve case, just add ". "
          return this.editor.chain()
            .setTextSelection(nodeEnd)
            .insertContent('. ')
            .run();
        }

        // STEP 3: Has "PREFIX." with content after → add dash separator
        // This repeats as many times as user wants (for multi-segment headings)
        // e.g., "INT. COFFEE SHOP - BACK ROOM - DAY"
        const prefixMatch = textUpper.match(/^(INT|EXT|I\/E)\.\s*/i);
        if (prefixMatch) {
          const afterPrefix = textUpper.slice(prefixMatch[0].length);

          // If we have any content after prefix → add dash
          if (afterPrefix.length > 0) {
            const endsWithSpace = text.endsWith(' ');
            const insertion = endsWithSpace ? '- ' : ' - ';
            return this.editor.chain()
              .setTextSelection(nodeEnd)
              .insertContent(insertion)
              .run();
          }
        }

        // STEP 4: Just "INT. " with no content yet - do nothing, wait for typing
        console.log('[SceneHeading Tab] Waiting for content');
        return true;
      },

      // Shift-Tab: Go to previous element type (Transition)
      'Shift-Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle Shift-Tab if we're actually in a scene heading
        if (node.type.name !== this.name) {
          return false;
        }

        const prevType = getPreviousElementType(this.name);
        return this.editor.commands.setNode(prevType);
      },

      // Cmd/Ctrl+Alt+1: Direct shortcut to Scene Heading
      'Mod-Alt-1': () => this.editor.commands.setNode(this.name),
    };
  },

  addCommands() {
    return {
      setSceneHeading: () => ({ commands }) => {
        return commands.setNode(this.name);
      },
    };
  },

  addInputRules() {
    // TODO: Add input rule to auto-convert lines starting with INT./EXT. to scene heading
    // Example: nodeInputRule({ find: /^(INT\.|EXT\.)\s/i, type: this.type })
    return [];
  },
});
