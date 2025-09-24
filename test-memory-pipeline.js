#!/usr/bin/env node

/**
 * Memory Persistence Pipeline Diagnostic Test
 * Tests the sr_first_look_final.fdx file through all stages
 * Expected: 53 scenes
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const GROUND_TRUTH_FILE = 'sr_first_look_final.fdx';
const EXPECTED_SCENE_COUNT = 53;
const BACKEND_URL = 'http://localhost:3001/api';
const FRONTEND_URL = 'http://localhost:3000';

// Diagnostic report structure
const diagnosticReport = {
  timestamp: new Date().toISOString(),
  groundTruthFile: GROUND_TRUTH_FILE,
  expectedSceneCount: EXPECTED_SCENE_COUNT,
  stages: {
    stage1_parser: { sceneCount: 0, sluglines: [], errors: [] },
    stage2_memoryWrite: { attemptedWrites: 0, successfulWrites: 0, failedWrites: [], errors: [] },
    stage3_storedState: { backendScenes: 0, localStorageScenes: 0, errors: [] },
    stage4_editorHydration: { loadedScenes: 0, errors: [] }
  },
  sceneTracking: {
    missingAtStage2: [],
    missingAtStage3: [],
    missingAtStage4: []
  },
  conclusion: ''
};

// Helper: Check if backend is running
async function checkBackend() {
  try {
    const response = await fetch(`${BACKEND_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// Helper: Clear backend memory for project
async function clearBackendMemory(projectId) {
  try {
    const response = await fetch(`${BACKEND_URL}/memory/clear?projectId=${projectId}`, {
      method: 'DELETE'
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Stage 1: Parse FDX file directly
async function testParserStage() {
  console.log('\n📊 STAGE 1: PARSER OUTPUT');
  console.log('=' .repeat(60));

  try {
    // Read the FDX file
    const fdxContent = fs.readFileSync(GROUND_TRUTH_FILE, 'utf8');
    console.log(`✓ Loaded ${GROUND_TRUTH_FILE}: ${fdxContent.length} bytes`);

    // Count scene headings using regex patterns
    const scenePatterns = [
      /<Paragraph[^>]*Type="Scene Heading"[^>]*>/gi,
      /<SceneHeading[^>]*>/gi
    ];

    let sceneMatches = [];
    for (const pattern of scenePatterns) {
      const matches = fdxContent.match(pattern);
      if (matches && matches.length > 0) {
        sceneMatches = matches;
        break;
      }
    }

    diagnosticReport.stages.stage1_parser.sceneCount = sceneMatches.length;

    // Extract sluglines
    const sluglineRegex = /<Paragraph[^>]*Type="Scene Heading"[^>]*>.*?<Text[^>]*>(.*?)<\/Text>/gis;
    const sluglines = [];
    let match;
    while ((match = sluglineRegex.exec(fdxContent)) !== null) {
      const slugline = match[1]
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();

      if (slugline) {
        sluglines.push(slugline);
      }
    }

    diagnosticReport.stages.stage1_parser.sluglines = sluglines;

    console.log(`✓ Found ${sceneMatches.length} scene headings in raw FDX`);
    console.log(`✓ Extracted ${sluglines.length} sluglines`);

    if (sluglines.length > 0) {
      console.log('\n📋 First 5 sluglines:');
      sluglines.slice(0, 5).forEach((s, i) => console.log(`  ${i+1}. ${s}`));
      console.log('\n📋 Last 5 sluglines:');
      sluglines.slice(-5).forEach((s, i) => console.log(`  ${sluglines.length - 4 + i}. ${s}`));
    }

    // Check against expected
    if (sceneMatches.length !== EXPECTED_SCENE_COUNT) {
      console.log(`\n⚠️ WARNING: Expected ${EXPECTED_SCENE_COUNT} scenes, found ${sceneMatches.length}`);
      diagnosticReport.stages.stage1_parser.errors.push(
        `Scene count mismatch: expected ${EXPECTED_SCENE_COUNT}, found ${sceneMatches.length}`
      );
    }

  } catch (error) {
    console.error('❌ Parser stage failed:', error.message);
    diagnosticReport.stages.stage1_parser.errors.push(error.message);
  }
}

// Stage 2: Test Memory Write Operations
async function testMemoryWriteStage() {
  console.log('\n📊 STAGE 2: MEMORY WRITE OPERATIONS');
  console.log('=' .repeat(60));

  const projectId = `test_${Date.now()}`;

  try {
    // First, parse the file through the API
    const formData = new FormData();
    const fdxContent = fs.readFileSync(GROUND_TRUTH_FILE);
    const file = new Blob([fdxContent], { type: 'application/octet-stream' });
    formData.append('fdx', file, GROUND_TRUTH_FILE);

    console.log('📤 Sending FDX to import API...');
    const parseResponse = await fetch(`${FRONTEND_URL}/api/fdx/import`, {
      method: 'POST',
      body: formData
    });

    if (!parseResponse.ok) {
      throw new Error(`Import API failed: ${parseResponse.status}`);
    }

    const parseResult = await parseResponse.json();
    console.log(`✓ Parse API returned: ${parseResult.sceneCount} scenes`);
    console.log(`✓ Project ID: ${parseResult.projectId}`);

    // Now check what was written to backend memory
    if (await checkBackend()) {
      console.log('\n🔄 Checking backend memory writes...');

      const memoryResponse = await fetch(`${BACKEND_URL}/memory/all?projectId=${parseResult.projectId}`);
      const memoryResult = await memoryResponse.json();

      if (memoryResult.success) {
        diagnosticReport.stages.stage2_memoryWrite.successfulWrites = memoryResult.data.length;
        diagnosticReport.stages.stage2_memoryWrite.attemptedWrites = parseResult.sceneCount;

        console.log(`✓ Backend has ${memoryResult.data.length} scenes stored`);
        console.log(`✓ Parser reported ${parseResult.sceneCount} scenes`);

        if (memoryResult.data.length !== parseResult.sceneCount) {
          const missing = parseResult.sceneCount - memoryResult.data.length;
          console.log(`\n⚠️ MEMORY WRITE LOSS: ${missing} scenes not stored!`);

          // Find missing scenes
          const storedSlugs = memoryResult.data.map(s => s.slugline);
          const missingSlugs = parseResult.sluglines.filter(s => !storedSlugs.includes(s));
          diagnosticReport.sceneTracking.missingAtStage2 = missingSlugs;

          console.log('Missing scenes:');
          missingSlugs.forEach((s, i) => console.log(`  ${i+1}. ${s}`));
        }

        // Check for fullContent in stored scenes
        const scenesWithContent = memoryResult.data.filter(s => s.fullContent);
        const scenesWithoutContent = memoryResult.data.filter(s => !s.fullContent);

        console.log(`\n📝 Content Analysis:`);
        console.log(`  ✓ Scenes with fullContent: ${scenesWithContent.length}`);
        console.log(`  ❌ Scenes without fullContent: ${scenesWithoutContent.length}`);

        if (scenesWithoutContent.length > 0) {
          console.log('\n⚠️ Scenes missing fullContent:');
          scenesWithoutContent.slice(0, 5).forEach(s => console.log(`  - ${s.slugline}`));
        }
      }
    } else {
      console.log('⚠️ Backend not available - skipping memory write verification');
    }

  } catch (error) {
    console.error('❌ Memory write stage failed:', error.message);
    diagnosticReport.stages.stage2_memoryWrite.errors.push(error.message);
  }
}

// Stage 3: Validate Storage State
async function testStorageState(projectId) {
  console.log('\n📊 STAGE 3: STORAGE STATE VALIDATION');
  console.log('=' .repeat(60));

  try {
    // Check backend storage
    if (await checkBackend()) {
      const response = await fetch(`${BACKEND_API_URL}/memory/all?projectId=${projectId}`);
      const result = await response.json();

      if (result.success) {
        diagnosticReport.stages.stage3_storedState.backendScenes = result.data.length;
        console.log(`✓ Backend storage: ${result.data.length} scenes`);

        // Get memory stats
        const statsResponse = await fetch(`${BACKEND_API_URL}/memory/stats?projectId=${projectId}`);
        const stats = await statsResponse.json();

        if (stats.success) {
          console.log(`\n📈 Memory Statistics:`);
          console.log(`  Total scenes: ${stats.data.totalScenes}`);
          console.log(`  Total tokens: ${stats.data.totalTokens}`);
          console.log(`  Unique characters: ${stats.data.uniqueCharacters.length}`);
          console.log(`  Average words/scene: ${stats.data.averageWordsPerScene}`);
        }
      }
    }

    // Check localStorage (would need browser context for real test)
    console.log('\n📦 LocalStorage check requires browser context');
    console.log('  Run in browser console: localStorage.getItem("wr.projects")');
    console.log(`  Run in browser console: localStorage.getItem("project-${projectId}")`);

  } catch (error) {
    console.error('❌ Storage state validation failed:', error.message);
    diagnosticReport.stages.stage3_storedState.errors.push(error.message);
  }
}

// Stage 4: Test Editor Hydration
async function testEditorHydration(projectId) {
  console.log('\n📊 STAGE 4: EDITOR HYDRATION');
  console.log('=' .repeat(60));

  try {
    console.log('📝 Editor hydration test requires browser context');
    console.log(`  Navigate to: ${FRONTEND_URL}/editor?projectId=${projectId}`);
    console.log('  Check console for scene loading logs');
    console.log('  Verify scene count in UI matches expected');

    // Simulate what the editor would do
    if (await checkBackend()) {
      const response = await fetch(`${BACKEND_URL}/memory/all?projectId=${projectId}`);
      const result = await response.json();

      if (result.success) {
        diagnosticReport.stages.stage4_editorHydration.loadedScenes = result.data.length;
        console.log(`\n✓ Editor would load ${result.data.length} scenes from backend`);

        // Check scene ordering
        console.log('\n🔄 Scene Order Check:');
        result.data.slice(0, 5).forEach((scene, i) => {
          let seqIndex = 'unknown';
          try {
            if (scene.fullContent) {
              const elements = JSON.parse(scene.fullContent);
              if (elements[0]?.metadata?.sequenceIndex !== undefined) {
                seqIndex = elements[0].metadata.sequenceIndex;
              }
            }
          } catch {}
          console.log(`  ${i+1}. "${scene.slugline}" (seq: ${seqIndex})`);
        });
      }
    }

  } catch (error) {
    console.error('❌ Editor hydration test failed:', error.message);
    diagnosticReport.stages.stage4_editorHydration.errors.push(error.message);
  }
}

// Generate final report
function generateReport() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 DIAGNOSTIC REPORT SUMMARY');
  console.log('='.repeat(60));

  const { stages, sceneTracking } = diagnosticReport;

  console.log(`\n📄 Ground Truth: ${GROUND_TRUTH_FILE}`);
  console.log(`   Expected scenes: ${EXPECTED_SCENE_COUNT}`);

  console.log(`\n🔍 Pipeline Analysis:`);
  console.log(`   Stage 1 (Parser):     ${stages.stage1_parser.sceneCount} scenes`);
  console.log(`   Stage 2 (Memory Write): ${stages.stage2_memoryWrite.successfulWrites}/${stages.stage2_memoryWrite.attemptedWrites} written`);
  console.log(`   Stage 3 (Storage):    ${stages.stage3_storedState.backendScenes} in backend`);
  console.log(`   Stage 4 (Editor):     ${stages.stage4_editorHydration.loadedScenes} loadable`);

  // Determine failure point
  let failurePoint = 'No failures detected';
  let sceneLoss = 0;

  if (stages.stage1_parser.sceneCount < EXPECTED_SCENE_COUNT) {
    failurePoint = 'Stage 1: Parser not detecting all scenes';
    sceneLoss = EXPECTED_SCENE_COUNT - stages.stage1_parser.sceneCount;
  } else if (stages.stage2_memoryWrite.successfulWrites < stages.stage2_memoryWrite.attemptedWrites) {
    failurePoint = 'Stage 2→3: Memory write operations failing';
    sceneLoss = stages.stage2_memoryWrite.attemptedWrites - stages.stage2_memoryWrite.successfulWrites;
  } else if (stages.stage3_storedState.backendScenes < stages.stage2_memoryWrite.successfulWrites) {
    failurePoint = 'Stage 3: Storage persistence issue';
    sceneLoss = stages.stage2_memoryWrite.successfulWrites - stages.stage3_storedState.backendScenes;
  } else if (stages.stage4_editorHydration.loadedScenes < stages.stage3_storedState.backendScenes) {
    failurePoint = 'Stage 4: Editor hydration incomplete';
    sceneLoss = stages.stage3_storedState.backendScenes - stages.stage4_editorHydration.loadedScenes;
  }

  console.log(`\n⚠️ FAILURE POINT: ${failurePoint}`);
  if (sceneLoss > 0) {
    console.log(`   Scene loss: ${sceneLoss} scenes`);
  }

  if (sceneTracking.missingAtStage2.length > 0) {
    console.log(`\n📋 Missing at Stage 2 (first 5):`);
    sceneTracking.missingAtStage2.slice(0, 5).forEach(s => console.log(`   - ${s}`));
  }

  // Check for specific issues
  console.log(`\n🔎 Specific Issues:`);

  const allErrors = [
    ...stages.stage1_parser.errors,
    ...stages.stage2_memoryWrite.errors,
    ...stages.stage3_storedState.errors,
    ...stages.stage4_editorHydration.errors
  ];

  if (allErrors.length > 0) {
    allErrors.forEach(err => console.log(`   ❌ ${err}`));
  } else {
    console.log(`   ✓ No critical errors detected`);
  }

  diagnosticReport.conclusion = failurePoint;

  // Save report to file
  const reportPath = `diagnostic_report_${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(diagnosticReport, null, 2));
  console.log(`\n💾 Full report saved to: ${reportPath}`);
}

// Main execution
async function runDiagnostics() {
  console.log('🚀 Starting Memory Persistence Pipeline Diagnostics');
  console.log(`   Ground truth file: ${GROUND_TRUTH_FILE}`);
  console.log(`   Expected scenes: ${EXPECTED_SCENE_COUNT}`);

  // Check if file exists
  if (!fs.existsSync(GROUND_TRUTH_FILE)) {
    console.error(`❌ File not found: ${GROUND_TRUTH_FILE}`);
    process.exit(1);
  }

  // Check if backend is running
  const backendRunning = await checkBackend();
  if (!backendRunning) {
    console.log('⚠️ Backend not running. Starting backend...');
    console.log('   Please run: cd backend && npm start');
    console.log('   Then re-run this diagnostic');
  }

  // Run all stages
  await testParserStage();
  await testMemoryWriteStage();

  // For stage 3 & 4, we need a projectId from stage 2
  // This would come from the actual upload process
  const testProjectId = `imported_${Date.now()}`;
  await testStorageState(testProjectId);
  await testEditorHydration(testProjectId);

  // Generate report
  generateReport();
}

// Run if executed directly
if (require.main === module) {
  runDiagnostics().catch(console.error);
}

module.exports = { runDiagnostics };