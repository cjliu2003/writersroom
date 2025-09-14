"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const memoryService_1 = __importDefault(require("../services/memoryService"));
const router = express_1.default.Router();
const handleError = (res, error, message = 'An error occurred') => {
    console.error('Memory API Error:', error);
    const response = {
        success: false,
        message,
        error: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(response);
};
router.post('/update', async (req, res) => {
    try {
        const { projectId, slugline, data } = req.body;
        if (!projectId || !slugline) {
            const response = {
                success: false,
                message: 'Missing required fields: projectId and slugline'
            };
            return res.status(400).json(response);
        }
        const updatedScene = memoryService_1.default.updateSceneMemory(projectId, slugline, data);
        const response = {
            success: true,
            data: updatedScene
        };
        res.json(response);
    }
    catch (error) {
        handleError(res, error, 'Failed to update scene memory');
    }
});
router.get('/recent', async (req, res) => {
    try {
        const { projectId, count } = req.query;
        if (!projectId) {
            const response = {
                success: false,
                message: 'Missing required parameter: projectId'
            };
            return res.status(400).json(response);
        }
        const sceneCount = count ? parseInt(count, 10) : 3;
        const scenes = memoryService_1.default.getRecentScenes(projectId, sceneCount);
        const response = {
            success: true,
            data: scenes
        };
        res.json(response);
    }
    catch (error) {
        handleError(res, error, 'Failed to get recent scenes');
    }
});
router.get('/by-slugline', async (req, res) => {
    try {
        const { projectId, slugline } = req.query;
        if (!projectId || !slugline) {
            const response = {
                success: false,
                message: 'Missing required parameters: projectId and slugline'
            };
            return res.status(400).json(response);
        }
        const scene = memoryService_1.default.getSceneBySlugline(projectId, slugline);
        const response = {
            success: true,
            data: scene
        };
        res.json(response);
    }
    catch (error) {
        handleError(res, error, 'Failed to get scene by slugline');
    }
});
router.get('/by-character', async (req, res) => {
    try {
        const { projectId, name } = req.query;
        if (!projectId || !name) {
            const response = {
                success: false,
                message: 'Missing required parameters: projectId and name'
            };
            return res.status(400).json(response);
        }
        const scenes = memoryService_1.default.getScenesByCharacter(projectId, name);
        const response = {
            success: true,
            data: scenes
        };
        res.json(response);
    }
    catch (error) {
        handleError(res, error, 'Failed to get scenes by character');
    }
});
router.get('/by-theme', async (req, res) => {
    try {
        const { projectId, theme } = req.query;
        if (!projectId || !theme) {
            const response = {
                success: false,
                message: 'Missing required parameters: projectId and theme'
            };
            return res.status(400).json(response);
        }
        const scenes = memoryService_1.default.getScenesByTheme(projectId, theme);
        const response = {
            success: true,
            data: scenes
        };
        res.json(response);
    }
    catch (error) {
        handleError(res, error, 'Failed to get scenes by theme');
    }
});
router.get('/tokens', async (req, res) => {
    try {
        const { projectId, sceneCount } = req.query;
        if (!projectId) {
            const response = {
                success: false,
                message: 'Missing required parameter: projectId'
            };
            return res.status(400).json(response);
        }
        const count = sceneCount ? parseInt(sceneCount, 10) : 3;
        const totalTokens = memoryService_1.default.getTotalRecentTokens(projectId, count);
        const response = {
            success: true,
            data: totalTokens
        };
        res.json(response);
    }
    catch (error) {
        handleError(res, error, 'Failed to get token count');
    }
});
router.get('/all', async (req, res) => {
    try {
        const { projectId } = req.query;
        if (!projectId) {
            const response = {
                success: false,
                message: 'Missing required parameter: projectId'
            };
            return res.status(400).json(response);
        }
        const scenes = memoryService_1.default.getAllScenes(projectId);
        const response = {
            success: true,
            data: scenes
        };
        res.json(response);
    }
    catch (error) {
        handleError(res, error, 'Failed to get all scenes');
    }
});
router.get('/stats', async (req, res) => {
    try {
        const { projectId } = req.query;
        if (!projectId) {
            const response = {
                success: false,
                message: 'Missing required parameter: projectId'
            };
            return res.status(400).json(response);
        }
        const stats = memoryService_1.default.getMemoryStats(projectId);
        const response = {
            success: true,
            data: stats
        };
        res.json(response);
    }
    catch (error) {
        handleError(res, error, 'Failed to get memory stats');
    }
});
router.delete('/clear', async (req, res) => {
    try {
        const { projectId } = req.query;
        if (!projectId) {
            const response = {
                success: false,
                message: 'Missing required parameter: projectId'
            };
            return res.status(400).json(response);
        }
        memoryService_1.default.clearSceneMemory(projectId);
        const response = {
            success: true,
            data: []
        };
        res.json(response);
    }
    catch (error) {
        handleError(res, error, 'Failed to clear scene memory');
    }
});
router.delete('/scene', async (req, res) => {
    try {
        const { projectId, slugline } = req.query;
        if (!projectId || !slugline) {
            const response = {
                success: false,
                message: 'Missing required parameters: projectId and slugline'
            };
            return res.status(400).json(response);
        }
        const deleted = memoryService_1.default.deleteScene(projectId, slugline);
        if (!deleted) {
            const response = {
                success: false,
                message: 'Scene not found'
            };
            return res.status(404).json(response);
        }
        const response = {
            success: true,
            data: []
        };
        res.json(response);
    }
    catch (error) {
        handleError(res, error, 'Failed to delete scene');
    }
});
router.get('/global-stats', async (req, res) => {
    try {
        const stats = memoryService_1.default.getGlobalStats();
        res.json({
            success: true,
            data: stats
        });
    }
    catch (error) {
        handleError(res, error, 'Failed to get global stats');
    }
});
exports.default = router;
//# sourceMappingURL=memory.js.map