"use client"

import { useEffect } from "react"
import { preloadCriticalChunks } from "@/hooks/useChunkRetry"

export default function GlobalChunkGuard() {
  useEffect(() => {
    let retryCount = 0
    const maxRetries = 3

    const handler = (event: any) => {
      const error = event?.error || event?.reason
      const msg = error?.message || String(error || "")
      const isChunkError =
        msg.includes("Loading chunk") ||
        msg.includes("ChunkLoadError") ||
        error?.name === "ChunkLoadError"

      if (!isChunkError) return

      console.warn("🚨 Global chunk load error detected:", msg)
      // Try progressive retries
      if (retryCount < maxRetries) {
        retryCount += 1
        const delay = 1000 * retryCount
        console.log(`🔄 Retrying app load (${retryCount}/${maxRetries}) in ${delay}ms`)
        setTimeout(() => {
          // Prefer a soft reload first
          try {
            if (typeof window !== 'undefined' && window.location) {
              window.location.reload()
            }
          } catch (e) {
            // no-op
          }
        }, delay)
      }
    }

    // Note: preloadCriticalChunks() disabled to prevent preload warnings
    // Next.js handles chunk loading automatically
    // Uncomment only if experiencing frequent chunk loading errors
    // preloadCriticalChunks()

    window.addEventListener("unhandledrejection", handler)
    window.addEventListener("error", handler)
    return () => {
      window.removeEventListener("unhandledrejection", handler)
      window.removeEventListener("error", handler)
    }
  }, [])

  return null
}
