/**
 * Writersroom Backend Server
 * 
 * Express.js server for the Writersroom screenwriting app.
 * Handles scene memory management and other backend operations.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import memoryRoutes from './routes/memory';
import snapshotRoutes from './routes/snapshot';
import { registerProject, listProjects, deleteProject } from './api/projects';

const app = express();
const PORT = process.env.PORT || 3003;

// Middleware
app.use(helmet()); // Security headers

// CORS configuration - allow frontend origins
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string | string[]) => void) {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'http://localhost:3000', // Next.js default
      'http://localhost:3001', // Alternative frontend port
      'http://localhost:3100', // Your configured frontend port
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3100'
    ];

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // In development, allow all localhost origins
      if (process.env.NODE_ENV !== 'production' && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions)); // Enable CORS for frontend communication

app.use(morgan('combined')); // Request logging
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    message: 'Writersroom Backend API is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Routes
app.use('/api/memory', memoryRoutes);
app.use('/api/projects', snapshotRoutes);

// Project Registry Routes
app.post('/api/projects/register', registerProject);
app.get('/api/projects/list', listProjects);
app.delete('/api/projects/:projectId', deleteProject);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    path: req.originalUrl
  });
});

// Error handler
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server Error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Writersroom Backend API running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`💾 Memory API: http://localhost:${PORT}/api/memory/*`);
  console.log(`📸 Snapshot API: http://localhost:${PORT}/api/projects/:id/snapshot`);
  console.log(`📁 Projects API: http://localhost:${PORT}/api/projects/*`);
});

export default app;