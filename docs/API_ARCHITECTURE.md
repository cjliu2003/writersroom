# WritersRoom API Architecture

## Overview

WritersRoom uses a hybrid API architecture that combines Next.js API routes with a dedicated Express.js backend. This document explains the architecture, routing patterns, and error handling strategies.

## Architecture Components

### 1. Frontend API Layer (Next.js API Routes)

Located in `frontend/app/api/`, these routes serve as:
- **Proxies** for complex backend operations
- **Processors** for file uploads and parsing
- **Aggregators** for multi-step operations

```
frontend/app/api/
├── ai/
│   ├── chat/route.ts          # AI chat functionality
│   └── scene-summary/route.ts # Scene analysis
├── fdx/
│   └── import/route.ts        # FDX file processing
└── health/route.ts            # Health checks
```

### 2. Backend API Layer (Express.js)

Located in `backend/routes/`, these provide:
- **Data persistence** via services
- **Business logic** for screenplay operations
- **Memory management** for scene data

```
backend/routes/
├── memory.ts                  # Scene memory CRUD operations
├── snapshot.ts               # Project snapshot management
└── projects.ts               # Project registry operations
```

### 3. Centralized API Client

The `frontend/lib/api.ts` module provides unified API access:

```typescript
// Core utilities
export const API_BASE_URL: string
export const createApiUrl(path: string): string
export const apiFetch(url: string, options?: RequestInit): Promise<Response>

// High-level operations
export const uploadFdxFile(file: File): Promise<UploadResult>
export const fetchProjectSnapshot(projectId: string): Promise<Snapshot>
export const storeProjectSnapshot(projectId: string, data: any): Promise<void>
```

## Routing Patterns

### Pattern 1: Next.js Proxy (File Uploads)

**Problem Solved**: File uploads hitting wrong port during development

```typescript
// frontend/lib/api.ts
export const uploadFdxFile = async (file: File) => {
  // Uses Next.js API route, not direct backend call
  const url = '/api/fdx/import'
  const response = await apiFetch(`${window.location.origin}${url}`, {
    method: 'POST',
    body: formData,
  })
  return response.json()
}
```

```typescript
// frontend/app/api/fdx/import/route.ts
export async function POST(request: Request) {
  // 1. Parse FDX file
  const formData = await request.formData()
  const file = formData.get('fdx') as File
  const parsed = await parseFDX(file)

  // 2. Store in backend via direct API call
  await fetch(`${BACKEND_URL}/api/memory/bulk-update`, {
    method: 'POST',
    body: JSON.stringify(parsed)
  })

  // 3. Return processed result
  return Response.json({ success: true, ...parsed })
}
```

### Pattern 2: Direct Backend Calls (Data Operations)

For simple CRUD operations, call backend directly:

```typescript
// frontend/utils/memoryAPI.ts
export class MemoryAPI {
  static async getAllScenes(projectId: string) {
    const response = await apiFetch(`${API_BASE_URL}/api/memory/all?projectId=${projectId}`)
    return response.json()
  }

  static async updateSceneMemory(projectId: string, data: SceneData) {
    const response = await apiFetch(`${API_BASE_URL}/api/memory/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, ...data })
    })
    return response.json()
  }
}
```

### Pattern 3: Hybrid Operations (Editor Loading)

Complex operations that need both patterns:

```typescript
// frontend/app/editor/page.tsx - Loading script data
const loadScript = async () => {
  // 1. Try backend snapshot API first
  let response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/snapshot`)

  if (response.ok) {
    const snapshot = await response.json()
    return processSnapshot(snapshot)
  }

  // 2. Fallback to memory API
  response = await fetch(`${API_BASE_URL}/api/memory/all?projectId=${projectId}`)

  if (response.ok) {
    const scenes = await response.json()
    return processScenes(scenes)
  }

  // 3. Final fallback to localStorage
  return loadFromLocalStorage(projectId)
}
```

## Error Handling Architecture

### 1. Centralized Error Handling

```typescript
// frontend/lib/api.ts
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

    // Let callers handle HTTP status codes
    return response
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout - please try again')
    }

    throw error
  }
}
```

### 2. Service-Level Error Handling

```typescript
// frontend/utils/memoryAPI.ts
async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  try {
    const response = await apiFetch(`${API_BASE_URL}${endpoint}`, options)

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()

    if (!data.success) {
      throw new Error(data.message || 'API request failed')
    }

    return data
  } catch (error) {
    console.error('API request failed:', error)
    throw error
  }
}
```

### 3. Component-Level Error Handling

```typescript
// React Error Boundaries
<ErrorBoundary>
  <Suspense fallback={<LoadingSpinner />}>
    <EditorPageContent />
  </Suspense>
</ErrorBoundary>
```

```typescript
// Component error states
const [uploadError, setUploadError] = useState<string | null>(null)

const handleUpload = async (file: File) => {
  try {
    setUploadError(null)
    const result = await uploadFdxFile(file)
    // Handle success
  } catch (error) {
    setUploadError(error instanceof Error ? error.message : 'Upload failed')
  }
}
```

## Request/Response Patterns

### Standard API Response Format

All backend APIs follow this format:

```typescript
interface APIResponse<T = any> {
  success: boolean
  message?: string
  data?: T
  error?: string
  timestamp?: string
}
```

### Memory API Patterns

```typescript
// Scene operations
interface SceneMemoryResponse {
  success: boolean
  data: SceneMemory[]
  message?: string
}

interface SingleSceneResponse {
  success: boolean
  data: SceneMemory | undefined
  message?: string
}

// Usage pattern
const scenes = await MemoryAPI.getAllScenes(projectId)
// scenes.data contains SceneMemory[]
```

### Upload Response Pattern

```typescript
interface UploadResult {
  success: boolean
  title?: string
  sceneCount?: number
  projectId?: string
  sluglines?: string[]
  error?: string
}

// Usage
const result = await uploadFdxFile(file)
if (result.success) {
  console.log(`Uploaded: ${result.title} (${result.sceneCount} scenes)`)
}
```

## Configuration Management

### Environment-Based Routing

```typescript
// lib/api.ts
const getApiBaseUrl = (): string => {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001'
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

export const API_BASE_URL = getApiBaseUrl()
```

### Development vs Production

**Development**:
- Frontend: `http://localhost:3100`
- Backend: `http://localhost:3001`
- API calls: Direct to backend with full URLs

**Production**:
- Frontend: `https://your-app.com`
- Backend: `https://api.your-app.com` or same domain
- API calls: Absolute URLs or relative with proxy

## Performance Considerations

### 1. Request Timeouts

All API calls have configurable timeouts:

```typescript
// Default 30s timeout, configurable per request
const response = await apiFetch(url, options, 15000) // 15s timeout
```

### 2. Concurrent Request Handling

```typescript
// Parallel data loading
const [scenes, stats, recent] = await Promise.all([
  MemoryAPI.getAllScenes(projectId),
  MemoryAPI.getMemoryStats(projectId),
  MemoryAPI.getRecentScenes(projectId, 5)
])
```

### 3. Retry Logic

```typescript
// Built into useChunkRetry hook for chunk loading failures
const { retry, isRetrying } = useChunkRetry()

// Retry pattern for API calls
const retryApiCall = async (apiCall: () => Promise<any>, maxAttempts = 3) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await apiCall()
    } catch (error) {
      if (attempt === maxAttempts) throw error
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
    }
  }
}
```

## Security Considerations

### 1. API Key Protection

```typescript
// Never expose API keys in frontend code
// Use Next.js API routes for OpenAI calls
export async function POST(request: Request) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY // Server-side only
  })
}
```

### 2. Input Validation

```typescript
// Backend route validation
export async function POST(req: Request) {
  const { projectId, slugline } = await req.json()

  if (!projectId || typeof projectId !== 'string') {
    return Response.json({ error: 'Invalid projectId' }, { status: 400 })
  }

  if (!slugline || typeof slugline !== 'string') {
    return Response.json({ error: 'Invalid slugline' }, { status: 400 })
  }
}
```

### 3. CORS Configuration

```typescript
// backend/server.ts
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3100',
  credentials: true
}))
```

## Monitoring and Debugging

### 1. Request Logging

```typescript
// Built-in logging in apiFetch
console.log(`🌐 API Request: ${method} ${url}`)
console.log(`📊 Response: ${response.status} ${response.statusText}`)
```

### 2. Health Checks

```typescript
// Backend health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'WritersRoom Backend API is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

// Frontend health check utility
const isBackendHealthy = await MemoryAPI.healthCheck()
```

### 3. Error Tracking

```typescript
// Centralized error logging
const logError = (context: string, error: Error) => {
  console.error(`❌ ${context}:`, error)

  // In production, send to monitoring service
  if (process.env.NODE_ENV === 'production') {
    // Sentry.captureException(error, { tags: { context } })
  }
}
```

## Testing Strategy

### 1. API Testing

```typescript
// backend/__tests__/integration/api.test.ts
describe('Memory API', () => {
  test('should create and retrieve scene', async () => {
    const scene = await MemoryAPI.updateSceneMemory(
      'test-project',
      'INT. OFFICE - DAY',
      { summary: 'A scene in an office' }
    )

    expect(scene.slugline).toBe('INT. OFFICE - DAY')
    expect(scene.summary).toBe('A scene in an office')
  })
})
```

### 2. Frontend Integration Testing

```typescript
// frontend/__tests__/integration/upload.test.ts
describe('File Upload', () => {
  test('should upload FDX file successfully', async () => {
    const file = new File(['FDX content'], 'test.fdx', { type: 'application/xml' })
    const result = await uploadFdxFile(file)

    expect(result.success).toBe(true)
    expect(result.sceneCount).toBeGreaterThan(0)
  })
})
```

## Future Considerations

### 1. API Versioning

```typescript
// Planned: API versioning support
const API_VERSION = 'v1'
export const createApiUrl = (path: string, version = API_VERSION) => {
  return `${API_BASE_URL}/api/${version}${path}`
}
```

### 2. Caching Layer

```typescript
// Planned: Response caching
const cachedFetch = async (url: string, options: RequestInit, cacheTime = 300000) => {
  const cacheKey = `${url}-${JSON.stringify(options)}`
  const cached = cache.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < cacheTime) {
    return cached.response
  }

  const response = await apiFetch(url, options)
  cache.set(cacheKey, { response, timestamp: Date.now() })
  return response
}
```

### 3. WebSocket Integration

```typescript
// Planned: Real-time updates
const useRealTimeScenes = (projectId: string) => {
  const [scenes, setScenes] = useState<SceneMemory[]>([])

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:3001/scenes/${projectId}`)
    ws.onmessage = (event) => {
      const updatedScene = JSON.parse(event.data)
      setScenes(prev => updateScene(prev, updatedScene))
    }
    return () => ws.close()
  }, [projectId])

  return scenes
}
```

This architecture provides a robust, scalable foundation for the WritersRoom application while maintaining clear separation of concerns and comprehensive error handling.