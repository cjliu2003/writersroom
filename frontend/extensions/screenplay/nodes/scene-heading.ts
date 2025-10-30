/**
 * Scene Heading (Slug Line) Extension
 *
 * Purpose: Introduces a new scene by establishing location and time
 * Format: ALL CAPS, bold, flush with left margin
 * Structure: INT./EXT. LOCATION - TIME OF DAY
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { getNextElementType } from '../utils/keyboard-navigation';

export const SceneHeading = Node.create({
  name: 'sceneHeading',

  group: 'block',

  content: 'inline*',

  defining: true, // Mark as structural boundary

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
      // Tab cycles to next element type
      'Tab': () => {
        const nextType = getNextElementType(this.name);
        return this.editor.commands.setNode(nextType);
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
