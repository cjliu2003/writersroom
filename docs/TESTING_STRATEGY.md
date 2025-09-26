# WritersRoom Comprehensive Testing Strategy

## Executive Summary

This document outlines a comprehensive testing strategy for WritersRoom that addresses critical FDX parsing reliability issues and establishes a robust framework to prevent future regressions. The strategy covers unit, integration, and end-to-end testing with clear ownership boundaries between Parser Validator and Testing agents.

## 1. Testing Architecture Overview

### 1.1 Testing Stack
- **Unit Testing**: Jest + React Testing Library
- **Integration Testing**: Jest with API mocking
- **E2E Testing**: Playwright
- **Coverage Reporting**: Jest Coverage with Istanbul
- **CI/CD Integration**: GitHub Actions

### 1.2 Test Organization Structure
```
frontend/
├── __tests__/
│   ├── unit/
│   │   ├── utils/
│   │   │   ├── fdx-format.test.ts
│   │   │   ├── scene-extraction.test.ts
│   │   │   └── memoryAPI.test.ts
│   │   └── components/
│   │       ├── editor/
│   │       └── sidebar/
│   ├── integration/
│   │   ├── upload-parse-flow.test.ts
│   │   ├── memory-sync.test.ts
│   │   └── editor-persistence.test.ts
│   └── fixtures/
│       ├── fdx/
│       │   ├── valid/
│       │   └── edge-cases/
│       └── mock-data/
├── e2e/
│   ├── playwright/
│   │   ├── upload-workflow.spec.ts
│   │   ├── editor-interactions.spec.ts
│   │   └── memory-persistence.spec.ts
│   └── playwright.config.ts
└── jest.config.js
```

## 2. Unit Test Coverage

### 2.1 FDX Parsing & Scene Extraction

#### Critical Functions to Test

**fdx-format.ts**
- `convertToFDX()`: Element to FDX paragraph conversion
- `calculateElementLines()`: Line count calculation accuracy
- `exportToFDXXML()`: XML generation and escaping
- `calculatePageBreaks()`: Page boundary detection

**scene-extraction.ts**
- `extractScenesFromEditor()`: Scene boundary detection
- `sceneMemoryToDescription()`: Memory to UI conversion
- Scene ordering preservation
- Handling of incomplete scenes

#### Test Cases

```typescript
// Test Categories:
1. Element Classification
   - Slugline detection (INT., EXT., INT./EXT., I/E)
   - Action block identification
   - Character and dialogue pairing
   - Transition recognition (CUT TO:, FADE OUT., BLACK.)
   - Parenthetical handling

2. Scene Order Preservation
   - Sequential scene numbering
   - Scene boundary detection
   - Content attribution to correct scene
   - Handling of content before first slugline

3. Edge Cases
   - Empty scenes (slugline only)
   - Scenes with only dialogue
   - Multiple transitions in sequence
   - Malformed sluglines
   - Unicode and special characters
```

### 2.2 Memory Operations

**memoryAPI.ts**
- API request error handling
- Retry logic for failed requests
- Response validation
- Cache invalidation

**Test Coverage Areas:**
```typescript
1. CRUD Operations
   - Create new scene memory
   - Update existing scenes
   - Delete scene records
   - Retrieve by various filters

2. Error Scenarios
   - Network failures
   - Invalid responses
   - Timeout handling
   - API unavailability

3. Data Integrity
   - Request/response schema validation
   - Type safety enforcement
   - Null/undefined handling
```

### 2.3 localStorage Synchronization

**Test Scenarios:**
```typescript
1. Data Persistence
   - Save editor state to localStorage
   - Restore editor state on reload
   - Handle corrupted localStorage data
   - Storage quota exceeded handling

2. Sync Timing
   - Debounced save operations
   - Conflict resolution
   - Version management
```

## 3. Integration Tests

### 3.1 Upload → Parse → Memory Pipeline

**Test Flow:**
```typescript
1. File Upload
   - Accept valid FDX files
   - Reject invalid formats
   - Handle large files (>10MB)
   - Progress indication

2. Parsing Stage
   - XML parsing success
   - Scene extraction accuracy
   - Memory creation from parsed data
   - Error recovery

3. Editor Loading
   - Parsed content to Slate format
   - Scene sidebar population
   - Initial cursor positioning
   - UI state consistency
```

### 3.2 Memory Sync with Backend

**Test Scenarios:**
```typescript
1. Online Mode
   - Real-time scene updates
   - Batch sync operations
   - Conflict resolution
   - API rate limiting

2. Offline Mode
   - Queue operations locally
   - Sync on reconnection
   - Data consistency checks
   - Conflict detection

3. Mode Transitions
   - Seamless offline → online
   - Pending operations sync
   - Error notification
```

### 3.3 AI Integration Context

**Test Coverage:**
```typescript
1. Context Building
   - Recent scenes selection
   - Token count management
   - Character/theme filtering
   - Context relevance

2. Response Integration
   - AI suggestions insertion
   - Format preservation
   - Undo/redo support
```

## 4. Regression Test Suite

### 4.1 Golden File Testing

**Approach:**
- Maintain a set of "golden" FDX files with known correct parsing results
- Snapshot testing for parsed output
- Automated comparison on each test run

**Golden Files:**
```
fixtures/fdx/golden/
├── standard-screenplay.fdx
├── tv-episode.fdx
├── stage-play.fdx
├── dual-dialogue.fdx
└── expected-outputs/
    ├── standard-screenplay.json
    ├── tv-episode.json
    └── ...
```

### 4.2 Edge Case Coverage

**Critical Edge Cases:**
```typescript
1. Transition Variations
   - "FADE OUT."
   - "BLACK."
   - "CUT TO:"
   - "DISSOLVE TO:"
   - Custom transitions

2. Slugline Formats
   - Standard (INT. LOCATION - TIME)
   - Abbreviated (I/E LOCATION)
   - Special (FLASHBACK, DREAM SEQUENCE)
   - Missing components

3. Complex Structures
   - Nested parentheticals
   - Dual dialogue
   - Scene numbers
   - Revision marks
```

### 4.3 Performance Benchmarks

**Metrics to Track:**
```typescript
1. Parsing Speed
   - Time per page
   - Memory usage
   - CPU utilization

2. Render Performance
   - Initial render time
   - Scroll performance
   - Typing latency

3. Memory Operations
   - Save latency
   - Load time
   - Sync duration
```

## 5. End-to-End Tests

### 5.1 Critical User Journeys

**Test Scenarios:**

```typescript
// 1. New Project Creation
test('complete new project workflow', async ({ page }) => {
  // Upload FDX
  // Verify parsing
  // Edit content
  // Save changes
  // Reload and verify persistence
});

// 2. Existing Project Editing
test('edit existing screenplay', async ({ page }) => {
  // Load project
  // Navigate scenes
  // Make edits
  // Verify auto-save
  // Check memory updates
});

// 3. Collaborative Features
test('AI assistance integration', async ({ page }) => {
  // Select scene context
  // Request AI suggestion
  // Insert suggestion
  // Verify formatting
});
```

### 5.2 Cross-Browser Testing

**Browser Matrix:**
- Chrome (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest version)
- Edge (latest version)

### 5.3 Responsive Testing

**Breakpoints:**
- Mobile: 320px, 375px, 414px
- Tablet: 768px, 1024px
- Desktop: 1280px, 1920px, 2560px

## 6. Test Data Strategy

### 6.1 Test Fixtures

**Categories:**

```typescript
// Minimal test cases
const minimalTestCases = {
  singleScene: 'single-scene.fdx',
  emptyScene: 'empty-scene.fdx',
  dialogueOnly: 'dialogue-only.fdx'
};

// Complex scenarios
const complexTestCases = {
  fullScreenplay: 'feature-film.fdx',
  tvEpisode: 'tv-episode.fdx',
  stagePlay: 'stage-play.fdx'
};

// Edge cases
const edgeCases = {
  malformed: 'malformed-structure.fdx',
  unicode: 'unicode-characters.fdx',
  largeFile: 'large-screenplay.fdx'
};
```

### 6.2 Mock Data Generation

**Utilities:**
```typescript
// Scene factory
createMockScene(options?: SceneOptions): SceneMemory

// FDX generator
generateFDX(scenes: SceneDefinition[]): string

// Editor state builder
buildEditorState(elements: ElementDefinition[]): EditorState
```

## 7. Testing Framework Configuration

### 7.1 Jest Configuration

```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  collectCoverageFrom: [
    'utils/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageThresholds: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
```

### 7.2 Playwright Configuration

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
```

## 8. Continuous Integration

### 8.1 GitHub Actions Workflow

```yaml
name: Test Suite
on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node
        uses: actions/setup-node@v3
      - name: Install dependencies
        run: npm ci
      - name: Run unit tests
        run: npm run test:unit
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Run integration tests
        run: npm run test:integration

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Run Playwright tests
        run: npx playwright test
```

## 9. Ownership & Responsibilities

### 9.1 Parser Validator Agent

**Responsibilities:**
- Validate FDX parsing accuracy
- Maintain golden file test suite
- Monitor parsing performance metrics
- Review and approve parser-related changes

**Test Ownership:**
- Unit tests for fdx-format.ts
- Unit tests for scene-extraction.ts
- Golden file regression tests
- Parsing performance benchmarks

### 9.2 Testing Agent

**Responsibilities:**
- Overall test strategy implementation
- Test infrastructure maintenance
- Coverage reporting and analysis
- CI/CD pipeline management

**Test Ownership:**
- Integration test suite
- E2E test scenarios
- Test data fixtures
- Mock utilities
- Memory API tests
- UI component tests

### 9.3 Collaboration Points

**Shared Responsibilities:**
- Test case design reviews
- Edge case identification
- Performance baseline establishment
- Regression prevention strategies

## 10. Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Setup Jest and React Testing Library
- [ ] Configure Playwright
- [ ] Create test directory structure
- [ ] Implement basic test utilities

### Phase 2: Unit Tests (Week 2)
- [ ] FDX parsing unit tests
- [ ] Scene extraction unit tests
- [ ] Memory API unit tests
- [ ] Component unit tests

### Phase 3: Integration Tests (Week 3)
- [ ] Upload-parse pipeline tests
- [ ] Memory synchronization tests
- [ ] Editor persistence tests
- [ ] AI context building tests

### Phase 4: E2E & Regression (Week 4)
- [ ] Critical user journey tests
- [ ] Golden file regression suite
- [ ] Cross-browser testing setup
- [ ] Performance benchmarks

### Phase 5: CI/CD Integration (Week 5)
- [ ] GitHub Actions setup
- [ ] Coverage reporting
- [ ] Automated regression detection
- [ ] Test result dashboards

## 11. Success Metrics

### Coverage Targets
- Unit Test Coverage: 85%
- Integration Test Coverage: 70%
- E2E Critical Paths: 100%

### Quality Metrics
- Zero regression bugs in production
- <2% test flakiness rate
- <5 minute total test execution time
- 100% parser accuracy for golden files

### Performance Baselines
- FDX parsing: <100ms per page
- Scene extraction: <50ms per scene
- Memory save: <200ms
- Editor render: <500ms

## 12. Maintenance & Evolution

### Regular Activities
- Weekly test review meetings
- Monthly coverage analysis
- Quarterly performance baseline updates
- Continuous edge case collection

### Documentation Requirements
- Test case documentation
- Failure troubleshooting guides
- Performance trend reports
- Coverage gap analysis

## Conclusion

This comprehensive testing strategy provides WritersRoom with a robust framework to ensure FDX parsing reliability and prevent future regressions. By implementing this multi-layered testing approach with clear ownership boundaries, we can maintain high quality standards while enabling rapid development iterations.

The success of this strategy depends on consistent execution, regular maintenance, and continuous improvement based on production insights and user feedback.