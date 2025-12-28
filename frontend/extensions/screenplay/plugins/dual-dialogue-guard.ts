/**
 * Dual Dialogue Guard Plugin
 *
 * Safety net plugin that detects invalid dual dialogue column states
 * and auto-unwraps the block to prevent editor crashes or corruption.
 *
 * Invalid states detected:
 * - Column missing a character as first child
 * - Column with no children at all
 * - Column with wrong node type as first child
 *
 * Recovery strategy: Unwrap entire dualDialogueBlock to flat nodes.
 * This is safer than trying to repair the structure, as it preserves
 * all content and returns to a known-good state.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';

export const DualDialogueGuardKey = new PluginKey('dualDialogueGuard');

/**
 * Info about an invalid dual dialogue block that needs unwrapping
 */
interface InvalidBlock {
  /** Position before the block */
  start: number;
  /** Position after the block */
  end: number;
  /** The block node itself */
  node: ProseMirrorNode;
  /** Reason for invalidity (for logging) */
  reason: string;
}

/**
 * Check if a dualDialogueColumn has valid structure.
 * Valid structure: character as first child, with meaningful content
 *
 * Invalid cases:
 * - Column has no children
 * - First child is not a character
 * - Column is "effectively empty" (only empty character, no dialogue)
 */
function isColumnValid(column: ProseMirrorNode): { valid: boolean; reason?: string } {
  if (column.type.name !== 'dualDialogueColumn') {
    return { valid: false, reason: 'not a column node' };
  }

  if (column.childCount === 0) {
    return { valid: false, reason: 'column is empty' };
  }

  const firstChild = column.child(0);
  if (firstChild.type.name !== 'character') {
    return { valid: false, reason: `first child is '${firstChild.type.name}', expected 'character'` };
  }

  // Check if column is "effectively empty" - only has an empty character
  // This happens when user deletes all content from a column
  const characterIsEmpty = firstChild.textContent.trim().length === 0;
  const hasNoDialogue = column.childCount === 1; // Only the character, no dialogue/parenthetical

  if (characterIsEmpty && hasNoDialogue) {
    return { valid: false, reason: 'column has only empty character (no content)' };
  }

  return { valid: true };
}

/**
 * Check if a dualDialogueBlock has valid structure.
 * Valid structure: exactly 2 columns, each with valid content
 */
function isBlockValid(block: ProseMirrorNode): { valid: boolean; reason?: string } {
  if (block.type.name !== 'dualDialogueBlock') {
    return { valid: false, reason: 'not a block node' };
  }

  if (block.childCount !== 2) {
    return { valid: false, reason: `block has ${block.childCount} children, expected 2` };
  }

  // Check left column
  const leftColumn = block.child(0);
  const leftCheck = isColumnValid(leftColumn);
  if (!leftCheck.valid) {
    return { valid: false, reason: `left column invalid: ${leftCheck.reason}` };
  }

  // Check right column
  const rightColumn = block.child(1);
  const rightCheck = isColumnValid(rightColumn);
  if (!rightCheck.valid) {
    return { valid: false, reason: `right column invalid: ${rightCheck.reason}` };
  }

  return { valid: true };
}

/**
 * Find all invalid dual dialogue blocks in the document
 */
function findInvalidBlocks(doc: ProseMirrorNode): InvalidBlock[] {
  const invalidBlocks: InvalidBlock[] = [];
  let pos = 0;

  doc.forEach((node, offset) => {
    if (node.type.name === 'dualDialogueBlock') {
      const check = isBlockValid(node);
      if (!check.valid) {
        invalidBlocks.push({
          start: pos,
          end: pos + node.nodeSize,
          node,
          reason: check.reason || 'unknown',
        });
      }
    }
    pos += node.nodeSize;
  });

  return invalidBlocks;
}

/**
 * Extract flat nodes from a dual dialogue block for unwrapping
 */
function extractFlatNodes(block: ProseMirrorNode): ProseMirrorNode[] {
  const flatNodes: ProseMirrorNode[] = [];

  block.forEach((column) => {
    if (column.type.name === 'dualDialogueColumn') {
      column.forEach((child) => {
        // Copy node to ensure clean state
        flatNodes.push(child.copy(child.content));
      });
    }
  });

  return flatNodes;
}

/**
 * Creates the Dual Dialogue Guard plugin
 */
export function DualDialogueGuardPlugin(): Plugin {
  return new Plugin({
    key: DualDialogueGuardKey,

    appendTransaction(transactions, oldState, newState) {
      // Only check if document changed
      const docChanged = transactions.some(tr => tr.docChanged);
      if (!docChanged) {
        return null;
      }

      // Find any invalid dual dialogue blocks
      const invalidBlocks = findInvalidBlocks(newState.doc);

      if (invalidBlocks.length === 0) {
        return null;
      }

      // Log what we're fixing
      console.warn('[DualDialogueGuard] Detected invalid dual dialogue structure:');
      invalidBlocks.forEach((block, i) => {
        console.warn(`  Block ${i + 1}: ${block.reason} (pos ${block.start}-${block.end})`);
      });

      // Create transaction to unwrap all invalid blocks
      const tr = newState.tr;

      // Process in reverse order to maintain position validity
      for (let i = invalidBlocks.length - 1; i >= 0; i--) {
        const block = invalidBlocks[i];
        const flatNodes = extractFlatNodes(block.node);

        if (flatNodes.length > 0) {
          // Replace block with flat nodes
          tr.replaceWith(block.start, block.end, flatNodes);
          console.log(`[DualDialogueGuard] Unwrapped block at ${block.start}-${block.end} to ${flatNodes.length} flat nodes`);
        } else {
          // No content to preserve - just delete the block
          tr.delete(block.start, block.end);
          console.log(`[DualDialogueGuard] Deleted empty invalid block at ${block.start}-${block.end}`);
        }
      }

      return tr;
    },
  });
}
