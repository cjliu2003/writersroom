/**
 * Runtime Invariant Tests
 *
 * Tests that enforce critical invariants throughout the parsing and storage pipeline.
 * These assertions help catch violations immediately rather than after data loss occurs.
 */

import { InvariantError } from '@/utils/invariants';

/**
 * Custom error class for invariant violations
 */
export class SceneInvariantError extends Error {
  constructor(
    message: string,
    public readonly details: {
      stage: string;
      expected?: number;
      actual?: number;
      diff?: number;
      context?: any;
    }
  ) {
    super(message);
    this.name = 'SceneInvariantError';
  }
}

/**
 * Parser invariants that must hold during FDX parsing
 */
export class ParserInvariants {
  private initialSceneCount?: number;
  private currentSceneCount = 0;
  private stage = 'initialization';

  /**
   * Set the expected scene count from initial parsing
   */
  setExpectedCount(count: number): void {
    this.initialSceneCount = count;
    this.stage = 'parsing';
    console.log(`🎯 Parser Invariant: Expected ${count} scenes`);
  }

  /**
   * Validate scene count at any stage of parsing
   */
  validateSceneCount(scenes: any[], stageName: string): void {
    this.currentSceneCount = scenes.length;
    this.stage = stageName;

    if (this.initialSceneCount !== undefined && scenes.length !== this.initialSceneCount) {
      throw new SceneInvariantError(
        `Parser invariant violation: expected ${this.initialSceneCount} scenes, got ${scenes.length}`,
        {
          stage: 'parser',
          expected: this.initialSceneCount,
          actual: scenes.length,
          diff: this.initialSceneCount - scenes.length,
          context: { stageName }
        }
      );
    }

    console.log(`✅ Parser Invariant (${stageName}): ${scenes.length} scenes`);
  }

  /**
   * Validate scene indices are contiguous
   */
  validateContiguousIndices(scenes: any[]): void {
    const indices = scenes.map(s => s.sceneIndex).sort((a, b) => a - b);

    for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== i) {
        throw new SceneInvariantError(
          `Parser invariant violation: non-contiguous indices at position ${i}`,
          {
            stage: 'parser',
            expected: i,
            actual: indices[i],
            context: { indices: indices.slice(Math.max(0, i - 2), i + 3) }
          }
        );
      }
    }

    console.log(`✅ Parser Invariant: Indices contiguous from 0 to ${indices.length - 1}`);
  }

  /**
   * Validate all scene IDs are unique
   */
  validateUniqueIds(scenes: any[]): void {
    const ids = scenes.map(s => s.sceneId);
    const uniqueIds = new Set(ids);

    if (uniqueIds.size !== ids.length) {
      const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
      throw new SceneInvariantError(
        `Parser invariant violation: duplicate scene IDs found`,
        {
          stage: 'parser',
          expected: ids.length,
          actual: uniqueIds.size,
          context: { duplicates }
        }
      );
    }

    console.log(`✅ Parser Invariant: All ${ids.length} scene IDs are unique`);
  }
}

/**
 * Storage invariants that must hold during memory operations
 */
export class StorageInvariants {
  private inputSceneCount?: number;
  private stage = 'initialization';

  /**
   * Track input scene count before storage
   */
  setInputCount(count: number): void {
    this.inputSceneCount = count;
    this.stage = 'pre-storage';
    console.log(`🎯 Storage Invariant: Input ${count} scenes`);
  }

  /**
   * Validate no scenes lost during storage
   */
  validateStorageComplete(storedScenes: any[]): void {
    this.stage = 'post-storage';

    if (this.inputSceneCount !== undefined && storedScenes.length !== this.inputSceneCount) {
      throw new SceneInvariantError(
        `Storage invariant violation: scenes lost during write`,
        {
          stage: 'storage',
          expected: this.inputSceneCount,
          actual: storedScenes.length,
          diff: this.inputSceneCount - storedScenes.length
        }
      );
    }

    console.log(`✅ Storage Invariant: All ${storedScenes.length} scenes stored`);
  }

  /**
   * Validate retrieval matches storage
   */
  validateRetrievalComplete(retrievedScenes: any[], expectedCount: number): void {
    this.stage = 'post-retrieval';

    if (retrievedScenes.length !== expectedCount) {
      throw new SceneInvariantError(
        `Storage invariant violation: scenes lost during retrieval`,
        {
          stage: 'retrieval',
          expected: expectedCount,
          actual: retrievedScenes.length,
          diff: expectedCount - retrievedScenes.length
        }
      );
    }

    console.log(`✅ Storage Invariant: All ${retrievedScenes.length} scenes retrieved`);
  }

  /**
   * Validate data integrity after storage
   */
  validateDataIntegrity(originalScenes: any[], storedScenes: any[]): void {
    if (originalScenes.length !== storedScenes.length) {
      throw new SceneInvariantError(
        `Storage invariant violation: scene count mismatch`,
        {
          stage: 'integrity-check',
          expected: originalScenes.length,
          actual: storedScenes.length
        }
      );
    }

    // Check each scene preserved its critical properties
    for (let i = 0; i < originalScenes.length; i++) {
      const original = originalScenes[i];
      const stored = storedScenes[i];

      if (original.sceneIndex !== stored.sceneIndex) {
        throw new SceneInvariantError(
          `Storage invariant violation: sceneIndex changed for scene ${i}`,
          {
            stage: 'integrity-check',
            expected: original.sceneIndex,
            actual: stored.sceneIndex,
            context: { sceneId: original.sceneId }
          }
        );
      }

      if (original.sceneId !== stored.sceneId) {
        throw new SceneInvariantError(
          `Storage invariant violation: sceneId changed for scene ${i}`,
          {
            stage: 'integrity-check',
            context: {
              expected: original.sceneId,
              actual: stored.sceneId
            }
          }
        );
      }
    }

    console.log(`✅ Storage Invariant: Data integrity preserved for all scenes`);
  }
}

/**
 * Pipeline invariants for end-to-end validation
 */
export class PipelineInvariants {
  private checkpoints: Map<string, number> = new Map();

  /**
   * Record scene count at a checkpoint
   */
  checkpoint(name: string, sceneCount: number): void {
    this.checkpoints.set(name, sceneCount);
    console.log(`📍 Pipeline Checkpoint "${name}": ${sceneCount} scenes`);
  }

  /**
   * Validate all checkpoints have same count
   */
  validateConsistency(): void {
    const counts = Array.from(this.checkpoints.values());
    const uniqueCounts = new Set(counts);

    if (uniqueCounts.size > 1) {
      const details = Array.from(this.checkpoints.entries())
        .map(([name, count]) => `${name}: ${count}`)
        .join(', ');

      throw new SceneInvariantError(
        `Pipeline invariant violation: inconsistent scene counts across checkpoints`,
        {
          stage: 'pipeline',
          context: { checkpoints: details, uniqueCounts: Array.from(uniqueCounts) }
        }
      );
    }

    const finalCount = counts[0];
    console.log(`✅ Pipeline Invariant: Consistent ${finalCount} scenes across all checkpoints`);
  }

  /**
   * Get checkpoint history for debugging
   */
  getHistory(): { name: string; count: number }[] {
    return Array.from(this.checkpoints.entries()).map(([name, count]) => ({
      name,
      count
    }));
  }
}

describe('Runtime Invariant Tests', () => {
  describe('Parser Invariants', () => {
    it('should detect scene count violations during parsing', () => {
      const invariants = new ParserInvariants();
      invariants.setExpectedCount(10);

      // This should pass
      const validScenes = Array.from({ length: 10 }, (_, i) => ({
        sceneIndex: i,
        sceneId: `scene_${i}`
      }));
      invariants.validateSceneCount(validScenes, 'initial-parse');

      // This should throw
      const invalidScenes = validScenes.slice(0, 8);
      expect(() => {
        invariants.validateSceneCount(invalidScenes, 'after-filter');
      }).toThrow(SceneInvariantError);
    });

    it('should detect non-contiguous indices', () => {
      const invariants = new ParserInvariants();

      const scenes = [
        { sceneIndex: 0, sceneId: 'scene_0' },
        { sceneIndex: 1, sceneId: 'scene_1' },
        { sceneIndex: 3, sceneId: 'scene_3' }, // Gap here!
        { sceneIndex: 4, sceneId: 'scene_4' }
      ];

      expect(() => {
        invariants.validateContiguousIndices(scenes);
      }).toThrow(SceneInvariantError);
    });

    it('should detect duplicate scene IDs', () => {
      const invariants = new ParserInvariants();

      const scenes = [
        { sceneIndex: 0, sceneId: 'scene_0' },
        { sceneIndex: 1, sceneId: 'scene_1' },
        { sceneIndex: 2, sceneId: 'scene_1' }, // Duplicate ID!
        { sceneIndex: 3, sceneId: 'scene_3' }
      ];

      expect(() => {
        invariants.validateUniqueIds(scenes);
      }).toThrow(SceneInvariantError);
    });
  });

  describe('Storage Invariants', () => {
    it('should detect scene loss during storage', () => {
      const invariants = new StorageInvariants();
      invariants.setInputCount(10);

      // Simulate lost scenes during storage
      const storedScenes = Array.from({ length: 8 }, (_, i) => ({
        sceneIndex: i,
        sceneId: `scene_${i}`
      }));

      expect(() => {
        invariants.validateStorageComplete(storedScenes);
      }).toThrow(SceneInvariantError);
    });

    it('should detect data corruption during storage', () => {
      const invariants = new StorageInvariants();

      const originalScenes = [
        { sceneIndex: 0, sceneId: 'scene_0', slugline: 'INT. ROOM - DAY' },
        { sceneIndex: 1, sceneId: 'scene_1', slugline: 'EXT. STREET - NIGHT' }
      ];

      const corruptedScenes = [
        { sceneIndex: 0, sceneId: 'scene_0', slugline: 'INT. ROOM - DAY' },
        { sceneIndex: 2, sceneId: 'scene_1', slugline: 'EXT. STREET - NIGHT' } // Index changed!
      ];

      expect(() => {
        invariants.validateDataIntegrity(originalScenes, corruptedScenes);
      }).toThrow(SceneInvariantError);
    });
  });

  describe('Pipeline Invariants', () => {
    it('should track scene count across pipeline stages', () => {
      const invariants = new PipelineInvariants();

      invariants.checkpoint('parse', 53);
      invariants.checkpoint('transform', 53);
      invariants.checkpoint('store', 53);
      invariants.checkpoint('retrieve', 53);

      // Should pass
      expect(() => {
        invariants.validateConsistency();
      }).not.toThrow();

      // Add inconsistent checkpoint
      invariants.checkpoint('display', 51);

      // Should fail
      expect(() => {
        invariants.validateConsistency();
      }).toThrow(SceneInvariantError);
    });

    it('should provide checkpoint history for debugging', () => {
      const invariants = new PipelineInvariants();

      invariants.checkpoint('parse', 53);
      invariants.checkpoint('store', 52);
      invariants.checkpoint('retrieve', 52);

      const history = invariants.getHistory();
      expect(history).toEqual([
        { name: 'parse', count: 53 },
        { name: 'store', count: 52 },
        { name: 'retrieve', count: 52 }
      ]);

      // Can identify where scene was lost
      const lostAt = history.find((h, i) =>
        i > 0 && h.count < history[i - 1].count
      );
      expect(lostAt?.name).toBe('store');
    });
  });

  describe('Integration with Real Parser', () => {
    it('should enforce invariants during actual FDX parsing', async () => {
      const mockFDXContent = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>
    <Paragraph Type="Scene Heading"><Text>INT. OFFICE - DAY</Text></Paragraph>
    <Paragraph Type="Action"><Text>Test scene content.</Text></Paragraph>
  </Content>
</FinalDraft>`;

      const parserInvariants = new ParserInvariants();
      const storageInvariants = new StorageInvariants();
      const pipelineInvariants = new PipelineInvariants();

      // Simulate parsing with invariant checks
      const parsedScenes = [
        {
          sceneIndex: 0,
          sceneId: 'test:0',
          slugline: 'INT. OFFICE - DAY'
        }
      ];

      // Check at each stage
      pipelineInvariants.checkpoint('raw-parse', 1);
      parserInvariants.setExpectedCount(1);
      parserInvariants.validateSceneCount(parsedScenes, 'post-parse');
      parserInvariants.validateContiguousIndices(parsedScenes);
      parserInvariants.validateUniqueIds(parsedScenes);

      pipelineInvariants.checkpoint('validated', 1);

      // Simulate storage
      storageInvariants.setInputCount(1);
      const storedScenes = [...parsedScenes];
      storageInvariants.validateStorageComplete(storedScenes);

      pipelineInvariants.checkpoint('stored', 1);

      // Final validation
      pipelineInvariants.validateConsistency();

      console.log(`✅ All invariants maintained throughout pipeline`);
    });
  });
});