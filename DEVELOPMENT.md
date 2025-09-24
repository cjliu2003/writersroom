# WritersRoom Development Guide

## Overview

WritersRoom is a comprehensive screenwriting application built with Next.js frontend and Express.js backend. This guide covers development setup, architecture, and deployment configuration.

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- Git

### Development Setup

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd writersroom

   # Install frontend dependencies
   cd frontend
   npm install

   # Install backend dependencies
   cd ../backend
   npm install
   ```

2. **Environment Configuration**
   ```bash
   # Frontend - copy example and configure
   cd frontend
   cp .env.example .env.local

   # Backend - copy example and configure
   cd ../backend
   cp .env.example .env
   ```

3. **Start Development Servers**
   ```bash
   # Terminal 1: Backend (runs on port 3003)
   cd backend
   npm run dev

   # Terminal 2: Frontend (runs on port 3001)
   cd frontend
   npm run dev
   ```

4. **Access Application**
   - Frontend: http://localhost:3001
   - Backend API: http://localhost:3003/api
   - Health Check: http://localhost:3003/api/health

## Environment Variables

### Frontend (.env.local)

```bash
# WritersRoom Development Configuration

# Port Configuration - Frontend runs on default Next.js port 3001
PORT=3001

# API Configuration - CRITICAL for routing uploads correctly
NEXT_PUBLIC_API_BASE_URL=http://localhost:3003

# OpenAI Configuration (for AI features)
OPENAI_API_KEY=your_openai_api_key_here

# Development Settings
NODE_ENV=development
NEXT_PUBLIC_ENVIRONMENT=development

# Performance Settings
NEXT_PUBLIC_CACHE_ENABLED=true
NEXT_PUBLIC_CHUNK_RETRY_ENABLED=true
```

### Backend (.env)

```bash
# WritersRoom Backend Configuration

# Server Configuration
PORT=3003
NODE_ENV=development

# Database Configuration (if using database)
# DATABASE_URL=your_database_url_here

# OpenAI Configuration (for backend AI features)
OPENAI_API_KEY=your_openai_api_key_here

# Security Settings
CORS_ORIGIN=http://localhost:3001

# Logging
LOG_LEVEL=debug
```

## Architecture Overview

### Frontend (Next.js App Router)

```
frontend/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes (proxies to backend)
│   ├── editor/            # Editor page
│   ├── layout.tsx         # Root layout
│   └── page.tsx          # Home page
├── components/            # React components
│   ├── ui/               # Reusable UI components
│   └── ...               # Feature-specific components
├── lib/                  # Utilities and configurations
│   ├── api.ts            # Centralized API client
│   └── utils.ts          # Common utilities
├── utils/                # Feature utilities
│   ├── memoryAPI.ts      # Memory/scene operations
│   └── ...               # Other utilities
├── hooks/                # Custom React hooks
├── types/                # TypeScript type definitions
└── shared/               # Shared with backend
```

### Backend (Express.js)

```
backend/
├── routes/               # API route handlers
│   ├── memory.ts         # Scene memory operations
│   └── snapshot.ts       # Project snapshot operations
├── services/             # Business logic
│   ├── memoryService.ts  # Scene memory service
│   └── snapshotService.ts # Project snapshot service
├── api/                  # API utilities
├── utils/                # Backend utilities
├── __tests__/           # Test files
├── server.ts            # Main server file
└── shared/               # Shared with frontend
```

## API Routing Architecture

### The Critical Upload Fix

**Problem**: File uploads were hitting Next.js dev server (port 3001) instead of Express backend (port 3003), causing failures.

**Solution**: Centralized API configuration with absolute URLs.

### Configuration Options

#### Option 1: Absolute URLs (Current Implementation)
```typescript
// lib/api.ts - Centralized configuration
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3003'

// Usage
const response = await uploadFdxFile(file)
```

**Pros**: Simple, works in all environments, explicit routing
**Cons**: Requires environment-specific configuration

#### Option 2: Next.js Rewrites (Alternative)
```javascript
// next.config.js
module.exports = {
  async rewrites() {
    return [
      {
        source: '/api/backend/:path*',
        destination: 'http://localhost:3003/api/:path*'
      }
    ]
  }
}
```

**Pros**: Relative URLs, automatic proxy
**Cons**: Development-only, complex production config

### API Client Architecture

The application uses a centralized API client pattern:

```typescript
// lib/api.ts - Main API utilities
export const API_BASE_URL: string           // Base URL configuration
export const createApiUrl(path: string)     // URL builder
export const apiFetch(url, options)         // Enhanced fetch with timeout
export const uploadFdxFile(file)            // FDX upload utility
export const fetchProjectSnapshot(id)       // Project retrieval
export const storeProjectSnapshot(id, data) // Project storage
```

```typescript
// utils/memoryAPI.ts - Memory operations
export class MemoryAPI {
  static updateSceneMemory(...)     // Update scene data
  static getRecentScenes(...)       // Fetch recent scenes
  static getSceneBySlugline(...)    // Find specific scene
  static getAllScenes(...)          // Fetch all project scenes
  static clearSceneMemory(...)      // Clear project data
  // ... more methods
}
```

## Error Handling Patterns

### API Error Handling

```typescript
// Centralized error handling in apiFetch
export const apiFetch = async (url, options, timeout = 30000) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('Request timeout - please try again')
    }
    throw error
  }
}
```

### Component Error Handling

```typescript
// Error boundaries for React components
<ErrorBoundary>
  <Suspense fallback={<LoadingSpinner />}>
    <EditorPageContent />
  </Suspense>
</ErrorBoundary>
```

## StrictMode Protection

The application implements StrictMode protection to prevent duplicate operations:

```typescript
// Upload protection pattern
const hasUploadedRef = useRef(false)

const handleUpload = async (file) => {
  if (hasUploadedRef.current) return
  hasUploadedRef.current = true

  try {
    await uploadFdxFile(file)
  } finally {
    // Reset after delay to allow legitimate re-uploads
    setTimeout(() => { hasUploadedRef.current = false }, 1000)
  }
}
```

## Development Workflow

### Code Quality

1. **TypeScript**: Strict type checking enabled
2. **ESLint**: Code linting with React hooks rules
3. **Prettier**: Code formatting (if configured)
4. **Testing**: Jest + React Testing Library

### Key Scripts

```bash
# Frontend
npm run dev          # Development server
npm run build        # Production build
npm run start        # Production server
npm run lint         # ESLint check
npm run test         # Run tests

# Backend
npm run dev          # Development server (nodemon)
npm run build        # TypeScript compilation
npm run start        # Production server
npm run test         # Run tests
```

### Testing Strategy

```bash
# Frontend tests
cd frontend
npm test                           # Unit tests
npm run test:e2e                   # End-to-end tests
npm run test:performance           # Performance tests

# Backend tests
cd backend
npm test                           # Unit tests
npm run test:integration           # Integration tests
```

## Production Deployment

### Environment Variables

Set these variables in your production environment:

```bash
# Frontend
NEXT_PUBLIC_API_BASE_URL=https://your-api-domain.com
OPENAI_API_KEY=your_production_openai_key

# Backend
PORT=3001
NODE_ENV=production
CORS_ORIGIN=https://your-frontend-domain.com
OPENAI_API_KEY=your_production_openai_key
```

### Deployment Steps

1. **Build Applications**
   ```bash
   cd frontend && npm run build
   cd backend && npm run build
   ```

2. **Deploy Backend** (Express API)
   - Deploy to your server/cloud platform
   - Ensure port 3001 is accessible
   - Set production environment variables

3. **Deploy Frontend** (Next.js)
   - Deploy to Vercel/Netlify/your platform
   - Configure `NEXT_PUBLIC_API_BASE_URL` to point to backend
   - Ensure build succeeds

4. **Verify Deployment**
   - Test file upload workflow
   - Check API health endpoint
   - Verify CORS configuration

### Docker Deployment (Optional)

```dockerfile
# Dockerfile.frontend
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3100
CMD ["npm", "start"]
```

```dockerfile
# Dockerfile.backend
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

## Troubleshooting

### Common Issues

1. **Upload failures**: Check `NEXT_PUBLIC_API_BASE_URL` is set correctly
2. **CORS errors**: Verify backend `CORS_ORIGIN` matches frontend URL
3. **Port conflicts**: Ensure ports 3001 (frontend) and 3003 (backend) are available
4. **Memory issues**: Large FDX files may need increased memory limits

### Debug Mode

Enable detailed logging:

```bash
# Frontend
DEBUG=writersroom:* npm run dev

# Backend
LOG_LEVEL=debug npm run dev
```

### Health Checks

- Frontend: Check browser console for errors
- Backend: GET http://localhost:3003/api/health
- Memory API: Use `/api/memory/stats` endpoint
- Upload test: Try uploading a small FDX file

## Contributing

1. Create feature branch from `main`
2. Follow existing code patterns
3. Add tests for new functionality
4. Update documentation as needed
5. Ensure all tests pass
6. Create pull request

## Support

For questions or issues:
1. Check this documentation
2. Review existing GitHub issues
3. Create new issue with reproduction steps
4. Include environment details and error logs