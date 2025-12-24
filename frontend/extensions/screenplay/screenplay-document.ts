/**
 * Screenplay Document Extension
 *
 * Custom Document node that enforces screenplay structure:
 * - First block MUST be a sceneHeading (screenplay convention)
 * - Followed by any number of block elements
 *
 * This ensures ProseMirror's createAndFill() always creates a sceneHeading
 * as the first block for new/empty documents, fixing the issue where
 * y-prosemirror would default to paragraph due to StarterKit's Document
 * having content: 'block+'.
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
   * Content schema: sceneHeading followed by any blocks
   *
   * - 'sceneHeading': Required first element (screenplay convention)
   * - 'block*': Zero or more additional block elements
   *
   * When ProseMirror needs to create an empty document (via createAndFill()),
   * it will create a sceneHeading as the first child because the schema
   * requires it.
   */
  content: 'sceneHeading block*',
});
