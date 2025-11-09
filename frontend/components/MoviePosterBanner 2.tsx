'use client';

import { useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { getTopRatedMovies, getPosterUrl, type TMDBMovie } from '@/lib/tmdb';

const ROWS_COUNT = 4;
const MOVIES_TO_FETCH = 80;

export function MoviePosterBanner() {
  const [movies, setMovies] = useState<TMDBMovie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[MoviePosterBanner] Fetching top-rated movies from TMDB...');
    }

    getTopRatedMovies(MOVIES_TO_FETCH)
      .then((data) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('[MoviePosterBanner] Received movies:', data.length);
          if (data.length === 0) {
            console.warn('[MoviePosterBanner] ⚠️ No movies returned from TMDB API');
          }
        }
        setMovies(data);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('[MoviePosterBanner] ❌ Failed to load movie posters:', err);
        setIsLoading(false);
      });
  }, []);

  // Memoize row calculations to avoid recalculation on every render
  const rows = useMemo(() => {
    if (movies.length === 0) return [];

    const moviesPerRow = Math.ceil(movies.length / ROWS_COUNT);
    return [
      movies.slice(0, moviesPerRow),
      movies.slice(moviesPerRow, moviesPerRow * 2),
      movies.slice(moviesPerRow * 2, moviesPerRow * 3),
      movies.slice(moviesPerRow * 3)
    ].filter(row => row.length > 0);
  }, [movies]);

  // Show loading skeleton while fetching
  if (isLoading) {
    return (
      <div className="fixed inset-0 -z-10 overflow-hidden bg-white">
        <div className="poster-banner-skeleton" aria-hidden="true" />
      </div>
    );
  }

  // Fallback if no movies loaded
  if (rows.length === 0) {
    return <div className="fixed inset-0 -z-10 overflow-hidden bg-white" />;
  }

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-white">
      <div className="poster-rows-container" aria-hidden="true">
        {rows.map((rowMovies, rowIndex) => {
          // Duplicate for seamless infinite scroll
          const duplicatedRow = [...rowMovies, ...rowMovies, ...rowMovies];
          const isEvenRow = rowIndex % 2 === 0;
          const scrollDirection = isEvenRow ? 'scroll-left' : 'scroll-right';
          const motionClass = reducedMotion ? 'reduced-motion' : '';

          return (
            <div
              key={rowIndex}
              className={`poster-row ${scrollDirection} ${motionClass}`}
            >
              <div className="poster-row-track">
                {duplicatedRow.map((movie, index) => (
                  <div
                    key={`${movie.id}-${rowIndex}-${index}`}
                    className="poster-item"
                  >
                    <Image
                      src={getPosterUrl(movie.poster_path, 'w300')}
                      alt=""
                      width={180}
                      height={270}
                      quality={80}
                      className="poster-img"
                      loading="eager"
                      unoptimized
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Radial vignette for reading zone */}
      <div className="poster-vignette" />
    </div>
  );
}
