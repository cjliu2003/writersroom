/**
 * Network Resilience Test
 *
 * Tests that the snapshot flow handles network issues gracefully:
 * - Mock network failures on first attempt
 * - Verify retry logic with exponential backoff
 * - Ensure eventual success and complete scene preservation
 * - Test timeout handling and error recovery
 */

import fetch from 'node-fetch';

interface SceneData {
  slugline: string;
  characters: string[];
  summary: string;
  tokens: number;
  wordCount: number;
  sceneIndex: number;
  sceneId: string;
  originalSlugline: string;
}

interface RetryOptions {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

describe('Network Resilience Test', () => {
  const TEST_PROJECT_ID = 'network-resilience-test';
  const BACKEND_API_URL = process.env.TEST_API_URL || 'http://localhost:3001/api';

  // Test data
  const testScenes: SceneData[] = [
    {
      slugline: 'INT. SERVER ROOM - DAY',
      characters: ['ADMIN'],
      summary: 'Testing network resilience',
      tokens: 50,
      wordCount: 20,
      sceneIndex: 0,
      sceneId: `${TEST_PROJECT_ID}:0`,
      originalSlugline: 'INT. SERVER ROOM - DAY'
    },
    {
      slugline: 'EXT. DATA CENTER - NIGHT',
      characters: ['ENGINEER'],
      summary: 'Network recovery in progress',
      tokens: 60,
      wordCount: 25,
      sceneIndex: 1,
      sceneId: `${TEST_PROJECT_ID}:1`,
      originalSlugline: 'EXT. DATA CENTER - NIGHT'
    }
  ];

  describe('Retry Logic', () => {
    it('should retry failed requests with exponential backoff', async () => {
      let attemptCount = 0;
      const delays: number[] = [];
      let lastAttemptTime = Date.now();

      const mockFetch = jest.fn(async (url: string, options?: any) => {
        attemptCount++;
        const currentTime = Date.now();
        const delay = currentTime - lastAttemptTime;
        delays.push(delay);
        lastAttemptTime = currentTime;

        // Fail first 2 attempts, succeed on third
        if (attemptCount < 3) {
          throw new Error('Network error: Connection refused');
        }

        return {
          ok: true,
          json: async () => ({
            success: true,
            storedCount: testScenes.length
          })
        };
      });

      const result = await fetchWithRetry(
        `${BACKEND_API_URL}/memory/snapshot`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: TEST_PROJECT_ID,
            scenes: testScenes
          })
        },
        {
          maxRetries: 3,
          initialDelay: 100,
          maxDelay: 5000,
          backoffFactor: 2
        },
        mockFetch
      );

      expect(attemptCount).toBe(3);
      expect(result.success).toBe(true);

      // Verify exponential backoff (delays should roughly double)
      if (delays.length >= 2) {
        const ratio = delays[1] / delays[0];
        expect(ratio).toBeGreaterThanOrEqual(1.5);
        expect(ratio).toBeLessThanOrEqual(2.5);
      }

      console.log(`✅ Retry logic succeeded after ${attemptCount} attempts with backoff`);
    });

    it('should fail after max retries exceeded', async () => {
      let attemptCount = 0;

      const mockFetch = jest.fn(async () => {
        attemptCount++;
        throw new Error('Network error: Connection refused');
      });

      await expect(
        fetchWithRetry(
          `${BACKEND_API_URL}/memory/snapshot`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: TEST_PROJECT_ID,
              scenes: testScenes
            })
          },
          {
            maxRetries: 3,
            initialDelay: 50,
            maxDelay: 1000,
            backoffFactor: 2
          },
          mockFetch
        )
      ).rejects.toThrow('Network error: Connection refused');

      expect(attemptCount).toBe(4); // Initial + 3 retries

      console.log(`✅ Failed appropriately after ${attemptCount} attempts`);
    });
  });

  describe('Partial Failure Handling', () => {
    it('should handle partial scene storage failures', async () => {
      const scenes = Array.from({ length: 10 }, (_, i) => ({
        slugline: `INT. SCENE ${i} - DAY`,
        characters: [],
        summary: `Scene ${i} content`,
        tokens: 50,
        wordCount: 20,
        sceneIndex: i,
        sceneId: `${TEST_PROJECT_ID}:${i}`,
        originalSlugline: `INT. SCENE ${i} - DAY`
      }));

      let callCount = 0;
      const mockFetch = jest.fn(async () => {
        callCount++;

        // Simulate intermittent failures
        if (callCount === 3 || callCount === 7) {
          throw new Error('Network timeout');
        }

        return {
          ok: true,
          json: async () => ({
            success: true,
            storedCount: 1
          })
        };
      });

      const results = await storeScenesWithRetry(scenes, mockFetch);

      // Should have attempted all scenes
      expect(results.attempted).toBe(10);
      // Some may have failed initially but retried
      expect(results.successful).toBeGreaterThanOrEqual(8);

      console.log(`✅ Handled partial failures: ${results.successful}/${results.attempted} succeeded`);
    });
  });

  describe('Timeout Handling', () => {
    it('should handle request timeouts gracefully', async () => {
      const mockFetch = jest.fn(async () => {
        // Simulate a hanging request
        await new Promise(resolve => setTimeout(resolve, 10000));
        return { ok: true };
      });

      const timeoutFetch = async (url: string, options: any) => {
        const timeout = 1000; // 1 second timeout
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), timeout)
        );

        return Promise.race([
          mockFetch(url, options),
          timeoutPromise
        ]);
      };

      await expect(
        timeoutFetch(`${BACKEND_API_URL}/memory/snapshot`, {
          method: 'POST',
          body: JSON.stringify({ scenes: testScenes })
        })
      ).rejects.toThrow('Request timeout');

      console.log(`✅ Timeout handled gracefully`);
    });
  });

  describe('Data Integrity After Recovery', () => {
    it('should preserve all scene data after network recovery', async () => {
      let attemptCount = 0;
      const storedScenes: SceneData[] = [];

      const mockFetch = jest.fn(async (url: string, options?: any) => {
        attemptCount++;

        if (url.includes('/snapshot') && options?.method === 'POST') {
          // Fail first attempt
          if (attemptCount === 1) {
            throw new Error('Network error');
          }

          // Success on retry
          const body = JSON.parse(options.body);
          storedScenes.push(...body.scenes);

          return {
            ok: true,
            json: async () => ({
              success: true,
              storedCount: body.scenes.length
            })
          };
        }

        if (url.includes('/snapshot') && !options?.method) {
          // GET request - return stored scenes
          return {
            ok: true,
            json: async () => ({
              success: true,
              scenes: storedScenes
            })
          };
        }
      });

      // Store with retry
      await fetchWithRetry(
        `${BACKEND_API_URL}/memory/snapshot`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: TEST_PROJECT_ID,
            scenes: testScenes
          })
        },
        {
          maxRetries: 3,
          initialDelay: 100,
          maxDelay: 1000,
          backoffFactor: 2
        },
        mockFetch
      );

      // Verify data integrity
      const response = await mockFetch(`${BACKEND_API_URL}/memory/snapshot?projectId=${TEST_PROJECT_ID}`);
      const result = await response.json();

      expect(result.scenes.length).toBe(testScenes.length);

      // Verify each scene preserved exactly
      testScenes.forEach((original, index) => {
        const stored = result.scenes[index];
        expect(stored.slugline).toBe(original.slugline);
        expect(stored.sceneIndex).toBe(original.sceneIndex);
        expect(stored.sceneId).toBe(original.sceneId);
        expect(stored.summary).toBe(original.summary);
      });

      console.log(`✅ All scene data preserved after network recovery`);
    });
  });

  describe('Circuit Breaker Pattern', () => {
    it('should implement circuit breaker to prevent cascading failures', async () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 1000
      });

      let callCount = 0;
      const mockFetch = jest.fn(async () => {
        callCount++;
        throw new Error('Service unavailable');
      });

      // Attempt multiple requests
      const attempts = [];
      for (let i = 0; i < 5; i++) {
        attempts.push(
          circuitBreaker.call(async () =>
            mockFetch(`${BACKEND_API_URL}/memory/snapshot`)
          ).catch(e => e.message)
        );
      }

      const results = await Promise.all(attempts);

      // Circuit should open after threshold
      expect(callCount).toBeLessThanOrEqual(3);
      expect(results.filter(r => r === 'Circuit breaker is open').length).toBeGreaterThan(0);

      console.log(`✅ Circuit breaker activated after ${callCount} failures`);

      // Wait for reset
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Circuit should be half-open now
      const resetAttempt = await circuitBreaker.call(async () =>
        mockFetch(`${BACKEND_API_URL}/memory/snapshot`)
      ).catch(e => e.message);

      expect(callCount).toBe(4); // One more attempt after reset

      console.log(`✅ Circuit breaker reset after timeout`);
    });
  });
});

/**
 * Fetch with retry logic and exponential backoff
 */
async function fetchWithRetry(
  url: string,
  options: any,
  retryOptions: RetryOptions,
  fetchFn = fetch
): Promise<any> {
  let lastError: Error | null = null;
  let delay = retryOptions.initialDelay;

  for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt++) {
    try {
      const response = await fetchFn(url, options);
      return response.json();
    } catch (error) {
      lastError = error as Error;

      if (attempt < retryOptions.maxRetries) {
        console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));

        // Exponential backoff with jitter
        delay = Math.min(
          delay * retryOptions.backoffFactor + Math.random() * 100,
          retryOptions.maxDelay
        );
      }
    }
  }

  throw lastError;
}

/**
 * Store scenes with individual retry logic
 */
async function storeScenesWithRetry(
  scenes: SceneData[],
  fetchFn = fetch
): Promise<{ attempted: number; successful: number }> {
  let attempted = 0;
  let successful = 0;

  for (const scene of scenes) {
    attempted++;

    try {
      await fetchWithRetry(
        `http://localhost:3001/api/memory/update`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'test',
            slugline: scene.slugline,
            sceneIndex: scene.sceneIndex,
            data: scene
          })
        },
        {
          maxRetries: 2,
          initialDelay: 50,
          maxDelay: 500,
          backoffFactor: 2
        },
        fetchFn
      );
      successful++;
    } catch (error) {
      console.warn(`Failed to store scene ${scene.sceneIndex}:`, error);
    }
  }

  return { attempted, successful };
}

/**
 * Simple Circuit Breaker implementation
 */
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private options: {
      failureThreshold: number;
      resetTimeout: number;
    }
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure > this.options.resetTimeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();

      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }

      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.failures >= this.options.failureThreshold) {
        this.state = 'open';
      }

      throw error;
    }
  }
}