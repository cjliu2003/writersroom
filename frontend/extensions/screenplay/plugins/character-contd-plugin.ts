/**
 * Character CONT'D Plugin
 *
 * Automatically displays (CONT'D) after character names when the same character
 * is speaking again after an action line interruption.
 *
 * Rules for showing (CONT'D):
 * 1. Same character spoke previously (case-insensitive, ignoring V.O./O.S./O.C. extensions)
 * 2. At least one action line exists between the two character blocks
 * 3. No scene heading between them (scene headings reset the chain)
 * 4. No other character's dialogue between them
 *
 * For dual dialogue:
 * - Each column is tracked independently
 * - Both columns look at content BEFORE the dual dialogue block (not at each other)
 *
 * The (CONT'D) is displayed as a ProseMirror widget decoration, not stored in the document.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';

export const CharacterContdKey = new PluginKey('characterContd');

/**
 * Character extensions that should be stripped for name comparison
 * These indicate how the character is heard, not who the character is
 */
const CHARACTER_EXTENSIONS = [
  '(V.O.)',
  '(O.S.)',
  '(O.C.)',
  '(V/O)',
  '(OS)',
  '(OC)',
  '(VO)',
  "(CONT'D)",
  '(CONTD)',
  '(CONTINUED)',
  '(FILTERED)',
  '(PRELAP)',
];

/**
 * Extract the base character name, stripping any parenthetical extensions
 * Examples:
 *   "JOHN (V.O.)" → "JOHN"
 *   "MARY (O.S.) (CONT'D)" → "MARY"
 *   "DR. SMITH" → "DR. SMITH"
 */
function extractCharacterName(text: string): string {
  let name = text.trim().toUpperCase();

  // Remove all known extensions
  for (const ext of CHARACTER_EXTENSIONS) {
    name = name.replace(ext.toUpperCase(), '');
  }

  // Remove any remaining parentheticals (catches custom extensions)
  name = name.replace(/\([^)]*\)/g, '');

  // Clean up whitespace
  return name.trim();
}

/**
 * Check if character line already has a parenthetical extension
 * We don't want to show (CONT'D) if there's already (V.O.), (O.S.), etc.
 */
function hasParentheticalExtension(text: string): boolean {
  // Check for any parenthetical in the character line
  // This catches (V.O.), (O.S.), (O.C.), (FILTERED), etc.
  return /\([^)]+\)/.test(text);
}

/**
 * Info about a character we've seen while traversing
 */
interface CharacterInfo {
  name: string;         // Normalized character name
  pos: number;          // Position of the character node
  nodeSize: number;     // Size of the character node
}

/**
 * State for tracking characters as we traverse the document
 */
interface TraversalState {
  lastCharacter: CharacterInfo | null;
  hasActionSinceLast: boolean;
}

/**
 * Check if a node type breaks the character continuation chain
 */
function breaksChain(nodeType: string): boolean {
  return nodeType === 'sceneHeading';
}

/**
 * Check if a node is an action/description that counts as an interruption
 */
function isActionNode(nodeType: string): boolean {
  return nodeType === 'action';
}

/**
 * Check if a node is a character node
 */
function isCharacterNode(nodeType: string): boolean {
  return nodeType === 'character';
}

/**
 * Check if a node is part of a dialogue group (character, dialogue, parenthetical)
 */
function isDialogueGroupNode(nodeType: string): boolean {
  return ['character', 'dialogue', 'parenthetical'].includes(nodeType);
}

/**
 * Check if a character node has dialogue content following it
 * (i.e., user has pressed Enter and moved to dialogue)
 */
function hasDialogueFollowing(doc: ProseMirrorNode, nodeIndex: number): boolean {
  // Check if next sibling is dialogue or parenthetical
  if (nodeIndex + 1 < doc.childCount) {
    const nextNode = doc.child(nodeIndex + 1);
    const nextType = nextNode.type.name;
    return nextType === 'dialogue' || nextType === 'parenthetical';
  }
  return false;
}

/**
 * Check if a character node within a column has dialogue following it
 */
function hasDialogueFollowingInColumn(column: ProseMirrorNode, childIndex: number): boolean {
  if (childIndex + 1 < column.childCount) {
    const nextNode = column.child(childIndex + 1);
    const nextType = nextNode.type.name;
    return nextType === 'dialogue' || nextType === 'parenthetical';
  }
  return false;
}

/**
 * Find all positions where (CONT'D) should be displayed
 */
function findContdPositions(doc: ProseMirrorNode): number[] {
  const contdPositions: number[] = [];

  // State for tracking at document level
  let state: TraversalState = {
    lastCharacter: null,
    hasActionSinceLast: false,
  };

  let pos = 0;

  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    const nodeType = node.type.name;

    // Handle dual dialogue blocks specially
    if (nodeType === 'dualDialogueBlock') {
      // Process dual dialogue block
      // Both columns look at content BEFORE the block
      const stateBeforeBlock = { ...state };

      // Process each column
      node.forEach((column, columnOffset) => {
        if (column.type.name === 'dualDialogueColumn') {
          // Each column starts with the state from before the dual dialogue block
          let columnState: TraversalState = { ...stateBeforeBlock };

          let columnPos = pos + 1 + columnOffset; // +1 for block open
          let childPos = columnPos + 1; // +1 for column open

          for (let j = 0; j < column.childCount; j++) {
            const child = column.child(j);
            const childType = child.type.name;

            if (isCharacterNode(childType)) {
              const currentName = extractCharacterName(child.textContent);

              // Check if we should show CONT'D
              // Show if: same character speaking again, has dialogue following,
              // AND doesn't already have a parenthetical extension (V.O., O.S., etc.)
              // Note: We show CONT'D even with no action in between (back-to-back dialogue)
              if (
                columnState.lastCharacter &&
                columnState.lastCharacter.name === currentName &&
                hasDialogueFollowingInColumn(column, j) &&
                !hasParentheticalExtension(child.textContent)
              ) {
                // Position at end of character node content (before closing tag)
                const contdPos = childPos + child.nodeSize - 1;
                contdPositions.push(contdPos);
              }

              // Update state for this column
              columnState.lastCharacter = {
                name: currentName,
                pos: childPos,
                nodeSize: child.nodeSize,
              };
              columnState.hasActionSinceLast = false;
            } else if (isActionNode(childType)) {
              columnState.hasActionSinceLast = true;
            } else if (breaksChain(childType)) {
              columnState.lastCharacter = null;
              columnState.hasActionSinceLast = false;
            }

            childPos += child.nodeSize;
          }
        }
      });

      // After dual dialogue block, reset state
      // The dual dialogue represents a separate conversational moment
      state.lastCharacter = null;
      state.hasActionSinceLast = false;

      pos += node.nodeSize;
      continue;
    }

    // Regular document-level nodes
    if (breaksChain(nodeType)) {
      // Scene heading resets the chain
      state.lastCharacter = null;
      state.hasActionSinceLast = false;
    } else if (isCharacterNode(nodeType)) {
      const currentName = extractCharacterName(node.textContent);

      // Check if we should show CONT'D
      // Show if: same character speaking again, has dialogue following,
      // AND doesn't already have a parenthetical extension (V.O., O.S., etc.)
      // Note: We show CONT'D even with no action in between (back-to-back dialogue)
      // (wait until user presses Enter to create dialogue before showing CONT'D)
      if (
        state.lastCharacter &&
        state.lastCharacter.name === currentName &&
        hasDialogueFollowing(doc, i) &&
        !hasParentheticalExtension(node.textContent)
      ) {
        // Position at end of character node content (before closing tag)
        const contdPos = pos + node.nodeSize - 1;
        contdPositions.push(contdPos);
      }

      // Update state
      state.lastCharacter = {
        name: currentName,
        pos: pos,
        nodeSize: node.nodeSize,
      };
      state.hasActionSinceLast = false;
    } else if (isActionNode(nodeType)) {
      // Action line counts as interruption
      if (node.textContent.trim().length > 0) {
        state.hasActionSinceLast = true;
      }
    }
    // Dialogue and parenthetical nodes don't affect the state
    // (they belong to the current character's dialogue group)

    pos += node.nodeSize;
  }

  return contdPositions;
}

/**
 * Create a widget decoration for (CONT'D)
 */
function createContdWidget(): HTMLElement {
  const span = document.createElement('span');
  span.className = 'character-contd';
  span.textContent = " (CONT'D)";
  span.contentEditable = 'false';
  return span;
}

/**
 * Creates the Character CONT'D plugin
 */
export function CharacterContdPlugin(): Plugin {
  return new Plugin({
    key: CharacterContdKey,

    props: {
      decorations(state) {
        const contdPositions = findContdPositions(state.doc);

        if (contdPositions.length === 0) {
          return DecorationSet.empty;
        }

        const decorations = contdPositions.map(pos =>
          Decoration.widget(pos, createContdWidget, {
            side: 1, // Appear after the position
            key: `contd-${pos}`,
          })
        );

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
