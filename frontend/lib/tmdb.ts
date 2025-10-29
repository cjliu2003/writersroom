const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

interface TMDBMovie {
  id: number;
  title: string;
  poster_path: string;
  backdrop_path: string;
  vote_average: number;
  release_date: string;
}

interface TMDBResponse {
  page: number;
  results: TMDBMovie[];
  total_pages: number;
  total_results: number;
}

/**
 * Fetch popular movies from TMDB
 * @param count Number of movies to return (max 20 per page)
 * @returns Array of movie objects
 */
export async function getPopularMovies(count: number = 12): Promise<TMDBMovie[]> {
  const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY;

  console.log('[TMDB] getPopularMovies called, count:', count);
  console.log('[TMDB] API key present:', !!apiKey);

  if (!apiKey) {
    console.error('[TMDB] ❌ TMDB API key not configured in environment variables');
    console.error('[TMDB] Please check that NEXT_PUBLIC_TMDB_API_KEY is set in .env.local');
    return [];
  }

  try {
    const url = `${TMDB_BASE_URL}/movie/popular?api_key=${apiKey}&language=en-US&page=1`;
    console.log('[TMDB] Fetching from:', TMDB_BASE_URL);

    const response = await fetch(url, {
      next: { revalidate: 86400 } // Cache for 24 hours
    });

    console.log('[TMDB] Response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[TMDB] ❌ API error response:', errorText);
      throw new Error(`TMDB API error: ${response.status} - ${errorText}`);
    }

    const data: TMDBResponse = await response.json();
    console.log('[TMDB] ✅ Received', data.results.length, 'movies');
    console.log('[TMDB] First movie:', data.results[0]?.title);

    return data.results.slice(0, count);
  } catch (error) {
    console.error('[TMDB] ❌ Failed to fetch movies from TMDB:', error);
    return [];
  }
}

/**
 * Get full poster URL from TMDB poster path
 * @param posterPath Path returned from TMDB API (e.g., "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg")
 * @param size Image size (w185, w300, w500, original)
 * @returns Full image URL
 */
export function getPosterUrl(
  posterPath: string,
  size: 'w185' | 'w300' | 'w500' | 'original' = 'w300'
): string {
  return `${TMDB_IMAGE_BASE}/${size}${posterPath}`;
}

/**
 * Get trending movies (optional alternative to popular)
 */
export async function getTrendingMovies(
  timeWindow: 'day' | 'week' = 'week',
  count: number = 12
): Promise<TMDBMovie[]> {
  const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY;

  if (!apiKey) return [];

  try {
    const response = await fetch(
      `${TMDB_BASE_URL}/trending/movie/${timeWindow}?api_key=${apiKey}`,
      { next: { revalidate: 3600 } } // Cache for 1 hour
    );

    const data: TMDBResponse = await response.json();
    return data.results.slice(0, count);
  } catch (error) {
    console.error('Failed to fetch trending movies:', error);
    return [];
  }
}

/**
 * Fetch top-rated movies from TMDB
 * @param count Number of movies to return (max 20 per page)
 * @returns Array of top-rated movie objects
 */
export async function getTopRatedMovies(count: number = 12): Promise<TMDBMovie[]> {
  const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY;

  console.log('[TMDB] getTopRatedMovies called, count:', count);
  console.log('[TMDB] API key present:', !!apiKey);

  if (!apiKey) {
    console.error('[TMDB] ❌ TMDB API key not configured in environment variables');
    console.error('[TMDB] Please check that NEXT_PUBLIC_TMDB_API_KEY is set in .env.local');
    return [];
  }

  try {
    // Fetch multiple pages to get large pool for grid layout (max 5 pages = 100 movies)
    const pagesToFetch = Math.min(Math.ceil(count / 20), 5);
    const allMovies: TMDBMovie[] = [];

    console.log('[TMDB] Fetching', pagesToFetch, 'pages for', count, 'movies');

    for (let page = 1; page <= pagesToFetch; page++) {
      const url = `${TMDB_BASE_URL}/movie/top_rated?api_key=${apiKey}&language=en-US&page=${page}`;

      const response = await fetch(url, {
        next: { revalidate: 86400 } // Cache for 24 hours
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[TMDB] ❌ API error response (page', page, '):', errorText);
        throw new Error(`TMDB API error: ${response.status} - ${errorText}`);
      }

      const data: TMDBResponse = await response.json();
      allMovies.push(...data.results);
    }

    console.log('[TMDB] ✅ Received', allMovies.length, 'top-rated movies across', pagesToFetch, 'pages');

    return allMovies.slice(0, count);
  } catch (error) {
    console.error('[TMDB] ❌ Failed to fetch top-rated movies from TMDB:', error);
    return [];
  }
}

export type { TMDBMovie };
