/**
 * Unit tests for text-metrics module
 *
 * Tests text measurement and line counting functionality including:
 * - Metric calibration accuracy
 * - Line count calculations
 * - Element type handling
 * - Edge cases (empty text, missing types)
 * - Hash function consistency
 */

import {
  calibrateTextMetrics,
  calculateElementLines,
  hashString,
  ELEMENT_WIDTHS,
  BASE_LINE_HEIGHTS,
  type TextMetrics,
} from '../text-metrics';

describe('text-metrics', () => {
  describe('calibrateTextMetrics', () => {
    beforeEach(() => {
      // Mock canvas and context for consistent testing
      const mockMeasureText = jest.fn().mockReturnValue({ width: 96 }); // 10 chars at 9.6 pixels each
      const mockGetContext = jest.fn().mockReturnValue({
        font: '',
        measureText: mockMeasureText,
      });

      // Mock document.createElement for canvas
      global.document.createElement = jest.fn().mockImplementation((tagName) => {
        if (tagName === 'canvas') {
          return {
            getContext: mockGetContext,
          };
        }
        return {};
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should calibrate character metrics accurately', () => {
      const metrics = calibrateTextMetrics();

      expect(metrics.charsPerInch).toBeGreaterThan(9);
      expect(metrics.charsPerInch).toBeLessThan(11);
      expect(metrics.dpi).toBe(96);
    });

    it('should calculate max columns for each element type', () => {
      const metrics = calibrateTextMetrics();

      expect(metrics.maxColsByType).toBeDefined();
      expect(metrics.maxColsByType.scene_heading).toBeGreaterThan(0);
      expect(metrics.maxColsByType.action).toBeGreaterThan(0);
      expect(metrics.maxColsByType.dialogue).toBeGreaterThan(0);
      expect(metrics.maxColsByType.character).toBeGreaterThan(0);

      // Wider elements should have more columns
      expect(metrics.maxColsByType.action).toBeGreaterThan(metrics.maxColsByType.dialogue);
    });

    it('should respect element width ratios', () => {
      const metrics = calibrateTextMetrics();

      // Action is 6.0 inches, dialogue is 3.5 inches
      // So action should have ~1.71x more columns than dialogue
      const ratio = metrics.maxColsByType.action / metrics.maxColsByType.dialogue;
      expect(ratio).toBeCloseTo(6.0 / 3.5, 1);
    });

    it('should handle missing canvas context gracefully', () => {
      global.document.createElement = jest.fn().mockImplementation((tagName) => {
        if (tagName === 'canvas') {
          return {
            getContext: () => null, // No context available
          };
        }
        return {};
      });

      const metrics = calibrateTextMetrics();

      // Should return default metrics
      expect(metrics.charsPerInch).toBe(10);
      expect(metrics.dpi).toBe(96);
      expect(metrics.maxColsByType.action).toBe(60);
      expect(metrics.maxColsByType.dialogue).toBe(35);
    });

    it('should handle non-browser environment', () => {
      const originalDocument = global.document;
      // @ts-ignore - Temporarily remove document
      delete global.document;

      const metrics = calibrateTextMetrics();

      // Should return default metrics
      expect(metrics.charsPerInch).toBe(10);
      expect(metrics.dpi).toBe(96);

      // Restore document
      global.document = originalDocument;
    });
  });

  describe('calculateElementLines', () => {
    let metrics: TextMetrics;

    beforeEach(() => {
      // Use predictable metrics for testing
      metrics = {
        charsPerInch: 10,
        maxColsByType: {
          scene_heading: 60,
          action: 60,
          character: 35,
          dialogue: 35,
          parenthetical: 27,  // Final Draft standard including parens
          transition: 60,
          shot: 60,
          general: 60,
        },
        dpi: 96,
      };
    });

    it('should calculate lines correctly for short text', () => {
      const lines = calculateElementLines('Short text', 'action', metrics);
      expect(lines).toBe(2); // 1 base line + 1 text line
    });

    it('should calculate lines correctly for long text', () => {
      // 130 characters should wrap to 3 lines at 60 chars/line
      const longText = 'A'.repeat(130);
      const lines = calculateElementLines(longText, 'action', metrics);
      expect(lines).toBe(4); // 1 base line + 3 text lines
    });

    it('should handle empty text', () => {
      const lines = calculateElementLines('', 'action', metrics);
      expect(lines).toBe(1); // Just base lines, no text lines
    });

    it('should respect element-specific base heights', () => {
      const text = 'Same text';

      const actionLines = calculateElementLines(text, 'action', metrics);
      const sceneLines = calculateElementLines(text, 'scene_heading', metrics);
      const characterLines = calculateElementLines(text, 'character', metrics);

      // Scene headings and characters have 2 base lines, action has 1
      expect(sceneLines).toBeGreaterThan(actionLines);
      expect(characterLines).toBeGreaterThan(actionLines);
      expect(sceneLines).toBe(characterLines); // Both have 2 base lines
    });

    it('should respect element-specific column widths', () => {
      // 40 characters: fits in 1 line for action (60 cols), 2 lines for dialogue (35 cols)
      const text = 'A'.repeat(40);

      const actionLines = calculateElementLines(text, 'action', metrics);
      const dialogueLines = calculateElementLines(text, 'dialogue', metrics);

      expect(actionLines).toBe(2); // 1 base + 1 text line
      expect(dialogueLines).toBe(3); // 1 base + 2 text lines
    });

    it('should handle unknown element types', () => {
      const lines = calculateElementLines('Some text', 'unknown_type', metrics);

      // Should use default: 60 cols, 1 base line
      expect(lines).toBe(2); // 1 base (default) + 1 text line
    });

    it('should handle text at exact column boundary', () => {
      // Exactly 60 characters should be 1 line for action
      const text = 'A'.repeat(60);
      const lines = calculateElementLines(text, 'action', metrics);
      expect(lines).toBe(2); // 1 base + 1 text line

      // 61 characters should wrap to 2 lines
      const text2 = 'A'.repeat(61);
      const lines2 = calculateElementLines(text2, 'action', metrics);
      expect(lines2).toBe(3); // 1 base + 2 text lines
    });

    it('should handle very long text', () => {
      // 600 characters = 10 lines at 60 chars/line
      const veryLongText = 'A'.repeat(600);
      const lines = calculateElementLines(veryLongText, 'action', metrics);
      expect(lines).toBe(11); // 1 base + 10 text lines
    });

    it('should handle single character', () => {
      const lines = calculateElementLines('A', 'action', metrics);
      expect(lines).toBe(2); // 1 base + 1 text line (ceil of 1/60 = 1)
    });

    it('should handle whitespace-only text', () => {
      const lines = calculateElementLines('     ', 'action', metrics);
      expect(lines).toBe(2); // 1 base + 1 text line (5 spaces still count)
    });
  });

  describe('hashString', () => {
    it('should generate consistent hashes for same input', () => {
      const text = 'Test screenplay text';
      const hash1 = hashString(text);
      const hash2 = hashString(text);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different inputs', () => {
      const text1 = 'First text';
      const text2 = 'Second text';

      const hash1 = hashString(text1);
      const hash2 = hashString(text2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = hashString('');
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle special characters', () => {
      const text = 'INT. CAFÉ - DAY\n\nSpecial chars: @#$%^&*()';
      const hash = hashString(text);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should handle very long strings', () => {
      const longText = 'A'.repeat(10000);
      const hash = hashString(longText);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should be case-sensitive', () => {
      const text1 = 'hello';
      const text2 = 'HELLO';

      const hash1 = hashString(text1);
      const hash2 = hashString(text2);

      expect(hash1).not.toBe(hash2);
    });

    it('should detect small differences', () => {
      const text1 = 'The quick brown fox';
      const text2 = 'The quick brown fox.'; // Added period

      const hash1 = hashString(text1);
      const hash2 = hashString(text2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('ELEMENT_WIDTHS constant', () => {
    it('should define widths for all screenplay element types', () => {
      expect(ELEMENT_WIDTHS.scene_heading).toBe(6.0);
      expect(ELEMENT_WIDTHS.action).toBe(6.0);
      expect(ELEMENT_WIDTHS.character).toBe(3.5);
      expect(ELEMENT_WIDTHS.dialogue).toBe(3.5);
      expect(ELEMENT_WIDTHS.parenthetical).toBe(2.7);
      expect(ELEMENT_WIDTHS.transition).toBe(6.0);
      expect(ELEMENT_WIDTHS.shot).toBe(6.0);
      expect(ELEMENT_WIDTHS.general).toBe(6.0);
    });

    it('should use industry-standard widths', () => {
      // Full-width elements (page width - margins = 6.0")
      expect(ELEMENT_WIDTHS.scene_heading).toBe(6.0);
      expect(ELEMENT_WIDTHS.action).toBe(6.0);
      expect(ELEMENT_WIDTHS.transition).toBe(6.0);

      // Narrow elements (dialogue and character)
      expect(ELEMENT_WIDTHS.character).toBe(3.5);
      expect(ELEMENT_WIDTHS.dialogue).toBe(3.5);

      // Very narrow (parenthetical)
      expect(ELEMENT_WIDTHS.parenthetical).toBe(2.7);
    });
  });

  describe('BASE_LINE_HEIGHTS constant', () => {
    it('should define base heights for all element types', () => {
      expect(BASE_LINE_HEIGHTS.scene_heading).toBe(2);
      expect(BASE_LINE_HEIGHTS.action).toBe(1);
      expect(BASE_LINE_HEIGHTS.character).toBe(2);
      expect(BASE_LINE_HEIGHTS.dialogue).toBe(1);
      expect(BASE_LINE_HEIGHTS.parenthetical).toBe(1);
      expect(BASE_LINE_HEIGHTS.transition).toBe(2);
      expect(BASE_LINE_HEIGHTS.shot).toBe(1);
      expect(BASE_LINE_HEIGHTS.general).toBe(1);
    });

    it('should give extra spacing to headers and transitions', () => {
      // Elements that need extra vertical spacing
      expect(BASE_LINE_HEIGHTS.scene_heading).toBe(2);
      expect(BASE_LINE_HEIGHTS.character).toBe(2);
      expect(BASE_LINE_HEIGHTS.transition).toBe(2);

      // Regular elements have single spacing
      expect(BASE_LINE_HEIGHTS.action).toBe(1);
      expect(BASE_LINE_HEIGHTS.dialogue).toBe(1);
      expect(BASE_LINE_HEIGHTS.parenthetical).toBe(1);
    });
  });

  describe('Integration: Realistic screenplay scenarios', () => {
    let metrics: TextMetrics;

    beforeEach(() => {
      metrics = {
        charsPerInch: 10,
        maxColsByType: {
          scene_heading: 60,
          action: 60,
          character: 35,
          dialogue: 35,
          parenthetical: 27,  // Final Draft standard including parens
          transition: 60,
        },
        dpi: 96,
      };
    });

    it('should handle typical scene heading', () => {
      const sceneHeading = 'INT. COFFEE SHOP - DAY';
      const lines = calculateElementLines(sceneHeading, 'scene_heading', metrics);

      // Scene headings are typically short, so: 2 base + 1 text = 3 lines
      expect(lines).toBe(3);
    });

    it('should handle typical action paragraph', () => {
      const action = 'John enters the room and looks around nervously. He spots Mary sitting at a table by the window.';
      const lines = calculateElementLines(action, 'action', metrics);

      // 96 chars = 2 text lines at 60 cols, plus 1 base = 3 lines
      expect(lines).toBe(3);
    });

    it('should handle typical dialogue exchange', () => {
      const character = 'JOHN';
      const dialogue = 'I need to tell you something important.';

      const charLines = calculateElementLines(character, 'character', metrics);
      const dialogLines = calculateElementLines(dialogue, 'dialogue', metrics);

      // Character: 2 base + 1 text = 3
      expect(charLines).toBe(3);

      // Dialogue (40 chars at 35 cols/line): 1 base + 2 text = 3
      expect(dialogLines).toBe(3);

      // Total for exchange: 6 lines
      expect(charLines + dialogLines).toBe(6);
    });

    it('should handle parenthetical', () => {
      const parenthetical = '(nervous)';
      const lines = calculateElementLines(parenthetical, 'parenthetical', metrics);

      // Parentheticals are short: 1 base + 1 text = 2 lines
      expect(lines).toBe(2);
    });

    it('should calculate page capacity accurately', () => {
      // Industry standard: 55 lines per page
      // If we have 55 lines of single-spaced action:
      // Each action line = 1 base + 1 text (for 60 chars) = 2 lines
      // So 27-28 action elements would fill a page

      const totalLines = Array.from({ length: 27 }, () =>
        calculateElementLines('A'.repeat(60), 'action', metrics)
      ).reduce((sum, lines) => sum + lines, 0);

      // Should be close to 55 lines (27 * 2 = 54)
      expect(totalLines).toBeLessThanOrEqual(55);
      expect(totalLines).toBeGreaterThanOrEqual(50);
    });
  });
});
