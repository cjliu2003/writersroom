/**
 * Content Blocks Converter
 *
 * Bidirectional conversion between backend content_blocks format and TipTap/ProseMirror JSON.
 *
 * Backend Format (Editor-Agnostic):
 * {
 *   type: "scene_heading" | "action" | "character" | "dialogue" | "parenthetical" | "transition",
 *   text: string,
 *   metadata: {}
 * }
 *
 * TipTap Format (ProseMirror JSON):
 * {
 *   type: "doc",
 *   content: [
 *     {
 *       type: "scene-heading" | "action" | "character" | "dialogue" | "parenthetical" | "transition",
 *       content: [{ type: "text", text: string }]
 *     }
 *   ]
 * }
 */

import { JSONContent } from '@tiptap/core';

/**
 * Backend content block format (from FDX parser and database)
 */
export interface ContentBlock {
  type: string;
  text: string;
  metadata?: Record<string, any>;
}

/**
 * Type mapping between backend snake_case and TipTap kebab-case
 */
const BACKEND_TO_TIPTAP_TYPE_MAP: Record<string, string> = {
  'scene_heading': 'sceneHeading',
  'action': 'action',
  'character': 'character',
  'dialogue': 'dialogue',
  'parenthetical': 'parenthetical',
  'transition': 'transition',
  'shot': 'shot',
  'general': 'paragraph', // Fallback for unknown types
};

const TIPTAP_TO_BACKEND_TYPE_MAP: Record<string, string> = {
  'sceneHeading': 'scene_heading',
  'action': 'action',
  'character': 'character',
  'dialogue': 'dialogue',
  'parenthetical': 'parenthetical',
  'transition': 'transition',
  'shot': 'shot',
  'paragraph': 'general',
};

/**
 * Convert backend content_blocks array to TipTap/ProseMirror JSON document
 *
 * @param blocks - Array of content blocks from backend
 * @returns TipTap JSONContent document
 *
 * @example
 * const blocks = [
 *   { type: "scene_heading", text: "INT. COFFEE SHOP - DAY", metadata: {} },
 *   { type: "action", text: "John sits at a table.", metadata: {} }
 * ];
 * const tipTapDoc = contentBlocksToTipTap(blocks);
 * editor.commands.setContent(tipTapDoc);
 */
export function contentBlocksToTipTap(blocks: ContentBlock[]): JSONContent {
  if (!blocks || blocks.length === 0) {
    // Return empty document with a scene heading (screenplay convention)
    return {
      type: 'doc',
      content: [
        {
          type: 'sceneHeading',
          content: []
        }
      ]
    };
  }

  const content: JSONContent[] = blocks.map(block => {
    // Map backend type to TipTap type
    const tipTapType = BACKEND_TO_TIPTAP_TYPE_MAP[block.type] || 'paragraph';

    // Handle empty text (TipTap requires at least empty content array)
    const textContent = block.text || '';

    return {
      type: tipTapType,
      content: textContent ? [
        {
          type: 'text',
          text: textContent
        }
      ] : [] // Empty content for blank elements
    };
  });

  return {
    type: 'doc',
    content
  };
}

/**
 * Convert TipTap/ProseMirror JSON document to backend content_blocks array
 *
 * @param doc - TipTap JSONContent document
 * @returns Array of content blocks in backend format
 *
 * @example
 * const tipTapDoc = editor.getJSON();
 * const blocks = tipTapToContentBlocks(tipTapDoc);
 * await fetch('/api/scripts/123', {
 *   method: 'PATCH',
 *   body: JSON.stringify({ content_blocks: blocks })
 * });
 */
export function tipTapToContentBlocks(doc: JSONContent): ContentBlock[] {
  if (!doc || !doc.content || doc.content.length === 0) {
    return [];
  }

  return doc.content
    .filter(node => node.type && node.type !== 'doc') // Filter out doc nodes
    .map(node => {
      // Map TipTap type to backend type
      const backendType = TIPTAP_TO_BACKEND_TYPE_MAP[node.type || 'paragraph'] || 'general';

      // Extract text content (handle nested text nodes)
      let text = '';
      if (node.content && node.content.length > 0) {
        text = node.content
          .filter(child => child.type === 'text')
          .map(child => child.text || '')
          .join('');
      }

      return {
        type: backendType,
        text: text,
        metadata: {}
      };
    });
}

/**
 * Validate content blocks array structure
 *
 * @param blocks - Content blocks to validate
 * @returns True if valid, false otherwise
 */
export function validateContentBlocks(blocks: any[]): blocks is ContentBlock[] {
  if (!Array.isArray(blocks)) {
    return false;
  }

  return blocks.every(block =>
    typeof block === 'object' &&
    block !== null &&
    typeof block.type === 'string' &&
    typeof block.text === 'string'
  );
}

/**
 * Validate TipTap document structure
 *
 * @param doc - TipTap document to validate
 * @returns True if valid, false otherwise
 */
export function validateTipTapDocument(doc: any): doc is JSONContent {
  return (
    typeof doc === 'object' &&
    doc !== null &&
    doc.type === 'doc' &&
    Array.isArray(doc.content)
  );
}

/**
 * Convert content blocks with error handling and logging
 *
 * @param blocks - Content blocks to convert
 * @returns TipTap document or null if conversion fails
 */
export function safeContentBlocksToTipTap(blocks: any[]): JSONContent | null {
  try {
    if (!validateContentBlocks(blocks)) {
      console.error('[ContentBlocksConverter] Invalid content blocks format:', blocks);
      return null;
    }

    const doc = contentBlocksToTipTap(blocks);

    if (!validateTipTapDocument(doc)) {
      console.error('[ContentBlocksConverter] Generated invalid TipTap document:', doc);
      return null;
    }

    console.log('[ContentBlocksConverter] Converted', blocks.length, 'blocks to TipTap document');
    return doc;
  } catch (error) {
    console.error('[ContentBlocksConverter] Conversion error:', error);
    return null;
  }
}

/**
 * Convert TipTap document with error handling and logging
 *
 * @param doc - TipTap document to convert
 * @returns Content blocks array or null if conversion fails
 */
export function safeTipTapToContentBlocks(doc: any): ContentBlock[] | null {
  try {
    if (!validateTipTapDocument(doc)) {
      console.error('[ContentBlocksConverter] Invalid TipTap document format:', doc);
      return null;
    }

    const blocks = tipTapToContentBlocks(doc);

    if (!validateContentBlocks(blocks)) {
      console.error('[ContentBlocksConverter] Generated invalid content blocks:', blocks);
      return null;
    }

    console.log('[ContentBlocksConverter] Converted TipTap document to', blocks.length, 'blocks');
    return blocks;
  } catch (error) {
    console.error('[ContentBlocksConverter] Conversion error:', error);
    return null;
  }
}

/**
 * Get statistics about content blocks
 *
 * @param blocks - Content blocks to analyze
 * @returns Statistics object
 */
export function getContentBlocksStats(blocks: ContentBlock[]) {
  const typeCounts: Record<string, number> = {};
  let totalCharacters = 0;
  let totalWords = 0;

  blocks.forEach(block => {
    // Count by type
    typeCounts[block.type] = (typeCounts[block.type] || 0) + 1;

    // Count characters and words
    totalCharacters += block.text.length;
    totalWords += block.text.split(/\s+/).filter(w => w.length > 0).length;
  });

  return {
    totalBlocks: blocks.length,
    typeCounts,
    totalCharacters,
    totalWords,
    averageWordsPerBlock: blocks.length > 0 ? totalWords / blocks.length : 0
  };
}
