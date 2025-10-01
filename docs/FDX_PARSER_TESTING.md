# FDX Parser Testing Guide

## 🎯 Mission Critical: Zero Content Loss

The FDX parser is the gateway for users to import their screenplays. **We cannot afford to lose a single word of their content.** This test suite ensures that guarantee.

## Quick Start

### Run all tests
```bash
cd backend
pytest -v
```

### Run only critical content preservation tests
```bash
cd backend
pytest tests/test_fdx_content_preservation.py -v
```

### Run with coverage
```bash
cd backend
pytest --cov=app.services.fdx_parser --cov-report=html
open htmlcov/index.html  # View coverage report
```

## Test Architecture

We use a **4-layer testing pyramid** designed specifically for content-critical parsing:

```
                    ▲
                   ╱ ╲
                  ╱   ╲
                 ╱ Edge ╲
                ╱  Cases  ╲
               ╱___________╲
              ╱             ╲
             ╱  Invariants   ╲
            ╱_________________╲
           ╱                   ╲
          ╱   Ground Truth      ╲
         ╱      Regression       ╲
        ╱_________________________╲
       ╱                           ╲
      ╱   Content Preservation     ╲
     ╱         (CRITICAL)            ╲
    ╱_________________________________╲
```

### Layer 1: Content Preservation (CRITICAL) ⚠️

**Files:** `test_fdx_content_preservation.py`

**Purpose:** Ensure ZERO data loss during parsing.

**Tests:**
- `test_no_content_loss_element_count` - All XML paragraphs are parsed
- `test_no_content_loss_text_preservation` - Every word from source appears in output
- `test_sr_first_look_exact_element_count` - Exact counts for reference file

**If these fail:** Stop everything. This is a critical bug. Do not deploy.

### Layer 2: Ground Truth Regression

**Files:** `test_fdx_parser_ground_truth.py`

**Purpose:** Prevent regressions by comparing against known-good outputs.

**Tests:**
- `test_sr_first_look_matches_ground_truth` - Compare against `parsedFdxScenes.txt`
- `test_ground_truth_file_validity` - Ensure ground truth is valid

**If these fail:** Either parser regressed or ground truth needs updating.

### Layer 3: Structural Invariants

**Files:** `test_fdx_parser_invariants.py`

**Purpose:** Enforce fundamental parsing rules across all files.

**Tests:**
- No empty elements
- Scenes start with headings
- Scene counts are reasonable
- Character names are consistent
- Metadata is complete
- Parser is deterministic

**If these fail:** Core parsing logic is broken.

### Layer 4: Edge Cases & Error Handling

**Files:** `test_fdx_parser_edge_cases.py`

**Purpose:** Handle malformed input gracefully.

**Tests:**
- Empty files
- Adjacent scene headings
- Incomplete sluglines
- Special transitions (BLACK., WHITE.)
- Unicode and special characters
- Very long scenes
- Malformed XML

**If these fail:** Parser may crash on edge cases.

## Test Data

### Primary Reference File
**`test_assets/sr_first_look_final.fdx`**
- 51 scenes
- Comprehensive screenplay structure
- Known-good parse in `parsedFdxScenes.txt`

### Edge Case Files
All files matching `test_assets/test-*.fdx` are automatically tested.

## Running Specific Test Categories

### By file
```bash
pytest tests/test_fdx_content_preservation.py -v    # Critical
pytest tests/test_fdx_parser_ground_truth.py -v     # Regression
pytest tests/test_fdx_parser_invariants.py -v       # Invariants
pytest tests/test_fdx_parser_edge_cases.py -v       # Edge cases
```

### By test name
```bash
pytest -k "content_loss" -v        # All content loss tests
pytest -k "ground_truth" -v        # Ground truth tests
pytest -k "invariant" -v           # Invariant tests
pytest -k "sr_first_look" -v       # Tests for reference file
```

### Single test
```bash
pytest tests/test_fdx_content_preservation.py::test_no_content_loss_text_preservation -v
```

## Understanding Test Output

### Success ✅
```
tests/test_fdx_content_preservation.py::test_no_content_loss_element_count PASSED
tests/test_fdx_content_preservation.py::test_no_content_loss_text_preservation PASSED
```

### Content Loss Detected ❌
```
AssertionError: Content loss detected in sr_first_look_final.fdx!
  Missing words (12): ['action', 'dialogue', 'important', ...]
  Total XML words: 5432
  Total parsed words: 5420
  This indicates text was lost during parsing!
```

**Action:** Debug `fdx_parser.py` to find where content is being dropped.

### Ground Truth Mismatch 📋
```
AssertionError: Slugline mismatch at scene 5:
  Parsed: INT. HOUSE - DAY
  Ground: INT. ROOM - DAY
```

**Action:** Determine if this is:
1. A parser bug (fix it)
2. An intentional improvement (update ground truth)

### Invariant Violation 🚨
```
AssertionError: Scene 3 doesn't start with scene_heading
  First block type: action
  Text: Some action text
```

**Action:** Scene hydration is broken. Check `_hydrate_memory_from_elements()`.

## Debugging Failed Tests

### Step 1: Run with verbose output
```bash
pytest tests/test_fdx_content_preservation.py::test_no_content_loss_text_preservation -vv
```

### Step 2: Add print debugging to parser
Edit `backend/app/services/fdx_parser.py` and add:
```python
print(f"Processing paragraph: type={xml_type}, text={text[:50]}...")
```

### Step 3: Parse test file directly
```python
from app.services.fdx_parser import FDXParser
from pathlib import Path

fdx_path = Path("test_assets/sr_first_look_final.fdx")
content = fdx_path.read_text()
parsed = FDXParser.parse_fdx_content(content, fdx_path.name)

print(f"Total elements: {len(parsed.elements)}")
print(f"Total scenes: {len(parsed.scenes)}")
for i, scene in enumerate(parsed.scenes[:3]):
    print(f"Scene {i}: {scene.slugline}")
```

### Step 4: Compare XML vs parsed
```python
from tests.utils import count_xml_elements, extract_all_text_from_xml

xml_counts = count_xml_elements(content)
print(f"XML element counts: {xml_counts}")

xml_text = extract_all_text_from_xml(content)
parsed_text = "\n".join(e.text for e in parsed.elements)

print(f"XML words: {len(xml_text.split())}")
print(f"Parsed words: {len(parsed_text.split())}")
```

## Updating Ground Truth

### When to update
- Parser improvements that change output format (but preserve content)
- Bug fixes that correct previously incorrect parsing
- Never update to mask content loss!

### How to update
```bash
cd backend
python tests/generate_ground_truth.py test_assets/sr_first_look_final.fdx > ../parsedFdxScenes.txt
```

### Verify the update
```bash
# Check what changed
git diff parsedFdxScenes.txt

# Run tests to confirm
pytest tests/test_fdx_parser_ground_truth.py -v
```

### Commit with explanation
```bash
git add parsedFdxScenes.txt
git commit -m "Update ground truth: [explain why, e.g. 'fixed transition formatting']"
```

## Adding New Test Files

### Add a new FDX file
1. Place `.fdx` file in `test_assets/`
2. Parametrized tests automatically include it

### Add ground truth for new file
```bash
python tests/generate_ground_truth.py test_assets/my_new_script.fdx > test_assets/my_new_script_ground_truth.json
```

### Add specific test for new file
```python
def test_my_new_script_specific_behavior(repo_root):
    fdx_path = repo_root / "test_assets" / "my_new_script.fdx"
    parsed = parse_to_dict(fdx_path)
    
    # Add specific assertions
    assert len(parsed) == 25  # Expected scene count
    assert "PROTAGONIST" in parsed[0]["characters"]
```

## Continuous Integration

### GitHub Actions Workflow
Tests run automatically on:
- Every push to `main` or `develop`
- Every pull request
- When FDX parser code changes
- When test files change

See `.github/workflows/test-fdx-parser.yml`

### Required Checks
Before merging PRs:
- ✅ Content preservation tests must pass
- ✅ Ground truth tests must pass
- ✅ Coverage must be >90%
- ⚠️  Invariant tests should pass (may have exceptions)
- ⚠️  Edge case tests should pass (may have exceptions)

## Performance Guidelines

### Expected Parser Performance
- Small files (<10 scenes): <100ms
- Medium files (50 scenes): <500ms
- Large files (200+ scenes): <2s

### If tests are slow
```bash
# Profile tests
pytest tests/ --profile

# Run only fast tests
pytest -m "not slow"
```

## Test Coverage Requirements

### Minimum Coverage
- **Line coverage:** 95% for `fdx_parser.py`
- **Branch coverage:** 90% for all code paths

### Check coverage
```bash
pytest --cov=app.services.fdx_parser --cov-report=term-missing
```

### View detailed coverage
```bash
pytest --cov=app.services.fdx_parser --cov-report=html
open htmlcov/index.html
```

## Common Issues and Solutions

### Issue: `pytest: command not found`
```bash
cd backend
pip install -r requirements_new.txt
```

### Issue: `ModuleNotFoundError: No module named 'app'`
```bash
# Ensure you're in backend/ directory
cd backend
pytest -v
```

### Issue: Ground truth file not found
```bash
# Check if file exists
ls -la parsedFdxScenes.txt

# Generate if missing
python tests/generate_ground_truth.py test_assets/sr_first_look_final.fdx > parsedFdxScenes.txt
```

### Issue: All tests failing with import errors
```bash
# Verify Python path
cd backend
python -c "import app.services.fdx_parser; print('OK')"

# If that fails, check Python version
python --version  # Should be 3.11+
```

## Best Practices

### Before committing parser changes
1. Run critical tests: `pytest tests/test_fdx_content_preservation.py -v`
2. Run full suite: `pytest tests/ -v`
3. Check coverage: `pytest --cov=app.services.fdx_parser`
4. Review any ground truth changes carefully

### When adding new parser features
1. Write tests first (TDD)
2. Ensure all existing tests still pass
3. Add edge case tests for new feature
4. Update ground truth if needed (with explanation)
5. Document the change

### When fixing parser bugs
1. Write a failing test that reproduces the bug
2. Fix the bug
3. Verify test now passes
4. Ensure no other tests broke
5. Add regression test to prevent recurrence

## Support and Questions

### Debugging help
- Check parser logs: Look for print statements in test output
- Use pytest's `-vv` flag for extra verbose output
- Add `import pdb; pdb.set_trace()` to debug interactively

### Test infrastructure issues
- See `backend/tests/README.md` for detailed documentation
- Check `pytest.ini` for configuration
- Review `conftest.py` for fixtures

### Parser questions
- See `backend/app/services/fdx_parser.py` docstrings
- Check FinalDraft FDX specification
- Review existing test cases for examples

---

**Remember:** The FDX parser is mission-critical. These tests are our safety net to ensure we never lose user content. Take them seriously. 🎬
