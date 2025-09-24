"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const memory_1 = __importDefault(require("./routes/memory"));
const snapshot_1 = __importDefault(require("./routes/snapshot"));
const projects_1 = require("./api/projects");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use((0, morgan_1.default)('combined'));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.get('/api/health', (_req, res) => {
    res.json({
        success: true,
        message: 'Writersroom Backend API is running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});
app.use('/api/memory', memory_1.default);
app.use('/api/projects', snapshot_1.default);
app.post('/api/projects/register', projects_1.registerProject);
app.get('/api/projects/list', projects_1.listProjects);
app.delete('/api/projects/:projectId', projects_1.deleteProject);
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'API endpoint not found',
        path: req.originalUrl
    });
});
app.use((error, _req, res, _next) => {
    console.error('Server Error:', error);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
});
app.listen(PORT, () => {
    console.log(`🚀 Writersroom Backend API running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
    console.log(`💾 Memory API: http://localhost:${PORT}/api/memory/*`);
    console.log(`📸 Snapshot API: http://localhost:${PORT}/api/projects/:id/snapshot`);
    console.log(`📁 Projects API: http://localhost:${PORT}/api/projects/*`);
});
exports.default = app;
//# sourceMappingURL=server.js.map