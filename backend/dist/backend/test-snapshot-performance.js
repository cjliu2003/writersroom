"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.measurePerformance = measurePerformance;
exports.checkServerLimits = checkServerLimits;
const fs_1 = __importDefault(require("fs"));
const axios_1 = __importDefault(require("axios"));
const script_parser_1 = require("../shared/script-parser");
const API_BASE_URL = 'http://localhost:3001/api';
const TEST_PROJECT_ID = 'perf-test-' + Date.now();
const LARGE_SCRIPT_PATH = '/Users/ltw/Documents/GitHub/writersroom/Samsara_250619 copy.fdx';
async function measurePerformance() {
    const metrics = {
        fileSize: 0,
        parseTime: 0,
        postPayloadSize: 0,
        postTime: 0,
        postStatus: 0,
        getTime: 0,
        getStatus: 0,
        getPayloadSize: 0,
        memoryUsage: process.memoryUsage(),
        errors: []
    };
    console.log('\n===============================================');
    console.log('SNAPSHOT SYSTEM PERFORMANCE TEST');
    console.log('===============================================\n');
    try {
        console.log('1. READING AND PARSING LARGE SCRIPT');
        console.log('   File:', LARGE_SCRIPT_PATH);
        const fileContent = fs_1.default.readFileSync(LARGE_SCRIPT_PATH, 'utf-8');
        metrics.fileSize = Buffer.byteLength(fileContent, 'utf-8');
        console.log(`   File size: ${(metrics.fileSize / 1024).toFixed(2)} KB`);
        const parseStart = Date.now();
        const parsedData = (0, script_parser_1.parseScript)(fileContent);
        metrics.parseTime = Date.now() - parseStart;
        console.log(`   Parse time: ${metrics.parseTime}ms`);
        console.log(`   Scenes parsed: ${parsedData.scenes.length}`);
        console.log(`   Elements parsed: ${parsedData.elements.length}`);
        console.log('\n2. PREPARING SNAPSHOT PAYLOAD');
        const snapshotPayload = {
            version: Date.now(),
            title: parsedData.title || 'Performance Test Script',
            scenes: parsedData.scenes.map((scene, index) => ({
                ...scene,
                sceneIndex: index,
                projectId: TEST_PROJECT_ID,
                sceneId: `${TEST_PROJECT_ID}_${index}`,
                timestamp: new Date()
            })),
            elements: parsedData.elements,
            metadata: {
                testRun: true,
                originalFileSize: metrics.fileSize,
                sceneCount: parsedData.scenes.length
            }
        };
        const payloadJson = JSON.stringify(snapshotPayload);
        metrics.postPayloadSize = Buffer.byteLength(payloadJson, 'utf-8');
        console.log(`   POST payload size: ${(metrics.postPayloadSize / 1024).toFixed(2)} KB`);
        console.log(`   Payload expansion ratio: ${(metrics.postPayloadSize / metrics.fileSize).toFixed(2)}x`);
        console.log('\n3. TESTING POST /api/projects/:id/snapshot');
        console.log(`   Project ID: ${TEST_PROJECT_ID}`);
        const postStart = Date.now();
        try {
            const postResponse = await axios_1.default.post(`${API_BASE_URL}/projects/${TEST_PROJECT_ID}/snapshot`, snapshotPayload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': metrics.postPayloadSize.toString()
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 30000
            });
            metrics.postTime = Date.now() - postStart;
            metrics.postStatus = postResponse.status;
            console.log(`   ✅ POST successful`);
            console.log(`   Status: ${postResponse.status}`);
            console.log(`   Response time: ${metrics.postTime}ms`);
            console.log(`   Throughput: ${((metrics.postPayloadSize / 1024) / (metrics.postTime / 1000)).toFixed(2)} KB/s`);
            if (postResponse.data) {
                console.log(`   Scenes stored: ${postResponse.data.count}`);
                console.log(`   Version: ${postResponse.data.version}`);
            }
        }
        catch (error) {
            const axiosError = error;
            metrics.errors.push(`POST failed: ${axiosError.message}`);
            console.log(`   ❌ POST failed`);
            console.log(`   Error: ${axiosError.message}`);
            if (axiosError.response) {
                metrics.postStatus = axiosError.response.status;
                console.log(`   Status: ${axiosError.response.status}`);
                console.log(`   Response:`, axiosError.response.data);
            }
            if (axiosError.code === 'ECONNRESET' || axiosError.code === 'EPIPE') {
                console.log(`   ⚠️  Connection reset - likely due to payload size`);
            }
        }
        console.log('\n4. TESTING GET /api/projects/:id/snapshot');
        const getStart = Date.now();
        try {
            const getResponse = await axios_1.default.get(`${API_BASE_URL}/projects/${TEST_PROJECT_ID}/snapshot`, {
                timeout: 30000
            });
            metrics.getTime = Date.now() - getStart;
            metrics.getStatus = getResponse.status;
            const responseJson = JSON.stringify(getResponse.data);
            metrics.getPayloadSize = Buffer.byteLength(responseJson, 'utf-8');
            console.log(`   ✅ GET successful`);
            console.log(`   Status: ${getResponse.status}`);
            console.log(`   Response time: ${metrics.getTime}ms`);
            console.log(`   Response size: ${(metrics.getPayloadSize / 1024).toFixed(2)} KB`);
            console.log(`   Throughput: ${((metrics.getPayloadSize / 1024) / (metrics.getTime / 1000)).toFixed(2)} KB/s`);
            if (getResponse.data?.data) {
                console.log(`   Scenes retrieved: ${getResponse.data.data.scenes.length}`);
                console.log(`   Version: ${getResponse.data.data.version}`);
            }
        }
        catch (error) {
            const axiosError = error;
            metrics.errors.push(`GET failed: ${axiosError.message}`);
            console.log(`   ❌ GET failed`);
            console.log(`   Error: ${axiosError.message}`);
            if (axiosError.response) {
                metrics.getStatus = axiosError.response.status;
                console.log(`   Status: ${axiosError.response.status}`);
            }
        }
        console.log('\n5. MEMORY USAGE');
        metrics.memoryUsage = process.memoryUsage();
        console.log(`   RSS: ${(metrics.memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Heap Used: ${(metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Heap Total: ${(metrics.memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   External: ${(metrics.memoryUsage.external / 1024 / 1024).toFixed(2)} MB`);
        console.log('\n6. TESTING STATS ENDPOINT');
        try {
            const statsResponse = await axios_1.default.get(`${API_BASE_URL}/projects/${TEST_PROJECT_ID}/snapshot/stats`);
            if (statsResponse.data?.data) {
                const stats = statsResponse.data.data;
                console.log(`   Memory usage in backend: ${(stats.memoryUsage / 1024).toFixed(2)} KB`);
                console.log(`   Scene count: ${stats.sceneCount}`);
                console.log(`   Total words: ${stats.totalWords}`);
                console.log(`   Total tokens: ${stats.totalTokens}`);
            }
        }
        catch (error) {
            console.log(`   Stats endpoint failed: ${error.message}`);
        }
    }
    catch (error) {
        console.error('Test failed:', error);
        metrics.errors.push(error.message);
    }
    console.log('\n===============================================');
    console.log('PERFORMANCE SUMMARY');
    console.log('===============================================');
    console.log(`File size: ${(metrics.fileSize / 1024).toFixed(2)} KB`);
    console.log(`POST payload: ${(metrics.postPayloadSize / 1024).toFixed(2)} KB`);
    console.log(`POST time: ${metrics.postTime}ms`);
    console.log(`GET time: ${metrics.getTime}ms`);
    console.log(`Total errors: ${metrics.errors.length}`);
    if (metrics.errors.length > 0) {
        console.log('\nERRORS:');
        metrics.errors.forEach(err => console.log(`  - ${err}`));
    }
    return metrics;
}
async function checkServerLimits() {
    console.log('\n===============================================');
    console.log('SERVER CONFIGURATION CHECK');
    console.log('===============================================\n');
    console.log('Current Express configuration (from server.ts):');
    console.log('  - express.json({ limit: "10mb" })');
    console.log('  - Default timeout: None set (Node.js default: 2 minutes)');
    console.log('  - Keep-alive: Default enabled');
    console.log('\nRecommendations for large payloads:');
    console.log('  1. Increase JSON limit if needed (current: 10mb)');
    console.log('  2. Add explicit timeout configuration');
    console.log('  3. Consider streaming for very large payloads');
    console.log('  4. Add compression middleware (compression package)');
    console.log('  5. Implement request size validation before parsing');
}
async function main() {
    try {
        const health = await axios_1.default.get(`${API_BASE_URL}/health`);
        console.log('✅ Server is running:', health.data.message);
    }
    catch (error) {
        console.error('❌ Server is not running. Please start the backend server first.');
        console.error('   Run: cd backend && npm run dev');
        process.exit(1);
    }
    await checkServerLimits();
    const metrics = await measurePerformance();
    console.log('\n===============================================');
    console.log('ANALYSIS & RECOMMENDATIONS');
    console.log('===============================================\n');
    const limitBytes = 10 * 1024 * 1024;
    const usagePercent = (metrics.postPayloadSize / limitBytes) * 100;
    console.log(`Payload size analysis:`);
    console.log(`  - Current payload: ${(metrics.postPayloadSize / 1024).toFixed(2)} KB`);
    console.log(`  - Server limit: 10 MB`);
    console.log(`  - Usage: ${usagePercent.toFixed(1)}%`);
    if (usagePercent > 80) {
        console.log(`  ⚠️  WARNING: Payload is ${usagePercent.toFixed(1)}% of limit`);
        console.log(`  Recommendation: Increase express.json limit`);
    }
    else {
        console.log(`  ✅ Payload is well within limits`);
    }
    console.log(`\nPerformance analysis:`);
    if (metrics.postTime > 5000) {
        console.log(`  ⚠️  POST is slow (${metrics.postTime}ms)`);
        console.log(`  Recommendations:`);
        console.log(`    - Add compression middleware`);
        console.log(`    - Consider chunked uploads for large scripts`);
        console.log(`    - Implement progress indicators`);
    }
    else {
        console.log(`  ✅ POST performance acceptable (${metrics.postTime}ms)`);
    }
    if (metrics.getTime > 3000) {
        console.log(`  ⚠️  GET is slow (${metrics.getTime}ms)`);
        console.log(`  Recommendations:`);
        console.log(`    - Add response compression`);
        console.log(`    - Consider pagination for scenes`);
        console.log(`    - Implement caching layer`);
    }
    else {
        console.log(`  ✅ GET performance acceptable (${metrics.getTime}ms)`);
    }
    console.log('\nCleaning up test data...');
    try {
        await axios_1.default.delete(`${API_BASE_URL}/projects/${TEST_PROJECT_ID}/snapshot`);
        console.log('✅ Test snapshot deleted');
    }
    catch (error) {
        console.log('Could not delete test snapshot:', error.message);
    }
}
if (require.main === module) {
    main().catch(console.error);
}
//# sourceMappingURL=test-snapshot-performance.js.map