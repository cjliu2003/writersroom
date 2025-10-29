'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { getTopRatedMovies, getPosterUrl, type TMDBMovie } from '@/lib/tmdb';

export function MoviePosterBanner() {
  const [movies, setMovies] = useState<TMDBMovie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    console.log('[MoviePosterBanner] Fetching top-rated movies from TMDB...');

    getTopRatedMovies(80) // Fetch 80 movies for scrolling rows
      .then((data) => {
        console.log('[MoviePosterBanner] Received movies:', data.length);
        if (data.length === 0) {
          console.warn('[MoviePosterBanner] ⚠️ No movies returned from TMDB API');
          setError('No movies available');
        }
        setMovies(data);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('[MoviePosterBanner] ❌ Failed to load movie posters:', err);
        setError(err.message || 'Failed to load');
        setIsLoading(false);
      });
  }, []);

  // Show loading skeleton while fetching
  if (isLoading) {
    return (
      <div className="fixed inset-0 -z-10 overflow-hidden bg-white">
        <div className="poster-banner-skeleton" aria-hidden="true" />
      </div>
    );
  }

  // Fallback if no movies loaded
  if (movies.length === 0) {
    return <div className="fixed inset-0 -z-10 overflow-hidden bg-white" />;
  }

  // Split movies into 4 rows (~20 posters each)
  const moviesPerRow = Math.ceil(movies.length / 4);
  const rows = [
    movies.slice(0, moviesPerRow),
    movies.slice(moviesPerRow, moviesPerRow * 2),
    movies.slice(moviesPerRow * 2, moviesPerRow * 3),
    movies.slice(moviesPerRow * 3)
  ].filter(row => row.length > 0);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-white">
      {/* Scrolling poster rows */}
      <div className="poster-rows-container" aria-hidden="true">
        {rows.map((rowMovies, rowIndex) => {
          // Duplicate for seamless infinite scroll
          const duplicatedRow = [...rowMovies, ...rowMovies, ...rowMovies];
          const isEvenRow = rowIndex % 2 === 0;

          return (
            <div
              key={rowIndex}
              className={`poster-row ${isEvenRow ? 'scroll-left' : 'scroll-right'} ${
                reducedMotion ? 'reduced-motion' : ''
              }`}
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

      {/* Radial vignette for reading zone - dark center, transparent edges */}
      <div className="poster-vignette" />
    </div>
  );
}
