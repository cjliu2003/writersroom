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
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS for frontend communication
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