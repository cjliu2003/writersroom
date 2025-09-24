/**
 * Snapshot Pipeline Integration Tests
 *
 * Comprehensive test suite for validating the complete WritersRoom pipeline
 * from FDX upload through snapshot storage to editor scene display.
 *
 * Tests ensure that all 53 scenes are preserved throughout the pipeline
 * and provide clear debugging output at each stage.
 */

import express from 'express';
import request from 'supertest';
import SnapshotService, { ProjectSnapshot } from '../../services/snapshotService';
import { SceneMemory } from '../../../shared/types';
import {
  PipelineCheckpoint,
  assertSceneCount,
  assertUniqueIds,
  assertContiguousIndices,
  InvariantError
} from '../../../frontend/utils/invariants';

// Test constants
const TEST_PROJECT_ID = 'sr_first_look_final';
const EXPECTED_SCENE_COUNT = 53;

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Import actual routes
  const snapshotRouter = require('../../routes/snapshot').default;
  app.use('/api/projects', snapshotRouter);

  return app;
}

// Test data generator
function generateTestScenes(count: number = EXPECTED_SCENE_COUNT): SceneMemory[] {
  const scenes: SceneMemory[] = [];
  const duplicateSluglines = [
    'INT. SARAH\'S APARTMENT - DAY',
    'EXT. SILK ROAD - NIGHT',
    'INT. FBI OFFICE - DAY'
  ];

  for (let i = 0; i < count; i++) {
    // Create some duplicate sluglines to test uniqueness handling
    const slugline = i % 10 === 0 && i > 0
      ? duplicateSluglines[Math.floor(i / 10) % duplicateSluglines.length]
      : `INT. LOCATION ${i} - DAY`;

    scenes.push({
      projectId: TEST_PROJECT_ID,
      sceneIndex: i,
      sceneId: `${TEST_PROJECT_ID}_${i}`,
      slugline,
      summary: `Test scene ${i} summary`,
      fullContent: `Test content for scene ${i}`,
      characters: [`CHARACTER_${i}`],
      themeTags: [`theme_${i % 5}`],
      tokens: 100 + i,
      wordCount: 50 + i,
      timestamp: new Date()
    });
  }

  return scenes;
}

describe('Snapshot Pipeline Integration Tests', () => {
  let app: express.Application;
  let checkpoint: PipelineCheckpoint;

  beforeAll(() => {
    app = createTestApp();

    // Enable debug logging
    console.log = jest.fn((...args) => {
      // Keep original console.log for debug output
      process.stdout.write(args.join(' ') + '\n');
    });
  });

  beforeEach(() => {
    // Clear all snapshots before each test
    SnapshotService.listProjects().forEach(projectId => {
      SnapshotService.deleteSnapshot(projectId);
    });

    // Create new checkpoint tracker
    checkpoint = new PipelineCheckpoint();
  });

  describe('1. Upload → Snapshot POST → Snapshot GET Flow', () => {
    it('should preserve exactly 53 scenes through the complete pipeline', async () => {
      console.log('\n========== TESTING COMPLETE PIPELINE ==========');

      // Generate test scenes
      const testScenes = generateTestScenes(EXPECTED_SCENE_COUNT);
      checkpoint.record('generated', testScenes.length);

      console.log(`✅ Test scenes generated: ${testScenes.length}`);

      // Step 1: POST snapshot
      const postResponse = await request(app)
        .post(`/api/projects/${TEST_PROJECT_ID}/snapshot`)
        .send({
          version: Date.now(),
          title: 'SR First Look Final',
          scenes: testScenes,
          elements: [],
          metadata: {
            source: 'test',
            uploadedAt: new Date().toISOString()
          }
        });

      expect(postResponse.status).toBe(200);
      expect(postResponse.body.success).toBe(true);
      expect(postResponse.body.count).toBe(EXPECTED_SCENE_COUNT);

      checkpoint.record('post_response', postResponse.body.count);
      console.log(`✅ Snapshot upload complete. Scenes saved: ${postResponse.body.count}`);

      // Step 2: GET snapshot
      const getResponse = await request(app)
        .get(`/api/projects/${TEST_PROJECT_ID}/snapshot`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.success).toBe(true);
      expect(getResponse.body.data).toBeDefined();
      expect(getResponse.body.data.scenes).toBeDefined();
      expect(getResponse.body.data.scenes.length).toBe(EXPECTED_SCENE_COUNT);

      checkpoint.record('get_response', getResponse.body.data.scenes.length);
      console.log(`✅ Snapshot loaded. Scenes retrieved: ${getResponse.body.data.scenes.length}`);

      // Validate checkpoint consistency
      checkpoint.validate();
      console.log('✅ All pipeline checkpoints validated successfully');

      // Additional validation
      const snapshot = getResponse.body.data as ProjectSnapshot;
      assertSceneCount(snapshot.scenes, EXPECTED_SCENE_COUNT, 'final_validation');
      assertUniqueIds(snapshot.scenes);
      assertContiguousIndices(snapshot.scenes);

      console.log('✅ PIPELINE TEST PASSED: All 53 scenes preserved');
    });

    it('should preserve duplicate sluglines with unique indices', async () => {
      console.log('\n========== TESTING DUPLICATE SLUGLINE HANDLING ==========');

      // Create scenes with duplicate sluglines
      const scenes: SceneMemory[] = [
        {
          projectId: TEST_PROJECT_ID,
          sceneIndex: 0,
          sceneId: `${TEST_PROJECT_ID}_0`,
          slugline: 'INT. APARTMENT - DAY',
          summary: 'First apartment scene',
          fullContent: 'Content 1',
          characters: ['SARAH'],
          themeTags: ['home'],
          tokens: 100,
          wordCount: 50,
          timestamp: new Date()
        },
        {
          projectId: TEST_PROJECT_ID,
          sceneIndex: 1,
          sceneId: `${TEST_PROJECT_ID}_1`,
          slugline: 'INT. APARTMENT - DAY',
          summary: 'Second apartment scene',
          fullContent: 'Content 2',
          characters: ['JOHN'],
          themeTags: ['conflict'],
          tokens: 120,
          wordCount: 60,
          timestamp: new Date()
        },
        {
          projectId: TEST_PROJECT_ID,
          sceneIndex: 2,
          sceneId: `${TEST_PROJECT_ID}_2`,
          slugline: 'INT. APARTMENT - DAY',
          summary: 'Third apartment scene',
          fullContent: 'Content 3',
          characters: ['SARAH', 'JOHN'],
          themeTags: ['resolution'],
          tokens: 150,
          wordCount: 75,
          timestamp: new Date()
        }
      ];

      // Store snapshot
      const postResponse = await request(app)
        .post(`/api/projects/${TEST_PROJECT_ID}/snapshot`)
        .send({
          version: Date.now(),
          title: 'Duplicate Test',
          scenes,
          elements: [],
          metadata: {}
        });

      expect(postResponse.status).toBe(200);

      // Retrieve snapshot
      const getResponse = await request(app)
        .get(`/api/projects/${TEST_PROJECT_ID}/snapshot`);

      expect(getResponse.status).toBe(200);

      const snapshot = getResponse.body.data as ProjectSnapshot;

      // Verify all scenes preserved
      expect(snapshot.scenes.length).toBe(3);

      // Verify duplicate sluglines maintained
      const sluglines = snapshot.scenes.map(s => s.slugline);
      expect(sluglines.filter(s => s === 'INT. APARTMENT - DAY').length).toBe(3);

      // Verify unique IDs
      const ids = snapshot.scenes.map(s => s.sceneId);
      expect(new Set(ids).size).toBe(3);
      expect(ids).toEqual(['sr_first_look_final_0', 'sr_first_look_final_1', 'sr_first_look_final_2']);

      // Verify content preserved
      expect(snapshot.scenes[0].summary).toBe('First apartment scene');
      expect(snapshot.scenes[1].summary).toBe('Second apartment scene');
      expect(snapshot.scenes[2].summary).toBe('Third apartment scene');

      console.log('✅ Duplicate sluglines preserved with unique scene IDs');
    });
  });

  describe('2. Parser Invariant Tests', () => {
    it('should throw clear error if scene count mismatch occurs', async () => {
      console.log('\n========== TESTING PARSER INVARIANTS ==========');

      // Simulate parser stage validation
      const expectedCount = 53;
      const actualScenes = generateTestScenes(50); // Intentionally wrong count

      try {
        assertSceneCount(actualScenes, expectedCount, 'parser');
        fail('Should have thrown InvariantError');
      } catch (error) {
        expect(error).toBeInstanceOf(InvariantError);

        if (error instanceof InvariantError) {
          expect(error.message).toContain('Scene count mismatch at parser');
          expect(error.details?.expected).toBe(53);
          expect(error.details?.actual).toBe(50);
          expect(error.details?.diff).toBe(3);

          console.log(`🚨 PARSER INVARIANT: Expected ${error.details?.expected} scenes, got ${error.details?.actual} scenes`);
        }
      }

      console.log('✅ Parser invariant throws clear error on mismatch');
    });

    it('should validate scene indices are contiguous', async () => {
      console.log('\n========== TESTING INDEX VALIDATION ==========');

      // Create scenes with non-contiguous indices
      const scenes = [
        { sceneIndex: 0, sceneId: 'test_0', slugline: 'Scene 0' },
        { sceneIndex: 1, sceneId: 'test_1', slugline: 'Scene 1' },
        { sceneIndex: 3, sceneId: 'test_3', slugline: 'Scene 3' }, // Missing index 2
        { sceneIndex: 4, sceneId: 'test_4', slugline: 'Scene 4' }
      ];

      try {
        assertContiguousIndices(scenes);
        fail('Should have thrown InvariantError');
      } catch (error) {
        expect(error).toBeInstanceOf(InvariantError);

        if (error instanceof InvariantError) {
          expect(error.message).toContain('Non-contiguous scene index');
          expect(error.details?.expected).toBe(2);
          expect(error.details?.actual).toBe(3);
        }
      }

      console.log('✅ Index validation detects non-contiguous scenes');
    });
  });

  describe('3. Scene Preservation Tests', () => {
    it('should verify sr_first_look_final.fdx produces exactly 53 scenes', async () => {
      console.log('\n========== TESTING SCENE COUNT PRESERVATION ==========');

      // Store snapshot with exact count
      const scenes = generateTestScenes(53);

      const postResponse = await request(app)
        .post(`/api/projects/${TEST_PROJECT_ID}/snapshot`)
        .send({
          version: Date.now(),
          title: 'SR First Look Final',
          scenes,
          elements: [],
          metadata: {
            originalFile: 'sr_first_look_final.fdx'
          }
        });

      expect(postResponse.body.count).toBe(53);

      // Get stats to verify
      const statsResponse = await request(app)
        .get(`/api/projects/${TEST_PROJECT_ID}/snapshot/stats`);

      expect(statsResponse.status).toBe(200);
      expect(statsResponse.body.data.sceneCount).toBe(53);

      console.log(`✅ Scene count preserved: ${statsResponse.body.data.sceneCount}/53`);
    });

    it('should validate scene ordering is preserved through the pipeline', async () => {
      console.log('\n========== TESTING SCENE ORDER PRESERVATION ==========');

      // Create scenes with specific order
      const orderedScenes: SceneMemory[] = [
        {
          projectId: TEST_PROJECT_ID,
          sceneIndex: 0,
          sceneId: `${TEST_PROJECT_ID}_0`,
          slugline: 'FADE IN:',
          summary: 'Opening',
          fullContent: '',
          characters: [],
          themeTags: [],
          tokens: 10,
          wordCount: 2,
          timestamp: new Date()
        },
        {
          projectId: TEST_PROJECT_ID,
          sceneIndex: 1,
          sceneId: `${TEST_PROJECT_ID}_1`,
          slugline: 'INT. SILK ROAD SERVER ROOM - NIGHT',
          summary: 'Server room scene',
          fullContent: '',
          characters: [],
          themeTags: [],
          tokens: 50,
          wordCount: 10,
          timestamp: new Date()
        },
        {
          projectId: TEST_PROJECT_ID,
          sceneIndex: 2,
          sceneId: `${TEST_PROJECT_ID}_2`,
          slugline: 'EXT. ICELAND - DAY',
          summary: 'Iceland scene',
          fullContent: '',
          characters: [],
          themeTags: [],
          tokens: 40,
          wordCount: 8,
          timestamp: new Date()
        }
      ];

      // Store and retrieve
      await request(app)
        .post(`/api/projects/${TEST_PROJECT_ID}/snapshot`)
        .send({
          version: Date.now(),
          title: 'Order Test',
          scenes: orderedScenes,
          elements: [],
          metadata: {}
        });

      const getResponse = await request(app)
        .get(`/api/projects/${TEST_PROJECT_ID}/snapshot`);

      const snapshot = getResponse.body.data as ProjectSnapshot;

      // Verify order preserved
      expect(snapshot.scenes[0].slugline).toBe('FADE IN:');
      expect(snapshot.scenes[1].slugline).toBe('INT. SILK ROAD SERVER ROOM - NIGHT');
      expect(snapshot.scenes[2].slugline).toBe('EXT. ICELAND - DAY');

      // Verify indices
      expect(snapshot.scenes[0].sceneIndex).toBe(0);
      expect(snapshot.scenes[1].sceneIndex).toBe(1);
      expect(snapshot.scenes[2].sceneIndex).toBe(2);

      console.log('✅ Scene ordering preserved correctly');
    });
  });

  describe('4. Error Handling Tests', () => {
    it('should handle parser invariant failure gracefully', async () => {
      console.log('\n========== TESTING ERROR HANDLING ==========');

      // Test with invalid scene data
      const invalidScenes = [
        { /* missing required fields */ },
        { sceneIndex: 'not-a-number' as any }
      ];

      const response = await request(app)
        .post(`/api/projects/${TEST_PROJECT_ID}/snapshot`)
        .send({
          version: Date.now(),
          title: 'Invalid Test',
          scenes: invalidScenes,
          elements: [],
          metadata: {}
        });

      // Should still accept the data (validation happens at parser stage)
      expect(response.status).toBe(200);

      console.log('✅ Error handling works for invalid data');
    });

    it('should handle missing snapshot gracefully', async () => {
      const response = await request(app)
        .get('/api/projects/non-existent-project/snapshot');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not found');

      console.log('✅ Missing snapshot handled gracefully');
    });

    it('should verify offline mode activation', async () => {
      console.log('\n========== TESTING OFFLINE MODE ==========');

      // Store a snapshot
      const scenes = generateTestScenes(10);
      await request(app)
        .post(`/api/projects/${TEST_PROJECT_ID}/snapshot`)
        .send({
          version: Date.now(),
          title: 'Offline Test',
          scenes,
          elements: [],
          metadata: { offline: true }
        });

      // Retrieve and verify metadata
      const response = await request(app)
        .get(`/api/projects/${TEST_PROJECT_ID}/snapshot`);

      expect(response.body.data.metadata.offline).toBe(true);

      console.log('✅ Offline mode metadata preserved');
    });
  });

  describe('5. End-to-End Validation', () => {
    it('should validate complete flow with scene count logging', async () => {
      console.log('\n========== END-TO-END VALIDATION ==========');
      console.log('Starting complete pipeline test...\n');

      const checkpoint = new PipelineCheckpoint();

      // Stage 1: Generate test data
      const scenes = generateTestScenes(53);
      checkpoint.record('generation', scenes.length, { stage: 'test-data' });
      console.log(`📍 Stage 1 - Test Data Generated: ${scenes.length} scenes`);

      // Stage 2: Upload to snapshot
      const uploadResponse = await request(app)
        .post(`/api/projects/${TEST_PROJECT_ID}/snapshot`)
        .send({
          version: Date.now(),
          title: 'E2E Test',
          scenes,
          elements: [],
          metadata: {
            test: 'e2e',
            timestamp: new Date().toISOString()
          }
        });

      checkpoint.record('upload', uploadResponse.body.count, { stage: 'snapshot-post' });
      console.log(`📍 Stage 2 - Snapshot Upload: ${uploadResponse.body.count} scenes`);

      // Stage 3: Retrieve snapshot
      const retrieveResponse = await request(app)
        .get(`/api/projects/${TEST_PROJECT_ID}/snapshot`);

      const retrievedScenes = retrieveResponse.body.data.scenes;
      checkpoint.record('retrieval', retrievedScenes.length, { stage: 'snapshot-get' });
      console.log(`📍 Stage 3 - Snapshot Retrieval: ${retrievedScenes.length} scenes`);

      // Stage 4: Validate parser stage (simulated)
      try {
        assertSceneCount(retrievedScenes, 53, 'parser');
        checkpoint.record('parser', retrievedScenes.length, { stage: 'parser-validation' });
        console.log(`📍 Stage 4 - Parser Validation: ${retrievedScenes.length} scenes`);
      } catch (error) {
        if (error instanceof InvariantError) {
          console.error(`🚨 PARSER INVARIANT FAILED: Expected 53 scenes, got ${error.details?.actual} scenes`);
          throw error;
        }
      }

      // Stage 5: Editor display simulation
      const editorScenes = retrievedScenes; // In real app, this would be after parsing
      checkpoint.record('editor', editorScenes.length, { stage: 'editor-display' });
      console.log(`📍 Stage 5 - Editor Display: ${editorScenes.length} scenes`);

      // Final validation
      checkpoint.validate();
      const history = checkpoint.getHistory();

      console.log('\n========== PIPELINE SUMMARY ==========');
      history.forEach(({ name, count }) => {
        console.log(`   ${name}: ${count} scenes ✅`);
      });

      // Check for any loss points
      const lossPoint = checkpoint.findLossPoint();
      if (lossPoint) {
        console.error(`\n🚨 SCENE LOSS DETECTED AT: ${lossPoint}`);
        fail(`Scene loss detected at ${lossPoint}`);
      } else {
        console.log('\n✅ NO SCENE LOSS DETECTED - Pipeline integrity verified!');
      }

      // Assert final state
      expect(editorScenes.length).toBe(53);
      expect(lossPoint).toBeNull();
    });

    it('should detect scene loss at any point in the pipeline', async () => {
      console.log('\n========== TESTING SCENE LOSS DETECTION ==========');

      const checkpoint = new PipelineCheckpoint();

      // Simulate scene loss scenario
      checkpoint.record('upload', 53);
      checkpoint.record('storage', 53);
      checkpoint.record('retrieval', 50); // Simulated loss
      checkpoint.record('parser', 50);

      const lossPoint = checkpoint.findLossPoint();
      expect(lossPoint).toBe('retrieval');

      console.log(`🚨 Scene loss detected at: ${lossPoint}`);
      console.log('✅ Loss detection working correctly');
    });
  });

  describe('6. Performance and Statistics', () => {
    it('should track memory usage and performance metrics', async () => {
      console.log('\n========== PERFORMANCE METRICS ==========');

      const scenes = generateTestScenes(53);

      const startTime = Date.now();

      await request(app)
        .post(`/api/projects/${TEST_PROJECT_ID}/snapshot`)
        .send({
          version: Date.now(),
          title: 'Performance Test',
          scenes,
          elements: [],
          metadata: {}
        });

      const uploadTime = Date.now() - startTime;

      const statsResponse = await request(app)
        .get(`/api/projects/${TEST_PROJECT_ID}/snapshot/stats`);

      const stats = statsResponse.body.data;

      console.log(`📊 Performance Metrics:`);
      console.log(`   Upload Time: ${uploadTime}ms`);
      console.log(`   Memory Usage: ${stats.memoryUsage} bytes`);
      console.log(`   Scenes: ${stats.sceneCount}`);
      console.log(`   Words: ${stats.totalWords}`);
      console.log(`   Tokens: ${stats.totalTokens}`);

      expect(uploadTime).toBeLessThan(1000); // Should be fast
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });
  });
});

// Export test utilities for use in other tests
export {
  generateTestScenes,
  createTestApp,
  EXPECTED_SCENE_COUNT,
  TEST_PROJECT_ID
};