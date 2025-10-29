'use client';

import { useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { getTopRatedMovies, getPosterUrl, type TMDBMovie } from '@/lib/tmdb';

const MOVIES_TO_FETCH = 80;

// Calculate optimal row count based on viewport height
function getOptimalRowCount(): number {
  if (typeof window === 'undefined') return 5;

  const vh = window.innerHeight;

  // Mobile screens
  if (vh < 600) return 2;
  // Small laptops and tablets
  if (vh < 800) return 3;
  // Standard laptops (768-900px)
  if (vh < 1000) return 3;
  // Larger laptops and displays (900-1080px)
  if (vh < 1200) return 4;
  // Large displays (> 1080px)
  return 5;
}

// Calculate poster dimensions based on viewport height and width
function getPosterDimensions(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 140, height: 210 };

  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // Very small mobile screens
  if (vw < 480) return { width: 100, height: 150 };
  // Mobile screens
  if (vw < 768 || vh < 600) return { width: 120, height: 180 };
  // Small laptops and tablets - smaller posters to fit 3 rows
  if (vh < 800) return { width: 130, height: 195 };
  // Standard laptops (768-900px height) - optimized for 3 rows
  if (vh < 1000) return { width: 140, height: 210 };
  // Larger laptops (900-1080px height) - can afford slightly larger posters for 4 rows
  if (vh < 1200) return { width: 150, height: 225 };
  // Large displays (> 1080px height) - full size posters for 5 rows
  return { width: 180, height: 270 };
}

export function MoviePosterBanner() {
  const [movies, setMovies] = useState<TMDBMovie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rowCount, setRowCount] = useState(5);
  const [posterDimensions, setPosterDimensions] = useState({ width: 150, height: 225 });
  const reducedMotion = useReducedMotion();

  // Update row count and poster dimensions on mount and resize
  useEffect(() => {
    const updateLayout = () => {
      setRowCount(getOptimalRowCount());
      setPosterDimensions(getPosterDimensions());
    };

    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, []);

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

    const moviesPerRow = Math.ceil(movies.length / rowCount);
    const calculatedRows: TMDBMovie[][] = [];

    for (let i = 0; i < rowCount; i++) {
      const start = i * moviesPerRow;
      const end = start + moviesPerRow;
      const row = movies.slice(start, end);
      if (row.length > 0) {
        calculatedRows.push(row);
      }
    }

    return calculatedRows;
  }, [movies, rowCount]);

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
                      width={posterDimensions.width}
                      height={posterDimensions.height}
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
