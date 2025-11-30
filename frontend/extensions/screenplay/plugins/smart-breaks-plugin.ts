/**
 * Smart Page Breaks Plugin
 *
 * Implements industry-standard smart page break rules for screenplay formatting.
 * Uses ProseMirror decorations to visually indicate and enforce page break rules
 * without modifying the underlying document.
 *
 * Phase: Tier 1 - Foundation
 * Status: Plugin skeleton with empty decoration computation
 *
 * Rules (to be implemented in Tier 4):
 * 1. Dialogue Continuation: (MORE) and (CONT'D) markers
 * 2. No Orphan Character: Character names stay with dialogue
 * 3. Parenthetical Grouping: Parentheticals stay with dialogue
 * 4. Scene Heading Orphan: Scene headings stay with following content
 * 5. No Transition at Top: Transitions don't start pages
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { Node as ProseMirrorNode } from 'prosemirror-model';

/**
 * Screenplay block types that smart breaks apply to
 */
type BlockKind =
  | 'sceneHeading'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition';

/**
 * Page rectangle information derived from pagination headers
 * Uses viewport coordinates from getBoundingClientRect()
 */
interface PageRect {
  page: number;    // Page index (0-based)
  top: number;     // Y coordinate of page top (viewport coords)
  bottom: number;  // Y coordinate of page bottom (viewport coords)
}

/**
 * Block information with page assignment
 */
interface BlockInfo {
  pos: number;        // ProseMirror position (start)
  end: number;        // ProseMirror position (end)
  type: BlockKind;    // Node type
  rect: DOMRect;      // DOM bounding rectangle
  startPage: number;  // Page index where block starts
  endPage: number;    // Page index where block ends
}

/**
 * Smart breaks configuration options
 */
export interface SmartBreaksOptions {
  /**
   * Node type name mappings
   * (allows flexibility for different naming conventions)
   */
  schemaNames: {
    sceneHeading: string;
    action: string;
    character: string;
    parenthetical: string;
    dialogue: string;
    transition: string;
  };

  /**
   * Text for dialogue continuation marker at page bottom
   * @default '(MORE)'
   */
  moreText?: string;

  /**
   * Text for character continuation marker on next page
   * @default " (CONT'D)"
   */
  contdText?: string;

  /**
   * Safety padding when pushing blocks to next page (px)
   * @default 4
   */
  safetyPx?: number;
}

/**
 * Plugin key for accessing smart breaks state
 */
const SmartBreaksKey = new PluginKey<DecorationSet>('smart-breaks');

// ============================================================================
// Helper Functions - Pagination Root Detection
// ============================================================================

/**
 * Get the pagination root element for scoped queries
 *
 * Prefer .screenplay-editor.rm-with-pagination container, fall back to
 * .screenplay-editor, or use editor DOM directly.
 *
 * @param view Editor view instance
 * @returns Pagination root HTMLElement
 */
function getPaginationRoot(view: EditorView): HTMLElement {
  return (
    (view.dom.closest('.screenplay-editor.rm-with-pagination') as HTMLElement) ||
    (view.dom.closest('.screenplay-editor') as HTMLElement) ||
    (view.dom as HTMLElement)
  );
}

/**
 * Create the Smart Page Breaks plugin
 *
 * @param options Configuration options for smart breaks behavior
 * @returns ProseMirror plugin instance
 */
export function SmartBreaksPlugin(options: SmartBreaksOptions): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: SmartBreaksKey,

    /**
     * Initialize plugin state with empty decoration set
     */
    state: {
      init: (_, { doc }) => {
        console.log('[SmartBreaks] Plugin initialized');
        return DecorationSet.create(doc, []);
      },

      /**
       * Apply transaction to update decoration state
       */
      apply(tr, oldDecorationSet, oldState, newState) {
        // If transaction contains new decorations in meta, use them
        const meta = tr.getMeta(SmartBreaksKey);
        if (meta?.decorations) {
          return meta.decorations;
        }

        // If document changed, clear decorations (will recompute in view.update)
        if (tr.docChanged) {
          return DecorationSet.create(tr.doc, []);
        }

        // Otherwise, map existing decorations through the transaction
        return oldDecorationSet.map(tr.mapping, tr.doc);
      },
    },

    /**
     * Plugin view for managing decoration computation and observers
     */
    view: (editorView: EditorView) => {
      let rafHandle = 0;
      let isApplyingDecorations = false;

      // Find the pagination root element
      const root = editorView.dom.closest('.screenplay-editor.rm-with-pagination') ||
                   editorView.dom;

      console.log('[SmartBreaks] Plugin view created, pagination root:', root);

      /**
       * Recompute decorations (debounced via requestAnimationFrame)
       */
      const recompute = () => {
        cancelAnimationFrame(rafHandle);
        rafHandle = requestAnimationFrame(() => {
          console.log('[SmartBreaks] Computing decorations...');

          // Get old decorations to preserve if computation fails
          const oldDecorations = SmartBreaksKey.getState(editorView.state) || DecorationSet.empty;
          const decorations = computeDecorations(editorView, options, oldDecorations);

          console.log('[SmartBreaks] Computed', decorations.find().length, 'decorations');

          // Set flag to prevent observer-triggered recomputation during decoration application
          isApplyingDecorations = true;

          // Dispatch transaction with new decorations
          editorView.dispatch(
            editorView.state.tr.setMeta(SmartBreaksKey, { decorations })
          );

          // Clear flag after layout settles (allow two frames for DOM updates and reflow)
          // Two frames ensures decorations are fully rendered and layout is stable
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              isApplyingDecorations = false;
            });
          });
        });
      };

      // Set up ResizeObserver for window/container size changes
      const resizeObserver = new ResizeObserver(() => {
        // Skip recomputation if we're currently applying decorations (prevents infinite loop)
        if (isApplyingDecorations) {
          console.log('[SmartBreaks] Resize detected but skipped (applying decorations)');
          return;
        }
        console.log('[SmartBreaks] Resize detected, recomputing...');
        recompute();
      });
      resizeObserver.observe(root as Element);

      // Set up MutationObserver for pagination DOM changes
      const mutationObserver = new MutationObserver((mutations) => {
        // Skip if we're currently applying decorations (prevents infinite loop)
        if (isApplyingDecorations) {
          return;
        }

        // Only recompute if mutations affect pagination headers
        const hasPaginationChanges = mutations.some(mutation =>
          Array.from(mutation.addedNodes).some(node =>
            node instanceof Element && node.classList.contains('rm-page-header')
          ) ||
          Array.from(mutation.removedNodes).some(node =>
            node instanceof Element && node.classList.contains('rm-page-header')
          )
        );

        if (hasPaginationChanges) {
          console.log('[SmartBreaks] Pagination DOM changed, recomputing...');
          recompute();
        }
      });
      mutationObserver.observe(root as Element, {
        childList: true,
        subtree: true,
        attributes: false, // Don't watch attribute changes to reduce noise
      });

      // Queue initial computation after mount
      queueMicrotask(() => {
        console.log('[SmartBreaks] Initial computation queued');
        recompute();
      });

      return {
        /**
         * Called when editor view updates
         * Only recompute when document content changes to avoid infinite loops
         */
        update: (view, prevState) => {
          // Only recompute if the document changed (content edits, not just decorations)
          // This prevents infinite loops from our own decoration updates
          if (view.state.doc !== prevState.doc) {
            console.log('[SmartBreaks] Document changed, triggering recomputation');
            recompute();
          }
        },

        /**
         * Cleanup when plugin is destroyed
         */
        destroy: () => {
          console.log('[SmartBreaks] Plugin view destroyed');
          cancelAnimationFrame(rafHandle);
          resizeObserver.disconnect();
          mutationObserver.disconnect();
        },
      };
    },

    /**
     * Provide decorations to the editor view
     */
    props: {
      decorations(state) {
        return SmartBreaksKey.getState(state);
      },
    },
  });
}

// ============================================================================
// Decoration Computation
// ============================================================================

/**
 * Compute all smart break decorations for the current document state
 *
 * Phase: Tier 1 - Returns empty set (rules not implemented yet)
 * Future: Tier 4 - Will implement all 5 rules
 *
 * @param view Editor view instance
 * @param options Smart breaks configuration
 * @returns Decoration set with all smart break decorations
 */
function computeDecorations(
  view: EditorView,
  options: SmartBreaksOptions,
  oldDecorations?: DecorationSet
): DecorationSet {
  const { state } = view;
  const { doc } = state;

  // STEP 1: Get pagination root and build page bands
  const root = getPaginationRoot(view);
  const bands = buildPageBands(root);

  if (!bands) {
    // buildPageBands already logs appropriate messages
    // Return old decorations to prevent clearing when bands unstable
    console.log('[SmartBreaks] Page bands unstable, preserving existing decorations');
    return oldDecorations || DecorationSet.create(doc, []);
  }

  console.log('[SmartBreaks] ✅ Page bands built, proceeding with computation');

  // TIER 2: Collect blocks with page assignments
  const blocks = collectBlocks(view, options);

  if (blocks.length === 0) {
    // Return old decorations to prevent clearing when blocks temporarily unavailable
    console.log('[SmartBreaks] No screenplay blocks found, preserving existing decorations');
    return oldDecorations || DecorationSet.create(doc, []);
  }

  // TIER 3-4: Apply smart break rules
  console.log('[SmartBreaks] ✅ Tier 2: Data collection complete');
  console.log('[SmartBreaks] ⚡ Tier 3-4: Applying smart break rules...');

  const decorations: Decoration[] = [];

  // Rule 1: Dialogue Continuation (MORE/CONT'D markers)
  applyDialogueContinuationRule(blocks, bands, decorations, view, options);

  console.log('[SmartBreaks] ✨ Created', decorations.length, 'decorations');

  return DecorationSet.create(doc, decorations);
}

// ============================================================================
// Helper Functions - Page Geometry (Tier 2)
// ============================================================================

/**
 * Validate that a DOMRect has finite dimensions
 *
 * @param r DOMRect to validate
 * @returns true if rect has valid finite dimensions
 */
function isFiniteRect(r: DOMRect): boolean {
  return (
    Number.isFinite(r.top) &&
    Number.isFinite(r.bottom) &&
    r.height >= 0
  );
}

// Helper functions removed - no longer needed with stable pagination guarantees
// (MAD statistics, CSS height guessing, doc index extraction, stability checks)

/**
 * Build page bands from pagination headers (deterministic approach)
 *
 * With the forked @jack/tiptap-pagination-plus extension, we have stable guarantees:
 * - data-page-index attributes on all headers (0..N-1)
 * - --rm-page-height CSS variable provides exact page height
 *
 * This allows a simple, deterministic approach without normalization or statistical inference.
 *
 * @param root Pagination root element
 * @returns Array of page bands, or null if unstable
 */
function buildPageBands(root: HTMLElement): PageRect[] | null {
  // 1. Get headers in doc order (data-page-index guarantees this)
  const headers = Array.from(
    root.querySelectorAll<HTMLElement>('.rm-first-page-header, .rm-page-header')
  ).sort((a, b) =>
    Number(a.dataset.pageIndex) - Number(b.dataset.pageIndex)
  );

  if (headers.length === 0) {
    console.log('[SmartBreaks] No pagination headers found');
    return null;
  }

  if (headers.length < 2) {
    console.log(
      `[SmartBreaks] Only ${headers.length} header found. ` +
      `Waiting for pagination to fully mount (need ≥2)...`
    );
    return null;
  }

  // 2. Read page height from CSS variable (always present with forked extension)
  const pageHeight = parseFloat(
    getComputedStyle(root).getPropertyValue('--rm-page-height')
  );

  if (!Number.isFinite(pageHeight) || pageHeight <= 0) {
    console.warn('[SmartBreaks] Invalid --rm-page-height:', pageHeight);
    return null;
  }

  console.log('[SmartBreaks] Page height from CSS:', pageHeight, 'px');
  console.log('[SmartBreaks] Found', headers.length, 'headers in doc order');

  // 3. Build bands deterministically
  const bands: PageRect[] = headers.map((h) => {
    const top = h.getBoundingClientRect().top;
    const pageIndex = Number(h.dataset.pageIndex);

    return {
      page: pageIndex,
      top: top,
      bottom: top + pageHeight
    };
  });

  // 4. Sanity check: verify page indices are sequential
  const pageIndices = bands.map(b => b.page);
  const isSequential = pageIndices.every((idx, i) => idx === i);

  if (!isSequential) {
    console.warn(
      '[SmartBreaks] Page indices not sequential:',
      pageIndices.join(', ')
    );
  }

  // Debug logging
  bands.forEach((b, i) => {
    console.log(
      `[SmartBreaks] Page ${i}: top=${b.top.toFixed(1)}, bottom=${b.bottom.toFixed(1)} ` +
      `(data-page-index=${b.page})`
    );
  });

  return bands;
}

/**
 * Helper function to clamp a value between min and max
 */
function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

/**
 * Find the page index for a Y coordinate using binary search
 *
 * Returns the largest page index where band.top <= y.
 * This is a "floor" operation: finds the page that starts at or before y.
 *
 * @param bands Array of page bands (viewport coordinates)
 * @param y Y coordinate (viewport coordinate)
 * @returns Page index (0-based)
 */
function floorPageIndex(bands: PageRect[], y: number): number {
  if (!bands.length) return 0;

  // Binary search for largest page with top <= y
  let lo = 0;
  let hi = bands.length - 1;
  let ans = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bands[mid].top <= y) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return ans;
}

// ============================================================================
// Block Collection (Tier 2)
// ============================================================================

/**
 * Collect all screenplay blocks with their page assignments
 *
 * Iterates through the ProseMirror document, finds all screenplay block nodes,
 * gets their DOM rects, and assigns start/end page indices by comparing viewport
 * coordinates with page bands.
 *
 * @param view Editor view instance
 * @param options Smart breaks configuration (for schema name mapping)
 * @returns Array of BlockInfo with page assignments
 */
function collectBlocks(
  view: EditorView,
  options: SmartBreaksOptions
): BlockInfo[] {
  const { state } = view;
  const { doc } = state;

  // Get page geometry first
  const root = getPaginationRoot(view);

  // Build page bands (handles header query internally)
  const bands = buildPageBands(root);
  if (!bands) {
    console.log('[SmartBreaks] collectBlocks: page bands unstable, returning empty');
    return [];
  }

  // Build set of wanted node type names
  const wantedTypes = new Set<string>([
    options.schemaNames.sceneHeading,
    options.schemaNames.action,
    options.schemaNames.character,
    options.schemaNames.parenthetical,
    options.schemaNames.dialogue,
    options.schemaNames.transition,
  ]);

  const blocks: BlockInfo[] = [];

  // Constants for edge snapping
  const SNAP_TOL = 24; // pixels near edge to snap

  const firstTop = bands[0].top;
  const lastBottom = bands[bands.length - 1].bottom;

  // Iterate through document nodes
  doc.descendants((node, pos) => {
    // Only process block nodes
    if (!node.isBlock) return false;

    // Only process screenplay node types
    if (!wantedTypes.has(node.type.name)) return;

    // Get DOM element for this node
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (!dom) {
      console.log('[SmartBreaks] No DOM element for node at pos', pos);
      return;
    }

    // Get viewport coordinates
    const blockRect = dom.getBoundingClientRect();
    if (!isFiniteRect(blockRect)) {
      console.log('[SmartBreaks] Invalid rect for node at pos', pos, ':', blockRect);
      return;
    }

    // Use viewport coordinates directly (no normalization needed)
    let bTop = blockRect.top;
    let bBottom = blockRect.bottom;

    // Snap near edges to avoid "before first page" and gap issues
    if (bTop < firstTop && firstTop - bTop <= SNAP_TOL) {
      bTop = firstTop;
    }
    if (bBottom > lastBottom && bBottom - lastBottom <= SNAP_TOL) {
      bBottom = lastBottom;
    }

    // Clamp to valid page range
    bTop = clamp(bTop, firstTop, lastBottom);
    bBottom = clamp(bBottom, firstTop, lastBottom);

    // Find start and end pages using viewport coordinates
    const startPage = floorPageIndex(bands, bTop);
    const endPage = floorPageIndex(bands, bBottom);

    blocks.push({
      pos,
      end: pos + node.nodeSize,
      type: node.type.name as BlockKind,
      rect: blockRect, // Keep original rect for other uses
      startPage,
      endPage,
    });
  });

  console.log('[SmartBreaks] Collected', blocks.length, 'screenplay blocks');

  // Log block summary by type
  const typeCounts = blocks.reduce((acc, b) => {
    acc[b.type] = (acc[b.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('[SmartBreaks] Block types:', typeCounts);

  // Log blocks that span pages
  const spanningBlocks = blocks.filter(b => b.startPage !== b.endPage);
  if (spanningBlocks.length > 0) {
    console.log('[SmartBreaks] Blocks spanning pages:', spanningBlocks.length);
    spanningBlocks.forEach(b => {
      console.log(`  - ${b.type} at pos ${b.pos}: page ${b.startPage} → ${b.endPage}`);
    });
  }

  return blocks;
}

/**
 * Create spacer decoration to push block to next page
 *
 * Status: Stub - To be implemented in Tier 3
 */
// function pushToNextPage(
//   block: BlockInfo,
//   pageRects: PageRect[],
//   safetyPx: number
// ): Decoration | null {
//   // TODO: Tier 3 implementation
//   return null;
// }

/**
 * Create (MORE) widget decoration at end of split dialogue
 *
 * Placed as a block-level centered element below dialogue on page N
 */
function createMoreMarker(pos: number, moreText: string = '(MORE)'): Decoration {
  return Decoration.widget(pos, () => {
    const el = document.createElement('div');
    el.textContent = moreText;
    el.style.textAlign = 'center';
    el.style.marginTop = '4px';
    el.style.marginBottom = '4px';
    el.className = 'smart-break-more-marker';
    return el;
  }, { side: -1 }); // Place BEFORE position to keep on page N
}

/**
 * Create CHARACTER (CONT'D) widget decoration for page N+1
 *
 * This creates a full character line with (CONT'D) appended,
 * placed at the start of the dialogue continuation on page N+1
 *
 * @param pos Position to place the decoration (start of dialogue on page N+1)
 * @param characterName The character name text to display
 * @param contdText The continuation text (default: "(CONT'D)")
 */
function createCharacterContinuation(
  pos: number,
  characterName: string,
  contdText: string = '(CONT\'D)'
): Decoration {
  return Decoration.widget(pos, () => {
    const el = document.createElement('div');
    el.textContent = `${characterName} ${contdText}`;
    el.style.textAlign = 'center';
    el.style.textTransform = 'uppercase';
    el.style.marginTop = '12px';
    el.style.marginBottom = '4px';
    el.className = 'smart-break-character-continuation';
    return el;
  }, { side: 1 }); // Place AFTER position - after (MORE) widget, on page N+1
}

// ============================================================================
// Helper Functions - Page Break Detection
// ============================================================================

/**
 * Get the line height from the editor's computed styles
 *
 * @param view Editor view instance
 * @returns Line height in pixels, defaults to 20 if cannot determine
 */
function getLineHeight(view: EditorView): number {
  try {
    const style = window.getComputedStyle(view.dom);
    const lineHeight = parseFloat(style.lineHeight);
    return isNaN(lineHeight) || lineHeight === 0 ? 20 : lineHeight;
  } catch (e) {
    console.warn('[SmartBreaks] Could not determine line height, using default', e);
    return 20;
  }
}

/**
 * Find safe position for (MORE) marker at sentence or word boundary
 *
 * Searches backwards from rawBreakPos to find:
 * 1. Sentence boundaries (. ? !) - preferred for screenplay formatting
 * 2. Word boundaries (any whitespace) - fallback option
 *
 * For each boundary, verifies there's enough vertical space on page N for the
 * (MORE) widget before accepting it. This ensures (MORE) appears at bottom of
 * page N, not top of page N+1.
 *
 * @param doc ProseMirror document
 * @param rawBreakPos Raw break position from findPageBreakPosition()
 * @param dialogueStart Start position of dialogue block
 * @param pageNBottom Bottom coordinate of page N
 * @param view Editor view for coordinate queries
 * @param moreWidgetHeight Height of (MORE) widget in pixels
 * @returns Safe position for (MORE) marker on page N
 */
function findSafeSentenceBoundary(
  doc: ProseMirrorNode,
  rawBreakPos: number,
  dialogueStart: number,
  pageNBottom: number,
  view: EditorView,
  moreWidgetHeight: number
): number {
  // Get text from dialogue start to raw break position
  const text = doc.textBetween(dialogueStart, rawBreakPos, '');

  // CRITICAL: When text is empty, all dialogue is on page N+1
  // We need to find the LAST position that's actually on page N
  if (!text || text.length === 0) {
    console.warn('[SmartBreaks] Empty text between', dialogueStart, 'and', rawBreakPos);

    // Search backward from dialogueStart to find last position on page N
    let candidate = dialogueStart - 1;
    const minPos = Math.max(0, dialogueStart - 50); // Don't search too far back

    while (candidate >= minPos) {
      try {
        const coords = view.coordsAtPos(candidate);
        if (coords.top < pageNBottom) {
          // Found a position on page N!
          console.log('[SmartBreaks] Found position on page N:', candidate, 'coords.top=', coords.top, 'pageNBottom=', pageNBottom);
          return candidate;
        }
      } catch (e) {
        // coordsAtPos failed, try previous position
      }
      candidate--;
    }

    // Fallback: if we can't find a position on page N, use dialogueStart - 1
    console.warn('[SmartBreaks] Could not find position on page N, using', dialogueStart - 1);
    return dialogueStart - 1;
  }

  const safetyBuffer = 5;

  // Helper: Check if position has enough vertical room for (MORE) widget
  // AND is strictly before rawBreakPos (on page N, not N+1)
  const hasRoomForMore = (pos: number): boolean => {
    // CRITICAL: Position must be < rawBreakPos to be on page N
    if (pos >= rawBreakPos) {
      return false;
    }

    try {
      const coords = view.coordsAtPos(pos);
      const hasRoom = coords.bottom + moreWidgetHeight + safetyBuffer < pageNBottom;
      return hasRoom;
    } catch (e) {
      return false;
    }
  };

  // Phase 1: Search for sentence boundaries (. ? !)
  // Screenplay dialogue should only break at sentence endings
  for (let i = text.length - 1; i >= 0; i--) {
    const char = text[i];
    const nextChar = i + 1 < text.length ? text[i + 1] : '';

    // Check for sentence-ending punctuation followed by space
    if (/[.?!]/.test(char) && /\s/.test(nextChar)) {
      // Position after punctuation and space (start of next sentence)
      const boundaryPos = dialogueStart + i + 2;

      if (hasRoomForMore(boundaryPos)) {
        console.log('[SmartBreaks] Found sentence boundary at', boundaryPos, 'for raw break', rawBreakPos);
        return boundaryPos;
      }
    }
  }

  // Phase 2: Fallback to word boundaries (any whitespace)
  // Only used if no sentence boundary found or none have room
  for (let i = text.length - 1; i >= 0; i--) {
    if (/\s/.test(text[i])) {
      // Position after whitespace (start of next word)
      const boundaryPos = dialogueStart + i + 1;

      if (hasRoomForMore(boundaryPos)) {
        console.log('[SmartBreaks] No sentence boundary, using word boundary at', boundaryPos);
        return boundaryPos;
      }
    }
  }

  // Phase 3: Word-aware fallback - never split mid-word
  // Backtrace from rawBreakPos to find the start of the current word
  let wordStart = rawBreakPos - 1;
  while (wordStart > dialogueStart) {
    const charBefore = doc.textBetween(wordStart - 1, wordStart, '');
    if (/\s/.test(charBefore)) {
      // Found whitespace - wordStart is now at beginning of word containing rawBreakPos
      break;
    }
    wordStart--;
  }

  // Use the position before this word (after previous whitespace)
  // This ensures complete word goes to page N+1, avoiding mid-word splits
  const safePos = Math.max(dialogueStart, wordStart);

  console.warn(
    '[SmartBreaks] Word-aware fallback: using pos', safePos,
    'instead of raw break', rawBreakPos,
    'to avoid mid-word split'
  );

  // Log context for debugging
  const textBefore = doc.textBetween(Math.max(dialogueStart, safePos - 20), safePos, '');
  const textAfter = doc.textBetween(safePos, Math.min(dialogueStart + 200, safePos + 20), '');
  console.log('[SmartBreaks] Break context: "...' + textBefore + '" | "' + textAfter + '..."');

  return safePos;
}

/**
 * Find the exact character position where a page break occurs within a block
 *
 * Uses binary search with coordsAtPos() to find the first position that appears
 * on the next page.
 *
 * @param block Block that spans pages
 * @param bands Page band definitions
 * @param view Editor view for coordinate queries
 * @returns Position where page break occurs, or null if cannot determine
 */
function findPageBreakPosition(
  block: BlockInfo,
  bands: PageRect[],
  view: EditorView
): number | null {
  if (block.startPage === block.endPage) {
    return null; // Block doesn't span pages
  }

  const pageNBottom = bands[block.startPage]?.bottom;
  if (!pageNBottom) {
    return null;
  }

  // Binary search for the position where content crosses page boundary
  let left = block.pos + 1; // Start after block opening
  let right = block.end - 1; // End before block closing

  console.log(`[SmartBreaks] findPageBreakPosition for block at ${block.pos}: left=${left}, right=${right}, blockSize=${block.end - block.pos}, pageNBottom=${pageNBottom}`);

  // Edge case: very short blocks
  if (left >= right) {
    console.warn(`[SmartBreaks] Very short block (left >= right), returning left=${left}`);
    return left;
  }

  // Check first position to understand the issue
  try {
    const firstCoords = view.coordsAtPos(left);
    console.log(`[SmartBreaks] First position (${left}) coords: top=${firstCoords.top}, bottom=${firstCoords.bottom}, pageNBottom=${pageNBottom}, onPageN=${firstCoords.top < pageNBottom}`);
  } catch (e) {
    console.warn('[SmartBreaks] Could not get coords for first position', left);
  }

  while (left < right) {
    const mid = Math.floor((left + right) / 2);

    try {
      const coords = view.coordsAtPos(mid);
      const onPageN = coords.top < pageNBottom;

      console.log(`[SmartBreaks]   Binary search: mid=${mid}, coords.top=${coords.top}, pageNBottom=${pageNBottom}, onPageN=${onPageN}`);

      if (onPageN) {
        // Still on page N, search forward
        left = mid + 1;
      } else {
        // On page N+1 or beyond, search backward
        right = mid;
      }
    } catch (e) {
      // coordsAtPos failed, fall back to midpoint
      console.warn('[SmartBreaks] coordsAtPos failed at pos', mid, e);
      return Math.floor((block.pos + block.end) / 2);
    }
  }

  console.log(`[SmartBreaks] Binary search complete: returning left=${left} as first position on page N+1`);
  return left; // First position on page N+1
}

// ============================================================================
// Rule Application Functions (Stubs for Tier 4)
// ============================================================================

/**
 * Rule 1: Apply dialogue continuation markers
 *
 * For dialogue blocks that span multiple pages:
 * - Adds (MORE) centered below dialogue on page N
 * - Adds CHARACTER (CONT'D) before dialogue continuation on page N+1
 */
function applyDialogueContinuationRule(
  blocks: BlockInfo[],
  bands: PageRect[],
  decorations: Decoration[],
  view: EditorView,
  options: SmartBreaksOptions
): void {
  const { doc } = view.state;

  // Process blocks with actual DOM positions (no prediction needed)
  let decorationsAdded = 0;

  // Process ALL blocks in document order
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Only process dialogue blocks
    if (block.type !== options.schemaNames.dialogue) {
      continue;
    }

    // Use actual block page assignment from current DOM state
    // If earlier decorations exist, block positions already reflect them
    if (block.startPage === block.endPage) {
      // Block doesn't span pages, skip
      continue;
    }

    // Block spans pages - find the preceding CHARACTER block
    let characterBlock: BlockInfo | null = null;
    let characterName = '';

    // Search backwards for the most recent character (max 3 blocks back to account for parentheticals)
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      if (blocks[j].type === options.schemaNames.character) {
        characterBlock = blocks[j];

        // Extract character name from the node
        const charNode = doc.nodeAt(characterBlock.pos);
        if (charNode) {
          characterName = charNode.textContent.trim();
        }
        break;
      }
    }

    if (!characterBlock || !characterName) {
      console.warn('[SmartBreaks] No character found before dialogue at pos', block.pos);
      continue;
    }

    // Find exact position where page break occurs within dialogue
    // Use ORIGINAL block (not adjusted) because findPageBreakPosition queries current DOM
    const rawBreakPos = findPageBreakPosition(block, bands, view);

    if (!rawBreakPos) {
      console.warn('[SmartBreaks] Could not determine page break position for dialogue at pos', block.pos);
      continue;
    }

    // Debug: Show actual dialogue content
    const dialogueContent = doc.textBetween(block.pos + 1, block.end - 1, ' ');
    console.log(`[SmartBreaks]   Dialogue content (${dialogueContent.length} chars): "${dialogueContent.substring(0, 100)}${dialogueContent.length > 100 ? '...' : ''}"`);
    console.log(`[SmartBreaks]   Block span: pos ${block.pos} to ${block.end}, pages ${block.startPage}→${block.endPage}`);
    console.log(`[SmartBreaks]   Raw break position: ${rawBreakPos}`);

    // Find safe position for (MORE) at sentence/word boundary with vertical space check
    // This ensures (MORE) appears at bottom of page N, not top of page N+1
    const lineHeight = getLineHeight(view);
    const moreWidgetHeight = 4 + lineHeight + 4; // marginTop + lineHeight + marginBottom
    const pageNBottom = bands[block.startPage].bottom;

    const safeBreakPos = findSafeSentenceBoundary(
      doc,
      rawBreakPos,
      block.pos + 1,
      pageNBottom,
      view,
      moreWidgetHeight
    );

    // ALWAYS place (MORE) when dialogue spans pages
    // Per screenplay rules: (CONT'D) requires (MORE) above it
    // Even if text measurement shows content on page N+1, the block spans pages
    // (decoration feedback loop can cause text to appear shifted)
    decorations.push(createMoreMarker(safeBreakPos, options.moreText || '(MORE)'));
    console.log(`[SmartBreaks]   Placing (MORE) at pos ${safeBreakPos} (page ${block.startPage})`);

    // Always place CHARACTER (CONT'D) at start of page N+1
    // This is the actual page break position, ensuring marker is on next page
    decorations.push(
      createCharacterContinuation(
        rawBreakPos,  // CHANGED: Was safeBreakPos, now rawBreakPos for page separation
        characterName,
        options.contdText || '(CONT\'D)'
      )
    );
    console.log(`[SmartBreaks]   Placing CHARACTER (CONT'D) at pos ${rawBreakPos} (page ${block.endPage})`);

    decorationsAdded++;
    console.log(`[SmartBreaks]   [${decorationsAdded}] Added decorations for dialogue at pos ${block.pos}:
      Raw break at ${rawBreakPos}, safe sentence/word boundary at ${safeBreakPos}
      (MORE) at pos ${safeBreakPos} (page ${block.startPage})
      CHARACTER (CONT'D) at pos ${rawBreakPos} (page ${block.endPage})`);
  }

  console.log('[SmartBreaks] Applied dialogue continuation to', decorationsAdded, 'blocks');
}

/**
 * Rule 2: Prevent orphaned character names
 *
 * Status: Stub - To be implemented in Tier 4
 */
// function applyNoOrphanCharacterRule(
//   blocks: BlockInfo[],
//   decorations: Decoration[],
//   pageRects: PageRect[],
//   options: SmartBreaksOptions
// ): void {
//   // TODO: Tier 4 implementation
// }

/**
 * Rule 3: Keep parentheticals with dialogue
 *
 * Status: Stub - To be implemented in Tier 4
 */
// function applyParentheticalRule(
//   blocks: BlockInfo[],
//   decorations: Decoration[],
//   pageRects: PageRect[],
//   options: SmartBreaksOptions
// ): void {
//   // TODO: Tier 4 implementation
// }

/**
 * Rule 4: Prevent orphaned scene headings
 *
 * Status: Stub - To be implemented in Tier 4
 */
// function applySceneHeadingRule(
//   blocks: BlockInfo[],
//   decorations: Decoration[],
//   pageRects: PageRect[],
//   options: SmartBreaksOptions
// ): void {
//   // TODO: Tier 4 implementation
// }

/**
 * Rule 5: Prevent transitions at top of page
 *
 * Status: Stub - To be implemented in Tier 4
 */
// function applyNoTransitionAtTopRule(
//   blocks: BlockInfo[],
//   decorations: Decoration[],
//   pageRects: PageRect[]
// ): void {
//   // TODO: Tier 4 implementation
// }
