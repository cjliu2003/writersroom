'use client';

import { useState, useEffect } from 'react';

/**
 * Hook to detect user's motion preferences (WCAG 2.1 compliance)
 * Returns true if user prefers reduced motion
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    // Check if window is available (client-side only)
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Set initial value
    setReducedMotion(mediaQuery.matches);

    // Listen for changes
    const listener = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
    // Fallback for older browsers
    else {
      // @ts-ignore - deprecated but needed for older browsers
      mediaQuery.addListener(listener);
      // @ts-ignore
      return () => mediaQuery.removeListener(listener);
    }
  }, []);

  return reducedMotion;
}
