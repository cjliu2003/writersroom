/**
 * Fetch Mock Utilities
 *
 * Provides mock implementations of fetch for testing network interactions.
 */

export interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
}

export interface MockFetchOptions {
  delay?: number;
  failureRate?: number;
  maxRetries?: number;
  responses?: Map<string, any>;
}

/**
 * Create a mock fetch function with configurable behavior
 */
export function createMockFetch(options: MockFetchOptions = {}) {
  const {
    delay = 0,
    failureRate = 0,
    responses = new Map()
  } = options;

  let callCount = 0;
  const callHistory: Array<{ url: string; options?: any; timestamp: number }> = [];

  const mockFetch = jest.fn(async (url: string, fetchOptions?: any) => {
    callCount++;
    callHistory.push({
      url,
      options: fetchOptions,
      timestamp: Date.now()
    });

    // Simulate network delay
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Simulate random failures
    if (failureRate > 0 && Math.random() < failureRate) {
      throw new Error('Network error: Connection failed');
    }

    // Check for predefined responses
    const predefinedResponse = responses.get(url);
    if (predefinedResponse) {
      return createMockResponse(200, predefinedResponse);
    }

    // Default response based on URL patterns
    if (url.includes('/snapshot')) {
      return handleSnapshotRequest(url, fetchOptions);
    }

    if (url.includes('/memory')) {
      return handleMemoryRequest(url, fetchOptions);
    }

    // Default 404 response
    return createMockResponse(404, { error: 'Not found' });
  });

  // Attach utility methods
  mockFetch.getCallCount = () => callCount;
  mockFetch.getCallHistory = () => callHistory;
  mockFetch.reset = () => {
    callCount = 0;
    callHistory.length = 0;
    mockFetch.mockClear();
  };

  return mockFetch;
}

/**
 * Create a mock response object
 */
function createMockResponse(status: number, data: any): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data)
  };
}

/**
 * Handle snapshot API requests
 */
function handleSnapshotRequest(url: string, options?: any): MockResponse {
  const method = options?.method || 'GET';

  if (method === 'POST') {
    const body = JSON.parse(options.body);
    return createMockResponse(200, {
      success: true,
      version: body.version || Date.now(),
      count: body.scenes?.length || 0
    });
  }

  if (method === 'GET') {
    // Return mock snapshot data
    return createMockResponse(200, {
      success: true,
      data: {
        version: Date.now(),
        scenes: [],
        metadata: {}
      }
    });
  }

  return createMockResponse(405, { error: 'Method not allowed' });
}

/**
 * Handle memory API requests
 */
function handleMemoryRequest(url: string, options?: any): MockResponse {
  const method = options?.method || 'GET';

  if (url.includes('/update') && method === 'POST') {
    return createMockResponse(200, {
      success: true,
      data: JSON.parse(options.body)
    });
  }

  if (url.includes('/all')) {
    return createMockResponse(200, {
      success: true,
      data: []
    });
  }

  if (url.includes('/clear') && method === 'DELETE') {
    return createMockResponse(200, {
      success: true,
      data: []
    });
  }

  return createMockResponse(200, {
    success: true,
    data: []
  });
}

/**
 * Create a mock fetch that simulates network issues
 */
export function createFlakeyFetch(options: {
  failurePattern?: number[];
  retryDelay?: number;
} = {}) {
  const { failurePattern = [1, 1, 0], retryDelay = 100 } = options;
  let attemptIndex = 0;

  return jest.fn(async (url: string, fetchOptions?: any) => {
    const shouldFail = attemptIndex < failurePattern.length && failurePattern[attemptIndex] === 1;
    attemptIndex++;

    if (shouldFail) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      throw new Error('Network timeout');
    }

    return createMockResponse(200, {
      success: true,
      attemptNumber: attemptIndex
    });
  });
}

/**
 * Create a mock fetch with latency simulation
 */
export function createSlowFetch(latency: number = 1000) {
  return jest.fn(async (url: string, options?: any) => {
    await new Promise(resolve => setTimeout(resolve, latency));

    return createMockResponse(200, {
      success: true,
      latency
    });
  });
}

/**
 * Mock fetch for testing concurrent requests
 */
export function createConcurrentFetch() {
  const activeRequests = new Set<string>();
  const completedRequests: string[] = [];

  return jest.fn(async (url: string, options?: any) => {
    const requestId = `${url}-${Date.now()}`;
    activeRequests.add(requestId);

    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));

    activeRequests.delete(requestId);
    completedRequests.push(requestId);

    return createMockResponse(200, {
      success: true,
      requestId,
      concurrentCount: activeRequests.size
    });
  });
}

/**
 * Mock localStorage for testing
 */
export class MockLocalStorage {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] || null;
  }
}