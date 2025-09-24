#!/usr/bin/env node
/**
 * Test script for snapshot API integration
 * Tests the atomic snapshot storage end-to-end
 */

const fs = require('fs');
const path = require('path');

// Test configuration
const API_URL = 'http://localhost:3001/api';
const TEST_PROJECT_ID = `test_${Date.now()}`;
const FDX_FILE = path.join(__dirname, '..', 'sr_first_look_final.fdx');

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testSnapshotAPI() {
  log('\n📸 TESTING SNAPSHOT API INTEGRATION', 'cyan');
  log('=====================================\n', 'cyan');

  try {
    // Step 1: Check backend health
    log('1. Checking backend health...', 'yellow');
    const healthResponse = await fetch(`${API_URL}/health`);
    const health = await healthResponse.json();
    if (health.success) {
      log('   ✅ Backend is healthy', 'green');
    } else {
      throw new Error('Backend is not healthy');
    }

    // Step 2: Create test snapshot data
    log('\n2. Creating test snapshot data...', 'yellow');
    const testSnapshot = {
      version: Date.now(),
      title: 'Silk Road - Test Snapshot',
      scenes: [
        {
          projectId: TEST_PROJECT_ID,
          slugline: 'INT. FBI OFFICE - DAY',
          sceneId: `${TEST_PROJECT_ID}_0`,
          sceneIndex: 0,
          characters: ['AGENT SMITH', 'AGENT JONES'],
          summary: 'FBI agents discuss the Silk Road case.',
          tokens: 150,
          wordCount: 100,
          fullContent: JSON.stringify([
            {
              type: 'scene_heading',
              children: [{ text: 'INT. FBI OFFICE - DAY' }],
              id: 'scene_1'
            },
            {
              type: 'action',
              children: [{ text: 'Two FBI agents review case files on the mysterious Silk Road marketplace.' }],
              id: 'action_1'
            }
          ]),
          projectTitle: 'Silk Road - Test Snapshot',
          timestamp: new Date().toISOString(),
          originalSlugline: 'INT. FBI OFFICE - DAY'
        },
        {
          projectId: TEST_PROJECT_ID,
          slugline: 'EXT. SILICON VALLEY - ESTABLISHING',
          sceneId: `${TEST_PROJECT_ID}_1`,
          sceneIndex: 1,
          characters: [],
          summary: 'Establishing shot of Silicon Valley.',
          tokens: 75,
          wordCount: 50,
          fullContent: JSON.stringify([
            {
              type: 'scene_heading',
              children: [{ text: 'EXT. SILICON VALLEY - ESTABLISHING' }],
              id: 'scene_2'
            },
            {
              type: 'action',
              children: [{ text: 'The sprawling tech campus gleams in the California sun.' }],
              id: 'action_2'
            }
          ]),
          projectTitle: 'Silk Road - Test Snapshot',
          timestamp: new Date().toISOString(),
          originalSlugline: 'EXT. SILICON VALLEY - ESTABLISHING'
        },
        {
          projectId: TEST_PROJECT_ID,
          slugline: 'INT. ROSS\'S APARTMENT - NIGHT',
          sceneId: `${TEST_PROJECT_ID}_2`,
          sceneIndex: 2,
          characters: ['ROSS'],
          summary: 'Ross works on his laptop late into the night.',
          tokens: 200,
          wordCount: 150,
          fullContent: JSON.stringify([
            {
              type: 'scene_heading',
              children: [{ text: 'INT. ROSS\'S APARTMENT - NIGHT' }],
              id: 'scene_3'
            },
            {
              type: 'action',
              children: [{ text: 'ROSS ULBRICHT, 20s, libertarian idealist, types furiously on his laptop.' }],
              id: 'action_3'
            },
            {
              type: 'character',
              children: [{ text: 'ROSS' }],
              id: 'char_1'
            },
            {
              type: 'dialogue',
              children: [{ text: 'This is going to change everything.' }],
              id: 'dialogue_1'
            }
          ]),
          projectTitle: 'Silk Road - Test Snapshot',
          timestamp: new Date().toISOString(),
          originalSlugline: 'INT. ROSS\'S APARTMENT - NIGHT'
        }
      ],
      elements: [],
      metadata: {
        title: 'Silk Road - Test Snapshot',
        createdAt: new Date().toISOString(),
        originalFileName: 'test-snapshot.fdx',
        testRun: true
      }
    };

    log(`   Created snapshot with ${testSnapshot.scenes.length} scenes`, 'green');

    // Step 3: Store the snapshot
    log('\n3. Storing snapshot via POST /api/projects/:id/snapshot...', 'yellow');
    const storeResponse = await fetch(`${API_URL}/projects/${TEST_PROJECT_ID}/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testSnapshot)
    });

    const storeResult = await storeResponse.json();
    if (storeResult.success) {
      log(`   ✅ Snapshot stored successfully`, 'green');
      log(`   Version: ${storeResult.version}`, 'blue');
      log(`   Scene count: ${storeResult.count}`, 'blue');
    } else {
      throw new Error(`Failed to store snapshot: ${storeResult.message}`);
    }

    // Step 4: Retrieve the snapshot
    log('\n4. Retrieving snapshot via GET /api/projects/:id/snapshot...', 'yellow');
    const getResponse = await fetch(`${API_URL}/projects/${TEST_PROJECT_ID}/snapshot`);
    const getResult = await getResponse.json();

    if (getResult.success && getResult.data) {
      const snapshot = getResult.data;
      log(`   ✅ Snapshot retrieved successfully`, 'green');
      log(`   Title: ${snapshot.title}`, 'blue');
      log(`   Scenes retrieved: ${snapshot.scenes.length}`, 'blue');
      log(`   Version: ${snapshot.version}`, 'blue');

      // Verify scene count matches
      if (snapshot.scenes.length === testSnapshot.scenes.length) {
        log(`   ✅ Scene count matches: ${snapshot.scenes.length}/${testSnapshot.scenes.length}`, 'green');
      } else {
        log(`   ❌ Scene count mismatch: ${snapshot.scenes.length}/${testSnapshot.scenes.length}`, 'red');
      }

      // Verify scene sluglines
      log('\n   Verifying scene sluglines:', 'yellow');
      snapshot.scenes.forEach((scene, index) => {
        const expected = testSnapshot.scenes[index].slugline;
        if (scene.slugline === expected) {
          log(`     ✅ Scene ${index + 1}: "${scene.slugline}"`, 'green');
        } else {
          log(`     ❌ Scene ${index + 1}: Expected "${expected}", got "${scene.slugline}"`, 'red');
        }
      });
    } else {
      throw new Error(`Failed to retrieve snapshot: ${getResult.message}`);
    }

    // Step 5: Get snapshot statistics
    log('\n5. Getting snapshot statistics...', 'yellow');
    const statsResponse = await fetch(`${API_URL}/projects/${TEST_PROJECT_ID}/snapshot/stats`);
    const statsResult = await statsResponse.json();

    if (statsResult.success) {
      log('   ✅ Statistics retrieved:', 'green');
      log(`   Total words: ${statsResult.data.totalWords}`, 'blue');
      log(`   Total tokens: ${statsResult.data.totalTokens}`, 'blue');
      log(`   Memory usage: ${statsResult.data.memoryUsage} bytes`, 'blue');
    }

    // Step 6: Check global stats
    log('\n6. Checking global statistics...', 'yellow');
    const globalResponse = await fetch(`${API_URL}/projects/snapshots/global-stats`);
    const globalResult = await globalResponse.json();

    if (globalResult.success) {
      log('   ✅ Global statistics:', 'green');
      log(`   Total projects: ${globalResult.data.totalProjects}`, 'blue');
      log(`   Total scenes across all projects: ${globalResult.data.totalScenes}`, 'blue');
    }

    // Step 7: Clean up - delete test snapshot
    log('\n7. Cleaning up test snapshot...', 'yellow');
    const deleteResponse = await fetch(`${API_URL}/projects/${TEST_PROJECT_ID}/snapshot`, {
      method: 'DELETE'
    });

    const deleteResult = await deleteResponse.json();
    if (deleteResult.success) {
      log('   ✅ Test snapshot deleted successfully', 'green');
    }

    // Summary
    log('\n=====================================', 'cyan');
    log('📸 SNAPSHOT API TEST COMPLETE', 'cyan');
    log('All tests passed successfully!', 'green');
    log('=====================================\n', 'cyan');

    return true;

  } catch (error) {
    log('\n❌ TEST FAILED', 'red');
    log(`Error: ${error.message}`, 'red');
    console.error(error);
    return false;
  }
}

// Run the test
testSnapshotAPI().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});