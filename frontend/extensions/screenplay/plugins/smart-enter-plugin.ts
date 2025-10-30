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

      // Check if this looks like an Enter press (node split)
      const hasSplit = transactions.some(transaction => {
        return transaction.docChanged && transaction.steps.some(step => {
          const stepJSON = step.toJSON();
          return stepJSON.stepType === 'replace' && stepJSON.slice;
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

      // Check if there's a previous node
      if (pos > 1) {
        try {
          // Resolve position before the current node to get the previous node
          const $prevPos = newState.doc.resolve(pos - 1);
          const prevNode = $prevPos.parent;
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
          // 2. Current node is 'paragraph' (default node created by Enter in StarterKit)
          // 3. Current node is empty (newly created by Enter press)
          const shouldTransform = transitionType && currentType === 'paragraph' && currentNode.content.size === 0;

          console.log('[SmartEnter] Should transform?', {
            hasTransition: !!transitionType,
            isParagraph: currentType === 'paragraph',
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
        console.log('[SmartEnter] Skipped - pos <= 1');
      }

      console.log('[SmartEnter] Modified:', modified);
      return modified ? tr : null;
    },
  });
}
