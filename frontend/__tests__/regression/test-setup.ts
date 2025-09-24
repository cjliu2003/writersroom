/**
 * Test Setup for Regression Tests
 *
 * Common setup and configuration for all regression tests
 */

import { TextEncoder, TextDecoder } from 'util';

// Polyfills for Node environment
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;

// Performance API polyfill if needed
if (typeof global.performance === 'undefined') {
  global.performance = {
    now: () => {
      const [seconds, nanoseconds] = process.hrtime();
      return seconds * 1000 + nanoseconds / 1000000;
    }
  } as any;
}

// Mock console methods for cleaner test output
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info
};

// Suppress logs during tests unless DEBUG is set
if (!process.env.DEBUG) {
  beforeAll(() => {
    console.log = jest.fn();
    console.warn = jest.fn();
    console.info = jest.fn();
    // Keep error for debugging failed tests
  });

  afterAll(() => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
  });
}

// Global test utilities
global.testUtils = {
  /**
   * Generate mock FDX content with specified number of scenes
   */
  generateMockFDX: (sceneCount: number, withDuplicates: boolean = false) => {
    let body = '';
    for (let i = 0; i < sceneCount; i++) {
      const slugline = withDuplicates && i % 3 === 0
        ? 'INT. DUPLICATE LOCATION - DAY'
        : `INT. SCENE ${i + 1} - DAY`;

      body += `
        <Paragraph Type="Scene Heading">
          <Text>${slugline}</Text>
        </Paragraph>
        <Paragraph Type="Action">
          <Text>Action for scene ${i + 1}</Text>
        </Paragraph>`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
      <FinalDraft DocumentType="Script" Template="No" Version="12">
        <Content>
          <Body>${body}
          </Body>
        </Content>
      </FinalDraft>`;
  },

  /**
   * Create a delay for async testing
   */
  delay: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Measure execution time of a function
   */
  measureTime: async (fn: () => Promise<any>): Promise<number> => {
    const start = performance.now();
    await fn();
    return performance.now() - start;
  },

  /**
   * Generate random scene data
   */
  generateSceneData: (index: number) => ({
    slugline: `INT. SCENE ${index} - DAY`,
    summary: `Summary for scene ${index}`,
    fullContent: `Full content for scene ${index}`.repeat(10),
    tokens: 100 + index,
    wordCount: 50 + index,
    characters: [`Character${index % 5}`],
    themeTags: [`Theme${index % 3}`]
  })
};

// Type definitions for global test utilities
declare global {
  var testUtils: {
    generateMockFDX: (sceneCount: number, withDuplicates?: boolean) => string;
    delay: (ms: number) => Promise<void>;
    measureTime: (fn: () => Promise<any>) => Promise<number>;
    generateSceneData: (index: number) => {
      slugline: string;
      summary: string;
      fullContent: string;
      tokens: number;
      wordCount: number;
      characters: string[];
      themeTags: string[];
    };
  };
}

// Environment setup
process.env.NODE_ENV = 'test';

// Increase event listener limit for tests that create many operations
process.setMaxListeners(100);

export {};