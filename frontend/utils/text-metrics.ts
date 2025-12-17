/**
 * Text metrics for screenplay formatting
 *
 * Uses canvas measurement for accurate monospace character sizing
 * to calculate line counts and page breaks with industry-standard precision.
 */

export interface TextMetrics {
  charsPerInch: number;
  maxColsByType: Record<string, number>;
  dpi: number;
}

export interface ElementWidths {
  scene_heading: number;
  action: number;
  character: number;
  dialogue: number;
  parenthetical: number;
  transition: number;
  shot: number;
  general: number;
}

/**
 * Standard screenplay element widths in inches
 * Based on Final Draft and industry standards:
 * - Page: 8.5" wide
 * - Left margin: 1.5"
 * - Right margin: 1.0"
 * - Usable width: 6.0"
 */
export const ELEMENT_WIDTHS: ElementWidths = {
  scene_heading: 6.0,   // Full width
  action: 6.0,          // Full width
  character: 3.5,       // Narrow (centered)
  dialogue: 3.5,        // Narrow
  parenthetical: 2.7,   // Final Draft standard: 27 chars including parens
  transition: 6.0,      // Full width (right-aligned)
  shot: 6.0,           // Full width
  general: 6.0,        // Full width
};

/**
 * Base line heights for vertical spacing
 * Scene headings, characters, and transitions get extra spacing
 */
export const BASE_LINE_HEIGHTS: Record<string, number> = {
  scene_heading: 2,    // Extra space above and below
  action: 1,
  character: 2,        // Extra space above
  dialogue: 1,
  parenthetical: 1,
  transition: 2,       // Extra space
  shot: 1,
  general: 1,
};

/**
 * Calibrate text metrics using canvas measurement
 *
 * This measures the actual rendered width of Courier Prime characters
 * to calculate accurate characters-per-inch for line wrapping.
 *
 * @returns TextMetrics object with calibrated values
 */
export function calibrateTextMetrics(): TextMetrics {
  // Check for browser environment
  if (typeof document === 'undefined') {
    console.warn('[TextMetrics] Not in browser environment, using defaults');
    return getDefaultMetrics();
  }

  // Create offscreen canvas for measurement
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    console.warn('[TextMetrics] Canvas context not available, using defaults');
    return getDefaultMetrics();
  }

  // Set font exactly as used in editor
  ctx.font = '12pt "Courier Prime", "Courier New", Courier, monospace';

  // Measure 10 M characters (widest character in monospace)
  const testString = 'MMMMMMMMMM';
  const width = ctx.measureText(testString).width;

  // Calculate characters per inch
  // Standard web DPI is 96 pixels per inch
  const dpi = 96;
  const charsPerInch = 10 / (width / dpi);

  console.log('[TextMetrics] Calibration:', {
    testString,
    width,
    dpi,
    charsPerInch: charsPerInch.toFixed(2),
  });

  // Calculate max columns for each element type
  const maxColsByType: Record<string, number> = {};
  for (const [type, widthInches] of Object.entries(ELEMENT_WIDTHS)) {
    maxColsByType[type] = Math.round(charsPerInch * widthInches);
  }

  return {
    charsPerInch,
    maxColsByType,
    dpi,
  };
}

/**
 * Get default metrics as fallback
 */
function getDefaultMetrics(): TextMetrics {
  const charsPerInch = 10; // Courier standard
  const maxColsByType: Record<string, number> = {
    scene_heading: 60,
    action: 60,
    character: 35,
    dialogue: 35,
    parenthetical: 27,  // Final Draft standard including parens
    transition: 60,
    shot: 60,
    general: 60,
  };

  return {
    charsPerInch,
    maxColsByType,
    dpi: 96,
  };
}

/**
 * Calculate line count for a text element
 *
 * @param text - Text content of element
 * @param elementType - Screenplay element type
 * @param metrics - Calibrated text metrics
 * @returns Total line count (base spacing + wrapped text lines)
 */
export function calculateElementLines(
  text: string,
  elementType: string,
  metrics: TextMetrics
): number {
  const maxCols = metrics.maxColsByType[elementType] || 60;
  const baseLines = BASE_LINE_HEIGHTS[elementType] || 1;

  // Calculate text wrapping
  const textLength = text.length;
  const textLines = textLength > 0 ? Math.ceil(textLength / maxCols) : 0;

  return baseLines + textLines;
}

/**
 * Simple string hash for cache keys
 * FNV-1a hash algorithm
 *
 * @param str - String to hash
 * @returns Hash value as base-36 string
 */
export function hashString(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
