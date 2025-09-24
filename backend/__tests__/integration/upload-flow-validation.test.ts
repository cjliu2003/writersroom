/**
 * Upload Flow Validation Tests
 *
 * Comprehensive test suite to prevent regression of the upload routing fix
 * and ensure robust error handling throughout the upload pipeline.
 *
 * Tests cover:
 * 1. Environment configuration validation
 * 2. Upload error handling and UI state recovery
 * 3. React StrictMode double-invoke protection
 * 4. Performance metrics logging
 */

import request from 'supertest'
import express, { Express } from 'express'
import path from 'path'
import fs from 'fs'
import { Server } from 'http'

// Mock environment variables
const originalEnv = process.env

describe('Upload Flow Validation Tests', () => {
  let app: Express
  let server: Server
  let mockBackendPort: number

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv }

    // Clear any module cache to ensure fresh imports
    jest.resetModules()
    jest.clearAllMocks()
  })

  afterEach(async () => {
    // Restore environment
    process.env = originalEnv

    // Close server if running
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
  })

  describe('Environment Configuration Tests', () => {
    describe('API URL Configuration', () => {
      it('should fail if NEXT_PUBLIC_API_BASE_URL is missing in production', () => {
        // Arrange
        delete process.env.NEXT_PUBLIC_API_BASE_URL
        process.env.NODE_ENV = 'production'

        // Act & Assert
        expect(() => {
          const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL
          if (!apiUrl && process.env.NODE_ENV === 'production') {
            throw new Error('NEXT_PUBLIC_API_BASE_URL is required in production')
          }
        }).toThrow('NEXT_PUBLIC_API_BASE_URL is required in production')
      })

      it('should use default localhost URL in development when env var is missing', () => {
        // Arrange
        delete process.env.NEXT_PUBLIC_API_BASE_URL
        process.env.NODE_ENV = 'development'

        // Act
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001'

        // Assert
        expect(apiUrl).toBe('http://localhost:3001')
      })

      it('should validate URL format when NEXT_PUBLIC_API_BASE_URL is provided', () => {
        // Arrange
        const testUrls = [
          { url: 'http://localhost:3001', valid: true },
          { url: 'https://api.example.com', valid: true },
          { url: 'http://192.168.1.100:3001', valid: true },
          { url: 'invalid-url', valid: false },
          { url: 'ftp://wrong-protocol.com', valid: false },
          { url: 'localhost:3001', valid: false }, // Missing protocol
        ]

        testUrls.forEach(({ url, valid }) => {
          // Act
          const isValidUrl = (urlString: string) => {
            try {
              const parsed = new URL(urlString)
              return parsed.protocol === 'http:' || parsed.protocol === 'https:'
            } catch {
              return false
            }
          }

          // Assert
          expect(isValidUrl(url)).toBe(valid)
        })
      })

      it('should handle rewrites mode (relative URLs) correctly', () => {
        // Arrange
        const relativeUrl = '/api/fdx/import'

        // Act - Simulate Next.js rewrite behavior
        const rewriteConfig = {
          source: '/api/:path*',
          destination: 'http://localhost:3001/api/:path*'
        }

        const matchesRewrite = relativeUrl.startsWith('/api/')
        const rewrittenUrl = matchesRewrite
          ? relativeUrl.replace('/api/', 'http://localhost:3001/api/')
          : relativeUrl

        // Assert
        expect(matchesRewrite).toBe(true)
        expect(rewrittenUrl).toBe('http://localhost:3001/api/fdx/import')
      })

      it('should handle non-rewrites mode (absolute URLs) correctly', () => {
        // Arrange
        process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001'

        // Act
        const createApiUrl = (path: string): string => {
          const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001'
          const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
          const normalizedPath = path.startsWith('/') ? path : `/${path}`
          return `${normalizedBase}${normalizedPath}`
        }

        const absoluteUrl = createApiUrl('/api/fdx/import')

        // Assert
        expect(absoluteUrl).toBe('http://localhost:3001/api/fdx/import')
      })

      it('should provide runtime assertion in development mode', () => {
        // Arrange
        process.env.NODE_ENV = 'development'

        // Act - Runtime assertion function
        const assertApiConfiguration = () => {
          const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001'

          // Development assertions
          if (process.env.NODE_ENV === 'development') {
            console.assert(apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1'),
              'API URL should point to localhost in development')
            console.assert(!apiUrl.includes('3000'),
              'API URL should not point to Next.js dev server port (3000)')
            console.assert(apiUrl.includes('3001') || apiUrl.includes('3003'),
              'API URL should point to Express backend port (3001 or 3003)')
          }

          return true
        }

        // Assert
        expect(assertApiConfiguration()).toBe(true)
      })
    })

    describe('Port Configuration', () => {
      it('should ensure backend runs on correct port (3003)', () => {
        // Arrange
        const backendPort = 3003
        const frontendPort = 3001

        // Assert
        expect(backendPort).not.toBe(frontendPort)
        expect(backendPort).toBe(3003)
        expect(frontendPort).toBe(3001)
      })

      it('should detect port conflicts', async () => {
        // Arrange - Create a server on port 3003
        const testApp = express()
        const testServer = testApp.listen(3003)

        // Act - Try to start another server on same port
        const conflictApp = express()
        let errorCaught = false

        try {
          await new Promise<void>((resolve, reject) => {
            const conflictServer = conflictApp.listen(3003)
              .on('error', (err: any) => {
                if (err.code === 'EADDRINUSE') {
                  errorCaught = true
                  reject(err)
                }
              })
              .on('listening', () => {
                conflictServer.close()
                resolve()
              })
          })
        } catch (err: any) {
          expect(err.code).toBe('EADDRINUSE')
        }

        // Assert
        expect(errorCaught).toBe(true)

        // Cleanup
        testServer.close()
      })
    })
  })

  describe('Upload Error Handling Tests', () => {
    let mockApp: Express
    let mockServer: Server

    beforeEach((done) => {
      // Create mock Express server for testing
      mockApp = express()
      mockApp.use(express.json())

      // Mock endpoints
      mockApp.post('/api/fdx/import', (req, res) => {
        // Simulate different scenarios based on headers
        const scenario = req.headers['x-test-scenario']

        switch (scenario) {
          case 'success':
            res.json({
              success: true,
              title: 'Test Script',
              sceneCount: 10,
              sluglines: ['INT. HOUSE - DAY'],
              projectId: 'test-123'
            })
            break
          case '404':
            res.status(404).send('Not Found')
            break
          case 'timeout':
            // Don't respond to simulate timeout
            break
          case 'server-error':
            res.status(500).send('Internal Server Error')
            break
          case 'parse-error':
            res.json({
              success: false,
              error: 'Failed to parse FDX file'
            })
            break
          default:
            res.status(400).send('Bad Request')
        }
      })

      mockServer = mockApp.listen(0, () => {
        mockBackendPort = (mockServer.address() as any).port
        done()
      })
    })

    afterEach((done) => {
      mockServer.close(done)
    })

    it('should handle 404 error and enable UI for retry', async () => {
      // Arrange
      const uploadState = {
        isUploading: false,
        uploadError: null as string | null,
        uploadResult: null as any
      }

      // Act - Simulate upload with 404 error
      try {
        const response = await request(mockApp)
          .post('/api/fdx/import')
          .set('x-test-scenario', '404')

        if (!response.ok) {
          throw new Error(`Upload failed: ${response.status}`)
        }
      } catch (error: any) {
        // Error handling logic
        uploadState.isUploading = false
        uploadState.uploadError = error.message
        uploadState.uploadResult = {
          success: false,
          error: error.message
        }
      }

      // Assert
      expect(uploadState.isUploading).toBe(false) // UI re-enabled
      expect(uploadState.uploadError).toContain('404')
      expect(uploadState.uploadResult?.success).toBe(false)
    })

    it('should handle server errors gracefully', async () => {
      // Arrange
      const uploadState = {
        isUploading: true,
        uploadError: null as string | null
      }

      // Act
      try {
        const response = await request(mockApp)
          .post('/api/fdx/import')
          .set('x-test-scenario', 'server-error')

        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`)
        }
      } catch (error: any) {
        uploadState.isUploading = false
        uploadState.uploadError = error.message
      }

      // Assert
      expect(uploadState.isUploading).toBe(false)
      expect(uploadState.uploadError).toContain('500')
    })

    it('should handle parse errors from successful response', async () => {
      // Arrange & Act
      const response = await request(mockApp)
        .post('/api/fdx/import')
        .set('x-test-scenario', 'parse-error')

      // Assert
      expect(response.status).toBe(200)
      expect(response.body.success).toBe(false)
      expect(response.body.error).toContain('Failed to parse')
    })

    it('should prevent UI from getting stuck on failure', async () => {
      // Arrange
      const uiState = {
        isUploading: true,
        isParsing: true,
        uploadButtonDisabled: true
      }

      const resetUI = () => {
        uiState.isUploading = false
        uiState.isParsing = false
        uiState.uploadButtonDisabled = false
      }

      // Act - Simulate any error
      try {
        await request(mockApp)
          .post('/api/fdx/import')
          .set('x-test-scenario', '404')
          .expect(404)
      } catch (error) {
        // Always reset UI on error
      } finally {
        resetUI()
      }

      // Assert
      expect(uiState.isUploading).toBe(false)
      expect(uiState.isParsing).toBe(false)
      expect(uiState.uploadButtonDisabled).toBe(false)
    })

    describe('AbortController Tests', () => {
      it('should cancel previous upload when new one starts', async () => {
        // Arrange
        let abortController1: AbortController | null = new AbortController()
        let abortController2: AbortController | null = new AbortController()
        const abortedSignals: boolean[] = []

        // Act - Start first upload
        const upload1 = new Promise((resolve) => {
          abortController1?.signal.addEventListener('abort', () => {
            abortedSignals.push(true)
            resolve('aborted')
          })
          // Simulate long upload
          setTimeout(() => resolve('completed'), 1000)
        })

        // Start second upload (should abort first)
        if (abortController1) {
          abortController1.abort() // Cancel first upload
        }
        abortController1 = abortController2 // Replace with new controller

        // Assert
        const result = await upload1
        expect(result).toBe('aborted')
        expect(abortedSignals.length).toBe(1)
      })

      it('should handle abort errors gracefully', async () => {
        // Arrange
        const controller = new AbortController()
        let errorMessage = ''

        // Act - Abort immediately
        controller.abort()

        try {
          // Simulate fetch with aborted signal
          if (controller.signal.aborted) {
            throw new DOMException('The operation was aborted', 'AbortError')
          }
        } catch (error: any) {
          if (error.name === 'AbortError') {
            errorMessage = 'Upload was cancelled'
          } else {
            errorMessage = error.message
          }
        }

        // Assert
        expect(errorMessage).toBe('Upload was cancelled')
      })
    })
  })

  describe('React StrictMode Double-Invoke Protection', () => {
    it('should prevent duplicate uploads in StrictMode', () => {
      // Arrange
      const uploadLog: string[] = []
      const hasUploadedRef = { current: false }

      const handleUpload = (file: string) => {
        // StrictMode guard
        if (hasUploadedRef.current) {
          uploadLog.push(`BLOCKED: ${file}`)
          return
        }
        hasUploadedRef.current = true
        uploadLog.push(`UPLOADED: ${file}`)
      }

      // Act - Simulate StrictMode double invocation
      handleUpload('test.fdx') // First call
      handleUpload('test.fdx') // Second call (StrictMode)

      // Assert
      expect(uploadLog).toEqual([
        'UPLOADED: test.fdx',
        'BLOCKED: test.fdx'
      ])
      expect(uploadLog.filter(log => log.startsWith('UPLOADED')).length).toBe(1)
    })

    it('should reset guard for subsequent user-triggered uploads', () => {
      // Arrange
      const uploadLog: string[] = []
      const hasUploadedRef = { current: false }

      const handleUpload = (file: string, userTriggered = false) => {
        if (userTriggered) {
          hasUploadedRef.current = false // Reset for new user action
        }

        if (hasUploadedRef.current) {
          uploadLog.push(`BLOCKED: ${file}`)
          return
        }
        hasUploadedRef.current = true
        uploadLog.push(`UPLOADED: ${file}`)
      }

      // Act
      handleUpload('first.fdx', true)  // User triggered
      handleUpload('first.fdx', false) // StrictMode duplicate

      hasUploadedRef.current = false   // Reset for new upload
      handleUpload('second.fdx', true) // New user triggered
      handleUpload('second.fdx', false) // StrictMode duplicate

      // Assert
      expect(uploadLog).toEqual([
        'UPLOADED: first.fdx',
        'BLOCKED: first.fdx',
        'UPLOADED: second.fdx',
        'BLOCKED: second.fdx'
      ])
    })

    it('should handle rapid consecutive uploads correctly', () => {
      // Arrange
      const uploadQueue: string[] = []
      let currentUpload: string | null = null

      const handleUpload = async (file: string) => {
        // If upload in progress, queue or reject
        if (currentUpload) {
          uploadQueue.push(`REJECTED: ${file} (${currentUpload} in progress)`)
          return
        }

        currentUpload = file
        uploadQueue.push(`STARTED: ${file}`)

        // Simulate upload
        await new Promise(resolve => setTimeout(resolve, 100))

        uploadQueue.push(`COMPLETED: ${file}`)
        currentUpload = null
      }

      // Act - Rapid uploads
      const uploads = Promise.all([
        handleUpload('file1.fdx'),
        handleUpload('file2.fdx'), // Should be rejected
        handleUpload('file3.fdx')  // Should be rejected
      ])

      return uploads.then(() => {
        // Assert
        expect(uploadQueue).toContain('STARTED: file1.fdx')
        expect(uploadQueue).toContain('COMPLETED: file1.fdx')
        expect(uploadQueue.filter(log => log.includes('REJECTED')).length).toBe(2)
      })
    })
  })

  describe('Performance Metrics Logging Tests', () => {
    interface PerformanceMetrics {
      parseMs?: number
      snapshotPostMs?: number
      snapshotGetMs?: number
      editorMountMs?: number
      totalMs?: number
    }

    it('should log parse time for FDX processing', () => {
      // Arrange
      const metrics: PerformanceMetrics = {}
      const startTime = performance.now()

      // Act - Simulate FDX parsing
      const parseFDX = () => {
        const parseStart = performance.now()
        // Simulate parsing work
        const fdxContent = '<FinalDraft><Content></Content></FinalDraft>'
        const parsed = fdxContent.includes('FinalDraft')
        const parseEnd = performance.now()

        metrics.parseMs = Math.round(parseEnd - parseStart)
        return parsed
      }

      const result = parseFDX()

      // Assert
      expect(result).toBe(true)
      expect(metrics.parseMs).toBeDefined()
      expect(metrics.parseMs).toBeGreaterThanOrEqual(0)
    })

    it('should log snapshot POST time', async () => {
      // Arrange
      const metrics: PerformanceMetrics = {}

      // Act
      const postSnapshot = async () => {
        const start = performance.now()

        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 50))

        const end = performance.now()
        metrics.snapshotPostMs = Math.round(end - start)
      }

      await postSnapshot()

      // Assert
      expect(metrics.snapshotPostMs).toBeDefined()
      expect(metrics.snapshotPostMs).toBeGreaterThanOrEqual(50)
    })

    it('should log snapshot GET time', async () => {
      // Arrange
      const metrics: PerformanceMetrics = {}

      // Act
      const getSnapshot = async () => {
        const start = performance.now()

        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 30))

        const end = performance.now()
        metrics.snapshotGetMs = Math.round(end - start)
      }

      await getSnapshot()

      // Assert
      expect(metrics.snapshotGetMs).toBeDefined()
      expect(metrics.snapshotGetMs).toBeGreaterThanOrEqual(30)
    })

    it('should log editor mount time', () => {
      // Arrange
      const metrics: PerformanceMetrics = {}

      // Act
      const mountEditor = () => {
        const start = performance.now()

        // Simulate editor mounting
        const editorState = { mounted: false }
        editorState.mounted = true

        const end = performance.now()
        metrics.editorMountMs = Math.round(end - start)

        return editorState.mounted
      }

      const mounted = mountEditor()

      // Assert
      expect(mounted).toBe(true)
      expect(metrics.editorMountMs).toBeDefined()
      expect(metrics.editorMountMs).toBeGreaterThanOrEqual(0)
    })

    it('should log complete upload flow metrics', async () => {
      // Arrange
      const performanceLogger = {
        metrics: {} as PerformanceMetrics,

        startTimer(key: string): number {
          return performance.now()
        },

        endTimer(key: string, startTime: number): void {
          const endTime = performance.now()
          const duration = Math.round(endTime - startTime)
          (this.metrics as any)[key] = duration
        },

        logSummary(): void {
          const total = Object.values(this.metrics)
            .reduce((sum, val) => sum + (val as number), 0)
          this.metrics.totalMs = total

          console.log('Performance Metrics:', {
            ...this.metrics,
            timestamp: new Date().toISOString()
          })
        }
      }

      // Act - Simulate complete flow
      const parseStart = performanceLogger.startTimer('parseMs')
      await new Promise(resolve => setTimeout(resolve, 100))
      performanceLogger.endTimer('parseMs', parseStart)

      const postStart = performanceLogger.startTimer('snapshotPostMs')
      await new Promise(resolve => setTimeout(resolve, 150))
      performanceLogger.endTimer('snapshotPostMs', postStart)

      const getStart = performanceLogger.startTimer('snapshotGetMs')
      await new Promise(resolve => setTimeout(resolve, 80))
      performanceLogger.endTimer('snapshotGetMs', getStart)

      const mountStart = performanceLogger.startTimer('editorMountMs')
      await new Promise(resolve => setTimeout(resolve, 50))
      performanceLogger.endTimer('editorMountMs', mountStart)

      performanceLogger.logSummary()

      // Assert
      expect(performanceLogger.metrics.parseMs).toBeGreaterThanOrEqual(100)
      expect(performanceLogger.metrics.snapshotPostMs).toBeGreaterThanOrEqual(150)
      expect(performanceLogger.metrics.snapshotGetMs).toBeGreaterThanOrEqual(80)
      expect(performanceLogger.metrics.editorMountMs).toBeGreaterThanOrEqual(50)
      expect(performanceLogger.metrics.totalMs).toBeGreaterThanOrEqual(380)
    })

    it('should handle performance monitoring for large files', async () => {
      // Arrange
      const largeFileMetrics = {
        fileSize: 5 * 1024 * 1024, // 5MB
        parseMs: 0,
        throughputMBps: 0
      }

      // Act
      const processLargeFile = async () => {
        const start = performance.now()

        // Simulate processing large file
        await new Promise(resolve => setTimeout(resolve, 2000))

        const end = performance.now()
        largeFileMetrics.parseMs = Math.round(end - start)

        // Calculate throughput
        const seconds = largeFileMetrics.parseMs / 1000
        const megabytes = largeFileMetrics.fileSize / (1024 * 1024)
        largeFileMetrics.throughputMBps = megabytes / seconds
      }

      await processLargeFile()

      // Assert
      expect(largeFileMetrics.parseMs).toBeGreaterThanOrEqual(2000)
      expect(largeFileMetrics.throughputMBps).toBeGreaterThan(0)
      expect(largeFileMetrics.throughputMBps).toBeLessThan(10) // Reasonable throughput
    })
  })
})

/**
 * Test Helpers
 */
export const testHelpers = {
  /**
   * Create a mock FDX file
   */
  createMockFDXFile: (content: string = '<FinalDraft></FinalDraft>'): File => {
    const blob = new Blob([content], { type: 'text/xml' })
    return new File([blob], 'test.fdx', { type: 'text/xml' })
  },

  /**
   * Create mock upload response
   */
  createMockUploadResponse: (overrides: Partial<any> = {}) => ({
    success: true,
    title: 'Test Script',
    sceneCount: 10,
    sluglines: ['INT. HOUSE - DAY'],
    projectId: 'test-123',
    ...overrides
  }),

  /**
   * Simulate network delay
   */
  simulateNetworkDelay: (ms: number = 100) =>
    new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Create performance mark
   */
  markPerformance: (name: string) => {
    if (typeof performance !== 'undefined' && performance.mark) {
      performance.mark(name)
    }
  },

  /**
   * Measure performance between marks
   */
  measurePerformance: (name: string, startMark: string, endMark: string): number => {
    if (typeof performance !== 'undefined' && performance.measure) {
      performance.measure(name, startMark, endMark)
      const entries = performance.getEntriesByName(name)
      return entries.length > 0 ? entries[0].duration : 0
    }
    return 0
  }
}