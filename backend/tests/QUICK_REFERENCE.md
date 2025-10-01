# FDX Parser Testing - Quick Reference

## 🚀 Quick Commands

```bash
# Run all tests
pytest -v

# Run only CRITICAL content preservation tests
pytest tests/test_fdx_content_preservation.py -v

# Run specific test file
pytest tests/test_fdx_parser_ground_truth.py -v

# Run with coverage
pytest --cov=app.services.fdx_parser --cov-report=html

# Run fast (skip slow parametrized tests)
pytest -m "not slow" -v
```

## 📊 Test Layers (Priority Order)

1. **Content Preservation** ⚠️ CRITICAL
   - Must NEVER fail
   - Ensures zero data loss
   - File: `test_fdx_content_preservation.py`

2. **Ground Truth Regression**
   - Prevents breaking changes
   - File: `test_fdx_parser_ground_truth.py`

3. **Invariants**
   - Structural guarantees
   - File: `test_fdx_parser_invariants.py`

4. **Edge Cases**
   - Error handling
   - File: `test_fdx_parser_edge_cases.py`

## 🔍 Common Test Scenarios

### Test a single FDX file
```bash
# Add file to test_assets/
cp ~/my_script.fdx test_assets/

# Parametrized tests automatically pick it up
pytest tests/test_fdx_parser_invariants.py -v
```

### Generate ground truth
```bash
python tests/generate_ground_truth.py test_assets/my_script.fdx > test_assets/my_script_ground_truth.json
```

### Update main ground truth
```bash
python tests/generate_ground_truth.py test_assets/sr_first_look_final.fdx > ../parsedFdxScenes.txt
git diff parsedFdxScenes.txt  # Review changes
```

### Debug failing test
```bash
pytest tests/test_fdx_content_preservation.py::test_no_content_loss_text_preservation -vv --tb=long
```

## 🎯 Test Expectations

### Must Pass (Critical)
- ✅ All content preservation tests
- ✅ Ground truth regression tests
- ✅ Coverage >90%

### Should Pass (Important)
- ⚠️  All invariant tests
- ⚠️  Most edge case tests

### Can Skip (Development)
- ⏭️  Performance benchmarks
- ⏭️  Slow integration tests

## 📝 When Tests Fail

### Content Loss Detected
```
❌ test_no_content_loss_text_preservation FAILED
   Missing words: ['important', 'dialogue', ...]
```
**Action:** STOP. Critical bug. Debug parser immediately.

### Ground Truth Mismatch
```
❌ test_sr_first_look_matches_ground_truth FAILED
   Slugline mismatch at scene 5
```
**Action:** Is this a bug or improvement? Fix or update ground truth.

### Invariant Violation
```
❌ test_scenes_start_with_heading FAILED
   Scene 3 doesn't start with scene_heading
```
**Action:** Scene hydration broken. Check `_hydrate_memory_from_elements()`.

## 🛠️ Troubleshooting

```bash
# Can't find pytest
pip install -r requirements_new.txt

# Import errors
cd backend  # Must run from backend/
export PYTHONPATH=.

# Ground truth missing
python tests/generate_ground_truth.py test_assets/sr_first_look_final.fdx > ../parsedFdxScenes.txt

# View coverage gaps
pytest --cov=app.services.fdx_parser --cov-report=term-missing
```

## 📈 Before Committing

```bash
# 1. Run critical tests
pytest tests/test_fdx_content_preservation.py -v

# 2. Run full suite
pytest tests/ -v

# 3. Check coverage
pytest --cov=app.services.fdx_parser --cov-report=term

# 4. Review any ground truth changes
git diff parsedFdxScenes.txt

# 5. Commit with clear message
git add .
git commit -m "feat: improve FDX parser [describe changes]"
```

## 🔗 More Info

- Full guide: `docs/FDX_PARSER_TESTING.md`
- Test docs: `backend/tests/README.md`
- Parser code: `backend/app/services/fdx_parser.py`
