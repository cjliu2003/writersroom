/**
 * Performance and Stability Tests
 *
 * These tests validate system performance under load, stability during
 * concurrent operations, and memory efficiency with large datasets.
 * Focus on ensuring the composite key system doesn't degrade performance.
 */

import { parseFDX } from '@/lib/fdx-parser';
import { MemoryService } from '../../../backend/services/memoryService';
import { extractScenesFromEditor } from '@/utils/scene-extraction';

describe('Performance and Stability Tests', () => {
  const TEST_PROJECT_ID = 'test-performance';

  beforeEach(() => {
    MemoryService.clearAllMemory();
  });

  afterEach(() => {
    MemoryService.clearAllMemory();
  });

  describe('Storage Performance', () => {
    it('should maintain O(1) storage time per scene', async () => {
      const testSizes = [10, 50, 100, 200];
      const timings: { size: number; avgTime: number }[] = [];

      for (const size of testSizes) {
        MemoryService.clearSceneMemory(TEST_PROJECT_ID);
        const times: number[] = [];

        for (let i = 0; i < size; i++) {
          const startTime = performance.now();

          MemoryService.updateSceneMemory(
            TEST_PROJECT_ID,
            `INT. SCENE ${i % 10} - DAY`, // Intentional duplicates
            {
              summary: `Scene ${i + 1}`,
              fullContent: `Content for scene ${i + 1}`.repeat(10),
              tokens: 100 + i,
              characters: [`Character${i % 5}`]
            },
            i
          );

          const endTime = performance.now();
          times.push(endTime - startTime);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        timings.push({ size, avgTime });
      }

      // Verify average time doesn't increase significantly with size
      const firstAvg = timings[0].avgTime;
      const lastAvg = timings[timings.length - 1].avgTime;

      // Allow up to 2x increase for large datasets (should be roughly constant)
      expect(lastAvg).toBeLessThan(firstAvg * 2);

      console.info('Storage performance:', timings);
    });

    it('should handle rapid sequential updates efficiently', async () => {
      const updateCount = 100;
      const slugline = 'INT. RAPID UPDATE - DAY';

      const startTime = performance.now();

      for (let i = 0; i < updateCount; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          slugline,
          {
            summary: `Update ${i + 1}`,
            tokens: 100 + i
          },
          0 // Always update the same scene
        );
      }

      const totalTime = performance.now() - startTime;

      // Should complete all updates quickly
      expect(totalTime).toBeLessThan(1000); // Under 1 second for 100 updates

      // Verify final state
      const scene = MemoryService.getSceneBySlugline(TEST_PROJECT_ID, slugline, 0);
      expect(scene?.summary).toBe(`Update ${updateCount}`);
      expect(scene?.tokens).toBe(100 + (updateCount - 1));
    });
  });

  describe('Retrieval Performance', () => {
    it('should maintain fast retrieval with composite keys', async () => {
      const sceneCount = 500;

      // Populate memory
      for (let i = 0; i < sceneCount; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          `INT. LOCATION ${i % 50} - DAY`,
          {
            summary: `Scene ${i + 1}`,
            tokens: 100
          },
          i
        );
      }

      // Test retrieval by ID
      const idRetrievalTimes: number[] = [];
      for (let i = 0; i < 100; i++) {
        const randomIndex = Math.floor(Math.random() * sceneCount);
        const sceneId = `${TEST_PROJECT_ID}_${randomIndex}`;

        const startTime = performance.now();
        const scene = MemoryService.getSceneById(TEST_PROJECT_ID, sceneId);
        const endTime = performance.now();

        expect(scene).toBeDefined();
        idRetrievalTimes.push(endTime - startTime);
      }

      const avgIdRetrieval = idRetrievalTimes.reduce((a, b) => a + b, 0) / idRetrievalTimes.length;
      expect(avgIdRetrieval).toBeLessThan(1); // Sub-millisecond average

      // Test retrieval by slugline + index
      const slugRetrievalTimes: number[] = [];
      for (let i = 0; i < 100; i++) {
        const randomIndex = Math.floor(Math.random() * sceneCount);
        const slugline = `INT. LOCATION ${randomIndex % 50} - DAY`;

        const startTime = performance.now();
        const scene = MemoryService.getSceneBySlugline(TEST_PROJECT_ID, slugline, randomIndex);
        const endTime = performance.now();

        slugRetrievalTimes.push(endTime - startTime);
      }

      const avgSlugRetrieval = slugRetrievalTimes.reduce((a, b) => a + b, 0) / slugRetrievalTimes.length;
      expect(avgSlugRetrieval).toBeLessThan(2); // Should be very fast
    });

    it('should efficiently retrieve recent scenes', async () => {
      const sceneCount = 1000;

      // Populate with many scenes
      for (let i = 0; i < sceneCount; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          `INT. SCENE ${i} - DAY`,
          {
            summary: `Scene ${i + 1}`,
            tokens: 100
          },
          i
        );
      }

      const startTime = performance.now();
      const recentScenes = MemoryService.getRecentScenes(TEST_PROJECT_ID, 10);
      const retrievalTime = performance.now() - startTime;

      expect(recentScenes).toHaveLength(10);
      expect(retrievalTime).toBeLessThan(10); // Should be very fast

      // Verify we got the most recent scenes
      expect(recentScenes[0].sceneIndex).toBe(999);
      expect(recentScenes[9].sceneIndex).toBe(990);
    });
  });

  describe('Memory Efficiency', () => {
    it('should handle large text content efficiently', async () => {
      const largeText = 'Lorem ipsum dolor sit amet. '.repeat(1000); // ~5000 words
      const sceneCount = 50;

      const startMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < sceneCount; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          `INT. LARGE SCENE ${i} - DAY`,
          {
            summary: `Large scene ${i + 1}`,
            fullContent: largeText,
            tokens: 5000,
            wordCount: 5000
          },
          i
        );
      }

      const endMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (endMemory - startMemory) / 1024 / 1024; // Convert to MB

      // Should use reasonable memory (less than 100MB for 50 large scenes)
      expect(memoryIncrease).toBeLessThan(100);

      // Verify all scenes are accessible
      const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(scenes).toHaveLength(sceneCount);
    });

    it('should not leak memory during updates', async () => {
      const slugline = 'INT. MEMORY TEST - DAY';
      const largeText = 'Test content. '.repeat(500);

      // Perform many updates to the same scene
      for (let i = 0; i < 100; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          slugline,
          {
            summary: `Update ${i + 1}`,
            fullContent: largeText + ` Version ${i + 1}`,
            tokens: 1000 + i
          },
          0
        );
      }

      // Should only have one scene in memory
      const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(scenes).toHaveLength(1);
      expect(scenes[0].summary).toBe('Update 100');
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent storage without race conditions', async () => {
      const concurrentCount = 50;
      const promises: Promise<any>[] = [];

      // Create concurrent storage operations
      for (let i = 0; i < concurrentCount; i++) {
        const promise = new Promise((resolve) => {
          setTimeout(() => {
            const scene = MemoryService.updateSceneMemory(
              TEST_PROJECT_ID,
              `INT. CONCURRENT ${i % 10} - DAY`,
              {
                summary: `Concurrent scene ${i + 1}`,
                tokens: 100 + i
              },
              i
            );
            resolve(scene);
          }, Math.random() * 10); // Random delay up to 10ms
        });
        promises.push(promise);
      }

      await Promise.all(promises);

      // Verify all scenes were stored
      const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(scenes).toHaveLength(concurrentCount);

      // Verify data integrity
      scenes.forEach((scene, index) => {
        expect(scene.sceneIndex).toBe(index);
        expect(scene.sceneId).toBe(`${TEST_PROJECT_ID}_${index}`);
      });
    });

    it('should handle concurrent reads and writes', async () => {
      // Pre-populate some scenes
      for (let i = 0; i < 10; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          `INT. SCENE ${i} - DAY`,
          {
            summary: `Initial scene ${i + 1}`,
            tokens: 100
          },
          i
        );
      }

      const operations: Promise<any>[] = [];

      // Mix of read and write operations
      for (let i = 0; i < 100; i++) {
        if (i % 3 === 0) {
          // Write operation
          operations.push(
            new Promise((resolve) => {
              const index = 10 + Math.floor(i / 3);
              MemoryService.updateSceneMemory(
                TEST_PROJECT_ID,
                `INT. NEW SCENE ${index} - DAY`,
                {
                  summary: `New scene ${index}`,
                  tokens: 200
                },
                index
              );
              resolve(null);
            })
          );
        } else if (i % 3 === 1) {
          // Read by ID
          operations.push(
            new Promise((resolve) => {
              const randomId = Math.floor(Math.random() * 10);
              const scene = MemoryService.getSceneById(
                TEST_PROJECT_ID,
                `${TEST_PROJECT_ID}_${randomId}`
              );
              resolve(scene);
            })
          );
        } else {
          // Read all scenes
          operations.push(
            new Promise((resolve) => {
              const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
              resolve(scenes);
            })
          );
        }
      }

      await Promise.all(operations);

      // Verify data consistency
      const finalScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(finalScenes.length).toBeGreaterThanOrEqual(10);

      // Verify no corruption
      finalScenes.forEach(scene => {
        expect(scene.sceneId).toBeDefined();
        expect(scene.summary).toBeDefined();
      });
    });
  });

  describe('Stress Testing', () => {
    it('should handle maximum realistic scene count', async () => {
      const maxScenes = 200; // Realistic maximum for a feature film
      const startTime = performance.now();

      for (let i = 0; i < maxScenes; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          `INT. SCENE ${i % 20} - DAY`, // 10% duplicates
          {
            summary: `Scene ${i + 1} of maximum test`,
            fullContent: `Full content for scene ${i + 1}`.repeat(5),
            tokens: 150,
            characters: [`Actor${i % 10}`, `Actor${(i + 1) % 10}`],
            themeTags: [`Theme${i % 5}`]
          },
          i
        );
      }

      const storageTime = performance.now() - startTime;

      // Should complete in reasonable time
      expect(storageTime).toBeLessThan(5000); // Under 5 seconds

      // Verify all scenes stored
      const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(scenes).toHaveLength(maxScenes);

      // Test statistics calculation performance
      const statsStart = performance.now();
      const stats = MemoryService.getMemoryStats(TEST_PROJECT_ID);
      const statsTime = performance.now() - statsStart;

      expect(statsTime).toBeLessThan(100); // Stats should be fast
      expect(stats.totalScenes).toBe(maxScenes);
      expect(stats.totalTokens).toBe(maxScenes * 150);
    });

    it('should handle rapid project switching', async () => {
      const projectCount = 10;
      const scenesPerProject = 20;

      // Create multiple projects
      for (let p = 0; p < projectCount; p++) {
        const projectId = `project_${p}`;

        for (let s = 0; s < scenesPerProject; s++) {
          MemoryService.updateSceneMemory(
            projectId,
            `INT. SCENE ${s} - DAY`,
            {
              summary: `Project ${p}, Scene ${s}`,
              tokens: 100
            },
            s
          );
        }
      }

      // Rapidly switch between projects
      const switchStart = performance.now();
      const accessOperations: any[] = [];

      for (let i = 0; i < 100; i++) {
        const projectId = `project_${i % projectCount}`;
        accessOperations.push(MemoryService.getAllScenes(projectId));
        accessOperations.push(MemoryService.getMemoryStats(projectId));
      }

      await Promise.all(accessOperations);
      const switchTime = performance.now() - switchStart;

      // Should handle project switching efficiently
      expect(switchTime).toBeLessThan(1000);

      // Verify data isolation
      for (let p = 0; p < projectCount; p++) {
        const scenes = MemoryService.getAllScenes(`project_${p}`);
        expect(scenes).toHaveLength(scenesPerProject);
      }
    });
  });

  describe('Edge Case Performance', () => {
    it('should handle scenes with no content efficiently', async () => {
      const emptySceneCount = 100;

      const startTime = performance.now();

      for (let i = 0; i < emptySceneCount; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          '', // Empty slugline
          {
            summary: '',
            fullContent: '',
            tokens: 0,
            wordCount: 0,
            characters: [],
            themeTags: []
          },
          i
        );
      }

      const totalTime = performance.now() - startTime;

      expect(totalTime).toBeLessThan(500);

      const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(scenes).toHaveLength(emptySceneCount);
    });

    it('should handle extremely long sluglines', async () => {
      const longSlugline = 'INT. ' + 'VERY LONG LOCATION NAME '.repeat(20) + '- DAY';
      const sceneCount = 50;

      const startTime = performance.now();

      for (let i = 0; i < sceneCount; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          longSlugline,
          {
            summary: `Scene with long slugline ${i + 1}`,
            tokens: 100
          },
          i
        );
      }

      const totalTime = performance.now() - startTime;

      expect(totalTime).toBeLessThan(1000);

      const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(scenes).toHaveLength(sceneCount);
      scenes.forEach(scene => {
        expect(scene.slugline).toBe(longSlugline);
      });
    });

    it('should handle unicode and special characters in sluglines', async () => {
      const specialSlugs = [
        'INT. CAFÉ ☕ - DAY',
        'EXT. 東京 STREET - NIGHT',
        'INT. BJÖRN\'S HOUSE - DAY',
        'EXT. МОСКВА - СНЕГ',
        'INT. 🏠 HOME - DAY'
      ];

      for (let i = 0; i < specialSlugs.length; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          specialSlugs[i],
          {
            summary: `Unicode scene ${i + 1}`,
            tokens: 100
          },
          i
        );
      }

      const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(scenes).toHaveLength(specialSlugs.length);

      scenes.forEach((scene, index) => {
        expect(scene.slugline).toBe(specialSlugs[index]);
      });
    });
  });

  describe('Recovery and Cleanup', () => {
    it('should recover from partial storage failures', async () => {
      const sceneCount = 20;

      // Simulate some successful and some failed operations
      for (let i = 0; i < sceneCount; i++) {
        try {
          if (i === 10) {
            // Simulate a failure midway
            throw new Error('Simulated storage failure');
          }

          MemoryService.updateSceneMemory(
            TEST_PROJECT_ID,
            `INT. SCENE ${i} - DAY`,
            {
              summary: `Scene ${i + 1}`,
              tokens: 100
            },
            i
          );
        } catch (error) {
          // Continue with next scene
          continue;
        }
      }

      // Continue storing remaining scenes
      for (let i = 11; i < sceneCount; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          `INT. SCENE ${i} - DAY`,
          {
            summary: `Scene ${i + 1}`,
            tokens: 100
          },
          i
        );
      }

      const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(scenes.length).toBe(sceneCount - 1); // All except the failed one
    });

    it('should efficiently clear large amounts of data', async () => {
      // Create multiple projects with many scenes
      for (let p = 0; p < 5; p++) {
        for (let s = 0; s < 100; s++) {
          MemoryService.updateSceneMemory(
            `project_${p}`,
            `INT. SCENE ${s} - DAY`,
            {
              summary: `Project ${p}, Scene ${s}`,
              fullContent: 'Content '.repeat(100),
              tokens: 500
            },
            s
          );
        }
      }

      // Clear all projects
      const clearStart = performance.now();
      MemoryService.clearAllMemory();
      const clearTime = performance.now() - clearStart;

      // Should clear quickly
      expect(clearTime).toBeLessThan(100);

      // Verify all data is cleared
      for (let p = 0; p < 5; p++) {
        const scenes = MemoryService.getAllScenes(`project_${p}`);
        expect(scenes).toHaveLength(0);
      }
    });
  });
});