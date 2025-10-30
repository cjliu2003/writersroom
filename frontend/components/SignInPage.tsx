'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { MoviePosterBanner } from '@/components/MoviePosterBanner';

/**
 * Cinematic styling constants for login page
 * Using clamp() for fluid responsive typography
 */
const TITLE_STYLES = {
  fontSize: 'clamp(3.5rem, 12vw, 11rem)',
  textShadow: '5px 5px 10px rgba(0, 0, 0, 0.95), 3px 3px 6px rgba(0, 0, 0, 0.9), -1px -1px 3px rgba(0, 0, 0, 0.6)',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  letterSpacing: '0.03em'
} as const;

const SUBTITLE_STYLES = {
  fontSize: 'clamp(1.25rem, 3vw, 2rem)',
  textShadow: '3px 3px 8px rgba(0, 0, 0, 0.95), 2px 2px 4px rgba(0, 0, 0, 0.8)',
  opacity: 0.95
} as const;

const BUTTON_BASE_STYLES = {
  fontSize: 'clamp(1rem, 2vw, 1.25rem)',
  textShadow: '2px 2px 4px rgba(0, 0, 0, 0.9)',
  background: 'rgba(255, 255, 255, 0.45)',
  border: '3px solid rgba(255, 255, 255, 0.8)',
  backdropFilter: 'blur(12px)'
} as const;

const BUTTON_HOVER_STYLES = {
  background: 'rgba(255, 255, 255, 0.6)',
  borderColor: 'rgba(255, 255, 255, 1)'
} as const;

export default function SignInPage() {
  const { signIn, isLoading } = useAuth();
  const [error, setError] = useState<string | null>(null);

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

  const handleButtonMouseEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    button.style.background = BUTTON_HOVER_STYLES.background;
    button.style.borderColor = BUTTON_HOVER_STYLES.borderColor;
  }, []);

  const handleButtonMouseLeave = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    button.style.background = BUTTON_BASE_STYLES.background;
    button.style.borderColor = 'rgba(255, 255, 255, 0.8)';
  }, []);

  return (
    <>
      <MoviePosterBanner />
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full flex flex-col items-center justify-center text-center z-10 animate-fade-in">
          {/* Main title */}
          <h1
            className="font-black text-white uppercase mb-8 leading-none px-4"
            style={TITLE_STYLES}
          >
            WRITERSROOM
          </h1>

          {/* Subtitle */}
          <p
            className="text-white font-semibold mb-16 tracking-wide px-4"
            style={SUBTITLE_STYLES}
          >
            by screenwriters, for screenwriters
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

          {/* Authentication buttons */}
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 justify-center items-center w-full max-w-2xl px-4">
            {/* Sign In Button */}
            <button
              onClick={handleSignIn}
              disabled={isLoading}
              className="group relative px-8 sm:px-16 py-4 sm:py-5 font-bold text-white uppercase tracking-widest transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed w-full sm:w-auto sm:min-w-[200px]"
              style={BUTTON_BASE_STYLES}
              onMouseEnter={handleButtonMouseEnter}
              onMouseLeave={handleButtonMouseLeave}
              aria-label="Sign in with Google"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>

            {/* Sign Up Button - Currently uses same handler as Sign In */}
            <button
              onClick={handleSignIn}
              disabled={isLoading}
              className="group relative px-8 sm:px-16 py-4 sm:py-5 font-bold text-white uppercase tracking-widest transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed w-full sm:w-auto sm:min-w-[200px]"
              style={BUTTON_BASE_STYLES}
              onMouseEnter={handleButtonMouseEnter}
              onMouseLeave={handleButtonMouseLeave}
              aria-label="Sign up with Google"
            >
              Sign Up
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
