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
        fixed inset-0 z-50 flex flex-col items-center justify-center
        bg-gradient-to-b from-white to-slate-50
        dark:from-slate-900 dark:to-black
        transition-all duration-500 ease-out
        ${isAnimatingOut ? 'opacity-0' : 'opacity-100'}
      `}
      style={{
        fontFamily: 'var(--font-courier-prime), "Courier New", monospace'
      }}
    >
      {/* Paper vignette overlay - subtle radial gradient like homepage cards */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.02)_100%)] dark:bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.4)_100%)] pointer-events-none" />

      {/* Main content - matching homepage card proportions */}
      <div className="relative z-10 flex flex-col items-center px-8 py-24 sm:py-32">
        {/* Icon container - matching homepage purple icon style */}
        <div className="relative mb-10">
          {/* Soft glow behind icon */}
          <div
            className="absolute inset-0 rounded-2xl bg-purple-100/60 dark:bg-purple-900/20 blur-xl opacity-60"
            style={{
              animation: 'gentlePulse 3s ease-in-out infinite'
            }}
          />

          {/* Icon background - matching homepage icon containers */}
          <div className="relative w-24 h-24 rounded-2xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center backdrop-blur-xl border border-purple-200/50 dark:border-purple-800/30 shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
            <Clapperboard
              className="w-12 h-12 text-purple-600 dark:text-purple-400 drop-shadow-[0_0_8px_rgba(147,51,234,0.25)]"
              strokeWidth={1.5}
              style={{
                animation: 'gentleFloat 3s ease-in-out infinite'
              }}
            />
          </div>
        </div>

        {/* Text content - matching homepage typography */}
        <div className="text-center space-y-3 max-w-md">
          {/* Main message - screenplay typography */}
          <h1
            className="text-2xl md:text-3xl font-normal tracking-wide text-gray-800 dark:text-gray-100"
            style={{
              letterSpacing: '0.05em',
              animation: 'fadeInUp 0.6s ease-out'
            }}
          >
            {displayMessage}
          </h1>

          {/* Subtitle - soft, minimal */}
          <p
            className="text-sm md:text-base text-gray-500 dark:text-gray-400 font-light tracking-wider lowercase"
            style={{
              letterSpacing: '0.08em',
              animation: 'fadeInUp 0.8s ease-out'
            }}
          >
            {displaySubtitle}
          </p>
        </div>

        {/* Minimal loading dots - soft fade animation */}
        <div className="flex gap-2 mt-10">
          <div
            className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"
            style={{
              animation: 'dotFade 1.8s ease-in-out infinite',
              animationDelay: '0s'
            }}
          />
          <div
            className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"
            style={{
              animation: 'dotFade 1.8s ease-in-out infinite',
              animationDelay: '0.4s'
            }}
          />
          <div
            className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"
            style={{
              animation: 'dotFade 1.8s ease-in-out infinite',
              animationDelay: '0.8s'
            }}
          />
        </div>
      </div>

      {/* Inline keyframe animations - matching homepage smoothness */}
      <style jsx>{`
        @keyframes gentleFloat {
          0%, 100% {
            transform: translateY(0px) rotate(0deg);
          }
          50% {
            transform: translateY(-6px) rotate(1deg);
          }
        }

        @keyframes gentlePulse {
          0%, 100% {
            opacity: 0.6;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.05);
          }
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes dotFade {
          0%, 100% {
            opacity: 0.2;
          }
          50% {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  )
}
