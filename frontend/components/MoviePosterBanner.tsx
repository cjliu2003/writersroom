'use client';

import { useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { getTopRatedMovies, getPosterUrl, type TMDBMovie } from '@/lib/tmdb';

// Configuration constants
const MOVIES_TO_FETCH = 80;
const TOTAL_ROW_COUNT = 7;
const VISIBLE_ROW_COUNT = 4;

// Layout constants synced with CSS
const CONTAINER_PADDING_DESKTOP = 64; // 2rem top + 2rem bottom
const CONTAINER_PADDING_MOBILE = 32;  // 1rem top + 1rem bottom
const GAP_SIZE_DESKTOP = 24;          // 1.5rem
const GAP_SIZE_MOBILE = 16;           // 1rem
const MOBILE_BREAKPOINT = 768;

// Poster dimension constraints
const SCALING_FACTOR = 0.85;          // 15% reduction for comfortable spacing
const POSTER_ASPECT_RATIO = 2 / 3;    // Standard movie poster ratio (width/height)
const MIN_POSTER_WIDTH = 50;
const MIN_POSTER_HEIGHT = 75;

/**
 * Calculate poster dimensions to fit exactly VISIBLE_ROW_COUNT rows in viewport.
 * Adapts to viewport size and device type for optimal display.
 *
 * @returns Object containing calculated width and height in pixels
 */
function getPosterDimensions(): { width: number; height: number } {
  // Server-side rendering fallback
  if (typeof window === 'undefined') {
    return { width: MIN_POSTER_WIDTH, height: MIN_POSTER_HEIGHT };
  }

  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const isMobile = vw < MOBILE_BREAKPOINT;

  // Calculate layout spacing
  const containerPadding = isMobile ? CONTAINER_PADDING_MOBILE : CONTAINER_PADDING_DESKTOP;
  const gapSize = isMobile ? GAP_SIZE_MOBILE : GAP_SIZE_DESKTOP;
  const totalGaps = (VISIBLE_ROW_COUNT - 1) * gapSize;

  // Calculate available height and poster dimensions
  const availableHeight = vh - containerPadding - totalGaps;
  const posterHeight = Math.floor((availableHeight / VISIBLE_ROW_COUNT) * SCALING_FACTOR);
  const posterWidth = Math.floor(posterHeight * POSTER_ASPECT_RATIO);

  return {
    width: Math.max(posterWidth, MIN_POSTER_WIDTH),
    height: Math.max(posterHeight, MIN_POSTER_HEIGHT)
  };
}

export function MoviePosterBanner() {
  const [movies, setMovies] = useState<TMDBMovie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [posterDimensions, setPosterDimensions] = useState(() => getPosterDimensions());
  const reducedMotion = useReducedMotion();

  // Update poster dimensions on mount and resize for fluid scaling
  useEffect(() => {
    const updateLayout = () => {
      setPosterDimensions(getPosterDimensions());
    };

    // Initial calculation
    updateLayout();

    // Throttle resize events for performance
    let timeoutId: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(updateLayout, 150);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Fetch movie posters from TMDB
  useEffect(() => {
    let isMounted = true;

    const fetchMovies = async () => {
      try {
        const data = await getTopRatedMovies(MOVIES_TO_FETCH);

        if (!isMounted) return;

        if (data.length === 0 && process.env.NODE_ENV === 'development') {
          console.warn('[MoviePosterBanner] No movies returned from TMDB API');
        }

        setMovies(data);
      } catch (error) {
        if (!isMounted) return;
        console.error('[MoviePosterBanner] Failed to load movie posters:', error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchMovies();

    return () => {
      isMounted = false;
    };
  }, []);

  // Distribute movies across rows for infinite scroll effect
  const rows = useMemo(() => {
    if (movies.length === 0) return [];

    const moviesPerRow = Math.ceil(movies.length / TOTAL_ROW_COUNT);
    const calculatedRows: TMDBMovie[][] = [];

    for (let i = 0; i < TOTAL_ROW_COUNT; i++) {
      const start = i * moviesPerRow;
      const end = start + moviesPerRow;
      const row = movies.slice(start, end);

      if (row.length > 0) {
        calculatedRows.push(row);
      }
    }

    return calculatedRows;
  }, [movies]);

  // Loading state with skeleton
  if (isLoading) {
    return (
      <div className="fixed inset-0 -z-10 overflow-hidden bg-white" aria-label="Loading movie posters">
        <div className="poster-banner-skeleton" aria-hidden="true" />
      </div>
    );
  }

  // Fallback if API fails or returns no data
  if (rows.length === 0) {
    return (
      <div className="fixed inset-0 -z-10 overflow-hidden bg-white" aria-label="Background" />
    );
  }

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-white" aria-label="Movie poster background">
      <div className="poster-rows-container" aria-hidden="true">
        {rows.map((rowMovies, rowIndex) => {
          // Triple duplication for seamless infinite scroll
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
                    style={{
                      width: `${posterDimensions.width}px`,
                      height: `${posterDimensions.height}px`,
                    }}
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

      {/* Radial vignette overlay for content readability */}
      <div className="poster-vignette" aria-hidden="true" />
    </div>
  );
}
