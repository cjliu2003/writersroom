# FDX Parser Test Suite

## Critical Priority: Zero Content Loss

The FDX parser is one of our most critical features. **Users must never lose content during FDX upload.** This test suite enforces that guarantee.

## Test Organization

### 1. Content Preservation Tests (`test_fdx_content_preservation.py`)
**HIGHEST PRIORITY** - These tests ensure no content is ever lost.

- `test_no_content_loss_element_count` - Verifies all XML paragraphs are parsed
- `test_no_content_loss_text_preservation` - Ensures every word from source appears in output
- `test_sr_first_look_exact_element_count` - Reference file with exact known counts

**If these tests fail, we have a critical data loss bug that must be fixed immediately.**

### 2. Ground Truth Regression Tests (`test_fdx_parser_ground_truth.py`)
Compares parser output against known-good snapshots.

- `test_sr_first_look_matches_ground_truth` - Main regression test against `parsedFdxScenes.txt`
- `test_ground_truth_file_validity` - Ensures ground truth file is valid

**If these tests fail, either the parser regressed or ground truth needs updating.**

### 3. Parser Invariants (`test_fdx_parser_invariants.py`)
Structural guarantees that must always hold.

- `test_no_empty_elements` - All elements must have text
- `test_scenes_start_with_heading` - Every scene starts with scene_heading
- `test_scene_count_reasonable` - Scene count matches scene headings
- `test_scene_sluglines_unique_or_sequential` - Detects scene merging bugs
- `test_character_names_consistent` - Character formatting is reliable
- `test_scene_metadata_populated` - All scenes have complete metadata
- `test_parser_deterministic` - Same input always produces same output

**These are fundamental guarantees. Failures indicate parser logic errors.**

### 4. Edge Cases (`test_fdx_parser_edge_cases.py`)
Error handling and boundary conditions.

- Empty files, single scenes, adjacent headings
- Incomplete sluglines, special transitions (BLACK., WHITE.)
- Orphaned dialogue, unicode characters
- Very long scenes, malformed XML
- Missing sections, empty paragraphs

**These ensure robustness and graceful degradation.**

## Running Tests

### Run all tests
```bash
cd backend
pytest -v
```

### Run specific test categories
```bash
# Content preservation only (critical)
pytest tests/test_fdx_content_preservation.py -v

# Ground truth regression
pytest tests/test_fdx_parser_ground_truth.py -v

# Invariants
pytest tests/test_fdx_parser_invariants.py -v

# Edge cases
pytest tests/test_fdx_parser_edge_cases.py -v
```

### Run with coverage
```bash
pytest --cov=app.services.fdx_parser --cov-report=html
```

### Run only fast tests (skip slow parametrized tests)
```bash
pytest -m "not slow"
```

## Test Data

### Current test files in `test_assets/`
- `sr_first_look_final.fdx` - Primary reference file (51 scenes, comprehensive)
- `test-*.fdx` - Various edge case test files
- `parsedFdxScenes.txt` - Ground truth snapshot for sr_first_look_final.fdx

### Adding new test files
1. Add `.fdx` file to `test_assets/`
2. Parametrized tests will automatically include it
3. To create ground truth snapshot:
   ```bash
   python tests/generate_ground_truth.py test_assets/your_file.fdx
   ```

## Interpreting Test Failures

### Content Preservation Failure
```
AssertionError: Content loss detected in example.fdx!
  Missing words (5): ['action', 'dialogue', 'scene', ...]
```
**Action:** This is critical. Debug parser immediately to find where content is dropped.

### Ground Truth Mismatch
```
AssertionError: Slugline mismatch at scene 5:
  Parsed: INT. ROOM - DAY
  Ground: INT. HOUSE - DAY
```
**Action:** Either parser regressed or ground truth is outdated. Compare carefully.

### Invariant Violation
```
AssertionError: Scene 3 doesn't start with scene_heading
  First block type: action
```
**Action:** Scene hydration logic is broken. Check `_hydrate_memory_from_elements()`.

## Continuous Integration

These tests should run on:
- Every commit to main branches
- Every pull request
- Before every deployment

**Content preservation tests must pass 100% before deploying.**

## Updating Ground Truth

When parser improvements are intentional:

1. Verify changes are correct (no content loss)
2. Run parser on reference file:
   ```bash
   python tests/generate_ground_truth.py test_assets/sr_first_look_final.fdx > parsedFdxScenes.txt
   ```
3. Review diff carefully
4. Commit updated ground truth with explanation

## Performance Benchmarks

Track parser performance over time:

```bash
pytest tests/test_fdx_parser_performance.py --benchmark-only
```

Expected performance:
- Small files (<10 scenes): <100ms
- Medium files (50 scenes): <500ms
- Large files (200+ scenes): <2s

## Test Coverage Goals

- **Line coverage:** >95% for `fdx_parser.py`
- **Branch coverage:** >90% for all code paths
- **Edge case coverage:** All known FDX variants tested

Current coverage:
```bash
pytest --cov=app.services.fdx_parser --cov-report=term-missing
```

## Known Issues and TODOs

- [ ] Add performance regression tests
- [ ] Add fuzzing tests for malformed FDX
- [ ] Test memory usage for very large files (1000+ scenes)
- [ ] Add integration tests with full upload flow
- [ ] Test concurrent parsing (thread safety)

## Questions?

See main documentation or contact the team.
