/**
 * Jest Setup File
 *
 * Configuration and setup for all test suites
 */

// Increase timeout for integration tests
jest.setTimeout(10000);

// Mock console methods for cleaner test output
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

// Allow console output in tests but capture it
global.console = {
  ...console,
  log: jest.fn((...args) => {
    if (process.env.DEBUG_TESTS === 'true') {
      originalConsoleLog(...args);
    }
  }),
  error: jest.fn((...args) => {
    if (process.env.DEBUG_TESTS === 'true') {
      originalConsoleError(...args);
    }
  }),
  warn: jest.fn((...args) => {
    if (process.env.DEBUG_TESTS === 'true') {
      originalConsoleWarn(...args);
    }
  })
};

// Global test helpers
global.testHelpers = {
  /**
   * Wait for a condition to be true
   */
  waitFor: async (condition, timeout = 5000, interval = 100) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error('Timeout waiting for condition');
  },

  /**
   * Create a delay
   */
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Mock API response
   */
  mockResponse: (data, status = 200) => ({
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    ok: status >= 200 && status < 300
  })
};

// Setup for supertest
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // Use random port for tests

// Clean up after all tests
afterAll(async () => {
  // Close any open handles
  await new Promise(resolve => setTimeout(resolve, 100));
});