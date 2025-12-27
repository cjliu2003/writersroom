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
      // Enter: Only works at the END of text - creates new Action block
      // In the middle of text, Enter does nothing (Final Draft behavior)
      'Enter': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;

        // Only handle if we're in a scene heading
        if (node.type.name !== this.name) {
          return false;
        }

        // Check if cursor is at the very end of the node content
        const isAtEnd = $from.parentOffset === node.content.size;

        if (!isAtEnd) {
          // Block Enter in the middle of scene heading
          return true;
        }

        // At end: insert new Action block after this node
        const endOfNode = $from.after();
        return this.editor.chain()
          .insertContentAt(endOfNode, { type: 'action' })
          .focus(endOfNode + 1)
          .run();
      },

      // Tab: Scene heading Tab behavior
      // - Empty: convert to Action
      // - With prefix + location: add dash separator for multi-segment headings
      // - Prefix suggestions are handled by SmartType
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

        // Get node boundaries
        const nodeEnd = $from.end();

        // Empty → convert to Action (cycle to next element type)
        if (textUpper === '') {
          return this.editor.commands.setNode('action');
        }

        // Has "PREFIX." with content after → add dash separator
        // This supports multi-segment headings: "INT. COFFEE SHOP - BACK ROOM - DAY"
        const prefixMatch = textUpper.match(/^(INT|EXT|I\/E|INT\.?\/?EXT\.?|EXT\.?\/?INT\.?)\.\s*/i);
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

        // Otherwise, let SmartType handle it or do nothing
        return false;
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
