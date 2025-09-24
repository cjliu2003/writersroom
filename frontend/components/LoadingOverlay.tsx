"use client"

import React, { useEffect, useState } from 'react'
import { Clapperboard, Clock } from 'lucide-react'

interface LoadingOverlayProps {
  isVisible: boolean
  title?: string
}

export default function LoadingOverlay({ isVisible, title }: LoadingOverlayProps) {
  const [progress, setProgress] = useState(0)
  const [currentStage, setCurrentStage] = useState(0)

  const stages = [
    "Uploading and parsing script",
    "Processing scenes",
    "Building structure",
    "Almost ready"
  ]

  useEffect(() => {
    if (!isVisible) {
      setProgress(0)
      setCurrentStage(0)
      return
    }

    // Simulated progress animation - more realistic
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) return 100
        const increment = Math.random() * 12 + 4 // 4-16% increments
        return Math.min(prev + increment, 100)
      })
    }, 800) // Balanced timing

    // Stage progression - slower to align with progress
    const stageInterval = setInterval(() => {
      setCurrentStage(prev => (prev + 1) % stages.length)
    }, 3000) // Slower stage progression

    return () => {
      clearInterval(progressInterval)
      clearInterval(stageInterval)
    }
  }, [isVisible, stages.length])

  if (!isVisible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-auto">
      {/* Full-screen overlay with gradient - blocks all interaction */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/80 via-gray-900/90 to-black/80 backdrop-blur-md pointer-events-auto" />

      {/* Cinematic loading content */}
      <div className="relative z-10 text-center animate-in fade-in duration-500">
        {/* Main loading icon */}
        <div className="relative mb-8">
          {/* Rotating outer ring */}
          <div className="absolute inset-0 w-32 h-32 mx-auto">
            <div className="w-full h-full border-4 border-transparent border-t-blue-500 border-r-purple-500
                          rounded-full animate-spin" />
          </div>

          {/* Inner pulsing circle */}
          <div className="relative w-32 h-32 mx-auto">
            <div className="absolute inset-4 bg-gradient-to-br from-blue-500/20 to-purple-600/20
                          rounded-full animate-pulse blur-sm" />
            <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-900
                          rounded-full flex items-center justify-center border border-gray-700
                          shadow-2xl shadow-blue-500/20">
              <Clapperboard className="w-12 h-12 text-blue-400 animate-pulse" />
            </div>
          </div>
        </div>

        {/* Loading text and progress */}
        <div className="space-y-6 max-w-md mx-auto">
          {/* Stage indicator */}
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-white tracking-tight">
              {stages[currentStage]}
              <span className="animate-pulse">...</span>
            </h2>

            {title && (
              <p className="text-gray-300 font-medium">
                {title}
              </p>
            )}
          </div>

          {/* Progress bar */}
          <div className="w-full">
            <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-purple-600
                         transition-all duration-700 ease-out rounded-full
                         shadow-lg shadow-blue-500/50"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between items-center mt-2 text-sm text-gray-400">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Processing
              </span>
              <span className="font-mono">{Math.round(progress)}%</span>
            </div>
          </div>

          {/* Subtle hint text */}
          <p className="text-gray-500 text-sm">
            Hang tight while we prepare your screenplay
          </p>
        </div>

        {/* Floating accent elements */}
        <div className="absolute -top-12 left-8 w-1 h-1 bg-blue-400 rounded-full animate-ping opacity-60"
             style={{ animationDelay: '0s' }} />
        <div className="absolute top-4 -right-6 w-0.5 h-0.5 bg-purple-400 rounded-full animate-ping opacity-40"
             style={{ animationDelay: '1s' }} />
        <div className="absolute -bottom-8 right-12 w-1.5 h-1.5 bg-blue-300 rounded-full animate-ping opacity-50"
             style={{ animationDelay: '2s' }} />
      </div>
    </div>
  )
}