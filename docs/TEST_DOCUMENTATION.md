# WritersRoom Regression Test Suite

## Overview

This comprehensive test suite ensures scene preservation integrity throughout the FDX parsing and storage pipeline. It was created to prevent the regression where 18.9% of scenes were lost due to duplicate slugline handling issues.

## Critical Invariants

The test suite enforces these invariants at every stage:

1. **Scene Count Preservation**: Total scene count must remain constant from parsing through storage to retrieval
2. **Index Contiguity**: Scene indices must be contiguous from 0 to N-1
3. **ID Uniqueness**: Every scene must have a unique sceneId
4. **Duplicate Preservation**: Scenes with identical sluglines must be preserved as distinct entities
5. **Property Integrity**: All scene properties must be preserved exactly

## Test Files

### 1. `gt_parity.test.ts` - Ground Truth Parity Test
- **Purpose**: Validates complete scene preservation for sr_first_look_final.fdx
- **Key Validations**:
  - Parses and verifies exactly 53 scenes
  - Posts to snapshot endpoint atomically
  - Retrieves and validates deep equality
  - Ensures no scene loss at any stage

### 2. `duplicate_sluglines.test.ts` - Duplicate Sluglines Test
- **Purpose**: Tests that identical sluglines get distinct indices
- **Key Validations**:
  - Creates test FDX with 3 identical "INT. APARTMENT - DAY" scenes
  - Verifies each gets unique sceneIndex (0, 2, 4)
  - Verifies each gets unique sceneId
  - Ensures no overwrites or merging

### 3. `network_flake.test.ts` - Network Resilience Test
- **Purpose**: Tests snapshot flow handles network issues gracefully
- **Key Features**:
  - Exponential backoff retry logic (2x multiplier)
  - Handles partial failures
  - Circuit breaker pattern
  - Timeout handling
  - Data integrity after recovery

### 4. `runtime_invariants.test.ts` - Runtime Invariant Tests
- **Purpose**: Enforces invariants with structured error reporting
- **Invariant Classes**:
  - `ParserInvariants`: Scene count, indices, IDs during parsing
  - `StorageInvariants`: No loss during storage/retrieval
  - `PipelineInvariants`: Consistency across all checkpoints

### 5. `integration_e2e.test.ts` - End-to-End Integration Test
- **Purpose**: Tests complete workflow from upload to editor display
- **Stages**:
  1. File upload and parsing
  2. Atomic snapshot storage
  3. Snapshot retrieval
  4. Editor display preparation
  5. Pipeline validation
- **Additional Tests**:
  - Concurrent uploads
  - Large file performance
  - Error recovery

## Test Data

### Fixtures (`fixtures/test-fdx-files.ts`)
- `SIMPLE_THREE_SCENES`: Basic 3-scene script
- `DUPLICATE_SLUGLINES`: 4 scenes with 3 duplicates
- `WITH_TRANSITIONS`: Tests transition handling
- `MALFORMED`: Invalid sluglines for error testing
- `EMPTY`: Empty FDX file
- `SPECIAL_CHARACTERS`: Unicode and special chars
- `LARGE`: Generated 20+ scene script

### Mocks (`mocks/fetch-mock.ts`)
- `createMockFetch()`: Configurable fetch mock
- `createFlakeyFetch()`: Simulates network issues
- `createSlowFetch()`: Latency simulation
- `createConcurrentFetch()`: Concurrent request testing

## Running Tests

### Individual Tests
```bash
# Run specific test
npm test -- __tests__/regression/gt_parity.test.ts

# Run with coverage
npm test -- --coverage __tests__/regression/

# Watch mode
npm test -- --watch __tests__/regression/duplicate_sluglines.test.ts
```

### Full Suite
```bash
# Run all regression tests
cd frontend
./__tests__/regression/run-all-tests.sh

# Or using npm
npm run test:regression
```

### CI/CD Integration
```yaml
# GitHub Actions example
- name: Run Regression Tests
  run: |
    cd frontend
    npm install
    npm run test:regression
```

## Expected Results

### sr_first_look_final.fdx Ground Truth
- **Total Scenes**: 53
- **Duplicate Groups**:
  - `EXT. SILK ROAD - NIGHT`: 3 occurrences
  - `INT. TATTOO ROOM`: 2 occurrences
  - `INT. ROSS'S HOUSE - DAY`: 2 occurrences
  - `INT. FBI OFFICE - DAY`: 2 occurrences
  - `INT. COURTHOUSE - DAY`: 1 occurrence

### Success Criteria
✅ All 53 scenes preserved
✅ Duplicate sluglines have unique indices
✅ Scene IDs are unique
✅ Indices are contiguous (0-52)
✅ All properties preserved exactly
✅ Network failures handled gracefully
✅ Atomic operations verified

## Troubleshooting

### Common Issues

1. **Scene Count Mismatch**
   - Check parser invariants in FDX import route
   - Verify snapshot endpoint is atomic
   - Check for race conditions in concurrent uploads

2. **Duplicate Scene Loss**
   - Ensure sceneIndex is included in storage key
   - Verify composite ID generation (projectId:sceneIndex)
   - Check memory service deduplication logic

3. **Network Test Failures**
   - Increase timeout values for slow CI environments
   - Check backend service is running
   - Verify API URLs in test configuration

4. **Invariant Violations**
   ```typescript
   // Example invariant error
   SceneInvariantError: Parser invariant violation: expected 53, got 43
     stage: 'parser'
     expected: 53
     actual: 43
     diff: 10
   ```
   - Check the stage where violation occurred
   - Review diff to understand what was lost
   - Use pipeline checkpoints to isolate issue

## Performance Benchmarks

| Operation | Target | Actual |
|-----------|--------|--------|
| Parse 53 scenes | < 500ms | ~200ms |
| Store snapshot | < 1000ms | ~300ms |
| Retrieve snapshot | < 200ms | ~50ms |
| 100 scene stress test | < 5000ms | ~2000ms |

## Future Enhancements

1. **Add Property-Based Testing**
   - Generate random FDX files
   - Test with varying scene counts
   - Fuzz testing for parser robustness

2. **Visual Regression Testing**
   - Snapshot UI rendering
   - Compare editor display output
   - Validate formatting preservation

3. **Performance Regression**
   - Track parsing speed over time
   - Memory usage monitoring
   - Database query optimization

4. **Cross-Browser Testing**
   - Playwright E2E tests
   - Safari/Firefox/Chrome validation
   - Mobile responsiveness

## Contact

For questions about the test suite or to report issues:
- File an issue in the repository
- Tag with `testing` and `regression` labels
- Include test output and environment details