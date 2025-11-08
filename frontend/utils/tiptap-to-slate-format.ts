/**
 * TipTap to Slate Format Converter
 *
 * Converts TipTap/ProseMirror document format to Slate format
 * for compatibility with components expecting Slate structure
 * (like ScriptSceneSidebar).
 *
 * TipTap Format:
 * {
 *   type: "sceneHeading",
 *   content: [{ type: "text", text: "..." }]
 * }
 *
 * Slate Format:
 * {
 *   type: "scene-heading",
 *   children: [{ text: "..." }]
 * }
 */

import { JSONContent } from '@tiptap/core';
import { ScreenplayElement } from '@/types/screenplay';

/**
 * Type mapping from TipTap camelCase to Slate kebab-case
 */
const TIPTAP_TO_SLATE_TYPE_MAP: Record<string, string> = {
  'sceneHeading': 'scene-heading',
  'action': 'action',
  'character': 'character',
  'dialogue': 'dialogue',
  'parenthetical': 'parenthetical',
  'transition': 'transition',
  'shot': 'shot',
  'paragraph': 'general',
};

/**
 * Convert a single TipTap node to Slate format
 */
function convertTipTapNodeToSlate(node: JSONContent): ScreenplayElement | null {
  if (!node.type) return null;

  // Map TipTap type to Slate type
  const slateType = TIPTAP_TO_SLATE_TYPE_MAP[node.type] || node.type;

  // Extract text content from TipTap's nested text nodes
  let children: { text: string }[] = [];

  if (node.content && node.content.length > 0) {
    // Filter for text nodes and extract text
    const textNodes = node.content
      .filter(child => child.type === 'text')
      .map(child => ({ text: child.text || '' }));

    children = textNodes.length > 0 ? textNodes : [{ text: '' }];
  } else {
    // Empty node gets empty text child
    children = [{ text: '' }];
  }

  return {
    type: slateType as any,
    children,
  };
}

/**
 * Convert TipTap/ProseMirror JSON document to Slate format array
 *
 * @param tipTapDoc - TipTap editor JSON document (from editor.getJSON())
 * @returns Array of Slate-formatted screenplay elements
 *
 * @example
 * const tipTapContent = editor.getJSON();
 * const slateContent = convertTipTapToSlate(tipTapContent);
 * // Pass to ScriptSceneSidebar's scriptContent prop
 */
export function convertTipTapToSlate(tipTapDoc: JSONContent): ScreenplayElement[] {
  if (!tipTapDoc || !tipTapDoc.content || tipTapDoc.content.length === 0) {
    return [];
  }

  // Convert each top-level node in the document
  const slateElements = tipTapDoc.content
    .map(node => convertTipTapNodeToSlate(node))
    .filter((element): element is ScreenplayElement => element !== null);

  return slateElements;
}

/**
 * Extract live content from TipTap editor in Slate format
 *
 * Convenience function that gets current editor JSON and converts it.
 *
 * @param editor - TipTap Editor instance
 * @returns Array of Slate-formatted screenplay elements
 *
 * @example
 * const slateContent = extractSlateContentFromTipTap(editor);
 * <ScriptSceneSidebar scriptContent={slateContent} ... />
 */
export function extractSlateContentFromTipTap(editor: any): ScreenplayElement[] {
  if (!editor) return [];

  try {
    const tipTapDoc = editor.getJSON();
    return convertTipTapToSlate(tipTapDoc);
  } catch (error) {
    console.warn('[TipTapToSlate] Error extracting content:', error);
    return [];
  }
}
