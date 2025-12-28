/**
 * ScreenplayKit Extension Bundle
 *
 * Bundles all screenplay node extensions and the Smart Enter plugin
 * into a single extension for easy integration with TipTap editor.
 *
 * Usage:
 * ```typescript
 * import { ScreenplayKit } from '@/extensions/screenplay/screenplay-kit';
 *
 * const editor = useEditor({
 *   extensions: [
 *     ScreenplayKit,
 *     // ... other extensions
 *   ],
 * });
 * ```
 */

import { Extension } from '@tiptap/core';

// Node extensions
import { SceneHeading } from './nodes/scene-heading';
import { Action } from './nodes/action';
import { Character } from './nodes/character';
import { Dialogue } from './nodes/dialogue';
import { Parenthetical } from './nodes/parenthetical';
import { Transition } from './nodes/transition';

// Dual dialogue wrapper nodes
import { DualDialogueColumn } from './nodes/dual-dialogue-column';
import { DualDialogueBlock } from './nodes/dual-dialogue-block';

// Plugins
import { SmartEnterPlugin } from './plugins/smart-enter-plugin';
import { SmartBreaksPlugin } from './plugins/smart-breaks-plugin';
import { DualDialogueMigrationPlugin } from './plugins/dual-dialogue-migration';
import { DualDialogueGuardPlugin } from './plugins/dual-dialogue-guard';

// SmartType autocomplete
import { SmartTypeExtension } from './smart-type';

// Dual dialogue toggle
import { toggleDualDialogue } from './dual-dialogue';

export interface ScreenplayKitOptions {
  /**
   * Enable/disable Smart Enter plugin for element transitions
   * @default true
   */
  enableSmartEnter?: boolean;

  /**
   * Enable/disable smart page breaks (Phase 3 feature)
   * @default false
   */
  enableSmartPageBreaks?: boolean;

  /**
   * Enable/disable SmartType autocomplete for characters and locations
   * @default true
   */
  enableSmartType?: boolean;
}

// Valid screenplay element types for type checking
const SCREENPLAY_TYPES = ['sceneHeading', 'action', 'character', 'dialogue', 'parenthetical', 'transition'];

export const ScreenplayKit = Extension.create<ScreenplayKitOptions>({
  name: 'screenplayKit',

  addExtensions() {
    // Use any[] to allow mixing Node and Extension types
    // TipTap's addExtensions() accepts any extension type
    const extensions: any[] = [
      SceneHeading,
      Action,
      Character,
      Dialogue,
      Parenthetical,
      Transition,
      // Dual dialogue wrapper nodes (column must come before block for schema resolution)
      DualDialogueColumn,
      DualDialogueBlock,
    ];

    // Add SmartType if enabled (default: true)
    if (this.options.enableSmartType !== false) {
      extensions.push(SmartTypeExtension);
    }

    return extensions;
  },

  addKeyboardShortcuts() {
    return {
      // Dual dialogue toggle - Cmd+D (Mac) or Ctrl+D (Windows/Linux)
      'Mod-d': () => toggleDualDialogue(this.editor),

      // Fallback Tab handler - catches Tab presses not handled by specific node extensions
      // This ensures Tab always does something sensible even in edge cases
      'Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const currentType = $from.parent.type.name;

        console.log('[ScreenplayKit] Fallback Tab handler for:', currentType);

        // If we're in an unknown/non-screenplay type, convert to action (default element)
        if (!SCREENPLAY_TYPES.includes(currentType)) {
          console.log('[ScreenplayKit] Unknown type, converting to action');
          return this.editor.commands.setNode('action');
        }

        // For screenplay types, the specific node handlers should have caught this
        // Return false to allow default Tab behavior (indent if applicable)
        return false;
      },

      // Fallback Shift-Tab handler for consistency
      'Shift-Tab': () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const currentType = $from.parent.type.name;

        console.log('[ScreenplayKit] Fallback Shift-Tab handler for:', currentType);

        // If we're in an unknown type, convert to action
        if (!SCREENPLAY_TYPES.includes(currentType)) {
          console.log('[ScreenplayKit] Unknown type, converting to action');
          return this.editor.commands.setNode('action');
        }

        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    const plugins = [];

    // Add Smart Enter plugin if enabled (default: true)
    if (this.options.enableSmartEnter !== false) {
      plugins.push(SmartEnterPlugin());
    }

    // Add Smart Page Breaks plugin if enabled (default: false)
    if (this.options.enableSmartPageBreaks === true) {
      plugins.push(SmartBreaksPlugin({
        schemaNames: {
          sceneHeading: 'sceneHeading',
          action: 'action',
          character: 'character',
          parenthetical: 'parenthetical',
          dialogue: 'dialogue',
          transition: 'transition',
        },
        moreText: '(MORE)',
        contdText: " (CONT'D)",
        safetyPx: 4,
      }));
    }

    // Dual dialogue migration plugin - runs once on document load
    // Converts legacy flat isDualDialogue=true structure to wrapper nodes
    plugins.push(DualDialogueMigrationPlugin());

    // Dual dialogue guard plugin - safety net for invalid column states
    // Auto-unwraps if structure becomes invalid (e.g., character deleted)
    plugins.push(DualDialogueGuardPlugin());

    return plugins;
  },
});

// Export all node extensions for individual use if needed
export { SceneHeading, Action, Character, Dialogue, Parenthetical, Transition };

// Export types
export type { ScreenplayElementType } from './types';
export { ELEMENT_CYCLE, SMART_ENTER_TRANSITIONS } from './types';

// Export SmartType for external use (popup component)
export { SmartTypeExtension, SmartTypePopup, SmartTypePluginKey } from './smart-type';
export type { SmartTypeState, SmartTypeOptions } from './smart-type';
