/**
 * Smart Enter Plugin
 *
 * ProseMirror plugin that handles smart Enter key transitions for screenplay elements.
 * Instead of hijacking Enter in keyboard shortcuts, this uses appendTransaction
 * to detect Enter presses and transform the newly created node based on context.
 *
 * Only triggers when cursor is at the end of specific node types.
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
      const tr = newState.tr;
      let modified = false;

      console.log('[SmartEnter] appendTransaction called');

      // Filter out Yjs sync/undo transactions - only process user-initiated transactions
      const hasUserTransaction = transactions.some(tr =>
        !tr.getMeta('y-sync$') && !tr.getMeta('y-undo$') && tr.getMeta('addToHistory') !== false
      );
      if (!hasUserTransaction) {
        console.log('[SmartEnter] Skipping - Yjs sync/undo transaction');
        return null;
      }

      // Check if this looks like an Enter press (node split)
      // Handle both 'replace' and 'replaceAround' step types
      const hasSplit = transactions.some(transaction => {
        return transaction.docChanged && transaction.steps.some(step => {
          const stepJSON = step.toJSON();
          return (stepJSON.stepType === 'replace' || stepJSON.stepType === 'replaceAround') && stepJSON.slice;
        });
      });

      console.log('[SmartEnter] hasSplit:', hasSplit);
      if (!hasSplit) return null;

      const { $from } = newState.selection;
      const currentNode = $from.parent;
      const currentType = currentNode.type.name;

      // Get the position of the current node
      const pos = $from.before();

      console.log('[SmartEnter] Current node:', {
        type: currentType,
        pos: pos,
        contentSize: currentNode.content.size,
        nodeContent: currentNode.textContent
      });

      // Check if there's a previous node using nodeBefore (actual sibling, not parent)
      if (pos > 0) {
        try {
          // Use nodeBefore to get the actual preceding sibling node
          const $beforePos = newState.doc.resolve(pos);
          const prevNode = $beforePos.nodeBefore;

          // If no previous sibling, skip transformation
          if (!prevNode) {
            console.log('[SmartEnter] No previous sibling node found');
            return null;
          }

          const prevType = prevNode.type.name;

          console.log('[SmartEnter] Previous node:', {
            type: prevType,
            contentSize: prevNode.content.size,
            nodeContent: prevNode.textContent
          });

          // Check if previous node type has a transition defined
          const transitionType = types[prevType];

          console.log('[SmartEnter] Transition lookup:', {
            prevType,
            transitionType,
            availableTransitions: Object.keys(types)
          });

          // Only transform if:
          // 1. Previous node has a transition defined
          // 2. Current node is either 'paragraph' (StarterKit default) OR a screenplay type that needs changing
          // 3. Current node is empty (newly created by Enter press)
          // 4. Current node type is different from the desired transition type
          const needsTransform = currentType !== transitionType;
          const isDefaultOrScreenplay = currentType === 'paragraph' || currentType === prevType;
          const shouldTransform = transitionType && isDefaultOrScreenplay && needsTransform && currentNode.content.size === 0;

          console.log('[SmartEnter] Should transform?', {
            hasTransition: !!transitionType,
            currentType,
            transitionType,
            needsTransform,
            isDefaultOrScreenplay,
            isEmpty: currentNode.content.size === 0,
            shouldTransform
          });

          if (shouldTransform) {
            const nextNodeType = newState.schema.nodes[transitionType];

            if (nextNodeType) {
              console.log('[SmartEnter] Applying transformation:', prevType, '→', transitionType);
              // Transform the current (newly created empty) node to the transition type
              tr.setNodeMarkup(pos, nextNodeType);
              modified = true;
            } else {
              console.warn('[SmartEnter] Node type not found in schema:', transitionType);
            }
          }
        } catch (err) {
          // Invalid position, skip transformation
          console.warn('[SmartEnter] Failed to resolve previous node:', err);
        }
      } else {
        console.log('[SmartEnter] Skipped - pos <= 0 (at document start)');
      }

      console.log('[SmartEnter] Modified:', modified);
      return modified ? tr : null;
    },
  });
}
