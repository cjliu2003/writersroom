/**
 * Memory Storage Composite Key Tests
 *
 * These tests validate the new composite key storage system that prevents
 * scene loss due to duplicate sluglines. The system now uses sceneIndex + projectId
 * as a unique identifier instead of just the slugline.
 */

import { MemoryService } from '../../../backend/services/memoryService';
import { SceneMemory } from '../../../shared/types';

describe('Memory Storage Composite Key System', () => {
  const TEST_PROJECT_ID = 'test-composite-keys';

  beforeEach(() => {
    MemoryService.clearAllMemory();
  });

  afterEach(() => {
    MemoryService.clearAllMemory();
  });

  describe('Composite Key Generation', () => {
    it('should generate unique sceneIds for scenes with same slugline', () => {
      const slugline = 'INT. DUPLICATE LOCATION - DAY';

      // Store three scenes with the same slugline but different indices
      for (let i = 0; i < 3; i++) {
        const scene = MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          slugline,
          {
            summary: `Scene ${i + 1}`,
            tokens: 100 * (i + 1),
            characters: [`Character${i + 1}`]
          },
          i // sceneIndex
        );

        // Verify unique sceneId was generated
        expect(scene.sceneId).toBe(`${TEST_PROJECT_ID}_${i}`);
        expect(scene.sceneIndex).toBe(i);
      }

      // Verify all three scenes are stored
      const allScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(allScenes).toHaveLength(3);

      // Verify each has unique sceneId
      const sceneIds = allScenes.map(s => s.sceneId);
      expect(new Set(sceneIds).size).toBe(3);
    });

    it('should maintain stable sceneIds across updates', () => {
      const slugline = 'INT. STABLE LOCATION - DAY';
      const sceneIndex = 5;

      // Create initial scene
      const originalScene = MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        slugline,
        {
          summary: 'Original summary',
          tokens: 100
        },
        sceneIndex
      );

      const originalSceneId = originalScene.sceneId;
      expect(originalSceneId).toBe(`${TEST_PROJECT_ID}_${sceneIndex}`);

      // Update the same scene
      const updatedScene = MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        slugline,
        {
          summary: 'Updated summary',
          tokens: 200
        },
        sceneIndex
      );

      // SceneId should remain the same
      expect(updatedScene.sceneId).toBe(originalSceneId);
      expect(updatedScene.summary).toBe('Updated summary');
      expect(updatedScene.tokens).toBe(200);

      // Should still have only one scene
      const allScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(allScenes).toHaveLength(1);
    });
  });

  describe('Storage Operations with Composite Keys', () => {
    it('should store all scenes with duplicate sluglines without overwriting', () => {
      const commonSlugline = 'INT. COMMON ROOM - DAY';
      const sceneCount = 5;

      for (let i = 0; i < sceneCount; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          commonSlugline,
          {
            summary: `Scene ${i + 1} at common room`,
            fullContent: `Unique content for scene ${i + 1}`,
            tokens: 100 + i,
            characters: [`Actor${i + 1}`]
          },
          i
        );
      }

      const storedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(storedScenes).toHaveLength(sceneCount);

      // Verify all scenes have the same slugline but different content
      storedScenes.forEach((scene, index) => {
        expect(scene.slugline).toBe(commonSlugline);
        expect(scene.summary).toContain(`Scene ${index + 1}`);
        expect(scene.sceneIndex).toBe(index);
      });
    });

    it('should update correct scene when using sceneIndex', () => {
      const slugline = 'INT. UPDATE TEST - DAY';

      // Create three scenes with same slugline
      for (let i = 0; i < 3; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          slugline,
          {
            summary: `Original scene ${i + 1}`,
            tokens: 100
          },
          i
        );
      }

      // Update only the middle scene
      MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        slugline,
        {
          summary: 'Updated middle scene',
          tokens: 500
        },
        1 // Update scene at index 1
      );

      const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(scenes).toHaveLength(3);

      // Verify only the middle scene was updated
      expect(scenes[0].summary).toBe('Original scene 1');
      expect(scenes[1].summary).toBe('Updated middle scene');
      expect(scenes[1].tokens).toBe(500);
      expect(scenes[2].summary).toBe('Original scene 3');
    });

    it('should handle mixed storage with and without sceneIndex', () => {
      // Store with sceneIndex
      MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        'INT. INDEXED SCENE - DAY',
        { summary: 'Indexed scene', tokens: 100 },
        0
      );

      // Store without sceneIndex (backward compatibility)
      MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        'INT. NON-INDEXED SCENE - DAY',
        { summary: 'Non-indexed scene', tokens: 200 }
      );

      // Store another with sceneIndex
      MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        'INT. ANOTHER INDEXED - DAY',
        { summary: 'Another indexed', tokens: 300 },
        2
      );

      const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(scenes).toHaveLength(3);

      // Verify all scenes are stored correctly
      const summaries = scenes.map(s => s.summary);
      expect(summaries).toContain('Indexed scene');
      expect(summaries).toContain('Non-indexed scene');
      expect(summaries).toContain('Another indexed');
    });
  });

  describe('Retrieval Operations', () => {
    it('should retrieve specific scene instance using sceneIndex', () => {
      const slugline = 'INT. MULTI INSTANCE - DAY';

      // Store multiple instances
      for (let i = 0; i < 4; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          slugline,
          {
            summary: `Instance ${i + 1}`,
            tokens: 100 * (i + 1)
          },
          i
        );
      }

      // Retrieve specific instance
      const secondInstance = MemoryService.getSceneBySlugline(TEST_PROJECT_ID, slugline, 1);
      expect(secondInstance).toBeDefined();
      expect(secondInstance?.summary).toBe('Instance 2');
      expect(secondInstance?.tokens).toBe(200);

      // Retrieve different instance
      const fourthInstance = MemoryService.getSceneBySlugline(TEST_PROJECT_ID, slugline, 3);
      expect(fourthInstance).toBeDefined();
      expect(fourthInstance?.summary).toBe('Instance 4');
      expect(fourthInstance?.tokens).toBe(400);
    });

    it('should retrieve scene by composite sceneId', () => {
      const scene = MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        'INT. SCENE BY ID - DAY',
        { summary: 'Find me by ID', tokens: 123 },
        7
      );

      const sceneId = scene.sceneId;
      expect(sceneId).toBe(`${TEST_PROJECT_ID}_7`);

      // Retrieve by sceneId
      const retrieved = MemoryService.getSceneById(TEST_PROJECT_ID, sceneId!);
      expect(retrieved).toBeDefined();
      expect(retrieved?.summary).toBe('Find me by ID');
      expect(retrieved?.tokens).toBe(123);
    });

    it('should maintain chronological order when retrieving all scenes', () => {
      const scenes = [
        { index: 0, slugline: 'INT. FIRST - DAY', summary: 'Scene 1' },
        { index: 1, slugline: 'INT. SECOND - DAY', summary: 'Scene 2' },
        { index: 2, slugline: 'INT. FIRST - DAY', summary: 'Scene 3 (return to first)' },
        { index: 3, slugline: 'INT. THIRD - DAY', summary: 'Scene 4' },
        { index: 4, slugline: 'INT. FIRST - DAY', summary: 'Scene 5 (another return)' }
      ];

      // Store in order
      scenes.forEach(scene => {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          scene.slugline,
          { summary: scene.summary },
          scene.index
        );
      });

      const allScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(allScenes).toHaveLength(5);

      // Verify chronological order is maintained
      allScenes.forEach((scene, index) => {
        expect(scene.sceneIndex).toBe(index);
        expect(scene.summary).toBe(scenes[index].summary);
      });
    });

    it('should correctly get recent scenes with duplicate sluglines', () => {
      const slugline = 'INT. RECENT TEST - DAY';

      // Store scenes with timestamps
      for (let i = 0; i < 5; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          slugline,
          {
            summary: `Scene ${i + 1}`,
            tokens: 100
          },
          i
        );
      }

      const recentScenes = MemoryService.getRecentScenes(TEST_PROJECT_ID, 3);
      expect(recentScenes).toHaveLength(3);

      // Should get the three most recent (highest indices)
      expect(recentScenes[0].sceneIndex).toBe(4);
      expect(recentScenes[1].sceneIndex).toBe(3);
      expect(recentScenes[2].sceneIndex).toBe(2);
    });
  });

  describe('Deletion Operations', () => {
    it('should delete specific scene instance using sceneIndex', () => {
      const slugline = 'INT. DELETE TEST - DAY';

      // Store three scenes with same slugline
      for (let i = 0; i < 3; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          slugline,
          { summary: `Scene ${i + 1}` },
          i
        );
      }

      // Delete the middle scene
      const deleted = MemoryService.deleteScene(TEST_PROJECT_ID, slugline, 1);
      expect(deleted).toBe(true);

      const remaining = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(remaining).toHaveLength(2);

      // Verify correct scene was deleted
      expect(remaining[0].summary).toBe('Scene 1');
      expect(remaining[1].summary).toBe('Scene 3');
    });

    it('should handle deletion of non-existent sceneIndex', () => {
      const slugline = 'INT. SCENE - DAY';

      MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        slugline,
        { summary: 'Only scene' },
        0
      );

      // Try to delete non-existent index
      const deleted = MemoryService.deleteScene(TEST_PROJECT_ID, slugline, 999);
      expect(deleted).toBe(false);

      // Original scene should still exist
      const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(scenes).toHaveLength(1);
    });
  });

  describe('Statistics and Metrics', () => {
    it('should calculate correct stats with duplicate sluglines', () => {
      const duplicateSlugline = 'INT. STATS TEST - DAY';

      // Store multiple scenes with same slugline
      for (let i = 0; i < 3; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          duplicateSlugline,
          {
            summary: `Duplicate ${i + 1}`,
            tokens: 100,
            wordCount: 50,
            characters: ['Alice', 'Bob'],
            themeTags: ['conflict']
          },
          i
        );
      }

      // Store unique scenes
      MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        'INT. UNIQUE - DAY',
        {
          summary: 'Unique scene',
          tokens: 150,
          wordCount: 75,
          characters: ['Charlie'],
          themeTags: ['resolution']
        },
        3
      );

      const stats = MemoryService.getMemoryStats(TEST_PROJECT_ID);

      expect(stats.totalScenes).toBe(4);
      expect(stats.totalTokens).toBe(450); // (100 * 3) + 150
      expect(stats.averageWordsPerScene).toBe(56); // (50 * 3 + 75) / 4 = 225 / 4 = 56.25 rounded
      expect(stats.uniqueCharacters).toContain('Alice');
      expect(stats.uniqueCharacters).toContain('Bob');
      expect(stats.uniqueCharacters).toContain('Charlie');
      expect(stats.allThemes).toContain('conflict');
      expect(stats.allThemes).toContain('resolution');
    });

    it('should track scene count accurately', () => {
      const slugline = 'INT. COUNT TEST - DAY';

      // Add scenes
      for (let i = 0; i < 5; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          slugline,
          { summary: `Scene ${i + 1}` },
          i
        );
      }

      expect(MemoryService.getSceneCount(TEST_PROJECT_ID)).toBe(5);

      // Delete one
      MemoryService.deleteScene(TEST_PROJECT_ID, slugline, 2);
      expect(MemoryService.getSceneCount(TEST_PROJECT_ID)).toBe(4);

      // Clear all
      MemoryService.clearSceneMemory(TEST_PROJECT_ID);
      expect(MemoryService.getSceneCount(TEST_PROJECT_ID)).toBe(0);
    });
  });

  describe('Backward Compatibility', () => {
    it('should support legacy operations without sceneIndex', () => {
      // Store without sceneIndex (legacy)
      const scene1 = MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        'INT. LEGACY SCENE 1 - DAY',
        { summary: 'Legacy 1', tokens: 100 }
      );

      const scene2 = MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        'INT. LEGACY SCENE 2 - DAY',
        { summary: 'Legacy 2', tokens: 200 }
      );

      // Both should have auto-generated sceneIds
      expect(scene1.sceneId).toBeDefined();
      expect(scene2.sceneId).toBeDefined();
      expect(scene1.sceneId).not.toBe(scene2.sceneId);

      // Should be retrievable
      const retrieved1 = MemoryService.getSceneBySlugline(TEST_PROJECT_ID, 'INT. LEGACY SCENE 1 - DAY');
      const retrieved2 = MemoryService.getSceneBySlugline(TEST_PROJECT_ID, 'INT. LEGACY SCENE 2 - DAY');

      expect(retrieved1?.summary).toBe('Legacy 1');
      expect(retrieved2?.summary).toBe('Legacy 2');
    });

    it('should handle mixed legacy and new storage patterns', () => {
      // Legacy storage (no index)
      MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        'INT. MIXED 1 - DAY',
        { summary: 'Legacy style' }
      );

      // New storage (with index)
      MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        'INT. MIXED 2 - DAY',
        { summary: 'New style with index' },
        10
      );

      // Another legacy
      MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        'INT. MIXED 3 - DAY',
        { summary: 'Another legacy' }
      );

      const allScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(allScenes).toHaveLength(3);

      // All should have unique sceneIds
      const sceneIds = allScenes.map(s => s.sceneId);
      expect(new Set(sceneIds).size).toBe(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large sceneIndex values', () => {
      const largeIndex = 999999;
      const scene = MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        'INT. LARGE INDEX - DAY',
        { summary: 'Scene with large index' },
        largeIndex
      );

      expect(scene.sceneId).toBe(`${TEST_PROJECT_ID}_${largeIndex}`);
      expect(scene.sceneIndex).toBe(largeIndex);

      // Should be retrievable
      const retrieved = MemoryService.getSceneBySlugline(TEST_PROJECT_ID, 'INT. LARGE INDEX - DAY', largeIndex);
      expect(retrieved?.summary).toBe('Scene with large index');
    });

    it('should handle sceneIndex 0 correctly', () => {
      const scene = MemoryService.updateSceneMemory(
        TEST_PROJECT_ID,
        'INT. ZERO INDEX - DAY',
        { summary: 'Scene at index 0' },
        0
      );

      expect(scene.sceneIndex).toBe(0);
      expect(scene.sceneId).toBe(`${TEST_PROJECT_ID}_0`);

      // Should not be treated as undefined/null
      const retrieved = MemoryService.getSceneBySlugline(TEST_PROJECT_ID, 'INT. ZERO INDEX - DAY', 0);
      expect(retrieved).toBeDefined();
      expect(retrieved?.summary).toBe('Scene at index 0');
    });

    it('should handle empty sluglines with composite keys', () => {
      const emptySlugline = '';

      for (let i = 0; i < 3; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          emptySlugline,
          { summary: `Empty slugline ${i + 1}` },
          i
        );
      }

      const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(scenes).toHaveLength(3);

      // All should have empty sluglines but unique sceneIds
      scenes.forEach((scene, index) => {
        expect(scene.slugline).toBe('');
        expect(scene.sceneId).toBe(`${TEST_PROJECT_ID}_${index}`);
      });
    });

    it('should handle special characters in sluglines', () => {
      const specialSlugline = "INT. JOHN'S APARTMENT - DAY (FLASHBACK)";

      for (let i = 0; i < 2; i++) {
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          specialSlugline,
          { summary: `Special chars scene ${i + 1}` },
          i
        );
      }

      const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(scenes).toHaveLength(2);

      scenes.forEach(scene => {
        expect(scene.slugline).toBe(specialSlugline);
      });
    });
  });

  describe('Performance with Large Datasets', () => {
    it('should efficiently handle hundreds of scenes with duplicate sluglines', () => {
      const startTime = Date.now();
      const sceneCount = 500;
      const uniqueSlugs = 50; // 10 scenes per slugline on average

      for (let i = 0; i < sceneCount; i++) {
        const slugIndex = i % uniqueSlugs;
        const slugline = `INT. LOCATION ${slugIndex} - DAY`;

        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          slugline,
          {
            summary: `Scene ${i + 1}`,
            tokens: 100,
            characters: [`Character${i % 10}`]
          },
          i
        );
      }

      const storageTime = Date.now() - startTime;

      // Storage should complete reasonably quickly
      expect(storageTime).toBeLessThan(1000); // Less than 1 second

      // Verify all scenes are stored
      const allScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(allScenes).toHaveLength(sceneCount);

      // Verify retrieval performance
      const retrievalStart = Date.now();
      const specificScene = MemoryService.getSceneById(TEST_PROJECT_ID, `${TEST_PROJECT_ID}_250`);
      const retrievalTime = Date.now() - retrievalStart;

      expect(specificScene).toBeDefined();
      expect(retrievalTime).toBeLessThan(100); // Retrieval should be very fast
    });
  });
});