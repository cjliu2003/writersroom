/**
 * Pagination Engine
 *
 * Calculates page breaks for screenplay content using industry-standard
 * formatting rules (55 lines per page). Implements caching and incremental
 * updates for performance.
 *
 * This module works with Slate documents and uses the text-metrics module
 * for accurate line counting.
 */

import { Node, Element, Path } from 'slate';
import { TextMetrics, calculateElementLines, hashString } from './text-metrics';

/**
 * Lines per screenplay page - tuned to match Final Draft output
 * Standard is 55, but adjusted to 58 to account for margin rendering
 */
export const LINES_PER_PAGE = 58;

/**
 * Page break decoration interface for Slate
 * These decorations are applied to the editor to visually mark page boundaries
 */
export interface PageBreakDecoration {
  /** Start position of the decoration */
  anchor: { path: number[]; offset: number };
  /** End position of the decoration (same as anchor for zero-width) */
  focus: { path: number[]; offset: number };
  /** Flag indicating this is a page break decoration */
  pageBreak: true;
  /** Zero-based page index (page 1 = index 0) */
  pageIndex: number;
}

/**
 * Pagination state containing all calculated data
 * This state is cached and reused for incremental updates
 */
export interface PaginationState {
  /** Map of element path (stringified) to page number (1-indexed) */
  pageOfBlock: Map<string, number>;
  /** Map of element cache key to line count */
  lineCountCache: Map<string, number>;
  /** Total pages in the document */
  totalPages: number;
  /** Page break decorations for Slate rendering */
  decorations: PageBreakDecoration[];
}

/**
 * Calculate page breaks for entire document (full O(N) calculation)
 *
 * This is the primary algorithm used for initial load and when incremental
 * optimization isn't possible. It processes all nodes sequentially, calculating
 * line counts and determining where page breaks should occur.
 *
 * Algorithm:
 * 1. Initialize page 1, line count 0
 * 2. For each element:
 *    a. Calculate lines using text-metrics (with caching)
 *    b. Check if adding element exceeds page limit (55 lines)
 *    c. If yes: insert page break, start new page
 *    d. If no: add to current page
 * 3. Record page assignments and generate decorations
 *
 * @param nodes - Slate document nodes (editor.children)
 * @param metrics - Calibrated text metrics for line counting
 * @param existingState - Previous pagination state (for cache reuse)
 * @returns Complete pagination state with decorations
 *
 * @example
 * ```typescript
 * const metrics = calibrateTextMetrics();
 * const state = calculatePageBreaks(editor.children, metrics);
 * console.log(`Document has ${state.totalPages} pages`);
 * ```
 */
export function calculatePageBreaks(
  nodes: Node[],
  metrics: TextMetrics,
  existingState?: PaginationState
): PaginationState {
  // Initialize or reuse caches
  const pageOfBlock = new Map<string, number>();
  const lineCountCache = existingState?.lineCountCache || new Map<string, number>();
  const decorations: PageBreakDecoration[] = [];

  let currentPage = 1;
  let currentLines = 0;

  // Process each top-level node
  nodes.forEach((node, index) => {
    // Skip non-element nodes (text nodes shouldn't be at top level)
    if (!Element.isElement(node)) {
      return;
    }

    const path = [index];
    const pathKey = JSON.stringify(path);

    // Calculate lines for this element (with caching)
    const text = Node.string(node);
    const textHash = hashString(text);
    const elementType = (node as any).type || 'general';
    const cacheKey = `${elementType}:${textHash}`;

    let elementLines: number;
    if (lineCountCache.has(cacheKey)) {
      // Cache hit - reuse previous calculation
      elementLines = lineCountCache.get(cacheKey)!;
    } else {
      // Cache miss - calculate and store
      elementLines = calculateElementLines(text, elementType, metrics);
      lineCountCache.set(cacheKey, elementLines);
    }

    // Check if element fits on current page
    if (currentLines + elementLines > LINES_PER_PAGE) {
      // Page break needed before this element
      // Create decoration at the start of the first text node in this element
      // Slate decorations must point to text nodes, not element nodes
      const textPath = [...path, 0]; // Point to first text child [index, 0]
      decorations.push({
        anchor: { path: textPath, offset: 0 },
        focus: { path: textPath, offset: 0 },
        pageBreak: true,
        pageIndex: currentPage - 1, // Zero-indexed for rendering
      });

      // Start new page with this element
      currentPage++;
      currentLines = elementLines;
    } else {
      // Element fits on current page
      currentLines += elementLines;
    }

    // Record page assignment for this element
    pageOfBlock.set(pathKey, currentPage);
  });

  return {
    pageOfBlock,
    lineCountCache,
    totalPages: currentPage,
    decorations,
  };
}

/**
 * Incremental page break calculation (future optimization)
 *
 * This function will implement O(D) incremental updates where D is the size
 * of the dirty region. For Phase 1, it falls back to full calculation.
 *
 * Future algorithm:
 * 1. Detect changed paths from Yjs operations
 * 2. Find earliest changed block
 * 3. Walk backwards until page assignment stable
 * 4. Reflow forward from stable point
 * 5. Early exit when assignments match previous state
 *
 * Performance improvement: 10-100x faster for typical edits
 *
 * @param nodes - Slate document nodes
 * @param metrics - Calibrated text metrics
 * @param previousState - Previous pagination state
 * @param changedPaths - Paths that changed (from Yjs operations)
 * @returns Updated pagination state
 *
 * @example
 * ```typescript
 * // Future usage:
 * const newState = calculatePageBreaksIncremental(
 *   editor.children,
 *   metrics,
 *   previousState,
 *   [[5], [6]] // Elements 5 and 6 changed
 * );
 * ```
 */
export function calculatePageBreaksIncremental(
  nodes: Node[],
  metrics: TextMetrics,
  previousState: PaginationState,
  changedPaths: Path[]
): PaginationState {
  // TODO: Implement incremental algorithm in Phase 1.5
  // For now, fall back to full calculation
  // This ensures correctness while we validate the full algorithm first
  console.log('[PaginationEngine] Incremental update requested, falling back to full calculation');
  console.log('  Changed paths:', changedPaths.map(p => JSON.stringify(p)));

  return calculatePageBreaks(nodes, metrics, previousState);
}

/**
 * Filter decorations for a specific node path
 *
 * This is called by Slate's decorate() function to get decorations
 * relevant to the current node being rendered. Only decorations with
 * matching paths are returned.
 *
 * @param decorations - All page break decorations
 * @param path - Current node path from Slate
 * @returns Decorations for this specific path
 *
 * @example
 * ```typescript
 * // In Slate's decorate function:
 * const decorate = ([node, path]) => {
 *   return getDecorationsForPath(allDecorations, path);
 * };
 * ```
 */
export function getDecorationsForPath(
  decorations: PageBreakDecoration[],
  path: Path
): PageBreakDecoration[] {
  return decorations.filter(decoration =>
    Path.equals(decoration.anchor.path, path)
  );
}

/**
 * Get page number for a specific element
 *
 * Helper function to determine which page a given element is on.
 * Useful for displaying page numbers, implementing page-based navigation,
 * or debugging pagination.
 *
 * @param path - Element path
 * @param state - Current pagination state
 * @returns Page number (1-indexed) or 1 if not found
 *
 * @example
 * ```typescript
 * const pageNum = getPageForElement([5], paginationState);
 * console.log(`Element 5 is on page ${pageNum}`);
 * ```
 */
export function getPageForElement(
  path: Path,
  state: PaginationState
): number {
  const pathKey = JSON.stringify(path);
  return state.pageOfBlock.get(pathKey) || 1;
}

/**
 * Get all elements on a specific page
 *
 * Returns the paths of all elements that appear on the given page.
 * Useful for implementing page-based navigation or rendering.
 *
 * @param pageNumber - Page number (1-indexed)
 * @param state - Current pagination state
 * @returns Array of element paths on this page
 *
 * @example
 * ```typescript
 * const elementsOnPage2 = getElementsOnPage(2, paginationState);
 * console.log(`Page 2 has ${elementsOnPage2.length} elements`);
 * ```
 */
export function getElementsOnPage(
  pageNumber: number,
  state: PaginationState
): Path[] {
  const paths: Path[] = [];

  for (const [pathKey, page] of Array.from(state.pageOfBlock.entries())) {
    if (page === pageNumber) {
      paths.push(JSON.parse(pathKey));
    }
  }

  return paths.sort((a, b) => {
    // Sort by path (element index)
    return a[0] - b[0];
  });
}

/**
 * Get page break information for debugging
 *
 * Returns detailed information about pagination state for debugging
 * and validation purposes.
 *
 * @param state - Current pagination state
 * @returns Debug information object
 *
 * @example
 * ```typescript
 * const debug = getDebugInfo(paginationState);
 * console.log('Pagination debug:', debug);
 * ```
 */
export function getDebugInfo(state: PaginationState): {
  totalPages: number;
  totalElements: number;
  pageBreakCount: number;
  cacheSize: number;
  averageElementsPerPage: number;
  pageDistribution: Record<number, number>;
} {
  // Count elements per page
  const pageDistribution: Record<number, number> = {};
  for (const page of Array.from(state.pageOfBlock.values())) {
    pageDistribution[page] = (pageDistribution[page] || 0) + 1;
  }

  return {
    totalPages: state.totalPages,
    totalElements: state.pageOfBlock.size,
    pageBreakCount: state.decorations.length,
    cacheSize: state.lineCountCache.size,
    averageElementsPerPage: state.pageOfBlock.size / state.totalPages,
    pageDistribution,
  };
}

/**
 * Validate pagination state consistency
 *
 * Checks for common errors in pagination state to help catch bugs.
 * Useful for testing and debugging.
 *
 * @param state - Pagination state to validate
 * @returns Object with validation results and errors
 *
 * @example
 * ```typescript
 * const validation = validatePaginationState(state);
 * if (!validation.valid) {
 *   console.error('Pagination errors:', validation.errors);
 * }
 * ```
 */
export function validatePaginationState(state: PaginationState): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check: Page break count should be totalPages - 1
  if (state.decorations.length !== state.totalPages - 1) {
    errors.push(
      `Decoration count mismatch: ${state.decorations.length} decorations for ${state.totalPages} pages (expected ${state.totalPages - 1})`
    );
  }

  // Check: All page numbers should be between 1 and totalPages
  for (const [pathKey, page] of Array.from(state.pageOfBlock.entries())) {
    if (page < 1 || page > state.totalPages) {
      errors.push(
        `Invalid page number ${page} for element ${pathKey} (valid range: 1-${state.totalPages})`
      );
    }
  }

  // Check: Decoration page indices should be sequential
  const decorationPages = state.decorations
    .map(d => d.pageIndex)
    .sort((a, b) => a - b);

  for (let i = 0; i < decorationPages.length; i++) {
    if (decorationPages[i] !== i) {
      errors.push(
        `Decoration page index gap: expected ${i}, got ${decorationPages[i]}`
      );
    }
  }

  // Check: Elements should be on consecutive pages (no gaps)
  const usedPages = new Set(state.pageOfBlock.values());
  for (let page = 1; page <= state.totalPages; page++) {
    if (!usedPages.has(page)) {
      errors.push(`No elements on page ${page} (gap in pagination)`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
