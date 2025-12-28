/**
 * Dual Dialogue Toggle Command (Wrapper-Based)
 *
 * Toggles dual dialogue by wrapping/unwrapping nodes into container structure.
 * Uses dualDialogueBlock and dualDialogueColumn nodes for side-by-side layout.
 *
 * Wrapping (Mod+D in second dialogue group):
 * - Identifies TWO consecutive dialogue groups (left = previous, right = current)
 * - A "dialogue group" is: character node + zero or more dialogue/parenthetical nodes
 * - Groups are terminated by non-dialogue blocks (action, sceneHeading, etc.)
 * - Creates dualDialogueBlock containing two dualDialogueColumn nodes
 * - Moves the identified nodes into the columns
 *
 * Unwrapping (Mod+D inside dualDialogueBlock):
 * - Extracts all nodes from both columns
 * - Replaces the block with flat sequence of nodes (left column first, then right)
 *
 * Edge Cases:
 * - Cursor in first dialogue group: Cannot wrap (no preceding group) → returns false
 * - Only one dialogue group in document: Cannot wrap → returns false
 * - Groups not adjacent (content between them): Cannot wrap → returns false
 * - Cursor already inside dualDialogueBlock: Unwraps instead of wrapping
 */

import { Editor } from '@tiptap/core';
import { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';

// ============================================================
// Utility functions for dual dialogue detection
// Used by node extensions to adapt their keyboard behavior
// ============================================================

/**
 * Check if cursor is inside a dualDialogueColumn.
 * Returns column info if found, null otherwise.
 */
export function findColumnAncestor($pos: ResolvedPos): {
  node: ProseMirrorNode;
  depth: number;
  side: 'left' | 'right';
  start: number;
  end: number;
} | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'dualDialogueColumn') {
      return {
        node,
        depth,
        side: (node.attrs.side as 'left' | 'right') || 'left',
        start: $pos.before(depth),
        end: $pos.after(depth),
      };
    }
  }
  return null;
}

/**
 * Check if cursor is inside any dual dialogue structure.
 * Quick check for node extensions to decide on behavior.
 */
export function isInsideDualDialogue($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'dualDialogueBlock' || node.type.name === 'dualDialogueColumn') {
      return true;
    }
  }
  return false;
}

/**
 * Get the valid element types for cycling inside a dual dialogue column.
 * Columns can only contain: character, dialogue, parenthetical
 */
export const COLUMN_VALID_TYPES = ['character', 'dialogue', 'parenthetical'] as const;

/**
 * Get next element type for Tab cycling INSIDE a column.
 * Different from normal screenplay cycling which includes action, sceneHeading, etc.
 */
export function getNextColumnElementType(currentType: string): string {
  const cycle: Record<string, string> = {
    'character': 'dialogue',
    'dialogue': 'parenthetical',
    'parenthetical': 'dialogue', // Back to dialogue, not character
  };
  return cycle[currentType] || 'dialogue';
}

/**
 * Get previous element type for Shift-Tab cycling INSIDE a column.
 * Returns null for character because character is required first in column.
 */
export function getPreviousColumnElementType(currentType: string): string | null {
  const cycle: Record<string, string | null> = {
    'character': null,       // Character is required first - cannot cycle backwards
    'dialogue': 'character',
    'parenthetical': 'dialogue',
  };
  return cycle[currentType] ?? 'dialogue';
}

/**
 * Node types that can be part of a dialogue group
 */
const DIALOGUE_GROUP_TYPES = ['character', 'dialogue', 'parenthetical'];

/**
 * A dialogue group: character + optional dialogue/parenthetical nodes
 */
interface DialogueGroup {
  /** Position where the group starts (before first node) */
  startPos: number;
  /** Position where the group ends (after last node) */
  endPos: number;
  /** All nodes in this group (character first, then dialogue/parenthetical) */
  nodes: ProseMirrorNode[];
}

/**
 * Info about a dualDialogueBlock ancestor
 */
interface BlockAncestorInfo {
  node: ProseMirrorNode;
  /** Position before the block node */
  start: number;
  /** Position after the block node */
  end: number;
}

/**
 * Check if cursor is inside a dualDialogueBlock and return its info.
 * Walks up the document tree from cursor position.
 */
function findDualDialogueBlockAncestor($pos: ResolvedPos): BlockAncestorInfo | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'dualDialogueBlock') {
      return {
        node,
        start: $pos.before(depth),
        end: $pos.after(depth),
      };
    }
  }
  return null;
}

/**
 * Find all dialogue groups at the document level.
 *
 * A dialogue group:
 * - Starts with a 'character' node
 * - Contains zero or more 'dialogue' or 'parenthetical' nodes
 * - Is terminated by any other node type (action, sceneHeading, transition, etc.)
 *
 * Groups are only found at the top level of the document.
 * Nodes already inside dualDialogueBlocks are not considered.
 */
function findDialogueGroups(doc: ProseMirrorNode): DialogueGroup[] {
  const groups: DialogueGroup[] = [];
  let currentGroup: DialogueGroup | null = null;
  let pos = 0;

  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    const nodeType = node.type.name;

    // Skip dualDialogueBlocks - their content is already wrapped
    if (nodeType === 'dualDialogueBlock') {
      if (currentGroup) {
        groups.push(currentGroup);
        currentGroup = null;
      }
      pos += node.nodeSize;
      continue;
    }

    if (nodeType === 'character') {
      // Character starts a new group (save previous if exists)
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = {
        startPos: pos,
        endPos: pos + node.nodeSize,
        nodes: [node],
      };
    } else if (currentGroup && (nodeType === 'dialogue' || nodeType === 'parenthetical')) {
      // Dialogue/parenthetical extends current group
      currentGroup.nodes.push(node);
      currentGroup.endPos = pos + node.nodeSize;
    } else {
      // Any other node type terminates the current group
      if (currentGroup) {
        groups.push(currentGroup);
        currentGroup = null;
      }
    }

    pos += node.nodeSize;
  }

  // Don't forget the last group if document ends with dialogue
  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Find which dialogue group contains the given cursor position.
 * Returns the index of the group, or -1 if cursor is not in any group.
 */
function findGroupContainingCursor(groups: DialogueGroup[], cursorPos: number): number {
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    // Check if cursor is within this group's position range
    // Using <= for endPos to handle cursor at end of last node
    if (cursorPos >= group.startPos && cursorPos <= group.endPos) {
      return i;
    }
  }
  return -1;
}

/**
 * Unwrap a dualDialogueBlock into flat nodes.
 *
 * Extracts all content from both columns and replaces the block
 * with the flat sequence (left column nodes first, then right column nodes).
 */
function unwrapDualDialogue(editor: Editor, blockInfo: BlockAncestorInfo): boolean {
  // Collect all nodes from both columns in order
  const flatNodes: ProseMirrorNode[] = [];

  blockInfo.node.forEach((column) => {
    if (column.type.name === 'dualDialogueColumn') {
      column.forEach((child) => {
        // Copy node to ensure clean state (preserves content and marks)
        flatNodes.push(child.copy(child.content));
      });
    }
  });

  if (flatNodes.length === 0) {
    console.log('[DualDialogue] No content to unwrap');
    return false;
  }

  console.log('[DualDialogue] Unwrapping:', flatNodes.map(n => n.type.name).join(', '));

  return editor.chain().focus().command(({ tr, dispatch }) => {
    if (dispatch) {
      // Replace the block with flat nodes
      // ProseMirror's transaction mapping preserves cursor position automatically
      tr.replaceWith(blockInfo.start, blockInfo.end, flatNodes);
    }
    return true;
  }).run();
}

/**
 * Wrap two adjacent dialogue groups into a dualDialogueBlock.
 *
 * Creates the wrapper structure:
 * - dualDialogueBlock
 *   - dualDialogueColumn (side: 'left') containing leftGroup nodes
 *   - dualDialogueColumn (side: 'right') containing rightGroup nodes
 */
function wrapDualDialogue(
  editor: Editor,
  leftGroup: DialogueGroup,
  rightGroup: DialogueGroup
): boolean {
  const { state } = editor;
  const { schema } = state;

  // Verify schema has required node types
  if (!schema.nodes.dualDialogueBlock) {
    console.error('[DualDialogue] Schema missing dualDialogueBlock node type');
    console.error('  Make sure DualDialogueBlock extension is registered');
    return false;
  }
  if (!schema.nodes.dualDialogueColumn) {
    console.error('[DualDialogue] Schema missing dualDialogueColumn node type');
    console.error('  Make sure DualDialogueColumn extension is registered');
    return false;
  }

  // Check that groups are adjacent (no content between them)
  if (leftGroup.endPos !== rightGroup.startPos) {
    console.log('[DualDialogue] Groups are not adjacent - cannot wrap');
    console.log(`  Left ends at ${leftGroup.endPos}, right starts at ${rightGroup.startPos}`);
    console.log('  There is content between the groups that would be lost');
    return false;
  }

  // Create column nodes with copies of the content
  // Using .copy() preserves marks and ensures clean node instances
  const leftColumn = schema.nodes.dualDialogueColumn.create(
    { side: 'left' },
    leftGroup.nodes.map(n => n.copy(n.content))
  );

  const rightColumn = schema.nodes.dualDialogueColumn.create(
    { side: 'right' },
    rightGroup.nodes.map(n => n.copy(n.content))
  );

  // Create the wrapper block
  const dualBlock = schema.nodes.dualDialogueBlock.create(
    null,
    [leftColumn, rightColumn]
  );

  console.log('[DualDialogue] Wrapping into dual dialogue:');
  console.log('  Left column:', leftGroup.nodes.map(n => n.type.name).join(', '));
  console.log('  Right column:', rightGroup.nodes.map(n => n.type.name).join(', '));

  return editor.chain().focus().command(({ tr, dispatch }) => {
    if (dispatch) {
      // Replace from start of left group to end of right group with the new block
      // This atomic operation ensures no content is lost
      tr.replaceWith(leftGroup.startPos, rightGroup.endPos, dualBlock);
    }
    return true;
  }).run();
}

/**
 * Toggle dual dialogue on the current dialogue group.
 *
 * Behavior depends on cursor location:
 *
 * 1. If cursor is inside a dualDialogueBlock:
 *    → Unwrap: Extract all nodes back to flat document structure
 *
 * 2. If cursor is in a dialogue group (character/dialogue/parenthetical):
 *    → Wrap: Pair with preceding dialogue group into dual dialogue
 *    → Fails if cursor is in the FIRST dialogue group (no preceding group)
 *    → Fails if groups are not adjacent (content between them)
 *
 * @param editor - TipTap Editor instance
 * @returns true if toggle was successful, false otherwise
 */
export function toggleDualDialogue(editor: Editor): boolean {
  const { state } = editor;
  const { $from } = state.selection;

  // ============================================================
  // CASE 1: Already inside a dualDialogueBlock → UNWRAP
  // ============================================================
  const blockAncestor = findDualDialogueBlockAncestor($from);

  if (blockAncestor) {
    console.log('[DualDialogue] Cursor inside dual dialogue block → unwrapping');
    return unwrapDualDialogue(editor, blockAncestor);
  }

  // ============================================================
  // CASE 2: Not inside a block → try to WRAP
  // ============================================================

  // Check cursor is in a dialogue-related element
  const currentNode = $from.parent;
  const currentType = currentNode.type.name;

  if (!DIALOGUE_GROUP_TYPES.includes(currentType)) {
    console.log(`[DualDialogue] Cannot toggle - cursor in '${currentType}'`);
    console.log('  Dual dialogue only works with character, dialogue, or parenthetical');
    return false;
  }

  // Find all dialogue groups in the document
  const groups = findDialogueGroups(state.doc);

  if (groups.length === 0) {
    console.log('[DualDialogue] No dialogue groups found in document');
    return false;
  }

  if (groups.length < 2) {
    console.log('[DualDialogue] Need at least 2 dialogue groups for dual dialogue');
    console.log('  Found only 1 group - add another character with dialogue first');
    return false;
  }

  // Find which group contains the cursor
  const cursorPos = $from.pos;
  const cursorGroupIndex = findGroupContainingCursor(groups, cursorPos);

  if (cursorGroupIndex === -1) {
    console.log(`[DualDialogue] Cursor position ${cursorPos} not in any dialogue group`);
    console.log('  Groups:', groups.map(g => `${g.startPos}-${g.endPos}`).join(', '));
    return false;
  }

  // First group cannot initiate dual dialogue
  if (cursorGroupIndex === 0) {
    console.log('[DualDialogue] First dialogue group cannot initiate dual dialogue');
    console.log('  Place cursor in the SECOND character\'s dialogue, then press Cmd+D');
    return false;
  }

  // Get the two groups to wrap (previous group = left, current group = right)
  const leftGroup = groups[cursorGroupIndex - 1];
  const rightGroup = groups[cursorGroupIndex];

  console.log(`[DualDialogue] Pairing group ${cursorGroupIndex - 1} with group ${cursorGroupIndex}`);

  return wrapDualDialogue(editor, leftGroup, rightGroup);
}
