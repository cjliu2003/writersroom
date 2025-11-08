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
 */
interface PageRect {
  top: number;     // Y coordinate of page top (from viewport)
  bottom: number;  // Y coordinate of page bottom (from viewport)
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

          const decorations = computeDecorations(editorView, options);

          console.log('[SmartBreaks] Computed', decorations.find().length, 'decorations');

          // Dispatch transaction with new decorations
          editorView.dispatch(
            editorView.state.tr.setMeta(SmartBreaksKey, { decorations })
          );
        });
      };

      // Set up ResizeObserver for window/container size changes
      const resizeObserver = new ResizeObserver(() => {
        console.log('[SmartBreaks] Resize detected, recomputing...');
        recompute();
      });
      resizeObserver.observe(root as Element);

      // Set up MutationObserver for pagination DOM changes
      const mutationObserver = new MutationObserver((mutations) => {
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
         */
        update: () => {
          recompute();
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
  options: SmartBreaksOptions
): DecorationSet {
  const { state } = view;
  const { doc } = state;

  // STEP 1: Check for pagination headers (early exit if not paginated)
  const headers = Array.from(
    document.querySelectorAll<HTMLElement>('.rm-page-header')
  );

  if (!headers.length) {
    console.log('[SmartBreaks] No pagination headers found, skipping computation');
    return DecorationSet.create(doc, []);
  }

  console.log('[SmartBreaks] Found', headers.length, 'pagination headers');

  // STEP 2: Get header positions and validate pagination stability
  const headerRects = headers.map(h => h.getBoundingClientRect());

  // Debug logging: show raw header positions for diagnostics
  console.log('[SmartBreaks] 🔍 Header positions:');
  headerRects.forEach((rect, i) => {
    console.log(`  Header ${i}: top=${rect.top.toFixed(1)}`);
  });

  // Validate pagination stability before proceeding
  if (!arePagesStable(headerRects)) {
    console.warn(
      '[SmartBreaks] ⚠️ Pagination not stable, deferring computation. ' +
      'Will retry on next update.'
    );
    return DecorationSet.create(doc, []);
  }

  console.log('[SmartBreaks] ✅ Pagination stable, proceeding with computation');

  // TIER 2: Collect blocks with page assignments
  const blocks = collectBlocks(view, options);

  if (blocks.length === 0) {
    console.log('[SmartBreaks] No screenplay blocks found, skipping computation');
    return DecorationSet.create(doc, []);
  }

  // TIER 2: At this stage, we just collect and log data
  // TIER 3-4 will add:
  // - Decoration building (pushToNextPage, addMoreAtEndOfPage, etc.)
  // - Rule application (applyDialogueContinuationRule, etc.)

  console.log('[SmartBreaks] Tier 2: Data collection complete, returning empty decorations');
  console.log('[SmartBreaks] Next steps: Tier 3 (decoration builders), Tier 4 (rules)');

  return DecorationSet.create(doc, []);
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

/**
 * Check if pagination headers are in a stable, valid state
 *
 * Validates that:
 * 1. Headers are in sequential vertical order (each below the previous)
 * 2. No mid-document headers are at viewport top (Y=0), which indicates
 *    pagination is still rendering/repositioning
 *
 * This prevents computing decorations when pagination geometry is corrupted
 * or incomplete, which would cause incorrect page span calculations.
 *
 * @param rects Array of DOMRect objects from pagination headers
 * @returns true if pagination is stable and ready for computation
 */
function arePagesStable(rects: DOMRect[]): boolean {
  if (!rects.length) return false;

  for (let i = 0; i < rects.length - 1; i++) {
    // Check headers are in sequential order (each header below the previous)
    if (rects[i].top >= rects[i + 1].top) {
      console.warn(
        `[SmartBreaks] ⚠️ Pagination unstable: header ${i} (top=${rects[i].top.toFixed(1)}) ` +
        `is not above header ${i + 1} (top=${rects[i + 1].top.toFixed(1)})`
      );
      return false;
    }

    // Check no mid-document header at viewport top (indicates mid-render)
    // Skip check for first header (i=0), as it can legitimately be at viewport top
    if (i > 0 && rects[i + 1].top === 0) {
      console.warn(
        `[SmartBreaks] ⚠️ Pagination unstable: mid-document header ${i + 1} at viewport top (Y=0), ` +
        `likely still rendering`
      );
      return false;
    }
  }

  return true;
}

/**
 * Attempt to extract page height from CSS variable
 *
 * @param el HTML element to start searching from
 * @returns Page height in pixels, or null if not found
 */
function guessPageHeightFromCSS(el: HTMLElement): number | null {
  // Find the pagination root element
  const root = el.closest('.screenplay-editor.rm-with-pagination') as HTMLElement | null;
  if (!root) {
    console.log('[SmartBreaks] No pagination root found for CSS variable lookup');
    return null;
  }

  // Try to get --rm-page-height CSS variable
  const computedStyle = getComputedStyle(root);
  const heightVar = computedStyle.getPropertyValue('--rm-page-height').trim();

  if (!heightVar) {
    console.log('[SmartBreaks] No --rm-page-height CSS variable found');
    return null;
  }

  const heightPx = parseFloat(heightVar);
  if (!Number.isFinite(heightPx) || heightPx <= 0) {
    console.log('[SmartBreaks] Invalid --rm-page-height value:', heightVar);
    return null;
  }

  console.log('[SmartBreaks] Page height from CSS variable:', heightPx, 'px');
  return heightPx;
}

/**
 * Extract page rectangle information from pagination headers
 *
 * Builds an array of PageRect objects representing each page's boundaries.
 * Uses the distance between successive headers, or falls back to CSS variable
 * or hardcoded Letter page height.
 *
 * @param headers Array of .rm-page-header elements in visual order
 * @returns Array of page rectangles with top/bottom Y coordinates
 */
function getPageRects(headers: HTMLElement[]): PageRect[] {
  if (!headers.length) {
    console.log('[SmartBreaks] getPageRects called with no headers');
    return [];
  }

  // Get bounding rects for all headers
  const headerRects = headers.map(h => h.getBoundingClientRect());

  // Try to get page height from CSS variable, otherwise use fallback
  // Letter size at 96 DPI = 11 inches * 96 = 1056 pixels
  const fallbackHeight = 1056;
  const cssHeight = guessPageHeightFromCSS(headers[0]);
  const pageHeight = cssHeight || fallbackHeight;

  console.log('[SmartBreaks] Using page height:', pageHeight, 'px',
    cssHeight ? '(from CSS)' : '(fallback)');

  // Build page rectangles
  const pageRects: PageRect[] = [];
  for (let i = 0; i < headerRects.length; i++) {
    const top = headerRects[i].top;

    // For all pages except the last, use the next header's position
    // For the last page, use the calculated page height
    const bottom = (i < headerRects.length - 1)
      ? headerRects[i + 1].top - 1  // -1 to avoid overlap
      : top + pageHeight;

    pageRects.push({ top, bottom });

    console.log(`[SmartBreaks] Page ${i}: top=${top.toFixed(1)}, bottom=${bottom.toFixed(1)}, height=${(bottom - top).toFixed(1)}`);
  }

  return pageRects;
}

/**
 * Determine which page index a Y coordinate falls on
 *
 * @param y Y coordinate (from viewport, getBoundingClientRect)
 * @param rects Array of page rectangles
 * @returns Page index (0-based), or -1 if before first page, or last page index if after last
 */
function pageIndexForY(y: number, rects: PageRect[]): number {
  if (!rects.length) return -1;

  // Check each page rectangle
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (y >= rect.top && y <= rect.bottom) {
      return i;
    }
  }

  // Handle out-of-bounds: before first page or after last page
  if (y < rects[0].top) {
    console.log('[SmartBreaks] Y coordinate', y, 'is before first page, clamping to 0');
    return 0;
  }

  console.log('[SmartBreaks] Y coordinate', y, 'is after last page, clamping to', rects.length - 1);
  return rects.length - 1;
}

// ============================================================================
// Block Collection (Tier 2)
// ============================================================================

/**
 * Collect all screenplay blocks with their page assignments
 *
 * Iterates through the ProseMirror document, finds all screenplay block nodes,
 * gets their DOM rects, and assigns start/end page indices.
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
  const headers = Array.from(
    document.querySelectorAll<HTMLElement>('.rm-page-header')
  );

  if (!headers.length) {
    console.log('[SmartBreaks] collectBlocks: no pagination headers, returning empty');
    return [];
  }

  const pageRects = getPageRects(headers);

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

    // Get bounding rectangle
    const rect = dom.getBoundingClientRect();
    if (!isFiniteRect(rect)) {
      console.log('[SmartBreaks] Invalid rect for node at pos', pos, ':', rect);
      return;
    }

    // Determine start and end pages
    const startPage = pageIndexForY(rect.top, pageRects);
    const endPage = pageIndexForY(rect.bottom, pageRects);

    blocks.push({
      pos,
      end: pos + node.nodeSize,
      type: node.type.name as BlockKind,
      rect,
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
 * Status: Stub - To be implemented in Tier 3
 */
// function addMoreAtEndOfPage(block: BlockInfo, moreText: string): Decoration {
//   // TODO: Tier 3 implementation
//   return null as any;
// }

/**
 * Create (CONT'D) widget decoration after character name
 *
 * Status: Stub - To be implemented in Tier 3
 */
// function addContdAfterCharacter(
//   block: BlockInfo,
//   contdText: string
// ): Decoration {
//   // TODO: Tier 3 implementation
//   return null as any;
// }

// ============================================================================
// Rule Application Functions (Stubs for Tier 4)
// ============================================================================

/**
 * Rule 1: Apply dialogue continuation markers
 *
 * Status: Stub - To be implemented in Tier 4
 */
// function applyDialogueContinuationRule(
//   blocks: BlockInfo[],
//   decorations: Decoration[],
//   options: SmartBreaksOptions
// ): void {
//   // TODO: Tier 4 implementation
// }

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
