/**
 * Enhanced Writersroom Backend Server
 *
 * Express.js server with optimizations for handling large payloads
 * and improved robustness for the atomic snapshot system.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import memoryRoutes from './routes/memory';
import snapshotRoutes from './routes/snapshot';
import { registerProject, listProjects, deleteProject } from './api/projects';

const app = express();
const PORT = process.env.PORT || 3001;

// ===============================================
// ENHANCED CONFIGURATION FOR LARGE PAYLOADS
// ===============================================

// 1. Compression middleware (reduces payload size by ~60-80%)
app.use(compression({
  // Enable compression for all responses > 1kb
  threshold: 1024,
  // Use maximum compression level for text data
  level: 9,
  // Custom filter to compress JSON responses
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Compress all JSON responses
    return compression.filter(req, res) ||
           res.getHeader('content-type')?.toString().includes('json');
  }
}));

// 2. Security headers with relaxed settings for large payloads
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API-only server
  crossOriginEmbedderPolicy: false
}));

// 3. CORS with specific configuration
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true,
  maxAge: 86400 // Cache preflight requests for 24 hours
}));

// 4. Request logging with response time
app.use(morgan('combined'));

// 5. Body parser with increased limits
const JSON_LIMIT = process.env.JSON_LIMIT || '50mb'; // Increased from 10mb
const URL_LIMIT = process.env.URL_LIMIT || '50mb';

app.use(express.json({
  limit: JSON_LIMIT,
  // Custom reviver to handle Date strings
  reviver: (key, value) => {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      return new Date(value);
    }
    return value;
  }
}));

app.use(express.urlencoded({
  extended: true,
  limit: URL_LIMIT,
  parameterLimit: 10000 // Increased from default 1000
}));

// 6. Request timeout configuration
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '300000'); // 5 minutes default

// Timeout middleware for all routes
app.use((req, res, next) => {
  // Set timeout for this request
  req.setTimeout(REQUEST_TIMEOUT);
  res.setTimeout(REQUEST_TIMEOUT);

  // Handle timeout
  req.on('timeout', () => {
    console.error(`Request timeout: ${req.method} ${req.url}`);
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        message: 'Request timeout',
        timeout: REQUEST_TIMEOUT
      });
    }
  });

  next();
});

// 7. Keep-alive configuration
app.use((req, res, next) => {
  // Enable keep-alive with custom timeout
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Keep-Alive', 'timeout=30');
  next();
});

// ===============================================
// HEALTH & MONITORING ENDPOINTS
// ===============================================

// Enhanced health check with system stats
app.get('/api/health', (_req, res) => {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();

  res.json({
    success: true,
    message: 'Writersroom Backend API is running',
    timestamp: new Date().toISOString(),
    uptime: uptime,
    config: {
      jsonLimit: JSON_LIMIT,
      requestTimeout: REQUEST_TIMEOUT,
      port: PORT,
      nodeVersion: process.version
    },
    memory: {
      rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      external: `${(memUsage.external / 1024 / 1024).toFixed(2)} MB`
    },
    performance: {
      uptimeHours: (uptime / 3600).toFixed(2),
      requestsServed: (global as any).requestCount || 0
    }
  });
});

// Performance monitoring endpoint
app.get('/api/health/performance', (_req, res) => {
  const stats = {
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    uptime: process.uptime(),
    pid: process.pid,
    platform: process.platform,
    nodeVersion: process.version,
    v8HeapStats: (process as any).getHeapStatistics ? (process as any).getHeapStatistics() : {}
  };

  res.json({
    success: true,
    stats
  });
});

// ===============================================
// REQUEST TRACKING
// ===============================================

// Track request count
let requestCount = 0;
app.use((req, res, next) => {
  requestCount++;
  (global as any).requestCount = requestCount;

  // Log large payloads
  const contentLength = req.get('content-length');
  if (contentLength && parseInt(contentLength) > 1024 * 1024) { // > 1MB
    console.log(`📦 Large payload detected: ${(parseInt(contentLength) / 1024 / 1024).toFixed(2)} MB for ${req.method} ${req.url}`);
  }

  // Track response time
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000) { // Log slow requests
      console.log(`⚠️ Slow request: ${req.method} ${req.url} took ${duration}ms`);
    }
  });

  next();
});

// ===============================================
// API ROUTES
// ===============================================

app.use('/api/memory', memoryRoutes);
app.use('/api/projects', snapshotRoutes);

// Project Registry Routes
app.post('/api/projects/register', registerProject);
app.get('/api/projects/list', listProjects);
app.delete('/api/projects/:projectId', deleteProject);

// ===============================================
// ERROR HANDLING
// ===============================================

// 404 handler
app.use('*', (req, res) => {
  console.log(`404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Global error handler with detailed logging
app.use((error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('=== SERVER ERROR ===');
  console.error('URL:', req.url);
  console.error('Method:', req.method);
  console.error('Error:', error);

  // Check for specific error types
  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'Payload too large',
      limit: JSON_LIMIT,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }

  if (error.code === 'ECONNRESET' || error.code === 'EPIPE') {
    return res.status(503).json({
      success: false,
      message: 'Connection error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }

  // Default error response
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });
});

// ===============================================
// GRACEFUL SHUTDOWN
// ===============================================

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Performing graceful shutdown...');
  server.close(() => {
    console.log('Server closed. Exiting process.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received. Performing graceful shutdown...');
  server.close(() => {
    console.log('Server closed. Exiting process.');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit in development
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit in development
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

// ===============================================
// START SERVER
// ===============================================

const server = app.listen(PORT, () => {
  console.log('');
  console.log('===============================================');
  console.log('🚀 WRITERSROOM BACKEND SERVER (ENHANCED)');
  console.log('===============================================');
  console.log(`📡 Port: ${PORT}`);
  console.log(`📦 JSON Limit: ${JSON_LIMIT}`);
  console.log(`⏱️  Request Timeout: ${REQUEST_TIMEOUT}ms`);
  console.log(`🗜️  Compression: Enabled`);
  console.log('');
  console.log('📍 Endpoints:');
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Performance: http://localhost:${PORT}/api/health/performance`);
  console.log(`   Memory API: http://localhost:${PORT}/api/memory/*`);
  console.log(`   Snapshot API: http://localhost:${PORT}/api/projects/:id/snapshot`);
  console.log(`   Projects API: http://localhost:${PORT}/api/projects/*`);
  console.log('===============================================');
  console.log('');
});

// Configure server timeouts
server.timeout = REQUEST_TIMEOUT;
server.keepAliveTimeout = 30000; // 30 seconds
server.headersTimeout = 31000; // Slightly higher than keepAliveTimeout

export default app;