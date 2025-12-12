"use client"

import React, { useEffect, useState } from 'react'
import { Clapperboard } from 'lucide-react'

interface ProcessingScreenProps {
  isVisible: boolean
  message?: string
  subtitle?: string
  mode?: 'upload' | 'open'
}

export default function ProcessingScreen({
  isVisible,
  message,
  subtitle,
  mode = 'upload'
}: ProcessingScreenProps) {
  const [shouldRender, setShouldRender] = useState(isVisible)
  const [isAnimatingOut, setIsAnimatingOut] = useState(false)

  // Default messages based on mode
  const defaultMessage = mode === 'upload' ? "Processing your screenplay" : "Opening your script"
  const defaultSubtitle = mode === 'upload' ? "preparing your workspace…" : "setting the stage…"

  const displayMessage = message || defaultMessage
  const displaySubtitle = subtitle || defaultSubtitle

  useEffect(() => {
    if (isVisible) {
      setShouldRender(true)
      setIsAnimatingOut(false)
    } else if (shouldRender) {
      // Start fade-out animation
      setIsAnimatingOut(true)
      // Remove from DOM after animation completes
      const timer = setTimeout(() => {
        setShouldRender(false)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [isVisible, shouldRender])

  if (!shouldRender) return null

  return (
    <div
      className={`
        fixed inset-0 z-[100]
        bg-gradient-to-b from-white to-slate-50 dark:from-slate-900 dark:to-black
        flex items-center justify-center
        transition-all duration-500 ease-out
        ${isAnimatingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'}
      `}
    >
      <div className="flex flex-col items-center px-8 py-24 sm:py-32">
        {/* Icon with animated glow */}
        <div className="relative mb-10">
          {/* Outer pulsing glow ring */}
          <div
            className="absolute -inset-4 rounded-3xl bg-purple-200/40 dark:bg-purple-800/20 blur-2xl"
            style={{ animation: 'pulseGlow 2s ease-in-out infinite' }}
          />
          {/* Inner breathing glow */}
          <div
            className="absolute inset-0 rounded-2xl bg-purple-100/60 dark:bg-purple-900/20 blur-xl"
            style={{ animation: 'breathe 1.5s ease-in-out infinite' }}
          />
          <div className="relative w-24 h-24 rounded-2xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center backdrop-blur-xl border border-purple-200/50 dark:border-purple-800/30 shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
            <Clapperboard
              className="w-12 h-12 text-purple-600 dark:text-purple-400 drop-shadow-[0_0_8px_rgba(147,51,234,0.25)]"
              strokeWidth={1.5}
              style={{ animation: 'gentleFloat 2s ease-in-out infinite' }}
            />
          </div>
        </div>

        {/* Text content */}
        <div className="text-center space-y-4 max-w-md">
          <h1
            className="text-2xl md:text-3xl font-normal tracking-wide text-gray-800 dark:text-gray-100"
            style={{ letterSpacing: '0.05em', animation: 'fadeInUp 0.6s ease-out' }}
          >
            {displayMessage}
          </h1>

          {/* Animated loading dots */}
          <div className="flex items-center justify-center gap-1.5 py-2">
            <span
              className="w-1.5 h-1.5 rounded-full bg-purple-400"
              style={{ animation: 'loadingDot 1.4s ease-in-out infinite', animationDelay: '0s' }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-purple-400"
              style={{ animation: 'loadingDot 1.4s ease-in-out infinite', animationDelay: '0.2s' }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-purple-400"
              style={{ animation: 'loadingDot 1.4s ease-in-out infinite', animationDelay: '0.4s' }}
            />
          </div>

          <p
            className="text-sm md:text-base text-gray-500 dark:text-gray-400 font-light tracking-wider lowercase"
            style={{ letterSpacing: '0.08em', animation: 'fadeInUp 0.8s ease-out', fontFamily: 'var(--font-courier-prime), "Courier New", monospace' }}
          >
            {displaySubtitle}
          </p>
        </div>
      </div>

      {/* Keyframe animations */}
      <style jsx>{`
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.05); }
        }
        @keyframes breathe {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.02); }
        }
        @keyframes gentleFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes loadingDot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </div>
  )
}
