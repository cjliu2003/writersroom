/**
 * TipTap Scene Boundary Tracker
 *
 * Extracts scene boundaries from TipTap/ProseMirror documents.
 * Compatible with ScriptSceneSidebar component interface.
 *
 * Key differences from Slate version:
 * - Works with ProseMirror Node structure instead of Slate
 * - Uses TipTap Editor instance for document access
 * - Positions are ProseMirror positions (not Slate paths)
 */

import { Editor } from '@tiptap/react';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * Represents the boundaries of a single scene within the full script.
 * Compatible with ScriptSceneSidebar interface.
 */
export interface SceneBoundary {
  /** Unique identifier for the scene (generated or from node attrs) */
  uuid: string;
  /** Starting block index in content array (for sidebar slicing) */
  startIndex: number;
  /** Ending block index in content array (inclusive, for sidebar slicing) */
  endIndex: number;
  /** Starting position in ProseMirror document (for scrolling) */
  startPos?: number;
  /** Ending position in ProseMirror document (for scrolling) */
  endPos?: number;
  /** Scene heading text (e.g., "INT. OFFICE - DAY") */
  heading: string;
  /** Sequential position of scene in script (0-indexed) */
  position: number;
}

/**
 * Extract scene boundaries from TipTap editor document.
 *
 * Traverses the ProseMirror document tree and identifies scene boundaries
 * based on 'sceneHeading' node types. Each scene starts with a scene heading
 * and continues until the next scene heading or end of document.
 *
 * @param editor - TipTap Editor instance
 * @returns Array of scene boundaries in document order
 */
export function extractSceneBoundariesFromTipTap(editor: Editor | null): SceneBoundary[] {
  if (!editor) {
    return [];
  }

  const boundaries: SceneBoundary[] = [];
  const doc = editor.state.doc;
  let scenePosition = 0;
  let lastSceneStartBlockIndex: number | null = null;
  let lastSceneStartPos: number | null = null;
  let lastSceneHeading: string | null = null;

  // CRITICAL: Iterate only over top-level children, not all descendants
  // doc.content is a Fragment containing top-level block nodes
  // We need blockIndex to match the scriptContent array indices
  let blockIndex = 0;
  let currentPos = 0;

  // Iterate through top-level children only
  doc.content.forEach((node: ProseMirrorNode, offset: number) => {
    // Calculate absolute position (offset is relative to doc start)
    const pos = currentPos + 1; // +1 for opening tag
    currentPos += node.nodeSize; // Move to next node

    if (node.type.name === 'sceneHeading') {
      // If we had a previous scene, close it before this one
      if (lastSceneStartBlockIndex !== null && lastSceneStartPos !== null && lastSceneHeading !== null) {
        boundaries.push({
          uuid: generateSceneUUID(scenePosition),
          startIndex: lastSceneStartBlockIndex,
          endIndex: blockIndex - 1, // End before current scene heading (block index)
          startPos: lastSceneStartPos,
          endPos: pos - 1, // End before current scene heading (ProseMirror position)
          heading: lastSceneHeading,
          position: scenePosition,
        });
        scenePosition++;
      }

      // Start new scene at this block index and position
      lastSceneStartBlockIndex = blockIndex;
      lastSceneStartPos = pos;
      lastSceneHeading = node.textContent || 'UNTITLED SCENE';
    }
    blockIndex++;
  });

  // Close the last scene (extends to end of document)
  if (lastSceneStartBlockIndex !== null && lastSceneStartPos !== null && lastSceneHeading !== null) {
    boundaries.push({
      uuid: generateSceneUUID(scenePosition),
      startIndex: lastSceneStartBlockIndex,
      endIndex: blockIndex - 1, // Last block index
      startPos: lastSceneStartPos,
      endPos: doc.content.size - 1, // End of document (ProseMirror position)
      heading: lastSceneHeading,
      position: scenePosition,
    });
  }

  console.log('[TipTapSceneTracker] Extracted scene boundaries:', {
    sceneCount: boundaries.length,
    totalBlocks: blockIndex,
    scenes: boundaries.map(b => ({
      position: b.position,
      heading: b.heading,
      blockRange: `${b.startIndex}-${b.endIndex}`,
      posRange: `${b.startPos}-${b.endPos}`,
      blockCount: b.endIndex - b.startIndex + 1
    }))
  });

  return boundaries;
}

/**
 * Generate a UUID for a scene based on its position.
 * Uses a simple deterministic approach for now.
 * TODO: Could enhance to use node attributes if scenes have persistent IDs.
 *
 * @param position - Scene position (0-indexed)
 * @returns UUID string
 */
function generateSceneUUID(position: number): string {
  // Generate a deterministic UUID-like string based on position
  // Format: scene-{position}-{random}
  const random = Math.random().toString(36).substring(2, 15);
  return `scene-${position}-${random}`;
}

/**
 * Scroll to a specific scene in the editor.
 *
 * Uses TipTap commands to:
 * 1. Focus the editor
 * 2. Set text selection to scene start position
 * 3. Use scrollIntoView to position scene heading at top of visible area
 *
 * @param editor - TipTap Editor instance
 * @param scene - Scene boundary to scroll to
 */
export function scrollToScene(editor: Editor | null, scene: SceneBoundary): void {
  if (!editor) {
    console.warn('[TipTapSceneTracker] Cannot scroll: editor is null');
    return;
  }

  // Use ProseMirror position for scrolling (startPos), fall back to startIndex if not available
  const scrollPos = scene.startPos ?? scene.startIndex;

  console.log('[TipTapSceneTracker] Scrolling to scene:', {
    position: scene.position,
    heading: scene.heading,
    scrollPos: scrollPos,
    startIndex: scene.startIndex
  });

  try {
    // Focus editor and set selection to scene start position
    editor.commands.focus();
    editor.commands.setTextSelection(scrollPos);

    // Find the DOM element and scroll container, then manually scroll
    // We need to wait a tick for the selection to be set
    setTimeout(() => {
      const { view } = editor;

      // Get DOM position info
      const domAtPos = view.domAtPos(scrollPos);
      let targetElement: HTMLElement | null = null;

      // Find the block-level element (scene heading)
      if (domAtPos.node instanceof HTMLElement) {
        targetElement = domAtPos.node;
      } else if (domAtPos.node.parentElement) {
        targetElement = domAtPos.node.parentElement;
      }

      // Walk up to find the actual block element (scene heading node)
      while (targetElement && !targetElement.hasAttribute('data-type') && targetElement.parentElement) {
        targetElement = targetElement.parentElement;
        // Stop if we hit the editor container
        if (targetElement.classList.contains('ProseMirror')) break;
      }

      if (targetElement) {
        // Find the scroll container (the fixed-position overflow-auto div)
        const scrollContainer = document.querySelector('.overflow-auto') as HTMLElement;

        if (scrollContainer) {
          // Calculate the element's position relative to the scroll container
          const containerRect = scrollContainer.getBoundingClientRect();
          const elementRect = targetElement.getBoundingClientRect();

          // Calculate scroll position to put element at top with 24px padding
          const scrollTop = scrollContainer.scrollTop + (elementRect.top - containerRect.top) - 24;

          scrollContainer.scrollTo({
            top: Math.max(0, scrollTop),
            behavior: 'smooth'
          });
          console.log('[TipTapSceneTracker] Scrolled container to scene');
        } else {
          // Fallback to scrollIntoView if container not found
          targetElement.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
            inline: 'nearest'
          });
          console.log('[TipTapSceneTracker] Fallback: used scrollIntoView');
        }
      }
    }, 50);
  } catch (error) {
    console.error('[TipTapSceneTracker] Failed to scroll to scene:', error);
  }
}

/**
 * Find which scene contains a given position.
 *
 * @param position - ProseMirror position
 * @param boundaries - Array of scene boundaries
 * @returns Scene index (0-based) or null if not found
 */
export function findSceneAtPosition(
  position: number,
  boundaries: SceneBoundary[]
): number | null {
  for (let i = 0; i < boundaries.length; i++) {
    const scene = boundaries[i];
    // Use ProseMirror positions (startPos/endPos) for accurate comparison
    const startPos = scene.startPos ?? 0;
    const endPos = scene.endPos ?? Infinity;
    if (position >= startPos && position <= endPos) {
      return i;
    }
  }
  return null;
}

/**
 * Get the current scene index based on editor selection.
 *
 * @param editor - TipTap Editor instance
 * @param boundaries - Array of scene boundaries
 * @returns Current scene index or null
 */
export function getCurrentSceneIndex(
  editor: Editor | null,
  boundaries: SceneBoundary[]
): number | null {
  if (!editor || boundaries.length === 0) {
    return null;
  }

  // Get current selection position (use anchor for cursor position)
  const { selection } = editor.state;
  const currentPos = selection.anchor;

  return findSceneAtPosition(currentPos, boundaries);
}
