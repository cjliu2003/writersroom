/**
 * Page Break Calculator Web Worker
 *
 * Calculates page breaks for screenplay content in the background to avoid
 * blocking the main thread. Uses industry-standard screenplay formatting rules
 * to determine where page breaks should occur.
 *
 * Standard Screenplay Formatting:
 * - 55 lines per page (industry standard)
 * - Different element types have different line heights
 * - Text wrapping calculated at ~60 characters per line
 *
 * Usage:
 * ```typescript
 * const worker = new Worker(new URL('./page-calculator.worker.ts', import.meta.url));
 * worker.postMessage({ content: screenplayElements });
 * worker.onmessage = (e) => {
 *   const { pageBreaks, totalPages } = e.data;
 *   // Use page break data
 * };
 * ```
 */

import { ScreenplayElement } from '@/types/screenplay';

/**
 * Request message format for page break calculation
 */
interface PageBreakCalculationRequest {
  content: ScreenplayElement[];
}

/**
 * Result message format with calculated page breaks
 */
interface PageBreakCalculationResult {
  /** Array of node indices where page breaks occur */
  pageBreaks: number[];
  /** Total number of pages in the screenplay */
  totalPages: number;
}

/**
 * Industry standard: 55 lines per screenplay page
 */
const LINES_PER_PAGE = 55;

/**
 * Base line heights for each screenplay element type.
 * These values represent the vertical spacing including margins.
 *
 * Scene headings and transitions have extra spacing (2 lines)
 * to create visual separation. Character names also get 2 lines
 * to create space before dialogue.
 */
const LINE_HEIGHTS: Record<string, number> = {
  'scene_heading': 2,    // Scene headings have space above and below
  'action': 1,           // Action lines have standard single spacing
  'character': 2,        // Character names have space above
  'dialogue': 1,         // Dialogue has standard single spacing
  'parenthetical': 1,    // Parentheticals are compact
  'transition': 2,       // Transitions have extra spacing
  'shot': 1,             // Shot directions have standard spacing
  'cast_list': 1,        // Cast lists have standard spacing
  'new_act': 2,          // Act markers have extra spacing
  'end_of_act': 2,       // Act endings have extra spacing
  'summary': 1,          // Summaries have standard spacing
  'general': 1,          // General text has standard spacing
};

/**
 * Approximate characters per line for text wrapping calculation.
 * Courier 12pt on standard US Letter paper fits about 60 characters.
 */
const CHARS_PER_LINE = 60;

/**
 * Calculate page breaks for screenplay content.
 *
 * Algorithm:
 * 1. Track current line count on the page
 * 2. For each element:
 *    - Calculate base line height from element type
 *    - Calculate text lines based on character count
 *    - Check if adding element would exceed page limit
 *    - If yes, insert page break and start new page
 *    - If no, continue on current page
 * 3. Return array of page break indices and total page count
 *
 * @param content - Array of screenplay elements to calculate page breaks for
 * @returns Object with pageBreaks array and totalPages count
 */
function calculatePageBreaks(content: ScreenplayElement[]): PageBreakCalculationResult {
  const pageBreaks: number[] = [];
  let currentLines = 0;
  let currentPage = 1;

  content.forEach((element, index) => {
    // Get base line height for this element type
    const baseLines = LINE_HEIGHTS[element.type] || 1;

    // Calculate additional lines needed for text content
    // Text wraps at approximately 60 characters per line
    const textContent = element.children[0]?.text || '';
    const textLength = textContent.length;
    const textLines = textLength > 0 ? Math.ceil(textLength / CHARS_PER_LINE) : 0;

    // Total lines needed for this element
    const totalLines = baseLines + textLines;

    // Check if adding this element would exceed page limit
    if (currentLines + totalLines > LINES_PER_PAGE) {
      // Page break needed - insert at this index
      pageBreaks.push(index);

      // Start new page with this element
      currentLines = totalLines;
      currentPage++;
    } else {
      // Element fits on current page
      currentLines += totalLines;
    }
  });

  return {
    pageBreaks,
    totalPages: currentPage,
  };
}

/**
 * Web Worker message handler.
 *
 * Listens for messages containing screenplay content,
 * calculates page breaks, and posts results back to main thread.
 */
self.addEventListener('message', (event: MessageEvent<PageBreakCalculationRequest>) => {
  try {
    const { content } = event.data;

    // Validate input
    if (!Array.isArray(content)) {
      throw new Error('Invalid content: expected array of screenplay elements');
    }

    // Calculate page breaks
    const result = calculatePageBreaks(content);

    // Post result back to main thread
    self.postMessage(result);
  } catch (error) {
    // Post error back to main thread
    self.postMessage({
      error: error instanceof Error ? error.message : 'Unknown error in page calculation',
      pageBreaks: [],
      totalPages: 1,
    });
  }
});

// Export types for TypeScript support when importing worker
export type { PageBreakCalculationRequest, PageBreakCalculationResult };
