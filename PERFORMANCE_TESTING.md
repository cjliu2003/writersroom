# WritersRoom Performance Testing Documentation

## Overview

This document describes the comprehensive performance testing suite for WritersRoom, designed to ensure system stability and prevent regressions, particularly for the critical 53-scene test case.

## Test Suite Components

### 1. Backend Performance Tests
**Location:** `/backend/__tests__/integration/performance-resilience.test.ts`

#### Key Test Scenarios:
- **Large FDX Processing:** Tests handling of 385KB+ files
- **Payload Limits:** Validates graceful handling of oversized requests
- **Timeout Resilience:** Ensures retry mechanisms work correctly
- **53-Scene Regression:** Guarantees scene count preservation

#### Performance Thresholds:
```javascript
{
  parse: 2000ms,        // FDX parsing
  postSnapshot: 1000ms, // Snapshot POST
  getSnapshot: 500ms,   // Snapshot GET
  editorMount: 1500ms,  // Editor mount
  e2eTotal: 5000ms     // Total end-to-end
}
```

### 2. Frontend E2E Tests
**Location:** `/frontend/__tests__/e2e/performance-e2e.spec.ts`

#### Test Coverage:
- Homepage load performance
- Large file upload handling
- Scene navigation efficiency
- Search operation performance
- Network error recovery
- Memory leak detection

### 3. CI/CD Integration
**Location:** `/.github/workflows/performance-tests.yml`

Automated testing on:
- Every push to main/develop
- All pull requests
- Nightly scheduled runs (2 AM UTC)

## Running Tests

### Quick Start

```bash
# Run all performance tests
./scripts/run-performance-tests.sh all

# Run specific test suites
./scripts/run-performance-tests.sh backend
./scripts/run-performance-tests.sh frontend
./scripts/run-performance-tests.sh regression

# Verbose output
./scripts/run-performance-tests.sh all verbose
```

### Manual Test Execution

#### Backend Tests
```bash
cd backend
npm test -- --testPathPattern="performance-resilience.test.ts"
```

#### Frontend E2E Tests
```bash
cd frontend
npx playwright test __tests__/e2e/performance-e2e.spec.ts
```

#### Regression Tests Only
```bash
cd backend
npm test -- --testNamePattern="53|regression"
```

## Test Data

### Large FDX File
- **File:** `Samsara_250619 copy.fdx`
- **Size:** ~385KB
- **Scenes:** 53
- **Purpose:** Real-world performance testing

### Mock Data Generation
The test suite automatically generates mock FDX files for testing when the actual file is not available.

## Performance Metrics

### Key Metrics Tracked

1. **Parse Time:** Time to parse FDX file
2. **Upload Time:** Time to POST snapshot
3. **Retrieve Time:** Time to GET snapshot
4. **Render Time:** Time to display in editor
5. **Memory Usage:** Heap memory consumption
6. **Scene Count:** Preservation through pipeline

### Performance Benchmarks

| Metric | Small (10 scenes) | Medium (53 scenes) | Large (100 scenes) |
|--------|-------------------|--------------------|--------------------|
| Parse | < 500ms | < 2000ms | < 3500ms |
| Upload | < 200ms | < 1000ms | < 2000ms |
| Retrieve | < 100ms | < 500ms | < 1000ms |
| Total E2E | < 1000ms | < 5000ms | < 8000ms |

## 53-Scene Regression Protection

### Critical Invariants

The test suite enforces these invariants for the 53-scene case:

1. **Scene Count Preservation:** Exactly 53 scenes at all stages
2. **Order Preservation:** Scene order maintained
3. **ID Uniqueness:** All scene IDs remain unique
4. **Index Continuity:** Scene indices 0-52 without gaps

### Pipeline Checkpoints

```
Generation → Parse → Upload → Storage → Retrieval → Display
    53        53       53        53         53         53
```

Any deviation triggers immediate test failure with detailed diagnostics.

## Error Handling Tests

### Payload Limits
- Tests rejection of oversized payloads (>50MB)
- Validates clear error messages
- Ensures no crashes or data corruption

### Timeout Handling
- Simulates slow network conditions
- Tests retry mechanisms
- Validates loading states

### Network Failures
- Tests intermittent connection issues
- Validates retry buttons and CTAs
- Ensures data integrity

## CI/CD Integration

### GitHub Actions Workflow

The performance tests run automatically:

1. **On Push:** To main/develop branches
2. **On PR:** All pull requests to main
3. **Scheduled:** Nightly at 2 AM UTC

### Test Matrix

Tests run across:
- **OS:** Ubuntu, Windows, macOS
- **Node:** 16, 18, 20
- **Browsers:** Chrome, Firefox, Safari

### Failure Notifications

On test failure:
- PR comment with detailed results
- GitHub status check blocks merge
- Performance report artifact uploaded

## Interpreting Results

### Success Criteria

All tests pass when:
- ✅ Performance thresholds met
- ✅ 53 scenes preserved
- ✅ No memory leaks detected
- ✅ Error handling works correctly

### Common Failure Scenarios

1. **Scene Count Mismatch**
   ```
   Expected 53 scenes, got 50 scenes
   ```
   **Action:** Check parser or storage logic

2. **Performance Threshold Exceeded**
   ```
   Snapshot POST: 1500ms > 1000ms threshold
   ```
   **Action:** Profile code for bottlenecks

3. **Memory Leak Detected**
   ```
   Memory increase: 75MB (threshold: 50MB)
   ```
   **Action:** Check for retained references

## Troubleshooting

### Test Failures

1. **Check server logs:**
   ```bash
   tail -f /tmp/backend.log
   tail -f /tmp/frontend.log
   ```

2. **View Playwright traces:**
   ```bash
   npx playwright show-report
   ```

3. **Run with verbose output:**
   ```bash
   ./scripts/run-performance-tests.sh all verbose
   ```

### Environment Issues

1. **Servers not starting:**
   - Check ports 3000 and 3001 are free
   - Verify Node.js version >= 16

2. **Playwright issues:**
   - Install browsers: `npx playwright install`
   - Update Playwright: `npm update @playwright/test`

3. **Memory issues:**
   - Increase Node heap: `export NODE_OPTIONS="--max-old-space-size=4096"`

## Best Practices

### When Adding New Features

1. **Update regression tests** for critical paths
2. **Add performance benchmarks** for new operations
3. **Test with large datasets** (100+ scenes)
4. **Verify 53-scene case** still passes

### Performance Optimization

1. **Profile first:** Use Chrome DevTools or Node profiler
2. **Measure impact:** Run benchmarks before/after
3. **Test at scale:** Use large FDX files
4. **Monitor memory:** Check for leaks

### Test Maintenance

1. **Keep thresholds realistic:** Based on actual requirements
2. **Update mock data:** As schema changes
3. **Document changes:** In test comments
4. **Clean up resources:** In teardown hooks

## Reporting

### Performance Reports

Generated after each test run:
- `performance-test-report.md`: Summary report
- `performance-results.json`: Detailed metrics
- `playwright-report/`: E2E test results

### Metrics Dashboard

Key metrics to track over time:
- Average parse time per scene
- Memory usage per operation
- API response times
- UI rendering performance

## Contact

For questions or issues with the performance tests:
- Review this documentation
- Check test output logs
- Consult the test files directly

## Appendix

### Environment Variables

```bash
# Base URLs
BASE_URL=http://localhost:3000
API_URL=http://localhost:3001

# Test configuration
TEST_ENV=e2e
CI=true  # Set in CI environment

# Performance tuning
NODE_OPTIONS="--max-old-space-size=4096"
```

### NPM Scripts

Add to package.json for convenience:

```json
{
  "scripts": {
    "test:perf": "./scripts/run-performance-tests.sh all",
    "test:perf:backend": "./scripts/run-performance-tests.sh backend",
    "test:perf:e2e": "./scripts/run-performance-tests.sh frontend",
    "test:regression": "./scripts/run-performance-tests.sh regression"
  }
}
```

### Recommended VS Code Extensions

- Jest Runner
- Playwright Test for VSCode
- Test Explorer UI

---

Last Updated: 2025-09-23
Version: 1.0.0