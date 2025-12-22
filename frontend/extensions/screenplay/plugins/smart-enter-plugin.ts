/**
 * Smart Enter Plugin
 *
 * ProseMirror plugin that handles smart Enter key transitions for screenplay elements.
 *
 * NOTE: Most Enter key behavior is now handled directly in each node's keyboard shortcuts.
 * This plugin serves as a fallback for edge cases:
 * - Converting 'paragraph' nodes (StarterKit default) to appropriate screenplay types
 * - Handling any splits that bypass the keyboard shortcuts
 *
 * The keyboard shortcuts in each node handle:
 * - Scene Heading: Enter at end → Action (middle = blocked)
 * - Character: Enter at end → Dialogue (middle = blocked)
 * - Transition: Enter at end → Scene Heading (middle = blocked)
 * - Dialogue: Enter at end → Action (middle = allows split for multi-paragraph dialogue)
 * - Parenthetical: Enter before ")" → Dialogue (middle = blocked)
 * - Action: No restriction, splits naturally stay as action
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { SMART_ENTER_TRANSITIONS } from '../types';

export const SmartEnterPluginKey = new PluginKey('smartEnter');

export interface SmartEnterOptions {
  types?: {
    [key: string]: string; // nodeType → transitionType
  };
}

/**
 * Create Smart Enter plugin for screenplay element transitions
 *
 * @param options - Configuration options (defaults to SMART_ENTER_TRANSITIONS)
 * @returns ProseMirror Plugin
 */
export function SmartEnterPlugin(options: SmartEnterOptions = {}) {
  const types = options.types || SMART_ENTER_TRANSITIONS;

  return new Plugin({
    key: SmartEnterPluginKey,

    appendTransaction(transactions, oldState, newState) {
      // Filter out Yjs sync/undo transactions - only process user-initiated transactions
      const hasUserTransaction = transactions.some(tr =>
        !tr.getMeta('y-sync$') && !tr.getMeta('y-undo$') && tr.getMeta('addToHistory') !== false
      );
      if (!hasUserTransaction) {
        return null;
      }

      // Check if this is a true Enter (split) by verifying the document GAINED nodes
      const oldNodeCount = oldState.doc.childCount;
      const newNodeCount = newState.doc.childCount;
      const gainedNodes = newNodeCount > oldNodeCount;

      // Only proceed if we gained nodes (true Enter/split)
      if (!gainedNodes) {
        return null;
      }

      // Check if this looks like an Enter press (node split)
      const hasSplit = transactions.some(transaction => {
        return transaction.docChanged && transaction.steps.some(step => {
          const stepJSON = step.toJSON();
          return (stepJSON.stepType === 'replace' || stepJSON.stepType === 'replaceAround') && stepJSON.slice;
        });
      });

      if (!hasSplit) return null;

      const { $from } = newState.selection;
      const currentNode = $from.parent;
      const currentType = currentNode.type.name;

      // Only handle 'paragraph' nodes (fallback for StarterKit default)
      // All screenplay node types now handle Enter via keyboard shortcuts
      if (currentType !== 'paragraph') {
        return null;
      }

      // Get the position of the current node
      const pos = $from.before();

      // Check if there's a previous node
      if (pos > 0) {
        try {
          const $beforePos = newState.doc.resolve(pos);
          const prevNode = $beforePos.nodeBefore;

          if (!prevNode) {
            return null;
          }

          const prevType = prevNode.type.name;
          const transitionType = types[prevType];

          // Only transform empty paragraphs that follow a screenplay element
          const isEmpty = currentNode.content.size === 0;

          if (transitionType && isEmpty) {
            const nextNodeType = newState.schema.nodes[transitionType];

            if (nextNodeType) {
              const tr = newState.tr;
              tr.setNodeMarkup(pos, nextNodeType);
              return tr;
            }
          }
        } catch (err) {
          // Invalid position, skip transformation
          console.warn('[SmartEnter] Failed to resolve previous node:', err);
        }
      }

      return null;
    },
  });
}
