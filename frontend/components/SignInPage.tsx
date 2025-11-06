'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { MoviePosterBanner } from '@/components/MoviePosterBanner';

/**
 * Cinematic styling constants for login page
 * Using clamp() for fluid responsive typography that adapts to viewport size
 */
const TITLE_STYLES = {
  fontSize: 'clamp(3.5rem, 12vw, 11rem)',
  textShadow: '5px 5px 10px rgba(0, 0, 0, 0.95), 3px 3px 6px rgba(0, 0, 0, 0.9), -1px -1px 3px rgba(0, 0, 0, 0.6)',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  letterSpacing: '0.03em'
} as const;

const SUBTITLE_STYLES = {
  fontSize: 'clamp(1.5rem, 4vw, 2.5rem)',
  textShadow: '3px 3px 8px rgba(0, 0, 0, 0.95), 2px 2px 4px rgba(0, 0, 0, 0.8)',
  opacity: 0.95
} as const;

const BUTTON_BASE_STYLES = {
  fontSize: 'clamp(1.25rem, 2.5vw, 1.625rem)',
  textShadow: '2px 2px 4px rgba(0, 0, 0, 0.9), 1px 1px 2px rgba(0, 0, 0, 0.8), 0px 0px 8px rgba(0, 0, 0, 0.6)',
  background: 'rgba(255, 255, 255, 0.9)',
  border: '2px solid rgba(255, 255, 255, 0.9)',
  backdropFilter: 'blur(12px)'
} as const;

const BUTTON_HOVER_STYLES = {
  background: 'rgba(255, 255, 255, 0.95)',
  borderColor: 'rgba(255, 255, 255, 1)'
} as const;

// Color constants for consistency
const COLORS = {
  buttonBackground: 'rgba(255, 255, 255, 0.9)',
  buttonBorder: 'rgba(255, 255, 255, 0.95)'
} as const;

/**
 * SignInPage - Authentication entry point with cinematic design
 *
 * Features:
 * - Google OAuth authentication via Firebase
 * - Animated movie poster background
 * - Responsive typography and layout
 * - User-friendly error handling
 * - WCAG-compliant accessibility
 *
 * Note: Firebase automatically handles both new user registration and
 * existing user sign-in through the same OAuth flow.
 */
export default function SignInPage() {
  const { signIn, isLoading } = useAuth();
  const [error, setError] = useState<string | null>(null);

  /**
   * Handles Google OAuth authentication
   * Clears any existing errors and initiates sign-in flow
   */
  const handleSignIn = useCallback(async () => {
    setError(null);

    try {
      const result = await signIn();

      if (!result) {
        setError('Authentication is not configured. Please contact support.');
      }
    } catch (err) {
      console.error('[SignInPage] Authentication failed:', err);
      setError('Sign in failed. Please try again or contact support.');
    }
  }, [signIn]);

  /**
   * Apply hover styles to button
   */
  const handleButtonMouseEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    button.style.background = BUTTON_HOVER_STYLES.background;
    button.style.borderColor = BUTTON_HOVER_STYLES.borderColor;
  }, []);

  /**
   * Reset button to base styles
   */
  const handleButtonMouseLeave = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    button.style.background = COLORS.buttonBackground;
    button.style.borderColor = COLORS.buttonBorder;
  }, []);

  return (
    <>
      <MoviePosterBanner />
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full flex flex-col items-center justify-center text-center z-10 animate-fade-in">
          {/* Main title */}
          <h1
            className="font-black text-white uppercase mb-7 leading-none px-4"
            style={TITLE_STYLES}
          >
            WRITERSROOM
          </h1>

          {/* Subtitle */}
          <p
            className="text-white font-semibold mb-7 tracking-wide px-4"
            style={SUBTITLE_STYLES}
          >
            by screenwriters, for screenwriters...
          </p>

          {/* Error message */}
          {error && (
            <div
              className="mb-6 px-6 py-3 bg-red-900/80 border-2 border-red-500/80 rounded-lg backdrop-blur-sm max-w-md"
              role="alert"
            >
              <p className="text-white font-medium">{error}</p>
            </div>
          )}

          {/* Authentication button */}
          <div className="flex justify-center items-center w-full px-4">
            <button
              onClick={handleSignIn}
              disabled={isLoading}
              className="group relative rounded-2xl px-8 sm:px-16 py-5 sm:py-6 font-semibold text-white uppercase tracking-wide transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed w-full sm:w-auto sm:min-w-[240px]"
              style={BUTTON_BASE_STYLES}
              onMouseEnter={handleButtonMouseEnter}
              onMouseLeave={handleButtonMouseLeave}
              aria-label="Sign in with Google"
            >
              {isLoading ? 'Connecting...' : 'Sign in with Google'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
