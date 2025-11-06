"use client"

import { useEffect } from 'react'

/**
 * Hook to handle chunk loading failures with automatic retry mechanism
 * Listens for global chunk loading errors and attempts to reload the page
 */
export function useChunkRetry() {
  useEffect(() => {
    let retryCount = 0
    const maxRetries = 3
    const retryDelay = 1000

    const handleChunkError = (event: Event) => {
      // Check if this is a chunk loading error
      const error = (event as any)?.error || (event as any)?.reason

      if (error && (
        error.message?.includes('Loading chunk') ||
        error.message?.includes('ChunkLoadError') ||
        error.name === 'ChunkLoadError'
      )) {
        console.warn('🚨 Chunk loading error detected:', error.message)

        if (retryCount < maxRetries) {
          retryCount++
          console.log(`🔄 Retrying chunk load (${retryCount}/${maxRetries}) in ${retryDelay}ms`)

          setTimeout(() => {
            window.location.reload()
          }, retryDelay * retryCount) // Progressive delay
        } else {
          console.error('❌ Max retry attempts reached for chunk loading')
        }
      }
    }

    // Listen for unhandled promise rejections (common with chunk loading failures)
    window.addEventListener('unhandledrejection', handleChunkError)

    // Listen for general script loading errors
    window.addEventListener('error', handleChunkError)

    return () => {
      window.removeEventListener('unhandledrejection', handleChunkError)
      window.removeEventListener('error', handleChunkError)
    }
  }, [])
}

/**
 * Preload critical chunks to reduce the chance of loading failures
 * Note: Disabled by default to prevent preload warnings for dynamic chunks
 * Enable only if you're experiencing frequent chunk loading failures
 */
export function preloadCriticalChunks() {
  if (typeof window === 'undefined') return

  // Commented out to prevent "preload not used" warnings
  // Next.js handles chunk loading automatically and these paths may not exist
  // Uncomment only if experiencing frequent chunk loading errors

  // const criticalPaths = [
  //   '/_next/static/chunks/webpack.js',
  //   '/_next/static/chunks/main-app.js',
  //   '/_next/static/chunks/app/layout.js',
  //   '/_next/static/chunks/app-pages-internals.js'
  // ]

  // criticalPaths.forEach(path => {
  //   const link = document.createElement('link')
  //   link.rel = 'preload'
  //   link.as = 'script'
  //   link.href = path
  //   document.head.appendChild(link)
  // })
}

export default useChunkRetry