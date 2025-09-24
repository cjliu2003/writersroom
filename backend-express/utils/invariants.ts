/**
 * Backend Invariant Utilities
 *
 * Runtime invariant checking for backend services.
 */

/**
 * Custom error class for scene invariant violations
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