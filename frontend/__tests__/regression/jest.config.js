/**
 * Jest Configuration for Regression Tests
 *
 * Specialized configuration for running the memory storage regression test suite
 */

module.exports = {
  displayName: 'Memory Storage Regression Tests',
  testEnvironment: 'node',

  // Test file patterns
  testMatch: [
    '**/__tests__/regression/**/*.test.ts',
    '**/__tests__/regression/**/*.test.js'
  ],

  // Module resolution
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/../../$1',
    '^@/lib/(.*)$': '<rootDir>/../../lib/$1',
    '^@/utils/(.*)$': '<rootDir>/../../utils/$1',
    '^@/types/(.*)$': '<rootDir>/../../types/$1'
  },

  // TypeScript support
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        jsx: 'react',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        moduleResolution: 'node',
        resolveJsonModule: true
      }
    }]
  },

  // Coverage configuration
  collectCoverageFrom: [
    'lib/fdx-parser.ts',
    'utils/memoryAPI.ts',
    'utils/scene-extraction.ts',
    '../../backend/services/memoryService.ts'
  ],

  coverageThresholds: {
    global: {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },

  // Test setup
  setupFilesAfterEnv: ['<rootDir>/test-setup.ts'],

  // Timeouts
  testTimeout: 30000, // 30 seconds for performance tests

  // Reporters
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: '<rootDir>/../../test-results',
      outputName: 'regression-test-results.xml',
      suiteName: 'Memory Storage Regression Tests',
      ancestorSeparator: ' › ',
      usePathForSuiteName: true
    }]
  ],

  // Verbose output for CI/CD
  verbose: true,

  // Fail fast in CI
  bail: process.env.CI === 'true' ? 1 : 0,

  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true
};