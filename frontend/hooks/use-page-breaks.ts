/**
 * Page Breaks Hook
 *
 * React hook for calculating page breaks in screenplay content using a Web Worker.
 * Runs calculation in the background to avoid blocking the main thread, making it
 * suitable for long scripts without impacting UI responsiveness.
 *
 * Features:
 * - Non-blocking calculation via Web Worker
 * - Debounced updates (500ms) to reduce unnecessary calculations
 * - Loading state for UI feedback
 * - Automatic worker lifecycle management
 * - Industry-standard screenplay page formatting (55 lines per page)
 *
 * Usage:
 * ```typescript
 * const { pageBreaks, totalPages, isCalculating } = usePageBreaks(content);
 *
 * // Use page breaks to render page numbers
 * {totalPages} pages
 *
 * // Check if element is at page break
 * const isPageBreak = pageBreaks.includes(elementIndex);
 * ```
 */

import { useState, useEffect, useRef } from 'react';
import { debounce } from 'lodash';
import { ScreenplayElement } from '@/types/screenplay';

/**
 * Result from page break calculation worker
 */
interface PageBreakResult {
  /** Array of node indices where page breaks occur */
  pageBreaks: number[];
  /** Total number of pages in the screenplay */
  totalPages: number;
  /** Optional error message if calculation failed */
  error?: string;
}

/**
 * Return type for usePageBreaks hook
 */
interface UsePageBreaksReturn {
  /** Array of node indices where page breaks should be inserted */
  pageBreaks: number[];
  /** Total number of pages in the screenplay */
  totalPages: number;
  /** True while calculation is in progress */
  isCalculating: boolean;
}

/**
 * Calculate page breaks for screenplay content in the background.
 *
 * This hook manages a Web Worker that calculates where page breaks should occur
 * based on industry-standard screenplay formatting (55 lines per page). The
 * calculation is debounced to avoid excessive worker calls during rapid content
 * changes (e.g., typing).
 *
 * @param content - Array of screenplay elements to calculate page breaks for
 * @returns Object with pageBreaks array, totalPages count, and isCalculating flag
 *
 * @example
 * ```typescript
 * function ScriptEditor({ content }) {
 *   const { pageBreaks, totalPages, isCalculating } = usePageBreaks(content);
 *
 *   return (
 *     <div>
 *       <div>Pages: {totalPages}</div>
 *       {isCalculating && <div>Calculating pages...</div>}
 *       {content.map((element, index) => (
 *         <div key={index}>
 *           {pageBreaks.includes(index) && <PageBreak />}
 *           <Element data={element} />
 *         </div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePageBreaks(content: ScreenplayElement[]): UsePageBreaksReturn {
  // State for page break calculation results
  const [pageBreaks, setPageBreaks] = useState<number[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [isCalculating, setIsCalculating] = useState(false);

  // Ref to persist worker instance across renders
  const workerRef = useRef<Worker | null>(null);

  // Create and initialize worker on mount
  useEffect(() => {
    // Only create worker in browser environment
    if (typeof window !== 'undefined') {
      try {
        // Create worker using Next.js webpack's worker-loader pattern
        // The new URL pattern tells webpack to bundle this as a worker
        workerRef.current = new Worker(
          new URL('../workers/page-calculator.worker.ts', import.meta.url)
        );

        // Set up message handler for worker results
        workerRef.current.onmessage = (e: MessageEvent<PageBreakResult>) => {
          const { pageBreaks: breaks, totalPages: pages, error } = e.data;

          if (error) {
            console.error('[usePageBreaks] Worker error:', error);
            // Set default values on error
            setPageBreaks([]);
            setTotalPages(1);
          } else {
            // Update state with calculated results
            setPageBreaks(breaks);
            setTotalPages(pages);
          }

          // Mark calculation as complete
          setIsCalculating(false);
        };

        // Handle worker errors
        workerRef.current.onerror = (error) => {
          console.error('[usePageBreaks] Worker error:', error);
          setPageBreaks([]);
          setTotalPages(1);
          setIsCalculating(false);
        };

        console.log('[usePageBreaks] Worker initialized');
      } catch (error) {
        console.error('[usePageBreaks] Failed to create worker:', error);
      }
    }

    // Cleanup: terminate worker on unmount
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
        console.log('[usePageBreaks] Worker terminated');
      }
    };
  }, []); // Empty deps - only run on mount/unmount

  // Calculate page breaks when content changes (debounced)
  useEffect(() => {
    // Create debounced calculation function
    // 500ms delay reduces unnecessary calculations during rapid typing
    const calculate = debounce(() => {
      if (workerRef.current && content && content.length > 0) {
        // Mark calculation as in progress
        setIsCalculating(true);

        // Send content to worker for calculation
        workerRef.current.postMessage({ content });

        console.log('[usePageBreaks] Calculation requested for', content.length, 'elements');
      } else if (content && content.length === 0) {
        // Empty content - reset to defaults
        setPageBreaks([]);
        setTotalPages(1);
        setIsCalculating(false);
      }
    }, 500); // 500ms debounce delay

    // Trigger calculation
    calculate();

    // Cleanup: cancel pending debounced calls on dependency change or unmount
    return () => {
      calculate.cancel();
    };
  }, [content]); // Recalculate when content changes

  return {
    pageBreaks,
    totalPages,
    isCalculating,
  };
}

/**
 * Check if a specific element index is at a page break.
 *
 * Helper function for checking if a page break occurs at a given index.
 * Useful for conditional rendering of page break indicators.
 *
 * @param index - Element index to check
 * @param pageBreaks - Array of page break indices from usePageBreaks
 * @returns True if there's a page break at this index
 *
 * @example
 * ```typescript
 * const { pageBreaks } = usePageBreaks(content);
 * const hasBreak = isPageBreak(10, pageBreaks); // Check element 10
 * ```
 */
export function isPageBreak(index: number, pageBreaks: number[]): boolean {
  return pageBreaks.includes(index);
}

/**
 * Get the page number for a specific element index.
 *
 * Helper function to determine which page a given element is on.
 * Useful for displaying page numbers or implementing page-based navigation.
 *
 * @param index - Element index to check
 * @param pageBreaks - Array of page break indices from usePageBreaks
 * @returns Page number (1-indexed) that contains this element
 *
 * @example
 * ```typescript
 * const { pageBreaks } = usePageBreaks(content);
 * const page = getPageNumber(25, pageBreaks); // Get page for element 25
 * ```
 */
export function getPageNumber(index: number, pageBreaks: number[]): number {
  // Count how many page breaks occur before this index
  let pageNumber = 1;
  for (const breakIndex of pageBreaks) {
    if (breakIndex <= index) {
      pageNumber++;
    } else {
      break;
    }
  }
  return pageNumber;
}
