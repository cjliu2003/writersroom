/**
 * Dual Dialogue Migration Plugin
 *
 * One-time migration plugin that converts old flat isDualDialogue=true
 * structure to new wrapper node structure (dualDialogueBlock + dualDialogueColumn).
 *
 * Old format (flat with attributes):
 *   character { isDualDialogue: false }  ← Left character
 *   dialogue { isDualDialogue: false }   ← Left dialogue
 *   character { isDualDialogue: true }   ← Right character (marked as dual)
 *   dialogue { isDualDialogue: true }    ← Right dialogue (marked as dual)
 *
 * New format (wrapper nodes):
 *   dualDialogueBlock
 *     dualDialogueColumn { side: 'left' }
 *       character
 *       dialogue
 *     dualDialogueColumn { side: 'right' }
 *       character
 *       dialogue
 *
 * The plugin runs once on document load via appendTransaction.
 * It detects the old pattern and wraps nodes into the new structure.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';

export const DualDialogueMigrationKey = new PluginKey('dualDialogueMigration');

/**
 * Node types that can be part of a dialogue group
 */
const DIALOGUE_GROUP_TYPES = ['character', 'dialogue', 'parenthetical'];

/**
 * A collected node with its position
 */
interface CollectedNode {
  node: ProseMirrorNode;
  pos: number;
}

/**
 * A dialogue group ready for migration
 */
interface DialogueGroup {
  nodes: CollectedNode[];
  startPos: number;
  endPos: number;
  isDual: boolean;
}

/**
 * A migration target: two adjacent groups to be wrapped
 */
interface MigrationTarget {
  leftGroup: DialogueGroup;
  rightGroup: DialogueGroup;
  startPos: number;
  endPos: number;
}

/**
 * Creates the Dual Dialogue Migration plugin
 */
export function DualDialogueMigrationPlugin(): Plugin {
  let hasMigrated = false;

  return new Plugin({
    key: DualDialogueMigrationKey,

    appendTransaction(transactions, oldState, newState) {
      // Only run once per editor instance
      if (hasMigrated) {
        return null;
      }

      // Only run on initial document load or significant changes
      // Check if any transaction modified the document
      const docChanged = transactions.some(tr => tr.docChanged);

      // If doc hasn't changed and we have content, this is initial load
      // If doc changed, check if we need to migrate
      if (!docChanged && newState.doc.content.size <= 4) {
        // Empty or nearly empty doc, skip
        return null;
      }

      // Find all dialogue groups and identify dual dialogue patterns
      const groups = findDialogueGroups(newState.doc);
      const migrationTargets = findMigrationTargets(groups);

      if (migrationTargets.length === 0) {
        // No old-style dual dialogue found, mark as done
        hasMigrated = true;
        console.log('[DualDialogueMigration] No legacy dual dialogue patterns found');
        return null;
      }

      // Check if schema has required node types
      const schema = newState.schema;
      if (!schema.nodes.dualDialogueBlock || !schema.nodes.dualDialogueColumn) {
        console.error('[DualDialogueMigration] Schema missing dualDialogueBlock or dualDialogueColumn');
        hasMigrated = true;
        return null;
      }

      console.log(`[DualDialogueMigration] Found ${migrationTargets.length} dual dialogue pattern(s) to migrate`);

      // Create transaction for migration
      const tr = newState.tr;

      // Process targets in reverse order to maintain position validity
      for (let i = migrationTargets.length - 1; i >= 0; i--) {
        const target = migrationTargets[i];

        // Create left column content (strip isDualDialogue attribute)
        const leftContent = target.leftGroup.nodes.map(({ node }) =>
          node.type.create(
            { ...node.attrs, isDualDialogue: false },
            node.content,
            node.marks
          )
        );

        // Create right column content (strip isDualDialogue attribute)
        const rightContent = target.rightGroup.nodes.map(({ node }) =>
          node.type.create(
            { ...node.attrs, isDualDialogue: false },
            node.content,
            node.marks
          )
        );

        // Create column nodes
        const leftColumn = schema.nodes.dualDialogueColumn.create(
          { side: 'left' },
          leftContent
        );
        const rightColumn = schema.nodes.dualDialogueColumn.create(
          { side: 'right' },
          rightContent
        );

        // Create the wrapper block
        const dualBlock = schema.nodes.dualDialogueBlock.create(
          null,
          [leftColumn, rightColumn]
        );

        // Replace the flat nodes with the wrapper structure
        tr.replaceWith(target.startPos, target.endPos, dualBlock);

        console.log(`[DualDialogueMigration] Migrated pattern at positions ${target.startPos}-${target.endPos}`);
      }

      hasMigrated = true;
      return tr;
    },
  });
}

/**
 * Find all dialogue groups in the document.
 * A group starts with 'character' and continues with 'dialogue' or 'parenthetical'.
 */
function findDialogueGroups(doc: ProseMirrorNode): DialogueGroup[] {
  const groups: DialogueGroup[] = [];
  let currentGroup: DialogueGroup | null = null;
  let pos = 0;

  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    const nodeType = node.type.name;

    // Skip nodes that are already in the new structure
    if (nodeType === 'dualDialogueBlock') {
      if (currentGroup && currentGroup.nodes.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = null;
      pos += node.nodeSize;
      continue;
    }

    if (nodeType === 'character') {
      // Character starts a new group
      if (currentGroup && currentGroup.nodes.length > 0) {
        groups.push(currentGroup);
      }

      const isDual = node.attrs.isDualDialogue === true;
      currentGroup = {
        nodes: [{ node, pos }],
        startPos: pos,
        endPos: pos + node.nodeSize,
        isDual,
      };
    } else if (currentGroup && (nodeType === 'dialogue' || nodeType === 'parenthetical')) {
      // Dialogue/parenthetical extends current group
      // If any node in the group has isDualDialogue, mark the group as dual
      if (node.attrs.isDualDialogue === true) {
        currentGroup.isDual = true;
      }
      currentGroup.nodes.push({ node, pos });
      currentGroup.endPos = pos + node.nodeSize;
    } else {
      // Other node type terminates group
      if (currentGroup && currentGroup.nodes.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = null;
    }

    pos += node.nodeSize;
  }

  // Don't forget the last group
  if (currentGroup && currentGroup.nodes.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Find migration targets: pairs of adjacent groups where the second is marked as dual.
 *
 * Pattern to detect:
 * - Group N: isDual = false (left column)
 * - Group N+1: isDual = true (right column)
 * - Groups must be adjacent (no gap between them)
 */
function findMigrationTargets(groups: DialogueGroup[]): MigrationTarget[] {
  const targets: MigrationTarget[] = [];

  for (let i = 0; i < groups.length - 1; i++) {
    const leftGroup = groups[i];
    const rightGroup = groups[i + 1];

    // Check if this is a dual dialogue pattern:
    // - Left group is NOT marked as dual
    // - Right group IS marked as dual
    // - They are adjacent (left ends where right starts)
    if (
      !leftGroup.isDual &&
      rightGroup.isDual &&
      leftGroup.endPos === rightGroup.startPos
    ) {
      targets.push({
        leftGroup,
        rightGroup,
        startPos: leftGroup.startPos,
        endPos: rightGroup.endPos,
      });

      // Skip the right group since it's been paired
      i++;
    }
  }

  return targets;
}
