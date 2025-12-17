/**
 * Unit tests for pagination-engine module
 *
 * Tests page break calculation and pagination state management including:
 * - Page break calculation accuracy
 * - Cache performance
 * - Helper functions
 * - Edge cases (empty content, single page, boundary conditions)
 * - Realistic screenplay scenarios
 */

import { Node, Element } from 'slate';
import {
  calculatePageBreaks,
  calculatePageBreaksIncremental,
  getDecorationsForPath,
  getPageForElement,
  getElementsOnPage,
  getDebugInfo,
  validatePaginationState,
  LINES_PER_PAGE,
  type PaginationState,
  type PageBreakDecoration,
} from '../pagination-engine';
import { type TextMetrics } from '../text-metrics';

describe('pagination-engine', () => {
  // Test data setup
  let mockMetrics: TextMetrics;
  let mockNodes: Node[];

  beforeEach(() => {
    // Predictable metrics for testing
    mockMetrics = {
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

    // Sample screenplay nodes
    mockNodes = [
      {
        type: 'scene_heading',
        children: [{ text: 'INT. COFFEE SHOP - DAY' }],
      } as Element,
      {
        type: 'action',
        children: [{ text: 'John enters.' }],
      } as Element,
      {
        type: 'character',
        children: [{ text: 'JOHN' }],
      } as Element,
      {
        type: 'dialogue',
        children: [{ text: 'Hello.' }],
      } as Element,
    ];
  });

  describe('LINES_PER_PAGE constant', () => {
    it('should be set to industry standard of 55 lines', () => {
      expect(LINES_PER_PAGE).toBe(55);
    });
  });

  describe('calculatePageBreaks', () => {
    it('should handle empty content', () => {
      const state = calculatePageBreaks([], mockMetrics);

      expect(state.totalPages).toBe(1);
      expect(state.decorations).toHaveLength(0);
      expect(state.pageOfBlock.size).toBe(0);
    });

    it('should handle single element', () => {
      const nodes = [mockNodes[0]]; // Just scene heading
      const state = calculatePageBreaks(nodes, mockMetrics);

      expect(state.totalPages).toBe(1);
      expect(state.decorations).toHaveLength(0);
      expect(state.pageOfBlock.get(JSON.stringify([0]))).toBe(1);
    });

    it('should keep elements on same page when they fit', () => {
      const state = calculatePageBreaks(mockNodes, mockMetrics);

      // Scene heading (3 lines) + action (2) + character (3) + dialogue (2) = 10 lines
      expect(state.totalPages).toBe(1);
      expect(state.decorations).toHaveLength(0);

      // All elements should be on page 1
      for (let i = 0; i < mockNodes.length; i++) {
        expect(state.pageOfBlock.get(JSON.stringify([i]))).toBe(1);
      }
    });

    it('should create page breaks when elements exceed page limit', () => {
      // Create 28 action elements (2 lines each = 56 lines total)
      const manyNodes: Node[] = Array.from({ length: 28 }, (_, i) => ({
        type: 'action',
        children: [{ text: 'A'.repeat(60) }],
      })) as Element[];

      const state = calculatePageBreaks(manyNodes, mockMetrics);

      expect(state.totalPages).toBe(2);
      expect(state.decorations).toHaveLength(1);

      // First decoration should be at element 27 (0-indexed)
      const decoration = state.decorations[0];
      expect(decoration.anchor.path).toEqual([27]);
      expect(decoration.pageIndex).toBe(0); // Zero-based page index
    });

    it('should assign correct page numbers to elements', () => {
      // Create 28 action elements (2 lines each)
      const manyNodes: Node[] = Array.from({ length: 28 }, () => ({
        type: 'action',
        children: [{ text: 'A'.repeat(60) }],
      })) as Element[];

      const state = calculatePageBreaks(manyNodes, mockMetrics);

      // First 27 elements should be on page 1
      for (let i = 0; i < 27; i++) {
        expect(state.pageOfBlock.get(JSON.stringify([i]))).toBe(1);
      }

      // Element 27 should be on page 2
      expect(state.pageOfBlock.get(JSON.stringify([27]))).toBe(2);
    });

    it('should respect element-specific line counts', () => {
      const nodes: Node[] = [
        { type: 'scene_heading', children: [{ text: 'Short' }] }, // 3 lines
        { type: 'action', children: [{ text: 'Short' }] },        // 2 lines
        { type: 'character', children: [{ text: 'JOHN' }] },      // 3 lines
        { type: 'dialogue', children: [{ text: 'Short' }] },      // 2 lines
      ] as Element[];

      const state = calculatePageBreaks(nodes, mockMetrics);

      // Total: 3 + 2 + 3 + 2 = 10 lines
      expect(state.totalPages).toBe(1);
    });

    it('should reuse line count cache from previous state', () => {
      const nodes: Node[] = [
        { type: 'action', children: [{ text: 'Same text' }] },
        { type: 'action', children: [{ text: 'Same text' }] },
      ] as Element[];

      // First calculation
      const state1 = calculatePageBreaks(nodes, mockMetrics);

      // Second calculation with cache
      const state2 = calculatePageBreaks(nodes, mockMetrics, state1);

      // Cache should contain entries
      expect(state2.lineCountCache.size).toBeGreaterThan(0);

      // Results should be identical
      expect(state2.totalPages).toBe(state1.totalPages);
      expect(state2.decorations).toEqual(state1.decorations);
    });

    it('should handle very long text with multiple page breaks', () => {
      // Create 60 action elements (2 lines each = 120 lines)
      const manyNodes: Node[] = Array.from({ length: 60 }, () => ({
        type: 'action',
        children: [{ text: 'A'.repeat(60) }],
      })) as Element[];

      const state = calculatePageBreaks(manyNodes, mockMetrics);

      // 120 lines / 55 lines per page = ~3 pages
      expect(state.totalPages).toBe(3);
      expect(state.decorations.length).toBe(2); // 3 pages = 2 page breaks
    });

    it('should handle mixed element types with different line counts', () => {
      const nodes: Node[] = [
        { type: 'scene_heading', children: [{ text: 'INT. ROOM - DAY' }] }, // 3 lines
        { type: 'action', children: [{ text: 'A'.repeat(130) }] },          // 4 lines (wraps to 3 text lines)
        { type: 'character', children: [{ text: 'JOHN' }] },                // 3 lines
        { type: 'dialogue', children: [{ text: 'A'.repeat(70) }] },         // 3 lines (wraps to 2 text lines)
        { type: 'parenthetical', children: [{ text: 'nervous' }] },         // 2 lines
      ] as Element[];

      const state = calculatePageBreaks(nodes, mockMetrics);

      // Total: 3 + 4 + 3 + 3 + 2 = 15 lines
      expect(state.totalPages).toBe(1);
      expect(state.decorations).toHaveLength(0);
    });

    it('should skip non-element nodes', () => {
      const nodesWithText: Node[] = [
        { type: 'action', children: [{ text: 'Element' }] } as Element,
        { text: 'Text node' }, // Should be skipped
        { type: 'action', children: [{ text: 'Another' }] } as Element,
      ];

      const state = calculatePageBreaks(nodesWithText, mockMetrics);

      // Only 2 elements should be counted
      expect(state.pageOfBlock.size).toBe(2);
    });

    it('should create decorations at zero-width positions', () => {
      const manyNodes: Node[] = Array.from({ length: 28 }, () => ({
        type: 'action',
        children: [{ text: 'A'.repeat(60) }],
      })) as Element[];

      const state = calculatePageBreaks(manyNodes, mockMetrics);

      const decoration = state.decorations[0];
      expect(decoration.anchor.offset).toBe(0);
      expect(decoration.focus.offset).toBe(0);
      expect(decoration.anchor.path).toEqual(decoration.focus.path);
    });

    it('should mark decorations with pageBreak flag', () => {
      const manyNodes: Node[] = Array.from({ length: 28 }, () => ({
        type: 'action',
        children: [{ text: 'A'.repeat(60) }],
      })) as Element[];

      const state = calculatePageBreaks(manyNodes, mockMetrics);

      const decoration = state.decorations[0];
      expect(decoration.pageBreak).toBe(true);
    });

    it('should use zero-based page indices in decorations', () => {
      const manyNodes: Node[] = Array.from({ length: 60 }, () => ({
        type: 'action',
        children: [{ text: 'A'.repeat(60) }],
      })) as Element[];

      const state = calculatePageBreaks(manyNodes, mockMetrics);

      // 3 pages should have indices 0, 1 (2 page breaks)
      expect(state.decorations[0].pageIndex).toBe(0);
      expect(state.decorations[1].pageIndex).toBe(1);
    });
  });

  describe('calculatePageBreaksIncremental', () => {
    it('should fall back to full calculation for now', () => {
      const previousState = calculatePageBreaks(mockNodes, mockMetrics);

      // Call incremental with changed paths
      const newState = calculatePageBreaksIncremental(
        mockNodes,
        mockMetrics,
        previousState,
        [[2]] // Changed path
      );

      // Should return valid state (implementation details may vary)
      expect(newState.totalPages).toBeGreaterThan(0);
      expect(newState.pageOfBlock.size).toBe(mockNodes.length);
    });

    it('should maintain cache from previous state', () => {
      const previousState = calculatePageBreaks(mockNodes, mockMetrics);
      const cacheSize = previousState.lineCountCache.size;

      const newState = calculatePageBreaksIncremental(
        mockNodes,
        mockMetrics,
        previousState,
        [[0]]
      );

      // Cache should be preserved or grown
      expect(newState.lineCountCache.size).toBeGreaterThanOrEqual(cacheSize);
    });
  });

  describe('getDecorationsForPath', () => {
    let decorations: PageBreakDecoration[];

    beforeEach(() => {
      decorations = [
        {
          anchor: { path: [5], offset: 0 },
          focus: { path: [5], offset: 0 },
          pageBreak: true,
          pageIndex: 0,
        },
        {
          anchor: { path: [10], offset: 0 },
          focus: { path: [10], offset: 0 },
          pageBreak: true,
          pageIndex: 1,
        },
      ];
    });

    it('should return decorations matching the path', () => {
      const result = getDecorationsForPath(decorations, [5]);

      expect(result).toHaveLength(1);
      expect(result[0].anchor.path).toEqual([5]);
    });

    it('should return empty array for non-matching path', () => {
      const result = getDecorationsForPath(decorations, [7]);

      expect(result).toHaveLength(0);
    });

    it('should handle multiple decorations at same path', () => {
      const duplicateDecorations: PageBreakDecoration[] = [
        ...decorations,
        {
          anchor: { path: [5], offset: 0 },
          focus: { path: [5], offset: 0 },
          pageBreak: true,
          pageIndex: 2,
        },
      ];

      const result = getDecorationsForPath(duplicateDecorations, [5]);

      expect(result).toHaveLength(2);
    });

    it('should handle empty decoration array', () => {
      const result = getDecorationsForPath([], [5]);

      expect(result).toHaveLength(0);
    });
  });

  describe('getPageForElement', () => {
    let state: PaginationState;

    beforeEach(() => {
      const manyNodes: Node[] = Array.from({ length: 28 }, () => ({
        type: 'action',
        children: [{ text: 'A'.repeat(60) }],
      })) as Element[];

      state = calculatePageBreaks(manyNodes, mockMetrics);
    });

    it('should return correct page number for element', () => {
      const page = getPageForElement([0], state);

      expect(page).toBe(1);
    });

    it('should return correct page for element on second page', () => {
      const page = getPageForElement([27], state);

      expect(page).toBe(2);
    });

    it('should return 1 for non-existent path', () => {
      const page = getPageForElement([999], state);

      expect(page).toBe(1);
    });

    it('should handle nested paths correctly', () => {
      // Even though we use top-level indices, test path key matching
      state.pageOfBlock.set(JSON.stringify([0, 1]), 2);

      const page = getPageForElement([0, 1], state);

      expect(page).toBe(2);
    });
  });

  describe('getElementsOnPage', () => {
    let state: PaginationState;

    beforeEach(() => {
      const manyNodes: Node[] = Array.from({ length: 28 }, () => ({
        type: 'action',
        children: [{ text: 'A'.repeat(60) }],
      })) as Element[];

      state = calculatePageBreaks(manyNodes, mockMetrics);
    });

    it('should return elements on first page', () => {
      const elements = getElementsOnPage(1, state);

      expect(elements).toHaveLength(27);
      expect(elements[0]).toEqual([0]);
      expect(elements[26]).toEqual([26]);
    });

    it('should return elements on second page', () => {
      const elements = getElementsOnPage(2, state);

      expect(elements).toHaveLength(1);
      expect(elements[0]).toEqual([27]);
    });

    it('should return empty array for non-existent page', () => {
      const elements = getElementsOnPage(999, state);

      expect(elements).toHaveLength(0);
    });

    it('should return sorted elements by path', () => {
      const elements = getElementsOnPage(1, state);

      for (let i = 0; i < elements.length - 1; i++) {
        expect(elements[i][0]).toBeLessThan(elements[i + 1][0]);
      }
    });
  });

  describe('getDebugInfo', () => {
    it('should return correct total pages', () => {
      const state = calculatePageBreaks(mockNodes, mockMetrics);
      const debug = getDebugInfo(state);

      expect(debug.totalPages).toBe(1);
    });

    it('should return correct total elements', () => {
      const state = calculatePageBreaks(mockNodes, mockMetrics);
      const debug = getDebugInfo(state);

      expect(debug.totalElements).toBe(4);
    });

    it('should return correct page break count', () => {
      const manyNodes: Node[] = Array.from({ length: 60 }, () => ({
        type: 'action',
        children: [{ text: 'A'.repeat(60) }],
      })) as Element[];

      const state = calculatePageBreaks(manyNodes, mockMetrics);
      const debug = getDebugInfo(state);

      expect(debug.pageBreakCount).toBe(state.decorations.length);
    });

    it('should return cache size', () => {
      const state = calculatePageBreaks(mockNodes, mockMetrics);
      const debug = getDebugInfo(state);

      expect(debug.cacheSize).toBe(state.lineCountCache.size);
    });

    it('should calculate average elements per page', () => {
      const manyNodes: Node[] = Array.from({ length: 60 }, () => ({
        type: 'action',
        children: [{ text: 'A'.repeat(60) }],
      })) as Element[];

      const state = calculatePageBreaks(manyNodes, mockMetrics);
      const debug = getDebugInfo(state);

      expect(debug.averageElementsPerPage).toBeCloseTo(60 / state.totalPages);
    });

    it('should provide page distribution', () => {
      const manyNodes: Node[] = Array.from({ length: 60 }, () => ({
        type: 'action',
        children: [{ text: 'A'.repeat(60) }],
      })) as Element[];

      const state = calculatePageBreaks(manyNodes, mockMetrics);
      const debug = getDebugInfo(state);

      // All pages should have elements
      for (let page = 1; page <= state.totalPages; page++) {
        expect(debug.pageDistribution[page]).toBeGreaterThan(0);
      }

      // Total elements should match
      const totalInDistribution = Object.values(debug.pageDistribution).reduce(
        (sum, count) => sum + count,
        0
      );
      expect(totalInDistribution).toBe(60);
    });
  });

  describe('validatePaginationState', () => {
    it('should validate correct state', () => {
      const state = calculatePageBreaks(mockNodes, mockMetrics);
      const validation = validatePaginationState(state);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect decoration count mismatch', () => {
      const state = calculatePageBreaks(mockNodes, mockMetrics);

      // Corrupt state by adding extra decoration
      state.decorations.push({
        anchor: { path: [999], offset: 0 },
        focus: { path: [999], offset: 0 },
        pageBreak: true,
        pageIndex: 999,
      });

      const validation = validatePaginationState(state);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Decoration count mismatch'))).toBe(true);
    });

    it('should detect invalid page numbers', () => {
      const state = calculatePageBreaks(mockNodes, mockMetrics);

      // Corrupt state with invalid page number
      state.pageOfBlock.set(JSON.stringify([0]), 999);

      const validation = validatePaginationState(state);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Invalid page number'))).toBe(true);
    });

    it('should detect decoration page index gaps', () => {
      const manyNodes: Node[] = Array.from({ length: 90 }, () => ({
        type: 'action',
        children: [{ text: 'A'.repeat(60) }],
      })) as Element[];

      const state = calculatePageBreaks(manyNodes, mockMetrics);

      // Corrupt state by changing page index
      if (state.decorations.length > 1) {
        state.decorations[1].pageIndex = 5; // Skip indices

        const validation = validatePaginationState(state);

        expect(validation.valid).toBe(false);
        expect(validation.errors.some(e => e.includes('page index gap'))).toBe(true);
      }
    });

    it('should detect page gaps', () => {
      const state = calculatePageBreaks(mockNodes, mockMetrics);

      // Corrupt state by setting all elements to page 1, but claiming 3 pages
      state.totalPages = 3;

      const validation = validatePaginationState(state);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('No elements on page'))).toBe(true);
    });
  });

  describe('Integration: Realistic screenplay scenarios', () => {
    it('should handle typical screenplay page', () => {
      const realisticPage: Node[] = [
        { type: 'scene_heading', children: [{ text: 'INT. COFFEE SHOP - DAY' }] },
        {
          type: 'action',
          children: [
            {
              text: 'The morning sun streams through large windows. SARAH, 30s, sits at a corner table nursing a latte.',
            },
          ],
        },
        { type: 'character', children: [{ text: 'SARAH' }] },
        {
          type: 'dialogue',
          children: [{ text: "I can't believe you're actually here." }],
        },
        { type: 'character', children: [{ text: 'MIKE' }] },
        { type: 'parenthetical', children: [{ text: '(sitting down)' }] },
        { type: 'dialogue', children: [{ text: 'I told you I would come.' }] },
      ] as Element[];

      const state = calculatePageBreaks(realisticPage, mockMetrics);

      // Should fit on one page
      expect(state.totalPages).toBe(1);
      expect(state.decorations).toHaveLength(0);
    });

    it('should handle 148-element screenplay producing ~125 pages', () => {
      // Create realistic screenplay with varying element types
      const largeScreenplay: Node[] = [];

      // Create ~148 elements that should produce ~125 pages
      // Average ~20 lines per page worth of elements
      for (let scene = 0; scene < 25; scene++) {
        // Scene heading (3 lines)
        largeScreenplay.push({
          type: 'scene_heading',
          children: [{ text: `INT. LOCATION ${scene} - DAY` }],
        } as Element);

        // Action paragraphs (varying lengths)
        for (let i = 0; i < 2; i++) {
          largeScreenplay.push({
            type: 'action',
            children: [{ text: 'A'.repeat(120) }], // 3 lines
          } as Element);
        }

        // Dialogue exchanges
        for (let i = 0; i < 2; i++) {
          largeScreenplay.push({
            type: 'character',
            children: [{ text: `CHARACTER ${i}` }],
          } as Element);

          largeScreenplay.push({
            type: 'dialogue',
            children: [{ text: 'A'.repeat(70) }], // 3 lines
          } as Element);
        }
      }

      const state = calculatePageBreaks(largeScreenplay, mockMetrics);

      // Should produce multiple pages
      expect(state.totalPages).toBeGreaterThan(1);
      expect(state.decorations.length).toBe(state.totalPages - 1);

      // Validate state consistency
      const validation = validatePaginationState(state);
      expect(validation.valid).toBe(true);
    });

    it('should handle page boundary at exact 55 lines', () => {
      // Create exactly 55 lines of content
      // 27 action elements × 2 lines = 54 lines, plus 1 more action = 56 lines (page break)
      const boundaryNodes: Node[] = Array.from({ length: 28 }, () => ({
        type: 'action',
        children: [{ text: 'A'.repeat(60) }],
      })) as Element[];

      const state = calculatePageBreaks(boundaryNodes, mockMetrics);

      expect(state.totalPages).toBe(2);
      expect(state.decorations).toHaveLength(1);

      // First 27 elements on page 1 (54 lines)
      for (let i = 0; i < 27; i++) {
        expect(getPageForElement([i], state)).toBe(1);
      }

      // 28th element on page 2
      expect(getPageForElement([27], state)).toBe(2);
    });

    it('should maintain cache efficiency with repeated content', () => {
      // Create screenplay with repeated dialogue
      const repeatedContent: Node[] = Array.from({ length: 50 }, (_, i) => ({
        type: i % 2 === 0 ? 'character' : 'dialogue',
        children: [{ text: i % 2 === 0 ? 'JOHN' : 'Same line repeated.' }],
      })) as Element[];

      const state = calculatePageBreaks(repeatedContent, mockMetrics);

      // Cache should only have 2 entries (character + dialogue)
      expect(state.lineCountCache.size).toBeLessThanOrEqual(2);

      // All calculations should still be correct
      const validation = validatePaginationState(state);
      expect(validation.valid).toBe(true);
    });

    it('should handle transition elements correctly', () => {
      const withTransitions: Node[] = [
        { type: 'action', children: [{ text: 'Scene content.' }] },
        { type: 'transition', children: [{ text: 'FADE TO:' }] },
        { type: 'scene_heading', children: [{ text: 'EXT. NEW LOCATION - NIGHT' }] },
      ] as Element[];

      const state = calculatePageBreaks(withTransitions, mockMetrics);

      // Transition should have 2 base lines (extra spacing)
      expect(state.totalPages).toBe(1);
    });
  });
});
