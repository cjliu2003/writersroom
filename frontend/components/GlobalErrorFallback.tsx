"use client"

import React from 'react'
import { AlertCircle, RefreshCw, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface GlobalErrorFallbackProps {
  error: Error
  resetError: () => void
}

/**
 * Global error fallback component for unhandled application errors
 * Provides user-friendly error messages and recovery options
 */
export default function GlobalErrorFallback({ error, resetError }: GlobalErrorFallbackProps) {
  const isChunkError = error.message?.includes('Loading chunk') ||
                      error.message?.includes('ChunkLoadError') ||
                      error.name === 'ChunkLoadError'

  const isDevelopment = process.env.NODE_ENV === 'development'

  const handleClearCacheAndReload = () => {
    // Clear all browser caches
    if ('caches' in window) {
      caches.keys().then(function(names) {
        for (let name of names) caches.delete(name)
      })
    }

    // Clear localStorage cache entries
    Object.keys(localStorage).forEach(key => {
      if (key.includes('cache') || key.includes('.next')) {
        localStorage.removeItem(key)
      }
    })

    // Force hard reload
    window.location.reload()
  }

  const handleGoHome = () => {
    window.location.href = '/'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-6">
      <div className="bg-slate-800/90 backdrop-blur border border-slate-600 rounded-xl shadow-2xl max-w-lg w-full p-8 text-center">
        {/* Error Icon */}
        <div className="text-red-400 mb-6">
          <AlertCircle className="w-16 h-16 mx-auto" />
        </div>

        {/* Error Title */}
        <h1 className="text-3xl font-bold text-white mb-4">
          {isChunkError ? 'Loading Error' : 'Application Error'}
        </h1>

        {/* Error Description */}
        <p className="text-slate-300 mb-6 leading-relaxed">
          {isChunkError
            ? 'There was a problem loading part of WritersRoom. This can happen when files are updated or due to network issues.'
            : 'An unexpected error occurred in WritersRoom. This might be temporary and could resolve with a refresh.'
          }
        </p>

        {/* Error Message for Development */}
        {isDevelopment && (
          <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4 mb-6 text-left">
            <h3 className="text-sm font-medium text-slate-400 mb-2">Error Details (Development)</h3>
            <pre className="text-xs text-red-300 overflow-auto max-h-32">
              {error.message}
            </pre>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3">
          <Button
            onClick={resetError}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-3"
            size="lg"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>

          {isChunkError && (
            <Button
              onClick={handleClearCacheAndReload}
              variant="outline"
              className="w-full border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 font-medium py-3"
              size="lg"
            >
              Clear Cache & Reload
            </Button>
          )}

          <Button
            onClick={handleGoHome}
            variant="outline"
            className="w-full border-slate-500 bg-slate-700/50 hover:bg-slate-700 text-slate-300 font-medium py-3"
            size="lg"
          >
            <Home className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </div>

        {/* Additional Help */}
        <div className="mt-8 text-sm text-slate-400">
          <p>
            If this problem persists, try:
          </p>
          <ul className="mt-2 text-xs space-y-1">
            <li>• Refreshing the page (Cmd+R / Ctrl+R)</li>
            <li>• Clearing your browser cache</li>
            <li>• Checking your internet connection</li>
          </ul>
        </div>
      </div>
    </div>
  )
}