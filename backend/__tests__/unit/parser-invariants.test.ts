/**
 * Parser Invariant Unit Tests
 *
 * Tests the invariant checking system that ensures
 * scene counts are preserved through the parsing pipeline.
 */

import {
  invariant,
  InvariantError,
  assertSceneCount,
  assertContiguousIndices,
  assertUniqueIds,
  assertSceneProperties,
  validateScenes,
  PipelineCheckpoint
} from '../../../frontend/utils/invariants';

describe('Parser Invariant Tests', () => {
  describe('Basic invariant function', () => {
    it('should not throw when condition is true', () => {
      expect(() => {
        invariant(true, 'This should not throw');
      }).not.toThrow();
    });

    it('should throw InvariantError when condition is false', () => {
      expect(() => {
        invariant(false, 'This should throw');
      }).toThrow(InvariantError);
    });

    it('should include details in error', () => {
      try {
        invariant(false, 'Test error', {
          stage: 'test',
          expected: 10,
          actual: 5
        });
      } catch (error) {
        expect(error).toBeInstanceOf(InvariantError);
        if (error instanceof InvariantError) {
          expect(error.details?.stage).toBe('test');
          expect(error.details?.expected).toBe(10);
          expect(error.details?.actual).toBe(5);
        }
      }
    });
  });

  describe('Scene count assertion', () => {
    it('should pass when scene count matches', () => {
      const scenes = [
        { sceneId: '1', sceneIndex: 0 },
        { sceneId: '2', sceneIndex: 1 },
        { sceneId: '3', sceneIndex: 2 }
      ];

      expect(() => {
        assertSceneCount(scenes, 3, 'test');
      }).not.toThrow();
    });

    it('should throw clear error message when count mismatches', () => {
      const scenes = [
        { sceneId: '1', sceneIndex: 0 },
        { sceneId: '2', sceneIndex: 1 }
      ];

      try {
        assertSceneCount(scenes, 53, 'parser');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(InvariantError);
        if (error instanceof InvariantError) {
          expect(error.message).toBe('Scene count mismatch at parser');
          expect(error.details?.expected).toBe(53);
          expect(error.details?.actual).toBe(2);
          expect(error.details?.diff).toBe(51);

          // This is the exact error message format we want to see
          const errorOutput = `🚨 PARSER INVARIANT: Expected ${error.details?.expected} scenes, got ${error.details?.actual} scenes`;
          expect(errorOutput).toBe('🚨 PARSER INVARIANT: Expected 53 scenes, got 2 scenes');
        }
      }
    });
  });

  describe('Contiguous indices assertion', () => {
    it('should pass for contiguous indices', () => {
      const scenes = [
        { sceneIndex: 0 },
        { sceneIndex: 1 },
        { sceneIndex: 2 },
        { sceneIndex: 3 }
      ];

      expect(() => {
        assertContiguousIndices(scenes);
      }).not.toThrow();
    });

    it('should fail for non-contiguous indices', () => {
      const scenes = [
        { sceneIndex: 0 },
        { sceneIndex: 1 },
        { sceneIndex: 3 }, // Missing 2
        { sceneIndex: 4 }
      ];

      expect(() => {
        assertContiguousIndices(scenes);
      }).toThrow(InvariantError);
    });

    it('should handle unsorted scenes', () => {
      const scenes = [
        { sceneIndex: 2 },
        { sceneIndex: 0 },
        { sceneIndex: 3 },
        { sceneIndex: 1 }
      ];

      expect(() => {
        assertContiguousIndices(scenes);
      }).not.toThrow();
    });
  });

  describe('Unique IDs assertion', () => {
    it('should pass for unique IDs', () => {
      const scenes = [
        { sceneId: 'scene_0' },
        { sceneId: 'scene_1' },
        { sceneId: 'scene_2' }
      ];

      expect(() => {
        assertUniqueIds(scenes);
      }).not.toThrow();
    });

    it('should fail for duplicate IDs', () => {
      const scenes = [
        { sceneId: 'scene_0' },
        { sceneId: 'scene_1' },
        { sceneId: 'scene_0' } // Duplicate
      ];

      try {
        assertUniqueIds(scenes);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(InvariantError);
        if (error instanceof InvariantError) {
          expect(error.message).toBe('Duplicate scene IDs detected');
          expect(error.details?.context?.duplicates).toContain('scene_0');
        }
      }
    });
  });

  describe('Scene properties assertion', () => {
    it('should pass for valid scene', () => {
      const scene = {
        slugline: 'INT. OFFICE - DAY',
        sceneIndex: 0,
        sceneId: 'scene_0'
      };

      expect(() => {
        assertSceneProperties(scene, 0);
      }).not.toThrow();
    });

    it('should fail for missing slugline', () => {
      const scene = {
        sceneIndex: 0,
        sceneId: 'scene_0'
      };

      expect(() => {
        assertSceneProperties(scene, 0);
      }).toThrow('Scene at index 0 missing slugline');
    });

    it('should fail for missing sceneIndex', () => {
      const scene = {
        slugline: 'INT. OFFICE - DAY',
        sceneId: 'scene_0'
      };

      expect(() => {
        assertSceneProperties(scene, 0);
      }).toThrow('Scene at index 0 missing sceneIndex');
    });

    it('should fail for missing sceneId', () => {
      const scene = {
        slugline: 'INT. OFFICE - DAY',
        sceneIndex: 0
      };

      expect(() => {
        assertSceneProperties(scene, 0);
      }).toThrow('Scene at index 0 missing sceneId');
    });
  });

  describe('Complete scene validation', () => {
    it('should validate a proper scene array', () => {
      const scenes = [
        {
          slugline: 'INT. OFFICE - DAY',
          sceneIndex: 0,
          sceneId: 'scene_0'
        },
        {
          slugline: 'EXT. STREET - NIGHT',
          sceneIndex: 1,
          sceneId: 'scene_1'
        }
      ];

      expect(() => {
        validateScenes(scenes);
      }).not.toThrow();
    });

    it('should validate with expected count', () => {
      const scenes = Array.from({ length: 53 }, (_, i) => ({
        slugline: `SCENE ${i}`,
        sceneIndex: i,
        sceneId: `scene_${i}`
      }));

      expect(() => {
        validateScenes(scenes, 53);
      }).not.toThrow();
    });

    it('should fail validation with wrong count', () => {
      const scenes = Array.from({ length: 50 }, (_, i) => ({
        slugline: `SCENE ${i}`,
        sceneIndex: i,
        sceneId: `scene_${i}`
      }));

      expect(() => {
        validateScenes(scenes, 53);
      }).toThrow('Scene count mismatch');
    });
  });

  describe('Pipeline checkpoint tracking', () => {
    let checkpoint: PipelineCheckpoint;

    beforeEach(() => {
      checkpoint = new PipelineCheckpoint();
    });

    it('should record checkpoints', () => {
      checkpoint.record('upload', 53);
      checkpoint.record('parser', 53);
      checkpoint.record('storage', 53);

      const history = checkpoint.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0].name).toBe('upload');
      expect(history[0].count).toBe(53);
    });

    it('should validate consistent checkpoints', () => {
      checkpoint.record('upload', 53);
      checkpoint.record('parser', 53);
      checkpoint.record('storage', 53);

      expect(() => {
        checkpoint.validate();
      }).not.toThrow();
    });

    it('should detect inconsistent checkpoints', () => {
      checkpoint.record('upload', 53);
      checkpoint.record('parser', 50); // Loss!
      checkpoint.record('storage', 50);

      expect(() => {
        checkpoint.validate();
      }).toThrow('Pipeline scene count inconsistency');
    });

    it('should find loss point', () => {
      checkpoint.record('upload', 53);
      checkpoint.record('parser', 53);
      checkpoint.record('storage', 50); // Loss here
      checkpoint.record('editor', 50);

      const lossPoint = checkpoint.findLossPoint();
      expect(lossPoint).toBe('storage');
    });

    it('should return null when no loss', () => {
      checkpoint.record('upload', 53);
      checkpoint.record('parser', 53);
      checkpoint.record('storage', 53);

      const lossPoint = checkpoint.findLossPoint();
      expect(lossPoint).toBeNull();
    });

    it('should calculate diff between checkpoints', () => {
      checkpoint.record('upload', 53);
      checkpoint.record('parser', 50);

      const diff = checkpoint.getDiff('upload', 'parser');
      expect(diff).toBe(-3);
    });

    it('should clear all checkpoints', () => {
      checkpoint.record('upload', 53);
      checkpoint.record('parser', 53);

      checkpoint.clear();
      const history = checkpoint.getHistory();
      expect(history).toHaveLength(0);
    });
  });

  describe('Real-world parser invariant scenarios', () => {
    it('should detect SR First Look Final scene loss', () => {
      const checkpoint = new PipelineCheckpoint();

      // Simulate the actual bug scenario
      checkpoint.record('fdx_parse', 53, { file: 'sr_first_look_final.fdx' });
      checkpoint.record('upload_api', 53);
      checkpoint.record('snapshot_save', 53);
      checkpoint.record('snapshot_retrieve', 53);
      checkpoint.record('editor_parse', 50); // Bug: scenes lost here!

      const lossPoint = checkpoint.findLossPoint();
      expect(lossPoint).toBe('editor_parse');

      // Generate the exact error message we want
      try {
        assertSceneCount(Array(50), 53, 'editor_parse');
      } catch (error) {
        if (error instanceof InvariantError) {
          const message = `🚨 PARSER INVARIANT: Expected ${error.details?.expected} scenes, got ${error.details?.actual} scenes`;
          expect(message).toBe('🚨 PARSER INVARIANT: Expected 53 scenes, got 50 scenes');
        }
      }
    });

    it('should handle duplicate sluglines correctly', () => {
      const scenes = [
        {
          slugline: 'INT. APARTMENT - DAY',
          sceneIndex: 0,
          sceneId: 'project_0'
        },
        {
          slugline: 'INT. APARTMENT - DAY', // Duplicate slugline
          sceneIndex: 1,
          sceneId: 'project_1' // But unique ID
        },
        {
          slugline: 'INT. APARTMENT - DAY', // Another duplicate
          sceneIndex: 2,
          sceneId: 'project_2' // Still unique ID
        }
      ];

      // Should pass - duplicate sluglines are OK as long as IDs are unique
      expect(() => {
        validateScenes(scenes);
      }).not.toThrow();

      // Verify the sluglines are indeed duplicates
      const sluglines = scenes.map(s => s.slugline);
      const uniqueSlugs = new Set(sluglines);
      expect(uniqueSlugs.size).toBe(1); // All same slugline
      expect(sluglines.length).toBe(3); // But 3 scenes
    });
  });
});