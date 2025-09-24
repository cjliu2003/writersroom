"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const snapshotService_1 = __importDefault(require("../services/snapshotService"));
const router = express_1.default.Router();
const handleError = (res, error, message = 'An error occurred') => {
    console.error('Snapshot API Error:', error);
    res.status(500).json({
        success: false,
        message,
        error: error instanceof Error ? error.message : 'Unknown error'
    });
};
router.post('/:id/snapshot', async (req, res) => {
    try {
        const projectId = req.params.id;
        const { version, scenes, elements, metadata, title } = req.body;
        console.log(`\n🚀 SNAPSHOT API: Storing snapshot for project ${projectId}`);
        console.log(`   Scenes received: ${scenes?.length || 0}`);
        console.log(`   Elements received: ${elements?.length || 0}`);
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
        const snapshot = snapshotService_1.default.storeSnapshot(projectId, {
            version: version || Date.now(),
            title,
            scenes: scenes,
            elements,
            metadata
        });
        res.json({
            success: true,
            version: snapshot.version,
            count: snapshot.scenes.length,
            projectId: snapshot.projectId,
            metadata: snapshot.metadata
        });
        console.log(`   ✅ Snapshot stored successfully with ${snapshot.scenes.length} scenes`);
    }
    catch (error) {
        handleError(res, error, 'Failed to store project snapshot');
    }
});
router.get('/:id/snapshot', async (req, res) => {
    try {
        const projectId = req.params.id;
        console.log(`\n🔍 SNAPSHOT API: Retrieving snapshot for project ${projectId}`);
        if (!projectId) {
            return res.status(400).json({
                success: false,
                message: 'Project ID is required'
            });
        }
        const snapshot = snapshotService_1.default.getSnapshot(projectId);
        if (!snapshot) {
            console.log(`   ⚠️ No snapshot found`);
            return res.status(404).json({
                success: false,
                message: 'Project snapshot not found'
            });
        }
        res.json({
            success: true,
            data: snapshot
        });
        console.log(`   ✅ Snapshot retrieved with ${snapshot.scenes.length} scenes`);
    }
    catch (error) {
        handleError(res, error, 'Failed to retrieve project snapshot');
    }
});
router.patch('/:id/snapshot/metadata', async (req, res) => {
    try {
        const projectId = req.params.id;
        const metadata = req.body;
        if (!projectId) {
            return res.status(400).json({
                success: false,
                message: 'Project ID is required'
            });
        }
        const updated = snapshotService_1.default.updateMetadata(projectId, metadata);
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
    }
    catch (error) {
        handleError(res, error, 'Failed to update snapshot metadata');
    }
});
router.delete('/:id/snapshot', async (req, res) => {
    try {
        const projectId = req.params.id;
        if (!projectId) {
            return res.status(400).json({
                success: false,
                message: 'Project ID is required'
            });
        }
        const deleted = snapshotService_1.default.deleteSnapshot(projectId);
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
    }
    catch (error) {
        handleError(res, error, 'Failed to delete project snapshot');
    }
});
router.get('/:id/snapshot/stats', async (req, res) => {
    try {
        const projectId = req.params.id;
        if (!projectId) {
            return res.status(400).json({
                success: false,
                message: 'Project ID is required'
            });
        }
        const stats = snapshotService_1.default.getStats(projectId);
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
    }
    catch (error) {
        handleError(res, error, 'Failed to get snapshot statistics');
    }
});
router.get('/snapshots', async (req, res) => {
    try {
        const projects = snapshotService_1.default.listProjects();
        res.json({
            success: true,
            data: projects
        });
    }
    catch (error) {
        handleError(res, error, 'Failed to list projects');
    }
});
router.get('/snapshots/global-stats', async (req, res) => {
    try {
        const stats = snapshotService_1.default.getGlobalStats();
        res.json({
            success: true,
            data: stats
        });
    }
    catch (error) {
        handleError(res, error, 'Failed to get global statistics');
    }
});
exports.default = router;
//# sourceMappingURL=snapshot.js.map