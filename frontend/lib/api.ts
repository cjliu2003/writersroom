/**
 * Centralized API utilities for consistent backend communication
 * Fixes the critical bug where uploads hit Next.js dev server instead of Express API
 */

// Get the API base URL from environment with fallback
const getApiBaseUrl = (): string => {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3003'

  // Ensure no trailing slash
  const normalizedUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl

  // Validate the URL format
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    console.warn(`⚠️ Invalid API base URL: ${normalizedUrl}. Using default.`)
    return 'http://localhost:3003'
  }

  return normalizedUrl
}

export const API_BASE_URL = getApiBaseUrl()

/**
 * Create an absolute API URL
 * @param path - API path (e.g., '/api/fdx/import')
 * @returns Full URL to Express backend
 */
export const createApiUrl = (path: string): string => {
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL}${normalizedPath}`
}

/**
 * Enhanced fetch wrapper with error handling and timeout
 * @param url - API URL
 * @param options - Fetch options
 * @param timeout - Request timeout in milliseconds (default: 30s)
 * @returns Promise<Response>
 */
export const apiFetch = async (
  url: string,
  options: RequestInit = {},
  timeout: number = 30000
): Promise<Response> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    // Enhanced error logging
    if (!response.ok) {
      console.error(`🚫 API Error: ${response.status} ${response.statusText} for ${url}`)
      if (response.status === 404) {
        console.error(`❌ Route not found. Check if Express backend is running on correct port.`)
        console.error(`   Expected: ${API_BASE_URL}`)
        console.error(`   Actual URL: ${url}`)
      }
    }

    return response
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout - please try again')
    }

    // Enhanced error logging for network issues
    if (error instanceof Error) {
      console.error(`🔌 Network Error: ${error.message} for ${url}`)
      console.error(`   Check if Express backend is running on ${API_BASE_URL}`)
    }

    throw error
  }
}

/**
 * Upload FDX file via Next.js API route (which then calls backend for storage)
 * The Next.js route handles FDX parsing, then stores to Express backend
 * @param file - FDX file to upload
 * @param onProgress - Optional progress callback
 * @returns Upload result
 */
export const uploadFdxFile = async (
  file: File,
  onProgress?: (progress: number) => void
): Promise<any> => {
  const formData = new FormData()
  formData.append('fdx', file)

  // Use Next.js API route for FDX parsing (it will store to Express backend)
  const url = '/api/fdx/import'

  console.log(`🌐 Uploading FDX via Next.js route: ${url}`)
  console.log(`📁 File: ${file.name} (${file.size} bytes)`)
  console.log(`🔧 This route will parse FDX and store data in backend on port 3003`)

  const response = await apiFetch(url, {
    method: 'POST',
    body: formData,
    // Add timeout for large files
  }, 60000) // 60 second timeout for uploads

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Upload failed: ${response.status} ${errorText}`)
  }

  const result = await response.json()

  if (!result.success) {
    throw new Error(result.error || 'Upload failed')
  }

  console.log(`✅ FDX upload successful: ${result.title} (${result.sceneCount} scenes)`)
  return result
}

/**
 * Fetch project snapshot from backend
 * @param projectId - Project ID
 * @returns Project snapshot
 */
export const fetchProjectSnapshot = async (projectId: string): Promise<any> => {
  const url = createApiUrl(`/api/projects/${projectId}/snapshot`)

  console.log(`🔍 Fetching project snapshot: ${url}`)

  const response = await apiFetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch project: ${response.status}`)
  }

  return response.json()
}

/**
 * Store project snapshot to backend
 * @param projectId - Project ID
 * @param snapshotData - Snapshot data to store
 * @returns Storage result
 */
export const storeProjectSnapshot = async (
  projectId: string,
  snapshotData: any
): Promise<any> => {
  const url = createApiUrl(`/api/projects/${projectId}/snapshot`)

  console.log(`💾 Storing project snapshot: ${url}`)

  const response = await apiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(snapshotData)
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to store project: ${response.status} ${errorText}`)
  }

  return response.json()
}

// Log the configuration for debugging
console.log(`🔧 API Configuration:`)
console.log(`   Express Backend: ${API_BASE_URL}`)
console.log(`   Environment: ${process.env.NODE_ENV}`)
console.log(`   FDX Upload: /api/fdx/import (Next.js route -> Express backend)`)
console.log(`   Memory API: ${createApiUrl('/api/memory')}`)
console.log(`   Snapshot API: ${createApiUrl('/api/projects')}`)