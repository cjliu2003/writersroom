#!/usr/bin/env node

/**
 * Test script to verify scene deduplication fix
 *
 * This script tests that duplicate sluglines are properly stored
 * using composite keys (projectId + sceneIndex).
 */

const fetch = require('node-fetch');

const BACKEND_API_URL = 'http://localhost:3001/api';
const TEST_PROJECT_ID = `test_dedup_${Date.now()}`;

// Test scenes with duplicate sluglines
const TEST_SCENES = [
  { slugline: 'INT. TATTOO ROOM - DAY', content: 'First tattoo scene' },
  { slugline: 'EXT. SILK ROAD - NIGHT', content: 'First silk road scene' },
  { slugline: 'INT. TATTOO ROOM - DAY', content: 'Second tattoo scene (duplicate)' },
  { slugline: 'INT. VAULT - CONTINUOUS', content: 'Vault scene' },
  { slugline: 'EXT. SILK ROAD - NIGHT', content: 'Second silk road scene (duplicate)' },
  { slugline: 'INT. TATTOO ROOM - DAY', content: 'Third tattoo scene (duplicate)' },
  { slugline: 'EXT. SILK ROAD - NIGHT', content: 'Third silk road scene (duplicate)' },
];

async function testSceneStorage() {
  console.log('🧪 Testing Scene Deduplication Fix');
  console.log(`📝 Project ID: ${TEST_PROJECT_ID}`);
  console.log(`📊 Total scenes to store: ${TEST_SCENES.length}`);
  console.log('');

  // Count expected duplicates
  const sluglineCounts = {};
  TEST_SCENES.forEach(scene => {
    sluglineCounts[scene.slugline] = (sluglineCounts[scene.slugline] || 0) + 1;
  });

  console.log('Expected duplicates:');
  Object.entries(sluglineCounts)
    .filter(([_, count]) => count > 1)
    .forEach(([slugline, count]) => {
      console.log(`  - ${slugline}: ${count} occurrences`);
    });
  console.log('');

  // Store each scene with its index
  console.log('📤 Storing scenes...');
  let storedCount = 0;

  for (let i = 0; i < TEST_SCENES.length; i++) {
    const scene = TEST_SCENES[i];

    try {
      const response = await fetch(`${BACKEND_API_URL}/memory/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: TEST_PROJECT_ID,
          slugline: scene.slugline,
          sceneIndex: i, // Critical: include scene index
          data: {
            summary: scene.content,
            characters: [],
            tokens: 100,
            wordCount: 20
          }
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`  ✅ Scene ${i + 1}: ${scene.slugline} (ID: ${result.data.sceneId})`);
        storedCount++;
      } else {
        console.error(`  ❌ Failed to store scene ${i + 1}: ${response.status}`);
      }
    } catch (error) {
      console.error(`  ❌ Error storing scene ${i + 1}:`, error.message);
    }
  }

  console.log('');
  console.log(`📊 Stored: ${storedCount}/${TEST_SCENES.length} scenes`);
  console.log('');

  // Verify all scenes are stored
  console.log('🔍 Verifying storage...');

  try {
    const verifyResponse = await fetch(`${BACKEND_API_URL}/memory/all?projectId=${TEST_PROJECT_ID}`);

    if (verifyResponse.ok) {
      const verifyResult = await verifyResponse.json();
      const storedScenes = verifyResult.data || [];

      console.log(`📋 Retrieved: ${storedScenes.length} scenes from memory`);

      // Check if all scenes are present
      if (storedScenes.length === TEST_SCENES.length) {
        console.log('✅ SUCCESS: All scenes stored without deduplication!');

        // Verify each scene has unique ID
        const sceneIds = new Set(storedScenes.map(s => s.sceneId));
        if (sceneIds.size === storedScenes.length) {
          console.log('✅ All scenes have unique IDs');
        } else {
          console.error('❌ Some scenes share the same ID');
        }

        // List all stored scenes
        console.log('');
        console.log('Stored scenes:');
        storedScenes.forEach((scene, i) => {
          console.log(`  ${i + 1}. ${scene.slugline} (ID: ${scene.sceneId}, Index: ${scene.sceneIndex})`);
        });
      } else {
        console.error(`❌ FAILURE: Scene count mismatch!`);
        console.error(`   Expected: ${TEST_SCENES.length} scenes`);
        console.error(`   Got: ${storedScenes.length} scenes`);
        console.error(`   Missing: ${TEST_SCENES.length - storedScenes.length} scenes (likely deduplicated)`);

        // Show what was stored
        const actualSluglineCounts = {};
        storedScenes.forEach(scene => {
          actualSluglineCounts[scene.slugline] = (actualSluglineCounts[scene.slugline] || 0) + 1;
        });

        console.log('');
        console.log('Actual storage:');
        Object.entries(actualSluglineCounts).forEach(([slugline, count]) => {
          const expected = sluglineCounts[slugline];
          const status = count === expected ? '✅' : '❌';
          console.log(`  ${status} ${slugline}: ${count}/${expected}`);
        });
      }
    } else {
      console.error('❌ Failed to verify storage:', verifyResponse.status);
    }
  } catch (error) {
    console.error('❌ Error verifying storage:', error.message);
  }

  // Cleanup
  console.log('');
  console.log('🧹 Cleaning up test data...');
  try {
    await fetch(`${BACKEND_API_URL}/memory/clear?projectId=${TEST_PROJECT_ID}`, {
      method: 'DELETE'
    });
    console.log('✅ Test data cleaned up');
  } catch (error) {
    console.warn('⚠️ Could not clean up test data:', error.message);
  }
}

// Run the test
console.log('========================================');
console.log('  SCENE DEDUPLICATION FIX TEST');
console.log('========================================');
console.log('');

testSceneStorage()
  .then(() => {
    console.log('');
    console.log('========================================');
    console.log('  TEST COMPLETE');
    console.log('========================================');
  })
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });