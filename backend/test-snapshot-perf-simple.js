/**
 * Simple Performance Test for Snapshot System
 */

const fs = require('fs');
const axios = require('axios');

const API_BASE_URL = 'http://localhost:3001/api';
const TEST_PROJECT_ID = 'perf-test-' + Date.now();
const LARGE_SCRIPT_PATH = '/Users/ltw/Documents/GitHub/writersroom/Samsara_250619 copy.fdx';

// Simple FDX parser to extract scenes
function parseSimpleFDX(content) {
  const scenes = [];
  const sceneRegex = /<Paragraph Type="Scene Heading"[^>]*>[\s\S]*?<Text>(.*?)<\/Text>/g;
  const actionRegex = /<Paragraph Type="Action"[^>]*>[\s\S]*?<Text>(.*?)<\/Text>/g;
  const dialogueRegex = /<Paragraph Type="Dialogue"[^>]*>[\s\S]*?<Text>(.*?)<\/Text>/g;

  let match;
  let sceneIndex = 0;

  // Extract all scene headings
  while ((match = sceneRegex.exec(content)) !== null) {
    const slugline = match[1].trim();

    // Extract some content after this scene for the scene data
    const sceneStart = match.index;
    const nextSceneMatch = sceneRegex.exec(content);
    const sceneEnd = nextSceneMatch ? nextSceneMatch.index : content.length;
    sceneRegex.lastIndex = match.index + match[0].length; // Reset regex position

    const sceneContent = content.substring(sceneStart, sceneEnd);

    // Count words in this scene section
    const textMatches = [...sceneContent.matchAll(/<Text>(.*?)<\/Text>/g)];
    const allText = textMatches.map(m => m[1]).join(' ');
    const wordCount = allText.split(/\s+/).filter(w => w.length > 0).length;

    scenes.push({
      sceneId: `scene_${sceneIndex}`,
      sceneIndex: sceneIndex,
      slugline: slugline,
      content: allText.substring(0, 500), // First 500 chars
      wordCount: wordCount,
      tokens: Math.ceil(wordCount * 1.3), // Rough estimate
      timestamp: new Date(),
      projectId: TEST_PROJECT_ID
    });

    sceneIndex++;
  }

  return {
    scenes,
    elements: [],
    title: 'Samsara Test Script'
  };
}

async function runTest() {
  console.log('\n===============================================');
  console.log('SNAPSHOT SYSTEM PERFORMANCE TEST');
  console.log('===============================================\n');

  try {
    // Check server health
    console.log('Checking server health...');
    const health = await axios.get(`${API_BASE_URL}/health`);
    console.log('✅ Server is running\n');
  } catch (error) {
    console.error('❌ Server is not running. Start it with: cd backend && npm run dev');
    process.exit(1);
  }

  // 1. Read and parse file
  console.log('1. READING LARGE SCRIPT FILE');
  console.log(`   File: ${LARGE_SCRIPT_PATH}`);

  const fileContent = fs.readFileSync(LARGE_SCRIPT_PATH, 'utf-8');
  const fileSizeKB = Buffer.byteLength(fileContent, 'utf-8') / 1024;
  console.log(`   File size: ${fileSizeKB.toFixed(2)} KB`);

  const parseStart = Date.now();
  const parsed = parseSimpleFDX(fileContent);
  const parseTime = Date.now() - parseStart;
  console.log(`   Parse time: ${parseTime}ms`);
  console.log(`   Scenes found: ${parsed.scenes.length}`);

  // 2. Create snapshot payload
  console.log('\n2. PREPARING SNAPSHOT PAYLOAD');
  const payload = {
    version: Date.now(),
    title: parsed.title,
    scenes: parsed.scenes,
    elements: parsed.elements,
    metadata: {
      originalFileSize: fileSizeKB * 1024,
      testRun: true
    }
  };

  const payloadJson = JSON.stringify(payload);
  const payloadSizeKB = Buffer.byteLength(payloadJson, 'utf-8') / 1024;
  console.log(`   Payload size: ${payloadSizeKB.toFixed(2)} KB`);
  console.log(`   Expansion ratio: ${(payloadSizeKB / fileSizeKB).toFixed(2)}x`);

  // Check against limit
  const limitMB = 10; // from server.ts
  const payloadMB = payloadSizeKB / 1024;
  const usagePercent = (payloadMB / limitMB) * 100;
  console.log(`   Limit usage: ${usagePercent.toFixed(1)}% of ${limitMB}MB limit`);

  if (usagePercent > 100) {
    console.log('   ❌ PAYLOAD EXCEEDS LIMIT!');
    console.log('   Need to increase express.json({ limit }) in server.ts');
  }

  // 3. Test POST endpoint
  console.log('\n3. TESTING POST /api/projects/:id/snapshot');
  console.log(`   Project ID: ${TEST_PROJECT_ID}`);

  const postStart = Date.now();
  let postSuccess = false;

  try {
    const response = await axios.post(
      `${API_BASE_URL}/projects/${TEST_PROJECT_ID}/snapshot`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 30000
      }
    );

    const postTime = Date.now() - postStart;
    postSuccess = true;

    console.log(`   ✅ POST successful`);
    console.log(`   Status: ${response.status}`);
    console.log(`   Response time: ${postTime}ms`);
    console.log(`   Throughput: ${(payloadSizeKB / (postTime / 1000)).toFixed(2)} KB/s`);

    if (response.data) {
      console.log(`   Scenes stored: ${response.data.count || 'unknown'}`);
    }

  } catch (error) {
    const postTime = Date.now() - postStart;
    console.log(`   ❌ POST failed after ${postTime}ms`);
    console.log(`   Error: ${error.message}`);

    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Response:`, error.response.data);
    }

    if (error.code === 'ECONNRESET' || error.code === 'EPIPE') {
      console.log(`   ⚠️  Connection reset - likely payload too large`);
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      console.log(`   ⚠️  Request timed out - server might be struggling`);
    }
  }

  // 4. Test GET endpoint if POST succeeded
  if (postSuccess) {
    console.log('\n4. TESTING GET /api/projects/:id/snapshot');

    const getStart = Date.now();
    try {
      const response = await axios.get(
        `${API_BASE_URL}/projects/${TEST_PROJECT_ID}/snapshot`,
        { timeout: 30000 }
      );

      const getTime = Date.now() - getStart;
      const responseSize = JSON.stringify(response.data).length / 1024;

      console.log(`   ✅ GET successful`);
      console.log(`   Status: ${response.status}`);
      console.log(`   Response time: ${getTime}ms`);
      console.log(`   Response size: ${responseSize.toFixed(2)} KB`);
      console.log(`   Throughput: ${(responseSize / (getTime / 1000)).toFixed(2)} KB/s`);

      if (response.data?.data) {
        console.log(`   Scenes retrieved: ${response.data.data.scenes.length}`);
      }

    } catch (error) {
      console.log(`   ❌ GET failed`);
      console.log(`   Error: ${error.message}`);
    }

    // 5. Test stats endpoint
    console.log('\n5. TESTING STATS ENDPOINT');
    try {
      const response = await axios.get(
        `${API_BASE_URL}/projects/${TEST_PROJECT_ID}/snapshot/stats`
      );

      if (response.data?.data) {
        const stats = response.data.data;
        console.log(`   Memory usage: ${(stats.memoryUsage / 1024).toFixed(2)} KB`);
        console.log(`   Scene count: ${stats.sceneCount}`);
      }
    } catch (error) {
      console.log(`   Stats failed: ${error.message}`);
    }
  }

  // 6. Server configuration analysis
  console.log('\n===============================================');
  console.log('SERVER CONFIGURATION ANALYSIS');
  console.log('===============================================');

  console.log('\nCurrent Express Settings (from server.ts):');
  console.log('  ✅ JSON limit: 10MB');
  console.log('  ⚠️  No explicit timeout set (default: 2 min)');
  console.log('  ⚠️  No compression middleware');
  console.log('  ⚠️  No request streaming');

  console.log('\nPotential Issues Identified:');

  if (payloadSizeKB > 5000) {
    console.log('  • Large payload (>5MB) may cause:');
    console.log('    - Memory pressure on server');
    console.log('    - Slow response times');
    console.log('    - Connection timeouts');
  }

  console.log('\n===============================================');
  console.log('RECOMMENDATIONS');
  console.log('===============================================');

  console.log('\n1. IMMEDIATE FIXES:');
  if (usagePercent > 80) {
    console.log(`  • Increase JSON limit to ${Math.ceil(payloadMB * 1.5)}MB`);
  }
  console.log('  • Add explicit timeout configuration');
  console.log('  • Add compression middleware');

  console.log('\n2. PERFORMANCE OPTIMIZATIONS:');
  console.log('  • Implement response caching');
  console.log('  • Add request/response compression');
  console.log('  • Consider chunked uploads for very large scripts');

  console.log('\n3. ROBUSTNESS IMPROVEMENTS:');
  console.log('  • Add retry logic with exponential backoff');
  console.log('  • Implement progress tracking for large uploads');
  console.log('  • Add health check endpoint with memory stats');

  // Clean up
  if (postSuccess) {
    console.log('\nCleaning up test data...');
    try {
      await axios.delete(`${API_BASE_URL}/projects/${TEST_PROJECT_ID}/snapshot`);
      console.log('✅ Test snapshot deleted');
    } catch (error) {
      console.log('Could not delete test snapshot');
    }
  }

  // Memory usage
  const memUsage = process.memoryUsage();
  console.log('\n===============================================');
  console.log('CLIENT MEMORY USAGE');
  console.log('===============================================');
  console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Heap Total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
}

// Run the test
runTest().catch(console.error);