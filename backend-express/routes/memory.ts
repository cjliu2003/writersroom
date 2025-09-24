/**
 * Memory API Routes
 * 
 * Express.js routes for scene memory management.
 * Provides RESTful API endpoints for all memory operations.
 */

import express, { Request, Response } from 'express';
import MemoryService from '../services/memoryService';
import { 
  UpdateSceneMemoryRequest,
  GetRecentScenesRequest,
  GetScenesByCharacterRequest,
  GetScenesByThemeRequest,
  GetTokensRequest,
  SceneMemoryResponse,
  SingleSceneResponse,
  TokensResponse,
  StatsResponse,
  ErrorResponse
} from '../../shared/types';

const router = express.Router();

/**
 * Error handler utility
 */
const handleError = (res: Response, error: unknown, message: string = 'An error occurred'): void => {
  console.error('Memory API Error:', error);
  const response: ErrorResponse = {
    success: false,
    message,
    error: error instanceof Error ? error.message : 'Unknown error'
  };
  res.status(500).json(response);
};

/**
 * POST /api/memory/update
 * Add or update a scene in memory
 */
router.post('/update', async (req: Request, res: Response) => {
  try {
    const { projectId, slugline, sceneIndex, data }: UpdateSceneMemoryRequest = req.body;

    if (!projectId || !slugline) {
      const response: ErrorResponse = {
        success: false,
        message: 'Missing required fields: projectId and slugline'
      };
      return res.status(400).json(response);
    }

    // Run migration for backward compatibility
    MemoryService.migrateProjectScenes(projectId);

    const updatedScene = MemoryService.updateSceneMemory(projectId, slugline, data, sceneIndex);

    const response: SingleSceneResponse = {
      success: true,
      data: updatedScene
    };

    res.json(response);
  } catch (error) {
    handleError(res, error, 'Failed to update scene memory');
  }
});

/**
 * GET /api/memory/recent?projectId=xxx&count=3
 * Get recent scenes for a project
 */
router.get('/recent', async (req: Request, res: Response) => {
  try {
    const { projectId, count } = req.query;
    
    if (!projectId) {
      const response: ErrorResponse = {
        success: false,
        message: 'Missing required parameter: projectId'
      };
      return res.status(400).json(response);
    }

    const sceneCount = count ? parseInt(count as string, 10) : 3;
    const scenes = MemoryService.getRecentScenes(projectId as string, sceneCount);
    
    const response: SceneMemoryResponse = {
      success: true,
      data: scenes
    };
    
    res.json(response);
  } catch (error) {
    handleError(res, error, 'Failed to get recent scenes');
  }
});

/**
 * GET /api/memory/by-slugline?projectId=xxx&slugline=xxx&sceneIndex=xxx
 * Get a specific scene by slugline and optional index
 */
router.get('/by-slugline', async (req: Request, res: Response) => {
  try {
    const { projectId, slugline, sceneIndex } = req.query;

    if (!projectId || !slugline) {
      const response: ErrorResponse = {
        success: false,
        message: 'Missing required parameters: projectId and slugline'
      };
      return res.status(400).json(response);
    }

    // Run migration for backward compatibility
    MemoryService.migrateProjectScenes(projectId as string);

    const index = sceneIndex ? parseInt(sceneIndex as string, 10) : undefined;
    const scene = MemoryService.getSceneBySlugline(projectId as string, slugline as string, index);

    const response: SingleSceneResponse = {
      success: true,
      data: scene
    };

    res.json(response);
  } catch (error) {
    handleError(res, error, 'Failed to get scene by slugline');
  }
});

/**
 * GET /api/memory/by-id?projectId=xxx&sceneId=xxx
 * Get a specific scene by its composite ID
 */
router.get('/by-id', async (req: Request, res: Response) => {
  try {
    const { projectId, sceneId } = req.query;

    if (!projectId || !sceneId) {
      const response: ErrorResponse = {
        success: false,
        message: 'Missing required parameters: projectId and sceneId'
      };
      return res.status(400).json(response);
    }

    const scene = MemoryService.getSceneById(projectId as string, sceneId as string);

    const response: SingleSceneResponse = {
      success: true,
      data: scene
    };

    res.json(response);
  } catch (error) {
    handleError(res, error, 'Failed to get scene by ID');
  }
});

/**
 * GET /api/memory/by-character?projectId=xxx&name=xxx
 * Get scenes involving a specific character
 */
router.get('/by-character', async (req: Request, res: Response) => {
  try {
    const { projectId, name } = req.query;
    
    if (!projectId || !name) {
      const response: ErrorResponse = {
        success: false,
        message: 'Missing required parameters: projectId and name'
      };
      return res.status(400).json(response);
    }

    const scenes = MemoryService.getScenesByCharacter(projectId as string, name as string);
    
    const response: SceneMemoryResponse = {
      success: true,
      data: scenes
    };
    
    res.json(response);
  } catch (error) {
    handleError(res, error, 'Failed to get scenes by character');
  }
});

/**
 * GET /api/memory/by-theme?projectId=xxx&theme=xxx
 * Get scenes by theme
 */
router.get('/by-theme', async (req: Request, res: Response) => {
  try {
    const { projectId, theme } = req.query;
    
    if (!projectId || !theme) {
      const response: ErrorResponse = {
        success: false,
        message: 'Missing required parameters: projectId and theme'
      };
      return res.status(400).json(response);
    }

    const scenes = MemoryService.getScenesByTheme(projectId as string, theme as string);
    
    const response: SceneMemoryResponse = {
      success: true,
      data: scenes
    };
    
    res.json(response);
  } catch (error) {
    handleError(res, error, 'Failed to get scenes by theme');
  }
});

/**
 * GET /api/memory/tokens?projectId=xxx&sceneCount=3
 * Get total tokens for recent scenes
 */
router.get('/tokens', async (req: Request, res: Response) => {
  try {
    const { projectId, sceneCount } = req.query;
    
    if (!projectId) {
      const response: ErrorResponse = {
        success: false,
        message: 'Missing required parameter: projectId'
      };
      return res.status(400).json(response);
    }

    const count = sceneCount ? parseInt(sceneCount as string, 10) : 3;
    const totalTokens = MemoryService.getTotalRecentTokens(projectId as string, count);
    
    const response: TokensResponse = {
      success: true,
      data: totalTokens
    };
    
    res.json(response);
  } catch (error) {
    handleError(res, error, 'Failed to get token count');
  }
});

/**
 * GET /api/memory/all?projectId=xxx
 * Get all scenes for a project
 */
router.get('/all', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;

    if (!projectId) {
      const response: ErrorResponse = {
        success: false,
        message: 'Missing required parameter: projectId'
      };
      return res.status(400).json(response);
    }

    // Run migration for backward compatibility
    MemoryService.migrateProjectScenes(projectId as string);

    const scenes = MemoryService.getAllScenes(projectId as string);

    const response: SceneMemoryResponse = {
      success: true,
      data: scenes
    };

    res.json(response);
  } catch (error) {
    handleError(res, error, 'Failed to get all scenes');
  }
});

/**
 * GET /api/memory/stats?projectId=xxx
 * Get memory statistics for a project
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    
    if (!projectId) {
      const response: ErrorResponse = {
        success: false,
        message: 'Missing required parameter: projectId'
      };
      return res.status(400).json(response);
    }

    const stats = MemoryService.getMemoryStats(projectId as string);
    
    const response: StatsResponse = {
      success: true,
      data: stats
    };
    
    res.json(response);
  } catch (error) {
    handleError(res, error, 'Failed to get memory stats');
  }
});

/**
 * DELETE /api/memory/clear?projectId=xxx
 * Clear all memory for a project
 */
router.delete('/clear', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    
    if (!projectId) {
      const response: ErrorResponse = {
        success: false,
        message: 'Missing required parameter: projectId'
      };
      return res.status(400).json(response);
    }

    MemoryService.clearSceneMemory(projectId as string);
    
    const response: SceneMemoryResponse = {
      success: true,
      data: []
    };
    
    res.json(response);
  } catch (error) {
    handleError(res, error, 'Failed to clear scene memory');
  }
});

/**
 * DELETE /api/memory/scene?projectId=xxx&slugline=xxx&sceneIndex=xxx
 * Delete a specific scene by slugline and optional index
 */
router.delete('/scene', async (req: Request, res: Response) => {
  try {
    const { projectId, slugline, sceneIndex } = req.query;

    if (!projectId || !slugline) {
      const response: ErrorResponse = {
        success: false,
        message: 'Missing required parameters: projectId and slugline'
      };
      return res.status(400).json(response);
    }

    const index = sceneIndex ? parseInt(sceneIndex as string, 10) : undefined;
    const deleted = MemoryService.deleteScene(projectId as string, slugline as string, index);

    if (!deleted) {
      const response: ErrorResponse = {
        success: false,
        message: 'Scene not found'
      };
      return res.status(404).json(response);
    }

    const response: SceneMemoryResponse = {
      success: true,
      data: []
    };

    res.json(response);
  } catch (error) {
    handleError(res, error, 'Failed to delete scene');
  }
});

/**
 * GET /api/memory/global-stats
 * Get global statistics across all projects (for debugging)
 */
router.get('/global-stats', async (req: Request, res: Response) => {
  try {
    const stats = MemoryService.getGlobalStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    handleError(res, error, 'Failed to get global stats');
  }
});

export default router;