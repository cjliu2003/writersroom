'use client';

import { MoviePosterBanner } from '@/components/MoviePosterBanner';

/**
 * DEPRECATED: This component is no longer used.
 *
 * The MoviePosterBanner has been moved directly into SignInPage.tsx
 * to ensure it only appears on the login screen, not throughout the app.
 *
 * This file is kept for reference but can be safely deleted.
 *
 * @deprecated Since 2025-10-29 - Use MoviePosterBanner directly in SignInPage instead
 */
export function LayoutWithBanner({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MoviePosterBanner />
      {children}
    </>
  );
}
