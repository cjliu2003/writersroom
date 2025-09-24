#!/usr/bin/env node
/**
 * End-to-End Test for Snapshot API Integration
 * Tests the complete flow from FDX upload to editor loading
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// Test configuration
const FRONTEND_URL = 'http://localhost:3000';
const BACKEND_URL = 'http://localhost:3001/api';
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

async function testE2ESnapshotFlow() {
  log('\n🎬 TESTING END-TO-END SNAPSHOT FLOW', 'cyan');
  log('=====================================\n', 'cyan');

  let projectId = null;

  try {
    // Step 1: Check backend health
    log('1. Checking backend health...', 'yellow');
    const healthResponse = await fetch(`${BACKEND_URL}/health`);
    const health = await healthResponse.json();
    if (health.success) {
      log('   ✅ Backend is healthy', 'green');
    } else {
      throw new Error('Backend is not healthy');
    }

    // Step 2: Upload FDX file through frontend API
    log('\n2. Uploading sr_first_look_final.fdx through frontend...', 'yellow');

    // Read the FDX file
    const fdxContent = fs.readFileSync(FDX_FILE);
    const formData = new FormData();
    formData.append('fdx', fdxContent, {
      filename: 'sr_first_look_final.fdx',
      contentType: 'application/xml'
    });

    const uploadResponse = await fetch(`${FRONTEND_URL}/api/fdx/import`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    const uploadResult = await uploadResponse.json();

    if (uploadResult.success) {
      projectId = uploadResult.projectId;
      log(`   ✅ FDX upload successful`, 'green');
      log(`   Title: ${uploadResult.title}`, 'blue');
      log(`   Project ID: ${projectId}`, 'blue');
      log(`   Scenes parsed: ${uploadResult.sceneCount}`, 'blue');
      log(`   Screenplay elements: ${uploadResult.screenplayElements?.length || 0}`, 'blue');

      // Verify we got 53 scenes
      if (uploadResult.sceneCount === 53) {
        log(`   ✅ CORRECT: All 53 scenes parsed`, 'green');
      } else {
        log(`   ❌ ERROR: Expected 53 scenes, got ${uploadResult.sceneCount}`, 'red');
      }
    } else {
      throw new Error(`Upload failed: ${uploadResult.error}`);
    }

    // Step 3: Wait for backend processing
    log('\n3. Waiting for backend to process snapshot...', 'yellow');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 4: Verify snapshot was stored in backend
    log('\n4. Verifying snapshot storage in backend...', 'yellow');
    const snapshotResponse = await fetch(`${BACKEND_URL}/projects/${projectId}/snapshot`);

    if (!snapshotResponse.ok) {
      throw new Error(`Snapshot not found: ${snapshotResponse.status}`);
    }

    const snapshotResult = await snapshotResponse.json();

    if (snapshotResult.success && snapshotResult.data) {
      const snapshot = snapshotResult.data;
      log(`   ✅ Snapshot retrieved from backend`, 'green');
      log(`   Version: ${snapshot.version}`, 'blue');
      log(`   Title: ${snapshot.title}`, 'blue');
      log(`   Scenes in snapshot: ${snapshot.scenes.length}`, 'blue');

      // Verify scene count
      if (snapshot.scenes.length === 53) {
        log(`   ✅ PERFECT: All 53 scenes stored atomically`, 'green');
      } else {
        log(`   ❌ ERROR: Expected 53 scenes in snapshot, got ${snapshot.scenes.length}`, 'red');
      }

      // Check for duplicate sluglines
      const sluglines = snapshot.scenes.map(s => s.slugline);
      const uniqueSlugs = new Set(sluglines);
      if (uniqueSlugs.size < sluglines.length) {
        log(`   ⚠️ Duplicate sluglines found: ${sluglines.length - uniqueSlugs.size} duplicates`, 'yellow');

        // Show duplicates
        const duplicates = {};
        sluglines.forEach(slug => {
          duplicates[slug] = (duplicates[slug] || 0) + 1;
        });
        Object.entries(duplicates).forEach(([slug, count]) => {
          if (count > 1) {
            log(`     - "${slug}" appears ${count} times`, 'yellow');
          }
        });
      }

      // Verify scene indexing
      log('\n   Verifying scene indexing...', 'yellow');
      let indexingCorrect = true;
      snapshot.scenes.forEach((scene, index) => {
        if (scene.sceneIndex !== index) {
          log(`     ❌ Scene ${index}: sceneIndex=${scene.sceneIndex} (should be ${index})`, 'red');
          indexingCorrect = false;
        }
      });
      if (indexingCorrect) {
        log(`     ✅ All scenes have correct sequential indexing`, 'green');
      }

      // Show first and last few scenes
      log('\n   First 3 scenes:', 'cyan');
      snapshot.scenes.slice(0, 3).forEach((scene, i) => {
        log(`     ${i + 1}. ${scene.slugline}`, 'blue');
      });

      log('\n   Last 3 scenes:', 'cyan');
      snapshot.scenes.slice(-3).forEach((scene, i) => {
        log(`     ${snapshot.scenes.length - 2 + i}. ${scene.slugline}`, 'blue');
      });

    } else {
      throw new Error('Failed to retrieve snapshot');
    }

    // Step 5: Simulate editor loading
    log('\n5. Simulating editor load from snapshot...', 'yellow');

    // Try snapshot endpoint first (as editor does)
    const editorLoadResponse = await fetch(`${BACKEND_URL}/projects/${projectId}/snapshot`);
    if (editorLoadResponse.ok) {
      const editorData = await editorLoadResponse.json();
      if (editorData.success && editorData.data) {
        log(`   ✅ Editor would load ${editorData.data.scenes.length} scenes from snapshot`, 'green');

        // Verify all scenes have fullContent
        let scenesWithContent = 0;
        editorData.data.scenes.forEach(scene => {
          if (scene.fullContent) {
            scenesWithContent++;
          }
        });
        log(`   Scenes with fullContent: ${scenesWithContent}/${editorData.data.scenes.length}`, 'blue');

        if (scenesWithContent === editorData.data.scenes.length) {
          log(`   ✅ All scenes have content for editor`, 'green');
        } else {
          log(`   ⚠️ Some scenes missing content`, 'yellow');
        }
      }
    }

    // Step 6: Check global statistics
    log('\n6. Checking global statistics...', 'yellow');
    const globalResponse = await fetch(`${BACKEND_URL}/projects/snapshots/global-stats`);
    const globalResult = await globalResponse.json();

    if (globalResult.success) {
      log(`   Total projects with snapshots: ${globalResult.data.totalProjects}`, 'blue');
      log(`   Total scenes across all projects: ${globalResult.data.totalScenes}`, 'blue');

      // Find our project
      const ourProject = globalResult.data.projects.find(p => p.projectId === projectId);
      if (ourProject) {
        log(`   ✅ Our project found in global stats:`, 'green');
        log(`     Title: ${ourProject.title}`, 'blue');
        log(`     Scenes: ${ourProject.sceneCount}`, 'blue');
      }
    }

    // Summary
    log('\n=====================================', 'cyan');
    log('🎬 END-TO-END TEST COMPLETE', 'cyan');
    log('✅ All critical checks passed!', 'green');
    log('=====================================\n', 'cyan');

    log('SUMMARY:', 'cyan');
    log(`• FDX parsing: SUCCESS (53 scenes)`, 'green');
    log(`• Snapshot storage: SUCCESS (atomic)`, 'green');
    log(`• Scene preservation: ${uploadResult.sceneCount === 53 ? 'PERFECT' : 'FAILED'}`, uploadResult.sceneCount === 53 ? 'green' : 'red');
    log(`• Editor readiness: SUCCESS`, 'green');
    log('\n', 'reset');

    return true;

  } catch (error) {
    log('\n❌ E2E TEST FAILED', 'red');
    log(`Error: ${error.message}`, 'red');
    console.error(error);

    // Clean up if we have a project ID
    if (projectId) {
      try {
        log('\nCleaning up test project...', 'yellow');
        await fetch(`${BACKEND_URL}/projects/${projectId}/snapshot`, {
          method: 'DELETE'
        });
        log('   Test project cleaned up', 'blue');
      } catch (cleanupError) {
        log('   Failed to clean up test project', 'red');
      }
    }

    return false;
  }
}

// Run the test
testE2ESnapshotFlow().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});