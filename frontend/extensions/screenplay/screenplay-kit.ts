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

// Plugins
import { SmartEnterPlugin } from './plugins/smart-enter-plugin';

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
}

export const ScreenplayKit = Extension.create<ScreenplayKitOptions>({
  name: 'screenplayKit',

  addExtensions() {
    return [
      SceneHeading,
      Action,
      Character,
      Dialogue,
      Parenthetical,
      Transition,
    ];
  },

  addProseMirrorPlugins() {
    const plugins = [];

    // Add Smart Enter plugin if enabled (default: true)
    if (this.options.enableSmartEnter !== false) {
      plugins.push(SmartEnterPlugin());
    }

    // TODO: Add Smart Page Breaks plugin when Phase 3 is implemented
    // if (this.options.enableSmartPageBreaks) {
    //   plugins.push(SmartPageBreaksPlugin());
    // }

    return plugins;
  },
});

// Export all node extensions for individual use if needed
export { SceneHeading, Action, Character, Dialogue, Parenthetical, Transition };

// Export types
export type { ScreenplayElementType } from './types';
export { ELEMENT_CYCLE, SMART_ENTER_TRANSITIONS } from './types';
