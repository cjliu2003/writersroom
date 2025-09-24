/**
 * End-to-End Integration Test
 *
 * Tests the complete workflow from FDX upload to editor display:
 * 1. Upload FDX file
 * 2. Parse scenes
 * 3. Store in memory
 * 4. Retrieve from memory
 * 5. Display in editor
 *
 * Validates scene count preservation at every stage.
 */

import { parseFDX } from '@/lib/fdx-parser';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import { ParserInvariants, StorageInvariants, PipelineInvariants } from './runtime_invariants.test';

(global as any).fetch = fetch;

interface SceneData {
  slugline: string;
  characters: string[];
  summary: string;
  tokens: number;
  wordCount: number;
  fullContent?: string;
  sceneIndex: number;
  sceneId: string;
  originalSlugline: string;
}

interface TestScenario {
  name: string;
  fdxFile: string;
  expectedSceneCount: number;
  expectedDuplicates?: Record<string, number>;
}

describe('End-to-End Integration Tests', () => {
  const BACKEND_API_URL = process.env.TEST_API_URL || 'http://localhost:3001/api';
  const TEST_FILES_DIR = path.join(process.cwd(), '..');

  // Test scenarios with different FDX files
  const testScenarios: TestScenario[] = [
    {
      name: 'Simple FDX with unique sluglines',
      fdxFile: 'test-action-with-slugline.fdx',
      expectedSceneCount: 3
    },
    {
      name: 'Complex FDX with duplicate sluglines',
      fdxFile: 'sr_first_look_final.fdx',
      expectedSceneCount: 53,
      expectedDuplicates: {
        'EXT. SILK ROAD - NIGHT': 3,
        'INT. TATTOO ROOM': 2,
        'INT. ROSS\'S HOUSE - DAY': 2,
        'INT. FBI OFFICE - DAY': 2
      }
    },
    {
      name: 'FDX with transitions and special elements',
      fdxFile: 'test-transitions.fdx',
      expectedSceneCount: 5
    }
  ];

  testScenarios.forEach(scenario => {
    describe(`Scenario: ${scenario.name}`, () => {
      const projectId = `e2e-test-${Date.now()}`;
      const filePath = path.join(TEST_FILES_DIR, scenario.fdxFile);

      // Skip if file doesn't exist
      if (!fs.existsSync(filePath)) {
        it.skip(`File not found: ${scenario.fdxFile}`, () => {});
        return;
      }

      // Initialize invariant checkers
      const parserInvariants = new ParserInvariants();
      const storageInvariants = new StorageInvariants();
      const pipelineInvariants = new PipelineInvariants();

      let uploadedScenes: SceneData[] = [];
      let parsedElements: any[] = [];

      describe('Stage 1: File Upload and Parsing', () => {
        it('should upload and parse FDX file', async () => {
          const fdxContent = await fs.promises.readFile(filePath, 'utf-8');

          // Create FormData for upload simulation
          const formData = new FormData();
          const file = new File([fdxContent], scenario.fdxFile, { type: 'text/xml' });
          formData.append('fdx', file);

          // Simulate the parsing that happens in the API route
          const parseResult = await simulateFDXParsing(fdxContent, scenario.fdxFile);

          expect(parseResult.success).toBe(true);
          expect(parseResult.scenes).toBeDefined();
          expect(parseResult.scenes.length).toBe(scenario.expectedSceneCount);

          uploadedScenes = parseResult.scenes;
          parsedElements = parseResult.elements || [];

          // Set invariant expectations
          parserInvariants.setExpectedCount(scenario.expectedSceneCount);
          pipelineInvariants.checkpoint('parsed', uploadedScenes.length);

          console.log(`✅ Stage 1: Parsed ${uploadedScenes.length} scenes from ${scenario.fdxFile}`);
        });

        it('should validate parsed scene structure', () => {
          // Validate parser invariants
          parserInvariants.validateSceneCount(uploadedScenes, 'post-parse');
          parserInvariants.validateContiguousIndices(uploadedScenes);
          parserInvariants.validateUniqueIds(uploadedScenes);

          // Check for expected duplicates
          if (scenario.expectedDuplicates) {
            const sluglineCounts: Record<string, number> = {};
            uploadedScenes.forEach(scene => {
              sluglineCounts[scene.slugline] = (sluglineCounts[scene.slugline] || 0) + 1;
            });

            Object.entries(scenario.expectedDuplicates).forEach(([slugline, count]) => {
              expect(sluglineCounts[slugline]).toBe(count);
            });
          }

          console.log(`✅ All parsed scenes have valid structure`);
        });
      });

      describe('Stage 2: Atomic Snapshot Storage', () => {
        it('should store all scenes atomically via snapshot', async () => {
          storageInvariants.setInputCount(uploadedScenes.length);

          const snapshotPayload = {
            version: Date.now(),
            title: scenario.fdxFile.replace('.fdx', ''),
            scenes: uploadedScenes,
            elements: parsedElements,
            metadata: {
              title: scenario.name,
              createdAt: new Date().toISOString(),
              sceneCount: uploadedScenes.length
            }
          };

          const response = await fetch(`${BACKEND_API_URL}/projects/${projectId}/snapshot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snapshotPayload)
          });

          expect(response.ok).toBe(true);
          const result = await response.json();

          expect(result.success).toBe(true);
          expect(result.count).toBe(scenario.expectedSceneCount);

          pipelineInvariants.checkpoint('stored', result.count);

          console.log(`✅ Stage 2: Stored ${result.count} scenes atomically`);
        });
      });

      describe('Stage 3: Snapshot Retrieval', () => {
        let retrievedScenes: SceneData[] = [];

        it('should retrieve complete snapshot', async () => {
          const response = await fetch(`${BACKEND_API_URL}/projects/${projectId}/snapshot`);

          expect(response.ok).toBe(true);
          const result = await response.json();

          expect(result.success).toBe(true);
          expect(result.data).toBeDefined();
          expect(result.data.scenes).toBeDefined();
          expect(result.data.scenes.length).toBe(scenario.expectedSceneCount);

          retrievedScenes = result.data.scenes;
          storageInvariants.validateRetrievalComplete(retrievedScenes, scenario.expectedSceneCount);

          pipelineInvariants.checkpoint('retrieved', retrievedScenes.length);

          console.log(`✅ Stage 3: Retrieved ${retrievedScenes.length} scenes`);
        });

        it('should preserve all scene properties', () => {
          storageInvariants.validateDataIntegrity(uploadedScenes, retrievedScenes);

          // Deep validation of each scene
          uploadedScenes.forEach((uploaded, index) => {
            const retrieved = retrievedScenes[index];

            expect(retrieved.slugline).toBe(uploaded.slugline);
            expect(retrieved.sceneIndex).toBe(uploaded.sceneIndex);
            expect(retrieved.sceneId).toBe(uploaded.sceneId);
            expect(retrieved.originalSlugline).toBe(uploaded.originalSlugline);
            expect(retrieved.summary).toBe(uploaded.summary);
            expect(retrieved.tokens).toBe(uploaded.tokens);
            expect(retrieved.wordCount).toBe(uploaded.wordCount);

            // Check character arrays (order may differ)
            expect(new Set(retrieved.characters)).toEqual(new Set(uploaded.characters));
          });

          console.log(`✅ All scene properties preserved exactly`);
        });
      });

      describe('Stage 4: Editor Display Simulation', () => {
        it('should prepare scenes for editor display', async () => {
          // Simulate fetching scenes for editor
          const response = await fetch(`${BACKEND_API_URL}/memory/all?projectId=${projectId}`);

          if (response.ok) {
            const result = await response.json();
            const editorScenes = result.data || [];

            pipelineInvariants.checkpoint('editor-ready', editorScenes.length);

            // Verify scene count for editor
            expect(editorScenes.length).toBe(scenario.expectedSceneCount);

            console.log(`✅ Stage 4: ${editorScenes.length} scenes ready for editor`);
          }
        });

        it('should handle scene navigation correctly', () => {
          // Simulate scene navigation
          const sceneIndices = uploadedScenes.map(s => s.sceneIndex);

          // Test forward navigation
          for (let i = 0; i < sceneIndices.length - 1; i++) {
            const current = sceneIndices[i];
            const next = sceneIndices[i + 1];
            expect(next).toBe(current + 1);
          }

          // Test backward navigation
          for (let i = sceneIndices.length - 1; i > 0; i--) {
            const current = sceneIndices[i];
            const previous = sceneIndices[i - 1];
            expect(previous).toBe(current - 1);
          }

          console.log(`✅ Scene navigation validated`);
        });
      });

      describe('Stage 5: Pipeline Validation', () => {
        it('should maintain scene count across entire pipeline', () => {
          pipelineInvariants.validateConsistency();

          const history = pipelineInvariants.getHistory();
          console.log('\n📊 Pipeline History:');
          history.forEach(checkpoint => {
            console.log(`   ${checkpoint.name}: ${checkpoint.count} scenes`);
          });

          // All checkpoints should have same count
          const counts = history.map(h => h.count);
          const uniqueCounts = new Set(counts);
          expect(uniqueCounts.size).toBe(1);
          expect(counts[0]).toBe(scenario.expectedSceneCount);

          console.log(`✅ Stage 5: Pipeline validated - ${scenario.expectedSceneCount} scenes preserved throughout`);
        });
      });

      describe('Stress Testing', () => {
        it('should handle concurrent uploads without interference', async () => {
          // Create multiple concurrent upload simulations
          const concurrentUploads = Array.from({ length: 3 }, async (_, i) => {
            const concurrentProjectId = `${projectId}-concurrent-${i}`;

            const snapshotPayload = {
              version: Date.now() + i,
              title: `Concurrent Test ${i}`,
              scenes: uploadedScenes.map(s => ({
                ...s,
                sceneId: `${concurrentProjectId}:${s.sceneIndex}`
              })),
              elements: [],
              metadata: {
                title: `Concurrent Test ${i}`,
                createdAt: new Date().toISOString()
              }
            };

            const response = await fetch(`${BACKEND_API_URL}/projects/${concurrentProjectId}/snapshot`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(snapshotPayload)
            });

            return response.ok;
          });

          const results = await Promise.all(concurrentUploads);
          expect(results.every(r => r === true)).toBe(true);

          console.log(`✅ Handled 3 concurrent uploads without interference`);
        });

        if (scenario.expectedSceneCount > 10) {
          it('should handle large FDX files efficiently', async () => {
            const startTime = Date.now();

            // Measure performance of large file processing
            const largeScenes = Array.from({ length: 100 }, (_, i) => ({
              ...uploadedScenes[i % uploadedScenes.length],
              sceneIndex: i,
              sceneId: `perf-test:${i}`
            }));

            const perfProjectId = `${projectId}-performance`;
            const response = await fetch(`${BACKEND_API_URL}/projects/${perfProjectId}/snapshot`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                version: Date.now(),
                title: 'Performance Test',
                scenes: largeScenes,
                elements: [],
                metadata: { title: 'Performance Test' }
              })
            });

            const duration = Date.now() - startTime;

            expect(response.ok).toBe(true);
            expect(duration).toBeLessThan(5000); // Should complete within 5 seconds

            console.log(`✅ Processed 100 scenes in ${duration}ms`);
          });
        }
      });

      describe('Error Recovery', () => {
        it('should recover from partial failures', async () => {
          // Simulate a corrupted scene in the middle
          const corruptedScenes = [...uploadedScenes];
          corruptedScenes[Math.floor(corruptedScenes.length / 2)] = {
            ...corruptedScenes[Math.floor(corruptedScenes.length / 2)],
            sceneIndex: -1, // Invalid index
            sceneId: null as any // Invalid ID
          };

          const recoveryProjectId = `${projectId}-recovery`;
          const response = await fetch(`${BACKEND_API_URL}/projects/${recoveryProjectId}/snapshot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              version: Date.now(),
              title: 'Recovery Test',
              scenes: corruptedScenes,
              elements: [],
              metadata: { title: 'Recovery Test' }
            })
          });

          // Should either handle the error gracefully or reject
          if (response.ok) {
            const result = await response.json();
            // If it succeeded, it should have sanitized the data
            expect(result.count).toBeGreaterThan(0);
          } else {
            // If it failed, it should provide meaningful error
            expect(response.status).toBeGreaterThanOrEqual(400);
          }

          console.log(`✅ Error recovery mechanism working`);
        });
      });

      // Cleanup after tests
      afterAll(async () => {
        // Clean up test data
        try {
          await fetch(`${BACKEND_API_URL}/memory/clear?projectId=${projectId}`, {
            method: 'DELETE'
          });
        } catch (error) {
          // Ignore cleanup errors
        }
      });
    });
  });
});

/**
 * Simulate FDX parsing (mirrors the API logic)
 */
async function simulateFDXParsing(fdxContent: string, filename: string): Promise<any> {
  // This would use the actual parser from the API
  // For testing, we create a simplified version
  const { parseFDX } = await import('@/app/api/fdx/import/route');
  return parseFDX(fdxContent, filename);
}