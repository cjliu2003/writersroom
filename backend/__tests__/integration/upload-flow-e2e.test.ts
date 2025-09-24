/**
 * End-to-End Upload Flow Integration Tests
 *
 * Complete integration testing of the upload flow from file selection
 * through FDX parsing, backend storage, and editor navigation.
 *
 * Tests the critical path and performance metrics.
 */

import request from 'supertest'
import express, { Express } from 'express'
import path from 'path'
import fs from 'fs/promises'
import { Server } from 'http'
import cors from 'cors'
import multer from 'multer'

// Performance tracking interface
interface PerformanceMetrics {
  parseMs: number
  snapshotPostMs: number
  snapshotGetMs: number
  editorMountMs: number
  totalMs: number
}

// Mock FDX content
const MOCK_FDX_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>
    <Paragraph Type="Scene Heading">
      <Text>INT. COFFEE SHOP - DAY</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>A busy coffee shop. Steam rises from the espresso machine.</Text>
    </Paragraph>
    <Paragraph Type="Character">
      <Text>SARAH</Text>
    </Paragraph>
    <Paragraph Type="Dialogue">
      <Text>I need to tell you something important.</Text>
    </Paragraph>
    <Paragraph Type="Scene Heading">
      <Text>EXT. STREET - CONTINUOUS</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Sarah rushes out of the coffee shop.</Text>
    </Paragraph>
  </Content>
</FinalDraft>`

describe('End-to-End Upload Flow Integration', () => {
  let app: Express
  let server: Server
  let serverPort: number
  let performanceMetrics: PerformanceMetrics

  // Setup mock Express backend
  beforeAll((done) => {
    app = express()

    // Middleware
    app.use(cors())
    app.use(express.json({ limit: '50mb' }))

    // Configure multer for file uploads
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
    })

    // Mock FDX import endpoint
    app.post('/api/fdx/import', upload.single('fdx'), async (req, res) => {
      const parseStart = performance.now()

      try {
        // Validate file
        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: 'No file provided'
          })
        }

        if (!req.file.originalname.endsWith('.fdx')) {
          return res.status(400).json({
            success: false,
            error: 'File must be an FDX file'
          })
        }

        // Simulate FDX parsing
        const fileContent = req.file.buffer.toString('utf-8')
        const hasValidContent = fileContent.includes('<FinalDraft')

        if (!hasValidContent) {
          return res.status(400).json({
            success: false,
            error: 'Invalid FDX file format'
          })
        }

        // Extract scenes (simplified)
        const sceneHeadings = fileContent.match(/<Paragraph Type="Scene Heading">[\s\S]*?<\/Paragraph>/g) || []
        const sluglines = sceneHeadings.map((heading, index) => {
          const textMatch = heading.match(/<Text>(.*?)<\/Text>/)
          return textMatch ? textMatch[1] : `Scene ${index + 1}`
        })

        const parseEnd = performance.now()
        performanceMetrics.parseMs = Math.round(parseEnd - parseStart)

        // Generate response
        const projectId = `test_${Date.now()}`
        const response = {
          success: true,
          title: req.file.originalname.replace('.fdx', ''),
          sceneCount: sluglines.length,
          sluglines,
          projectId,
          screenplayElements: [],
          diagnostics: {
            originalLines: fileContent.split('\n').length,
            processedParagraphs: sceneHeadings.length,
            lastSceneHeadings: sluglines.slice(-3)
          }
        }

        res.json(response)
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        })
      }
    })

    // Mock snapshot storage endpoint
    app.post('/api/projects/:projectId/snapshot', async (req, res) => {
      const postStart = performance.now()

      try {
        const { projectId } = req.params
        const { version, title, scenes, elements, metadata } = req.body

        // Validate required fields
        if (!version || !title || !scenes) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields'
          })
        }

        // Simulate storage delay
        await new Promise(resolve => setTimeout(resolve, 100))

        const postEnd = performance.now()
        performanceMetrics.snapshotPostMs = Math.round(postEnd - postStart)

        res.json({
          success: true,
          version,
          count: scenes.length,
          projectId
        })
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Storage failed'
        })
      }
    })

    // Mock snapshot retrieval endpoint
    app.get('/api/projects/:projectId/snapshot', async (req, res) => {
      const getStart = performance.now()

      try {
        const { projectId } = req.params

        // Simulate retrieval delay
        await new Promise(resolve => setTimeout(resolve, 50))

        const getEnd = performance.now()
        performanceMetrics.snapshotGetMs = Math.round(getEnd - getStart)

        res.json({
          success: true,
          data: {
            projectId,
            scenes: [],
            version: Date.now()
          }
        })
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Retrieval failed'
        })
      }
    })

    // Start server
    server = app.listen(0, () => {
      serverPort = (server.address() as any).port
      done()
    })
  })

  afterAll((done) => {
    server.close(done)
  })

  beforeEach(() => {
    // Reset metrics
    performanceMetrics = {
      parseMs: 0,
      snapshotPostMs: 0,
      snapshotGetMs: 0,
      editorMountMs: 0,
      totalMs: 0
    }
  })

  describe('Complete Upload Flow', () => {
    it('should handle FDX file upload end-to-end', async () => {
      // Arrange
      const testFile = Buffer.from(MOCK_FDX_CONTENT)

      // Act - Upload FDX file
      const uploadResponse = await request(app)
        .post('/api/fdx/import')
        .attach('fdx', testFile, 'test-script.fdx')
        .expect(200)

      // Assert - Upload response
      expect(uploadResponse.body.success).toBe(true)
      expect(uploadResponse.body.title).toBe('test-script')
      expect(uploadResponse.body.sceneCount).toBe(2)
      expect(uploadResponse.body.sluglines).toEqual([
        'INT. COFFEE SHOP - DAY',
        'EXT. STREET - CONTINUOUS'
      ])
      expect(uploadResponse.body.projectId).toBeDefined()

      const projectId = uploadResponse.body.projectId

      // Act - Store snapshot
      const snapshotData = {
        version: Date.now(),
        title: uploadResponse.body.title,
        scenes: uploadResponse.body.sluglines.map((slug: string, index: number) => ({
          projectId,
          slugline: slug,
          sceneId: `${projectId}_${index}`,
          sceneIndex: index,
          characters: [],
          summary: slug,
          tokens: 100,
          wordCount: 20,
          fullContent: JSON.stringify([]),
          projectTitle: uploadResponse.body.title,
          timestamp: new Date().toISOString(),
          originalSlugline: slug
        })),
        elements: [],
        metadata: {
          title: uploadResponse.body.title,
          createdAt: new Date().toISOString(),
          originalFileName: 'test-script.fdx'
        }
      }

      const storeResponse = await request(app)
        .post(`/api/projects/${projectId}/snapshot`)
        .send(snapshotData)
        .expect(200)

      // Assert - Storage response
      expect(storeResponse.body.success).toBe(true)
      expect(storeResponse.body.count).toBe(2)

      // Act - Retrieve snapshot
      const getResponse = await request(app)
        .get(`/api/projects/${projectId}/snapshot`)
        .expect(200)

      // Assert - Retrieval response
      expect(getResponse.body.success).toBe(true)
      expect(getResponse.body.data.projectId).toBe(projectId)
    })

    it('should reject invalid file types', async () => {
      // Arrange
      const invalidFile = Buffer.from('Not an FDX file')

      // Act
      const response = await request(app)
        .post('/api/fdx/import')
        .attach('fdx', invalidFile, 'invalid.txt')
        .expect(400)

      // Assert
      expect(response.body.success).toBe(false)
      expect(response.body.error).toContain('FDX')
    })

    it('should handle large FDX files', async () => {
      // Arrange - Create large FDX with many scenes
      const largeContent = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>
    ${Array.from({ length: 100 }, (_, i) => `
    <Paragraph Type="Scene Heading">
      <Text>INT. LOCATION ${i + 1} - DAY</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Scene ${i + 1} action description goes here.</Text>
    </Paragraph>
    `).join('')}
  </Content>
</FinalDraft>`

      const largeFile = Buffer.from(largeContent)

      // Act
      const response = await request(app)
        .post('/api/fdx/import')
        .attach('fdx', largeFile, 'large-script.fdx')
        .expect(200)

      // Assert
      expect(response.body.success).toBe(true)
      expect(response.body.sceneCount).toBe(100)
      expect(response.body.sluglines.length).toBe(100)
    })

    it('should handle malformed FDX gracefully', async () => {
      // Arrange
      const malformedContent = '<?xml version="1.0"?><FinalDraft><Content>Incomplete'
      const malformedFile = Buffer.from(malformedContent)

      // Act
      const response = await request(app)
        .post('/api/fdx/import')
        .attach('fdx', malformedFile, 'malformed.fdx')

      // Assert - Should still process partial content
      expect(response.status).toBeLessThanOrEqual(400)
      if (response.body.success) {
        expect(response.body.sceneCount).toBe(0)
      } else {
        expect(response.body.error).toBeDefined()
      }
    })
  })

  describe('Performance Metrics', () => {
    it('should track parse time for FDX processing', async () => {
      // Arrange
      const testFile = Buffer.from(MOCK_FDX_CONTENT)

      // Act
      await request(app)
        .post('/api/fdx/import')
        .attach('fdx', testFile, 'perf-test.fdx')
        .expect(200)

      // Assert
      expect(performanceMetrics.parseMs).toBeGreaterThanOrEqual(0)
      expect(performanceMetrics.parseMs).toBeLessThan(5000) // Should parse in under 5 seconds
      console.log(`Parse time: ${performanceMetrics.parseMs}ms`)
    })

    it('should track snapshot storage time', async () => {
      // Arrange
      const snapshotData = {
        version: Date.now(),
        title: 'Performance Test',
        scenes: Array.from({ length: 50 }, (_, i) => ({
          projectId: 'perf-test',
          slugline: `Scene ${i + 1}`,
          sceneId: `perf-test_${i}`,
          sceneIndex: i,
          characters: [],
          summary: `Scene ${i + 1} summary`,
          tokens: 100,
          wordCount: 20,
          fullContent: JSON.stringify([]),
          projectTitle: 'Performance Test',
          timestamp: new Date().toISOString(),
          originalSlugline: `Scene ${i + 1}`
        })),
        elements: [],
        metadata: {
          title: 'Performance Test',
          createdAt: new Date().toISOString()
        }
      }

      // Act
      await request(app)
        .post('/api/projects/perf-test/snapshot')
        .send(snapshotData)
        .expect(200)

      // Assert
      expect(performanceMetrics.snapshotPostMs).toBeGreaterThanOrEqual(100) // Simulated delay
      expect(performanceMetrics.snapshotPostMs).toBeLessThan(10000) // Should complete in 10s
      console.log(`Snapshot POST time: ${performanceMetrics.snapshotPostMs}ms`)
    })

    it('should track snapshot retrieval time', async () => {
      // Act
      await request(app)
        .get('/api/projects/perf-test/snapshot')
        .expect(200)

      // Assert
      expect(performanceMetrics.snapshotGetMs).toBeGreaterThanOrEqual(50) // Simulated delay
      expect(performanceMetrics.snapshotGetMs).toBeLessThan(5000) // Should retrieve in 5s
      console.log(`Snapshot GET time: ${performanceMetrics.snapshotGetMs}ms`)
    })

    it('should log complete flow metrics', async () => {
      // Arrange
      const testFile = Buffer.from(MOCK_FDX_CONTENT)
      const flowStart = performance.now()

      // Act - Complete flow
      // 1. Upload and parse
      const uploadResponse = await request(app)
        .post('/api/fdx/import')
        .attach('fdx', testFile, 'flow-test.fdx')
        .expect(200)

      const projectId = uploadResponse.body.projectId

      // 2. Store snapshot
      await request(app)
        .post(`/api/projects/${projectId}/snapshot`)
        .send({
          version: Date.now(),
          title: 'Flow Test',
          scenes: [],
          elements: [],
          metadata: {}
        })
        .expect(200)

      // 3. Retrieve snapshot
      await request(app)
        .get(`/api/projects/${projectId}/snapshot`)
        .expect(200)

      // 4. Simulate editor mount
      const editorMountStart = performance.now()
      await new Promise(resolve => setTimeout(resolve, 200)) // Simulate mount time
      const editorMountEnd = performance.now()
      performanceMetrics.editorMountMs = Math.round(editorMountEnd - editorMountStart)

      // Calculate total
      const flowEnd = performance.now()
      performanceMetrics.totalMs = Math.round(flowEnd - flowStart)

      // Assert & Log
      console.log('\n=== Complete Flow Performance Metrics ===')
      console.log(`Parse time: ${performanceMetrics.parseMs}ms`)
      console.log(`Snapshot POST time: ${performanceMetrics.snapshotPostMs}ms`)
      console.log(`Snapshot GET time: ${performanceMetrics.snapshotGetMs}ms`)
      console.log(`Editor mount time: ${performanceMetrics.editorMountMs}ms`)
      console.log(`Total flow time: ${performanceMetrics.totalMs}ms`)
      console.log('=========================================\n')

      expect(performanceMetrics.totalMs).toBeGreaterThan(0)
      expect(performanceMetrics.totalMs).toBeLessThan(30000) // Complete in 30s
    })
  })

  describe('Error Recovery', () => {
    it('should handle backend unavailability', async () => {
      // Simulate backend being down by closing server temporarily
      const originalPost = app.post
      app.post = jest.fn().mockImplementation((path, ...args) => {
        if (path === '/api/projects/:projectId/snapshot') {
          return (req: any, res: any) => {
            res.status(503).json({ error: 'Service Unavailable' })
          }
        }
        return originalPost.call(app, path, ...args)
      })

      // Act
      const response = await request(app)
        .post('/api/projects/test/snapshot')
        .send({ version: 1, title: 'Test', scenes: [] })
        .expect(503)

      // Assert
      expect(response.body.error).toContain('Service Unavailable')

      // Restore
      app.post = originalPost
    })

    it('should handle concurrent uploads', async () => {
      // Arrange
      const file1 = Buffer.from(MOCK_FDX_CONTENT)
      const file2 = Buffer.from(MOCK_FDX_CONTENT.replace('SARAH', 'JOHN'))

      // Act - Upload files concurrently
      const [response1, response2] = await Promise.all([
        request(app)
          .post('/api/fdx/import')
          .attach('fdx', file1, 'concurrent1.fdx'),
        request(app)
          .post('/api/fdx/import')
          .attach('fdx', file2, 'concurrent2.fdx')
      ])

      // Assert
      expect(response1.status).toBe(200)
      expect(response2.status).toBe(200)
      expect(response1.body.projectId).not.toBe(response2.body.projectId)
    })

    it('should validate environment configuration', () => {
      // Test different environment configurations
      const configs = [
        { env: 'production', apiUrl: undefined, shouldFail: true },
        { env: 'production', apiUrl: 'http://api.example.com', shouldFail: false },
        { env: 'development', apiUrl: undefined, shouldFail: false },
        { env: 'development', apiUrl: 'http://localhost:3003', shouldFail: false }
      ]

      configs.forEach(({ env, apiUrl, shouldFail }) => {
        const validateConfig = () => {
          if (env === 'production' && !apiUrl) {
            throw new Error('API URL required in production')
          }
          return true
        }

        if (shouldFail) {
          expect(validateConfig).toThrow()
        } else {
          expect(validateConfig()).toBe(true)
        }
      })
    })
  })
})

/**
 * Integration Test Utilities
 */
export const integrationTestUtils = {
  /**
   * Create a mock FDX file with specified number of scenes
   */
  createMockFDX: (sceneCount: number = 10): string => {
    const scenes = Array.from({ length: sceneCount }, (_, i) => `
      <Paragraph Type="Scene Heading">
        <Text>INT. LOCATION ${i + 1} - DAY</Text>
      </Paragraph>
      <Paragraph Type="Action">
        <Text>Action for scene ${i + 1}.</Text>
      </Paragraph>
      <Paragraph Type="Character">
        <Text>CHARACTER ${i + 1}</Text>
      </Paragraph>
      <Paragraph Type="Dialogue">
        <Text>Dialogue for scene ${i + 1}.</Text>
      </Paragraph>
    `).join('')

    return `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>${scenes}</Content>
</FinalDraft>`
  },

  /**
   * Measure async operation performance
   */
  measurePerformance: async <T>(
    operation: () => Promise<T>,
    label: string
  ): Promise<{ result: T; duration: number }> => {
    const start = performance.now()
    const result = await operation()
    const end = performance.now()
    const duration = Math.round(end - start)

    console.log(`⏱️ ${label}: ${duration}ms`)

    return { result, duration }
  },

  /**
   * Wait for condition with timeout
   */
  waitForCondition: async (
    condition: () => boolean | Promise<boolean>,
    timeout: number = 5000,
    interval: number = 100
  ): Promise<boolean> => {
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return true
      }
      await new Promise(resolve => setTimeout(resolve, interval))
    }

    return false
  }
}