/**
 * Invariant Utilities
 *
 * Runtime invariant checking utilities to ensure data integrity
 * throughout the parsing and storage pipeline.
 */

/**
 * Custom error class for invariant violations
 */
export class InvariantError extends Error {
  constructor(
    message: string,
    public readonly details?: {
      stage?: string;
      expected?: any;
      actual?: any;
      diff?: any;
      context?: any;
    }
  ) {
    super(message);
    this.name = 'InvariantError';

    // Log details for debugging
    if (details) {
      console.error('Invariant Violation Details:', details);
    }
  }
}

/**
 * Assert that a condition is true, throw InvariantError if not
 */
export function invariant(
  condition: boolean,
  message: string,
  details?: InvariantError['details']
): asserts condition {
  if (!condition) {
    throw new InvariantError(message, details);
  }
}

/**
 * Assert scene count matches expected
 */
export function assertSceneCount(
  scenes: any[],
  expected: number,
  stage: string
): void {
  invariant(
    scenes.length === expected,
    `Scene count mismatch at ${stage}`,
    {
      stage,
      expected,
      actual: scenes.length,
      diff: expected - scenes.length
    }
  );
}

/**
 * Assert scene indices are contiguous from 0 to n-1
 */
export function assertContiguousIndices(scenes: any[]): void {
  const indices = scenes.map(s => s.sceneIndex).sort((a, b) => a - b);

  for (let i = 0; i < indices.length; i++) {
    invariant(
      indices[i] === i,
      `Non-contiguous scene index at position ${i}`,
      {
        stage: 'index-validation',
        expected: i,
        actual: indices[i],
        context: {
          indices: indices.slice(Math.max(0, i - 2), i + 3)
        }
      }
    );
  }
}

/**
 * Assert all scene IDs are unique
 */
export function assertUniqueIds(scenes: any[]): void {
  const ids = scenes.map(s => s.sceneId);
  const uniqueIds = new Set(ids);

  invariant(
    uniqueIds.size === ids.length,
    'Duplicate scene IDs detected',
    {
      stage: 'id-validation',
      expected: ids.length,
      actual: uniqueIds.size,
      context: {
        duplicates: ids.filter((id, index) => ids.indexOf(id) !== index)
      }
    }
  );
}

/**
 * Assert scenes have required properties
 */
export function assertSceneProperties(scene: any, index: number): void {
  invariant(
    scene.slugline !== undefined,
    `Scene at index ${index} missing slugline`,
    {
      stage: 'property-validation',
      context: { index, scene }
    }
  );

  invariant(
    scene.sceneIndex !== undefined,
    `Scene at index ${index} missing sceneIndex`,
    {
      stage: 'property-validation',
      context: { index, scene }
    }
  );

  invariant(
    scene.sceneId !== undefined,
    `Scene at index ${index} missing sceneId`,
    {
      stage: 'property-validation',
      context: { index, scene }
    }
  );
}

/**
 * Validate complete scene array
 */
export function validateScenes(
  scenes: any[],
  expectedCount?: number
): void {
  // Check array
  invariant(
    Array.isArray(scenes),
    'Scenes must be an array',
    {
      stage: 'type-validation',
      actual: typeof scenes
    }
  );

  // Check count if provided
  if (expectedCount !== undefined) {
    assertSceneCount(scenes, expectedCount, 'validation');
  }

  // Check each scene
  scenes.forEach((scene, index) => {
    assertSceneProperties(scene, index);
  });

  // Check indices
  assertContiguousIndices(scenes);

  // Check IDs
  assertUniqueIds(scenes);
}

/**
 * Pipeline checkpoint for tracking scene counts
 */
export class PipelineCheckpoint {
  private checkpoints = new Map<string, {
    count: number;
    timestamp: number;
    metadata?: any;
  }>();

  /**
   * Record a checkpoint
   */
  record(name: string, count: number, metadata?: any): void {
    this.checkpoints.set(name, {
      count,
      timestamp: Date.now(),
      metadata
    });

    console.log(`📍 Pipeline Checkpoint: ${name} = ${count} scenes`);
  }

  /**
   * Validate all checkpoints have the same count
   */
  validate(): void {
    const counts = Array.from(this.checkpoints.values()).map(c => c.count);
    const uniqueCounts = new Set(counts);

    invariant(
      uniqueCounts.size === 1,
      'Pipeline scene count inconsistency',
      {
        stage: 'pipeline',
        context: {
          checkpoints: Array.from(this.checkpoints.entries()).map(
            ([name, data]) => ({ name, count: data.count })
          ),
          uniqueCounts: Array.from(uniqueCounts)
        }
      }
    );
  }

  /**
   * Get the difference between two checkpoints
   */
  getDiff(from: string, to: string): number | null {
    const fromData = this.checkpoints.get(from);
    const toData = this.checkpoints.get(to);

    if (!fromData || !toData) {
      return null;
    }

    return toData.count - fromData.count;
  }

  /**
   * Find where scenes were lost
   */
  findLossPoint(): string | null {
    const entries = Array.from(this.checkpoints.entries());

    for (let i = 1; i < entries.length; i++) {
      const [prevName, prevData] = entries[i - 1];
      const [currName, currData] = entries[i];

      if (currData.count < prevData.count) {
        return currName;
      }
    }

    return null;
  }

  /**
   * Get checkpoint history
   */
  getHistory(): Array<{
    name: string;
    count: number;
    timestamp: number;
  }> {
    return Array.from(this.checkpoints.entries()).map(([name, data]) => ({
      name,
      count: data.count,
      timestamp: data.timestamp
    }));
  }

  /**
   * Clear all checkpoints
   */
  clear(): void {
    this.checkpoints.clear();
  }
}

/**
 * Create a guarded function that validates invariants
 */
export function withInvariants<T extends (...args: any[]) => any>(
  fn: T,
  preConditions?: () => void,
  postConditions?: (result: ReturnType<T>) => void
): T {
  return ((...args: Parameters<T>) => {
    // Check pre-conditions
    if (preConditions) {
      preConditions();
    }

    // Execute function
    const result = fn(...args);

    // Check post-conditions
    if (postConditions) {
      if (result instanceof Promise) {
        return result.then(value => {
          postConditions(value);
          return value;
        });
      } else {
        postConditions(result);
      }
    }

    return result;
  }) as T;
}