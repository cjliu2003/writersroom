'use client';

import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { MoviePosterBanner } from '@/components/MoviePosterBanner';

// Cinematic styling constants
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

  const handleSignIn = useCallback(async () => {
    try {
      const result = await signIn();
      if (!result) {
        alert('Firebase authentication is not configured. Please check your environment variables.');
      }
    } catch (error) {
      console.error('Sign in failed:', error);
      alert('Sign in failed. Please check your Firebase configuration.');
    }
  }, [signIn]);

  const handleButtonMouseEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    Object.assign(e.currentTarget.style, BUTTON_HOVER_STYLES);
  }, []);

  const handleButtonMouseLeave = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = BUTTON_BASE_STYLES.background;
    e.currentTarget.style.borderColor = BUTTON_BASE_STYLES.border.split(' ')[2];
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

          {/* Button group */}
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 justify-center items-center w-full max-w-2xl px-4">
            {/* Sign In Button */}
            <button
              onClick={handleSignIn}
              disabled={isLoading}
              className="group relative px-8 sm:px-16 py-4 sm:py-5 font-bold text-white uppercase tracking-widest transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed w-full sm:w-auto sm:min-w-[200px]"
              style={BUTTON_BASE_STYLES}
              onMouseEnter={handleButtonMouseEnter}
              onMouseLeave={handleButtonMouseLeave}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>

            {/* Sign Up Button */}
            <button
              onClick={handleSignIn}
              disabled={isLoading}
              className="group relative px-8 sm:px-16 py-4 sm:py-5 font-bold text-white uppercase tracking-widest transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed w-full sm:w-auto sm:min-w-[200px]"
              style={BUTTON_BASE_STYLES}
              onMouseEnter={handleButtonMouseEnter}
              onMouseLeave={handleButtonMouseLeave}
            >
              Sign Up
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
