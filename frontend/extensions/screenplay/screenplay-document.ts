/**
 * Screenplay Document Extension
 *
 * Custom Document node that enforces screenplay structure:
 * - First block defaults to sceneHeading (screenplay convention)
 * - User can change first block to any screenplay element type
 * - Followed by any number of block elements
 *
 * This ensures ProseMirror's createAndFill() creates a sceneHeading
 * as the first block for new/empty documents (since it's listed first
 * in the alternation), while still allowing users to Tab-cycle or
 * manually switch to other element types.
 *
 * Usage:
 * ```typescript
 * import { ScreenplayDocument } from '@/extensions/screenplay/screenplay-document';
 *
 * const editor = useEditor({
 *   extensions: [
 *     ScreenplayDocument,
 *     StarterKit.configure({ document: false }), // Disable StarterKit's Document
 *     // ... other extensions
 *   ],
 * });
 * ```
 */

import { Node } from '@tiptap/core';

export const ScreenplayDocument = Node.create({
  name: 'doc',

  topNode: true,

  /**
   * Content schema: any screenplay element first, followed by any blocks
   *
   * - First position: sceneHeading listed first (default for empty docs)
   *   but allows any screenplay element type for flexibility
   * - dualDialogueBlock: wrapper node for side-by-side dual dialogue
   * - 'block*': Zero or more additional block elements
   *
   * When ProseMirror needs to create an empty document (via createAndFill()),
   * it will try sceneHeading first since it's the first option in the
   * alternation. Users can then Tab-cycle or use shortcuts to change it.
   */
  content: '(sceneHeading | action | character | dialogue | parenthetical | transition | dualDialogueBlock) block*',
});
