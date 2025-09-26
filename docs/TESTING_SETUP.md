# WritersRoom Testing Setup Instructions

## Quick Start

### 1. Install Dependencies

Navigate to the frontend directory and install testing dependencies:

```bash
cd frontend
npm install
```

### 2. Run Tests

#### Unit Tests
```bash
# Run all unit tests
npm run test:unit

# Run with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

#### Integration Tests
```bash
npm run test:integration
```

#### End-to-End Tests
```bash
# Run Playwright tests
npm run test:e2e

# Run with UI mode for debugging
npm run test:e2e:ui
```

#### All Tests
```bash
npm test
```

## Test Structure

```
frontend/
├── __tests__/
│   ├── unit/
│   │   └── utils/
│   │       ├── fdx-format.test.ts      # FDX conversion and pagination tests
│   │       ├── scene-extraction.test.ts # Scene boundary detection tests
│   │       └── memoryAPI.test.ts       # Memory API client tests
│   ├── integration/
│   │   └── upload-parse-flow.test.ts   # Complete upload pipeline tests
│   └── fixtures/
│       └── test-helpers.ts             # Test utilities and mock data
├── e2e/
│   └── upload-workflow.spec.ts         # E2E upload and editor tests
├── jest.config.js                      # Jest configuration
├── jest.setup.js                        # Jest setup and mocks
└── playwright.config.ts                # Playwright configuration
```

## Creating Test FDX Files

Place test FDX files in the appropriate directories:

```bash
# Valid test files for regression testing
frontend/__tests__/fixtures/fdx/valid/
├── standard-screenplay.fdx
├── multiple-scenes.fdx
└── tv-episode.fdx

# Edge cases for robust testing
frontend/__tests__/fixtures/fdx/edge-cases/
├── empty.fdx
├── malformed.fdx
├── special-characters.fdx
└── unicode-content.fdx

# Large files for performance testing
frontend/__tests__/fixtures/fdx/large/
└── feature-film.fdx
```

## Running Specific Test Suites

### FDX Parsing Tests Only
```bash
npm test -- fdx-format.test.ts
```

### Scene Extraction Tests Only
```bash
npm test -- scene-extraction.test.ts
```

### Memory API Tests Only
```bash
npm test -- memoryAPI.test.ts
```

### Integration Tests Only
```bash
npm test -- upload-parse-flow.test.ts
```

## Coverage Reports

After running tests with coverage:

```bash
npm run test:coverage
```

View the HTML coverage report:
```bash
open coverage/lcov-report/index.html
```

## Debugging Tests

### Jest Tests
1. Add `debugger` statements in your test or code
2. Run tests in debug mode:
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```
3. Open Chrome DevTools at `chrome://inspect`

### Playwright Tests
1. Run tests in headed mode:
```bash
npx playwright test --headed
```

2. Use the Playwright Inspector:
```bash
npx playwright test --debug
```

3. View test traces:
```bash
npx playwright show-trace trace.zip
```

## CI/CD Integration

### GitHub Actions

The test suite is configured to run automatically on:
- Push to main branch
- Pull requests
- Manual workflow dispatch

To run tests in CI:
1. Tests run automatically on PR creation
2. Coverage reports are uploaded to Codecov
3. Test results are available in the Actions tab

### Local CI Simulation

To simulate CI environment locally:
```bash
CI=true npm test
CI=true npm run test:e2e
```

## Common Issues and Solutions

### Issue: Tests failing with "Cannot find module"
**Solution:** Ensure all imports use the correct path aliases:
```typescript
import { something } from '@/utils/something'; // ✓
import { something } from '../../../utils/something'; // ✗
```

### Issue: Playwright tests timeout
**Solution:** Increase timeout in test or config:
```typescript
test('slow test', async ({ page }) => {
  test.slow(); // Triples the timeout
  // or
  test.setTimeout(60000); // 60 seconds
});
```

### Issue: Memory API tests fail with network errors
**Solution:** Ensure mocks are properly set up:
```typescript
beforeEach(() => {
  global.fetch = jest.fn();
});
```

### Issue: localStorage not defined in tests
**Solution:** Jest setup file includes localStorage mock. Ensure jest.setup.js is referenced in jest.config.js.

## Test Data Management

### Using Test Helpers

Import test utilities for consistent test data:

```typescript
import {
  createMockScene,
  generateFDXXML,
  buildEditorState
} from '@/__tests__/fixtures/test-helpers';

// Create a mock scene
const scene = createMockScene({
  slugline: 'INT. TEST - DAY',
  hasDialogue: true,
  characterCount: 2
});

// Generate FDX XML
const fdx = generateFDXXML([
  {
    slugline: 'INT. ROOM - DAY',
    content: ['Action text', 'CHARACTER', 'Dialogue']
  }
]);
```

## Performance Benchmarks

Expected performance targets:
- Unit tests: < 5 seconds total
- Integration tests: < 10 seconds total
- E2E tests: < 30 seconds per test
- FDX parsing: < 100ms per page
- Scene extraction: < 50ms per scene

## Maintaining Tests

### Adding New Tests
1. Follow the existing structure and naming conventions
2. Use descriptive test names that explain the scenario
3. Include both positive and negative test cases
4. Document any special setup requirements

### Updating Test Fixtures
1. Keep test files minimal and focused
2. Version control all test FDX files
3. Document the purpose of each fixture file
4. Update regression tests when fixing bugs

### Test Review Checklist
- [ ] Tests are deterministic (no random failures)
- [ ] Tests are isolated (no dependencies between tests)
- [ ] Tests are fast (< 1 second for unit tests)
- [ ] Tests have clear assertions
- [ ] Tests cover edge cases
- [ ] Tests include error scenarios

## Support

For testing issues or questions:
1. Check the test output for detailed error messages
2. Review the testing strategy document
3. Consult the test helper utilities
4. Check CI logs for environment-specific issues

## Next Steps

1. Run the test suite to establish baseline
2. Add test FDX files to fixtures directory
3. Configure CI/CD pipeline
4. Set up coverage reporting
5. Integrate with code review process