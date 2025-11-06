"use client"

import React, { useEffect } from 'react'
import { preloadCriticalChunks } from '@/hooks/useChunkRetry'

interface ChunkRetryProviderProps {
  children: React.ReactNode
}

/**
 * Provider component that enables global chunk loading error handling
 * and preloads critical chunks for better reliability
 */
export default function ChunkRetryProvider({ children }: ChunkRetryProviderProps) {
  useEffect(() => {
    // Note: preloadCriticalChunks() disabled to prevent preload warnings
    // Next.js handles chunk loading automatically
    // preloadCriticalChunks()

    // Set up global error handler for chunk loading failures
    const handleGlobalError = (event: ErrorEvent) => {
      if (event.error && (
        event.error.name === 'ChunkLoadError' ||
        event.message?.includes('Loading chunk') ||
        event.message?.includes('ChunkLoadError')
      )) {
        console.error('🚨 Global chunk loading error:', event.error)

        // The useChunkRetry hook in individual components will handle retries
        // This is just for logging and monitoring
      }
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (event.reason && (
        event.reason.name === 'ChunkLoadError' ||
        event.reason.message?.includes('Loading chunk') ||
        event.reason.message?.includes('ChunkLoadError')
      )) {
        console.error('🚨 Global unhandled chunk loading rejection:', event.reason)
      }
    }

    window.addEventListener('error', handleGlobalError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.removeEventListener('error', handleGlobalError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  return <>{children}</>
}