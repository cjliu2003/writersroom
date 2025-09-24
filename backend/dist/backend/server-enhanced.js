"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const compression_1 = __importDefault(require("compression"));
const memory_1 = __importDefault(require("./routes/memory"));
const snapshot_1 = __importDefault(require("./routes/snapshot"));
const projects_1 = require("./api/projects");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
app.use((0, compression_1.default)({
    threshold: 1024,
    level: 9,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression_1.default.filter(req, res) ||
            res.getHeader('content-type')?.toString().includes('json');
    }
}));
app.use((0, helmet_1.default)({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use((0, cors_1.default)({
    origin: true,
    credentials: true,
    maxAge: 86400
}));
app.use((0, morgan_1.default)('combined'));
const JSON_LIMIT = process.env.JSON_LIMIT || '50mb';
const URL_LIMIT = process.env.URL_LIMIT || '50mb';
app.use(express_1.default.json({
    limit: JSON_LIMIT,
    reviver: (key, value) => {
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
            return new Date(value);
        }
        return value;
    }
}));
app.use(express_1.default.urlencoded({
    extended: true,
    limit: URL_LIMIT,
    parameterLimit: 10000
}));
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '300000');
app.use((req, res, next) => {
    req.setTimeout(REQUEST_TIMEOUT);
    res.setTimeout(REQUEST_TIMEOUT);
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
app.use((req, res, next) => {
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=30');
    next();
});
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
            requestsServed: global.requestCount || 0
        }
    });
});
app.get('/api/health/performance', (_req, res) => {
    const stats = {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        uptime: process.uptime(),
        pid: process.pid,
        platform: process.platform,
        nodeVersion: process.version,
        v8HeapStats: process.getHeapStatistics ? process.getHeapStatistics() : {}
    };
    res.json({
        success: true,
        stats
    });
});
let requestCount = 0;
app.use((req, res, next) => {
    requestCount++;
    global.requestCount = requestCount;
    const contentLength = req.get('content-length');
    if (contentLength && parseInt(contentLength) > 1024 * 1024) {
        console.log(`📦 Large payload detected: ${(parseInt(contentLength) / 1024 / 1024).toFixed(2)} MB for ${req.method} ${req.url}`);
    }
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (duration > 1000) {
            console.log(`⚠️ Slow request: ${req.method} ${req.url} took ${duration}ms`);
        }
    });
    next();
});
app.use('/api/memory', memory_1.default);
app.use('/api/projects', snapshot_1.default);
app.post('/api/projects/register', projects_1.registerProject);
app.get('/api/projects/list', projects_1.listProjects);
app.delete('/api/projects/:projectId', projects_1.deleteProject);
app.use('*', (req, res) => {
    console.log(`404 Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({
        success: false,
        message: 'API endpoint not found',
        path: req.originalUrl,
        method: req.method
    });
});
app.use((error, req, res, _next) => {
    console.error('=== SERVER ERROR ===');
    console.error('URL:', req.url);
    console.error('Method:', req.method);
    console.error('Error:', error);
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
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
});
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
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
});
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
server.timeout = REQUEST_TIMEOUT;
server.keepAliveTimeout = 30000;
server.headersTimeout = 31000;
exports.default = app;
//# sourceMappingURL=server-enhanced.js.map