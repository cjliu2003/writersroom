'use client';

import { MoviePosterBanner } from '@/components/MoviePosterBanner';

/**
 * Layout wrapper that shows the movie poster banner on all pages
 * Banner renders as a fixed background layer behind all content
 */
export function LayoutWithBanner({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MoviePosterBanner />
      {children}
    </>
  );
}
