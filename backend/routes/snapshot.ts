/**
 * Snapshot API Routes
 *
 * Express.js routes for atomic project snapshot management.
 * Provides endpoints for storing and retrieving complete project states.
 */

import express, { Request, Response } from 'express';
import SnapshotService from '../services/snapshotService';
import { SceneMemory } from '../../shared/types';

const router = express.Router();

/**
 * Error handler utility
 */
const handleError = (res: Response, error: unknown, message: string = 'An error occurred'): void => {
  console.error('Snapshot API Error:', error);
  res.status(500).json({
    success: false,
    message,
    error: error instanceof Error ? error.message : 'Unknown error'
  });
};

/**
 * POST /api/projects/:id/snapshot
 * Store a complete project snapshot atomically
 */
router.post('/:id/snapshot', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const { version, scenes, elements, metadata, title } = req.body;

    console.log(`\n🚀 SNAPSHOT API: Storing snapshot for project ${projectId}`);
    console.log(`   Scenes received: ${scenes?.length || 0}`);
    console.log(`   Elements received: ${elements?.length || 0}`);

    // Validate required fields
    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: 'Project ID is required'
      });
    }

    if (!scenes || !Array.isArray(scenes)) {
      return res.status(400).json({
        success: false,
        message: 'Scenes array is required'
      });
    }

    // Store the snapshot atomically
    const snapshot = SnapshotService.storeSnapshot(projectId, {
      version: version || Date.now(),
      title,
      scenes: scenes as SceneMemory[],
      elements,
      metadata
    });

    // Return success response
    res.json({
      success: true,
      version: snapshot.version,
      count: snapshot.scenes.length,
      projectId: snapshot.projectId,
      metadata: snapshot.metadata
    });

    console.log(`   ✅ Snapshot stored successfully with ${snapshot.scenes.length} scenes`);

  } catch (error) {
    handleError(res, error, 'Failed to store project snapshot');
  }
});

/**
 * GET /api/projects/:id/snapshot
 * Retrieve a complete project snapshot
 */
router.get('/:id/snapshot', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;

    console.log(`\n🔍 SNAPSHOT API: Retrieving snapshot for project ${projectId}`);

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: 'Project ID is required'
      });
    }

    // Retrieve the snapshot
    const snapshot = SnapshotService.getSnapshot(projectId);

    if (!snapshot) {
      console.log(`   ⚠️ No snapshot found`);
      return res.status(404).json({
        success: false,
        message: 'Project snapshot not found'
      });
    }

    // Return the complete snapshot
    res.json({
      success: true,
      data: snapshot
    });

    console.log(`   ✅ Snapshot retrieved with ${snapshot.scenes.length} scenes`);

  } catch (error) {
    handleError(res, error, 'Failed to retrieve project snapshot');
  }
});

/**
 * PATCH /api/projects/:id/snapshot/metadata
 * Update snapshot metadata
 */
router.patch('/:id/snapshot/metadata', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const metadata = req.body;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: 'Project ID is required'
      });
    }

    const updated = SnapshotService.updateMetadata(projectId, metadata);

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Project snapshot not found'
      });
    }

    res.json({
      success: true,
      message: 'Metadata updated successfully'
    });

  } catch (error) {
    handleError(res, error, 'Failed to update snapshot metadata');
  }
});

/**
 * DELETE /api/projects/:id/snapshot
 * Delete a project snapshot
 */
router.delete('/:id/snapshot', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: 'Project ID is required'
      });
    }

    const deleted = SnapshotService.deleteSnapshot(projectId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Project snapshot not found'
      });
    }

    res.json({
      success: true,
      message: 'Snapshot deleted successfully'
    });

  } catch (error) {
    handleError(res, error, 'Failed to delete project snapshot');
  }
});

/**
 * GET /api/projects/:id/snapshot/stats
 * Get snapshot statistics
 */
router.get('/:id/snapshot/stats', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: 'Project ID is required'
      });
    }

    const stats = SnapshotService.getStats(projectId);

    if (!stats) {
      return res.status(404).json({
        success: false,
        message: 'Project snapshot not found'
      });
    }

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    handleError(res, error, 'Failed to get snapshot statistics');
  }
});

/**
 * GET /api/projects/snapshots
 * List all projects with snapshots
 */
router.get('/snapshots', async (req: Request, res: Response) => {
  try {
    const projects = SnapshotService.listProjects();

    res.json({
      success: true,
      data: projects
    });

  } catch (error) {
    handleError(res, error, 'Failed to list projects');
  }
});

/**
 * GET /api/projects/snapshots/global-stats
 * Get global snapshot statistics
 */
router.get('/snapshots/global-stats', async (req: Request, res: Response) => {
  try {
    const stats = SnapshotService.getGlobalStats();

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    handleError(res, error, 'Failed to get global statistics');
  }
});

export default router;