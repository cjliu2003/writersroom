/**
 * usePageDecorations Hook
 *
 * Manages Slate decorations for page breaks in screenplay editor.
 * Provides efficient pagination with caching and debounced updates.
 *
 * This hook integrates the pagination-engine with Slate editor to:
 * - Calculate page breaks based on industry-standard 55 lines/page
 * - Provide decorations for Slate's decorate() function
 * - Cache calculations for performance
 * - Debounce updates to avoid excessive recalculation
 *
 * @example
 * ```typescript
 * const { decorate, totalPages, isCalculating } = usePageDecorations(editor, yjsDoc);
 *
 * <Editable
 *   decorate={decorate}
 *   renderLeaf={renderLeaf}
 * />
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Editor, Range } from 'slate';
import * as Y from 'yjs';
import {
  calibrateTextMetrics,
  type TextMetrics,
} from '../utils/text-metrics';
import {
  calculatePageBreaks,
  getDecorationsForPath,
  type PaginationState,
  type PageBreakDecoration,
} from '../utils/pagination-engine';

/**
 * Options for usePageDecorations hook
 */
export interface UsePageDecorationsOptions {
  /** Debounce delay in milliseconds (default: 150ms) */
  debounceMs?: number;
  /** Whether pagination is enabled (default: true) */
  enabled?: boolean;
}

/**
 * Return value from usePageDecorations hook
 */
export interface UsePageDecorationsReturn {
  /**
   * Decorate function for Slate editor
   * Filters decorations for the given node path
   */
  decorate: (entry: [node: any, path: number[]]) => Range[];
  /** Total page count */
  totalPages: number;
  /** Whether calculation is in progress */
  isCalculating: boolean;
  /** All page break decorations (for debugging) */
  decorations: PageBreakDecoration[];
}

/**
 * Simple debounce utility
 * Creates a debounced version of the provided function
 */
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): T & { cancel: () => void } {
  let timeout: NodeJS.Timeout | null = null;

  const debounced = function (this: any, ...args: Parameters<T>) {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func.apply(this, args);
    }, wait);
  } as T & { cancel: () => void };

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return debounced;
}

/**
 * Hook for calculating and managing page break decorations
 *
 * This hook:
 * 1. Calibrates text metrics once on mount
 * 2. Calculates page breaks when editor content changes
 * 3. Caches pagination state for performance
 * 4. Debounces updates to avoid excessive recalculation
 * 5. Provides memoized decorate function for Slate
 *
 * @param editor - Slate editor instance
 * @param yjsDoc - Yjs document (optional, for future incremental updates)
 * @param options - Configuration options
 * @returns Object with decorate function, totalPages, isCalculating, decorations
 *
 * @example
 * ```typescript
 * const { decorate, totalPages } = usePageDecorations(editor, yjsDoc, {
 *   debounceMs: 200,
 *   enabled: true
 * });
 * ```
 */
export function usePageDecorations(
  editor: Editor,
  yjsDoc: Y.Doc | null = null,
  options: UsePageDecorationsOptions = {}
): UsePageDecorationsReturn {
  const { debounceMs = 150, enabled = true } = options;

  // State
  const [totalPages, setTotalPages] = useState(1);
  const [isCalculating, setIsCalculating] = useState(false);
  const [decorations, setDecorations] = useState<PageBreakDecoration[]>([]);

  // Refs for caching (persist across renders without triggering re-renders)
  const metricsRef = useRef<TextMetrics | null>(null);
  const paginationStateRef = useRef<PaginationState | null>(null);
  const debouncedCalculateRef = useRef<
    ((nodes: any[]) => void) & { cancel: () => void }
  >();

  // Calibrate metrics once on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && !metricsRef.current) {
      metricsRef.current = calibrateTextMetrics();
      console.log('[usePageDecorations] Metrics calibrated:', {
        charsPerInch: metricsRef.current.charsPerInch.toFixed(2),
        actionCols: metricsRef.current.maxColsByType.action,
        dialogueCols: metricsRef.current.maxColsByType.dialogue,
      });
    }
  }, []);

  // Create debounced calculation function
  useEffect(() => {
    const calculate = (nodes: any[]) => {
      if (!metricsRef.current) {
        console.warn('[usePageDecorations] Metrics not calibrated yet');
        return;
      }

      try {
        setIsCalculating(true);

        const startTime = performance.now();

        const newState = calculatePageBreaks(
          nodes,
          metricsRef.current,
          paginationStateRef.current || undefined
        );

        const endTime = performance.now();

        paginationStateRef.current = newState;
        setDecorations(newState.decorations);
        setTotalPages(newState.totalPages);

        console.log('[usePageDecorations] Calculated:', {
          totalPages: newState.totalPages,
          decorations: newState.decorations.length,
          elements: newState.pageOfBlock.size,
          cacheSize: newState.lineCountCache.size,
          timeMs: (endTime - startTime).toFixed(2),
        });
      } catch (error) {
        console.error('[usePageDecorations] Calculation error:', error);
        setDecorations([]);
        setTotalPages(1);
      } finally {
        setIsCalculating(false);
      }
    };

    debouncedCalculateRef.current = debounce(calculate, debounceMs);

    return () => {
      debouncedCalculateRef.current?.cancel();
    };
  }, [debounceMs]);

  // Calculate decorations when editor content changes
  useEffect(() => {
    if (!enabled || !debouncedCalculateRef.current) {
      return;
    }

    // Guard: Don't recalculate if editor.children is empty or very small
    // This prevents clearing decorations during Yjs sync transient states
    // Only skip if we already have decorations (to allow initial calculation)
    if (editor.children.length === 0 && decorations.length > 0) {
      console.log('[usePageDecorations] Skipping calculation - editor.children is empty (transient state)');
      return;
    }

    // Trigger debounced calculation
    debouncedCalculateRef.current(editor.children);

    return () => {
      // Cleanup is handled by the debounce function
    };
  }, [editor.children, enabled, decorations.length]);

  // Optional: Subscribe to Yjs document updates for future incremental optimization
  useEffect(() => {
    if (!yjsDoc || !enabled) {
      return;
    }

    const handleUpdate = () => {
      // Future: Could implement incremental updates here
      // For now, the editor.children dependency handles updates
      console.log('[usePageDecorations] Yjs doc updated');
    };

    yjsDoc.on('update', handleUpdate);

    return () => {
      yjsDoc.off('update', handleUpdate);
    };
  }, [yjsDoc, enabled]);

  // Memoized decorate function for Slate
  // This function is called by Slate for each node during rendering
  const decorate = useCallback(
    (entry: [node: any, path: number[]]) => {
      const [, path] = entry;

      // Filter decorations for this specific path
      const pathDecorations = getDecorationsForPath(decorations, path);

      // Convert to Slate Range format
      return pathDecorations.map((decoration) => ({
        ...decoration,
        // Add any additional properties needed by Slate
      })) as Range[];
    },
    [decorations]
  );

  return {
    decorate,
    totalPages,
    isCalculating,
    decorations,
  };
}
