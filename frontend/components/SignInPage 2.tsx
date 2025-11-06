'use client';

import React from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function SignInPage() {
  const { signIn, isLoading } = useAuth();

  const handleSignIn = async () => {
    try {
      const result = await signIn();
      if (!result) {
        alert('Firebase authentication is not configured. Please check your environment variables.');
      }
    } catch (error) {
      console.error('Sign in failed:', error);
      alert('Sign in failed. Please check your Firebase configuration.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      {/* Centered cinematic content - no card */}
      <div className="w-full flex flex-col items-center justify-center text-center z-10 animate-fade-in">
        {/* Main title with cinematic styling */}
        <h1
          className="font-black text-white uppercase mb-8 leading-none px-4"
          style={{
            fontSize: 'clamp(3.5rem, 12vw, 11rem)',
            textShadow: '5px 5px 10px rgba(0, 0, 0, 0.95), 3px 3px 6px rgba(0, 0, 0, 0.9), -1px -1px 3px rgba(0, 0, 0, 0.6)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            letterSpacing: '0.03em'
          }}
        >
          WRITERSROOM
        </h1>

        {/* Subtitle */}
        <p
          className="text-white font-semibold mb-16 tracking-wide px-4"
          style={{
            fontSize: 'clamp(1.25rem, 3vw, 2rem)',
            textShadow: '3px 3px 8px rgba(0, 0, 0, 0.95), 2px 2px 4px rgba(0, 0, 0, 0.8)',
            opacity: 0.95
          }}
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
            style={{
              fontSize: 'clamp(1rem, 2vw, 1.25rem)',
              textShadow: '2px 2px 4px rgba(0, 0, 0, 0.9)',
              background: 'rgba(255, 255, 255, 0.45)',
              border: '3px solid rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(12px)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.6)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.45)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.8)';
            }}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>

          {/* Sign Up Button */}
          <button
            onClick={handleSignIn}
            disabled={isLoading}
            className="group relative px-8 sm:px-16 py-4 sm:py-5 font-bold text-white uppercase tracking-widest transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed w-full sm:w-auto sm:min-w-[200px]"
            style={{
              fontSize: 'clamp(1rem, 2vw, 1.25rem)',
              textShadow: '2px 2px 4px rgba(0, 0, 0, 0.9)',
              background: 'rgba(255, 255, 255, 0.45)',
              border: '3px solid rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(12px)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.6)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.45)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.8)';
            }}
          >
            Sign Up
          </button>
        </div>
      </div>
    </div>
  );
}
