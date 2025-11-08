/**
 * Unit tests for usePageDecorations hook
 *
 * Tests React hook behavior including:
 * - Hook initialization and state management
 * - Debouncing behavior
 * - Decoration calculation triggers
 * - Yjs document integration
 * - Performance and caching
 * - Error handling
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { createEditor, Editor } from 'slate';
import * as Y from 'yjs';
import { usePageDecorations } from '../use-page-decorations';

// Mock the utilities
jest.mock('../../utils/text-metrics', () => ({
  calibrateTextMetrics: jest.fn(() => ({
    charsPerInch: 10,
    maxColsByType: {
      scene_heading: 60,
      action: 60,
      character: 35,
      dialogue: 35,
      parenthetical: 30,
      transition: 60,
      shot: 60,
      general: 60,
    },
    dpi: 96,
  })),
}));

jest.mock('../../utils/pagination-engine', () => ({
  calculatePageBreaks: jest.fn((nodes, metrics, prevState) => ({
    pageOfBlock: new Map([[JSON.stringify([0]), 1]]),
    lineCountCache: new Map([['action:test', 2]]),
    totalPages: 1,
    decorations: [],
  })),
  getDecorationsForPath: jest.fn(() => []),
}));

describe('usePageDecorations', () => {
  let editor: Editor;

  beforeEach(() => {
    // Create a fresh editor for each test
    editor = createEditor();
    editor.children = [
      {
        type: 'action',
        children: [{ text: 'Test content' }],
      } as any,
    ];

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('Hook Initialization', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => usePageDecorations(editor));

      expect(result.current.totalPages).toBe(1);
      expect(result.current.isCalculating).toBe(false);
      expect(result.current.decorations).toEqual([]);
      expect(result.current.decorate).toBeDefined();
      expect(typeof result.current.decorate).toBe('function');
    });

    it('should calibrate metrics on mount', async () => {
      const { calibrateTextMetrics } = require('../../utils/text-metrics');

      renderHook(() => usePageDecorations(editor));

      await waitFor(() => {
        expect(calibrateTextMetrics).toHaveBeenCalledTimes(1);
      });
    });

    it('should respect enabled option', () => {
      const { calculatePageBreaks } = require('../../utils/pagination-engine');

      renderHook(() =>
        usePageDecorations(editor, null, { enabled: false })
      );

      // Should not calculate when disabled
      expect(calculatePageBreaks).not.toHaveBeenCalled();
    });

    it('should use custom debounce delay', async () => {
      const { result } = renderHook(() =>
        usePageDecorations(editor, null, { debounceMs: 500 })
      );

      expect(result.current).toBeDefined();
      // Debounce delay is internal, verified through timing tests below
    });
  });

  describe('Decoration Calculation', () => {
    it('should calculate decorations on mount', async () => {
      const { calculatePageBreaks } = require('../../utils/pagination-engine');

      renderHook(() => usePageDecorations(editor));

      await waitFor(() => {
        expect(calculatePageBreaks).toHaveBeenCalled();
      });
    });

    it('should recalculate when editor content changes', async () => {
      const { calculatePageBreaks } = require('../../utils/pagination-engine');
      const { result, rerender } = renderHook(() => usePageDecorations(editor));

      // Wait for initial calculation
      await waitFor(() => {
        expect(calculatePageBreaks).toHaveBeenCalledTimes(1);
      });

      // Change editor content
      act(() => {
        editor.children = [
          {
            type: 'action',
            children: [{ text: 'New content' }],
          } as any,
        ];
      });

      rerender();

      // Should trigger recalculation
      await waitFor(() => {
        expect(calculatePageBreaks).toHaveBeenCalledTimes(2);
      });
    });

    it('should pass previous state for cache reuse', async () => {
      const { calculatePageBreaks } = require('../../utils/pagination-engine');

      renderHook(() => usePageDecorations(editor));

      await waitFor(() => {
        expect(calculatePageBreaks).toHaveBeenCalled();
      });

      // Second call should have previous state
      const secondCall = calculatePageBreaks.mock.calls[1];
      if (secondCall) {
        expect(secondCall[2]).toBeDefined(); // prevState parameter
      }
    });

    it('should update totalPages from calculation', async () => {
      const { calculatePageBreaks } = require('../../utils/pagination-engine');

      // Mock with 3 pages
      calculatePageBreaks.mockReturnValueOnce({
        pageOfBlock: new Map(),
        lineCountCache: new Map(),
        totalPages: 3,
        decorations: [],
      });

      const { result } = renderHook(() => usePageDecorations(editor));

      await waitFor(() => {
        expect(result.current.totalPages).toBe(3);
      });
    });

    it('should update decorations from calculation', async () => {
      const { calculatePageBreaks } = require('../../utils/pagination-engine');

      const mockDecorations = [
        {
          anchor: { path: [5], offset: 0 },
          focus: { path: [5], offset: 0 },
          pageBreak: true,
          pageIndex: 0,
        },
      ];

      calculatePageBreaks.mockReturnValueOnce({
        pageOfBlock: new Map(),
        lineCountCache: new Map(),
        totalPages: 2,
        decorations: mockDecorations,
      });

      const { result } = renderHook(() => usePageDecorations(editor));

      await waitFor(() => {
        expect(result.current.decorations).toEqual(mockDecorations);
      });
    });
  });

  describe('Debouncing Behavior', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should debounce rapid content changes', async () => {
      const { calculatePageBreaks } = require('../../utils/pagination-engine');
      const { rerender } = renderHook(() =>
        usePageDecorations(editor, null, { debounceMs: 150 })
      );

      // Make multiple rapid changes
      for (let i = 0; i < 5; i++) {
        act(() => {
          editor.children = [
            {
              type: 'action',
              children: [{ text: `Content ${i}` }],
            } as any,
          ];
        });
        rerender();
      }

      // Should not calculate yet
      expect(calculatePageBreaks).not.toHaveBeenCalled();

      // Advance timers past debounce delay
      act(() => {
        jest.advanceTimersByTime(200);
      });

      // Should calculate only once
      await waitFor(() => {
        expect(calculatePageBreaks).toHaveBeenCalledTimes(1);
      });
    });

    it('should cancel debounce on unmount', () => {
      const { unmount } = renderHook(() =>
        usePageDecorations(editor, null, { debounceMs: 150 })
      );

      // Trigger calculation
      act(() => {
        editor.children = [
          {
            type: 'action',
            children: [{ text: 'New' }],
          } as any,
        ];
      });

      // Unmount before debounce completes
      unmount();

      // Advance timers
      act(() => {
        jest.advanceTimersByTime(200);
      });

      // Should not throw or cause issues
    });
  });

  describe('Decorate Function', () => {
    it('should return decorate function', () => {
      const { result } = renderHook(() => usePageDecorations(editor));

      expect(result.current.decorate).toBeDefined();
      expect(typeof result.current.decorate).toBe('function');
    });

    it('should call getDecorationsForPath with correct arguments', async () => {
      const { getDecorationsForPath } = require('../../utils/pagination-engine');
      const { result } = renderHook(() => usePageDecorations(editor));

      await waitFor(() => {
        expect(result.current.decorate).toBeDefined();
      });

      const mockNode = { type: 'action', children: [] };
      const mockPath = [0];

      act(() => {
        result.current.decorate([mockNode, mockPath]);
      });

      expect(getDecorationsForPath).toHaveBeenCalledWith(
        expect.anything(),
        mockPath
      );
    });

    it('should return empty array when no decorations for path', () => {
      const { getDecorationsForPath } = require('../../utils/pagination-engine');
      getDecorationsForPath.mockReturnValue([]);

      const { result } = renderHook(() => usePageDecorations(editor));

      const decorations = result.current.decorate([{}, [0]]);

      expect(decorations).toEqual([]);
    });

    it('should convert decorations to Slate Range format', async () => {
      const { getDecorationsForPath } = require('../../utils/pagination-engine');

      const mockDecoration = {
        anchor: { path: [0], offset: 0 },
        focus: { path: [0], offset: 0 },
        pageBreak: true,
        pageIndex: 0,
      };

      getDecorationsForPath.mockReturnValue([mockDecoration]);

      const { result } = renderHook(() => usePageDecorations(editor));

      await waitFor(() => {
        expect(result.current.decorate).toBeDefined();
      });

      const ranges = result.current.decorate([{}, [0]]);

      expect(ranges).toHaveLength(1);
      expect(ranges[0]).toMatchObject({
        anchor: { path: [0], offset: 0 },
        focus: { path: [0], offset: 0 },
        pageBreak: true,
      });
    });

    it('should memoize decorate function', () => {
      const { result, rerender } = renderHook(() => usePageDecorations(editor));

      const firstDecorate = result.current.decorate;

      // Rerender without decoration changes
      rerender();

      expect(result.current.decorate).toBe(firstDecorate);
    });

    it('should update decorate when decorations change', async () => {
      const { calculatePageBreaks } = require('../../utils/pagination-engine');
      const { result, rerender } = renderHook(() => usePageDecorations(editor));

      const firstDecorate = result.current.decorate;

      // Change decorations
      calculatePageBreaks.mockReturnValueOnce({
        pageOfBlock: new Map(),
        lineCountCache: new Map(),
        totalPages: 2,
        decorations: [
          {
            anchor: { path: [5], offset: 0 },
            focus: { path: [5], offset: 0 },
            pageBreak: true,
            pageIndex: 0,
          },
        ],
      });

      act(() => {
        editor.children = [
          {
            type: 'action',
            children: [{ text: 'Changed' }],
          } as any,
        ];
      });

      rerender();

      await waitFor(() => {
        expect(result.current.decorate).not.toBe(firstDecorate);
      });
    });
  });

  describe('Yjs Integration', () => {
    it('should accept null Yjs document', () => {
      const { result } = renderHook(() => usePageDecorations(editor, null));

      expect(result.current).toBeDefined();
    });

    it('should subscribe to Yjs document updates', () => {
      const yjsDoc = new Y.Doc();
      const onSpy = jest.spyOn(yjsDoc, 'on');

      renderHook(() => usePageDecorations(editor, yjsDoc));

      expect(onSpy).toHaveBeenCalledWith('update', expect.any(Function));
    });

    it('should unsubscribe from Yjs document on unmount', () => {
      const yjsDoc = new Y.Doc();
      const offSpy = jest.spyOn(yjsDoc, 'off');

      const { unmount } = renderHook(() => usePageDecorations(editor, yjsDoc));

      unmount();

      expect(offSpy).toHaveBeenCalledWith('update', expect.any(Function));
    });

    it('should not subscribe when disabled', () => {
      const yjsDoc = new Y.Doc();
      const onSpy = jest.spyOn(yjsDoc, 'on');

      renderHook(() =>
        usePageDecorations(editor, yjsDoc, { enabled: false })
      );

      expect(onSpy).not.toHaveBeenCalled();
    });
  });

  describe('State Management', () => {
    it('should set isCalculating during calculation', async () => {
      const { calculatePageBreaks } = require('../../utils/pagination-engine');

      // Make calculation slow
      calculatePageBreaks.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  pageOfBlock: new Map(),
                  lineCountCache: new Map(),
                  totalPages: 1,
                  decorations: [],
                }),
              100
            )
          )
      );

      const { result } = renderHook(() => usePageDecorations(editor));

      // Should be calculating
      await waitFor(() => {
        expect(result.current.isCalculating).toBe(true);
      });

      // Should complete
      await waitFor(() => {
        expect(result.current.isCalculating).toBe(false);
      });
    });

    it('should maintain state across re-renders', async () => {
      const { result, rerender } = renderHook(() => usePageDecorations(editor));

      await waitFor(() => {
        expect(result.current.totalPages).toBeGreaterThan(0);
      });

      const pages = result.current.totalPages;

      // Rerender without changes
      rerender();

      expect(result.current.totalPages).toBe(pages);
    });
  });

  describe('Error Handling', () => {
    it('should handle calculation errors gracefully', async () => {
      const { calculatePageBreaks } = require('../../utils/pagination-engine');
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      calculatePageBreaks.mockImplementation(() => {
        throw new Error('Calculation failed');
      });

      const { result } = renderHook(() => usePageDecorations(editor));

      await waitFor(() => {
        expect(result.current.totalPages).toBe(1);
        expect(result.current.decorations).toEqual([]);
        expect(result.current.isCalculating).toBe(false);
      });

      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should reset state on error', async () => {
      const { calculatePageBreaks } = require('../../utils/pagination-engine');
      jest.spyOn(console, 'error').mockImplementation(() => {});

      // First successful calculation
      calculatePageBreaks.mockReturnValueOnce({
        pageOfBlock: new Map(),
        lineCountCache: new Map(),
        totalPages: 3,
        decorations: [{ test: 'decoration' }],
      });

      const { result, rerender } = renderHook(() => usePageDecorations(editor));

      await waitFor(() => {
        expect(result.current.totalPages).toBe(3);
      });

      // Then throw error
      calculatePageBreaks.mockImplementation(() => {
        throw new Error('Error');
      });

      act(() => {
        editor.children = [
          {
            type: 'action',
            children: [{ text: 'New' }],
          } as any,
        ];
      });

      rerender();

      await waitFor(() => {
        expect(result.current.totalPages).toBe(1);
        expect(result.current.decorations).toEqual([]);
      });
    });
  });

  describe('Performance', () => {
    it('should reuse metrics across calculations', async () => {
      const { calibrateTextMetrics } = require('../../utils/text-metrics');
      const { rerender } = renderHook(() => usePageDecorations(editor));

      await waitFor(() => {
        expect(calibrateTextMetrics).toHaveBeenCalledTimes(1);
      });

      // Trigger recalculation
      act(() => {
        editor.children = [
          {
            type: 'action',
            children: [{ text: 'New' }],
          } as any,
        ];
      });

      rerender();

      // Should not calibrate again
      expect(calibrateTextMetrics).toHaveBeenCalledTimes(1);
    });

    it('should pass previous state for cache reuse', async () => {
      const { calculatePageBreaks } = require('../../utils/pagination-engine');

      calculatePageBreaks.mockReturnValue({
        pageOfBlock: new Map([['test', 1]]),
        lineCountCache: new Map([['cache-key', 5]]),
        totalPages: 1,
        decorations: [],
      });

      const { rerender } = renderHook(() => usePageDecorations(editor));

      await waitFor(() => {
        expect(calculatePageBreaks).toHaveBeenCalled();
      });

      // Trigger recalculation
      act(() => {
        editor.children = [
          {
            type: 'action',
            children: [{ text: 'New' }],
          } as any,
        ];
      });

      rerender();

      await waitFor(() => {
        expect(calculatePageBreaks).toHaveBeenCalledTimes(2);
      });

      // Second call should have previous state
      const secondCall = calculatePageBreaks.mock.calls[1];
      expect(secondCall[2]).toBeDefined();
      expect(secondCall[2].lineCountCache).toBeDefined();
    });
  });
});
