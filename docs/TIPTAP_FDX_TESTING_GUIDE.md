# TipTap FDX Import Testing Guide

**Date**: 2025-10-29
**Purpose**: Test FDX import → TipTap editor with pagination and formatting validation

---

## Quick Start

### Prerequisites

1. **Backend running**: `cd backend && python main.py` (port 8000)
2. **Frontend running**: `cd frontend && npm run dev` (port 3102)
3. **Signed in**: Navigate to http://localhost:3102/test-tiptap and sign in
4. **Test FDX file**: Use `test_assets/silk_road_090825.fdx` (469KB, full screenplay)

---

## Test Workflow

### Step 1: Upload FDX File

**Option A: Via Script** (Recommended)

```bash
cd /Users/jacklofwall/Documents/GitHub/writersroom

# Get your Firebase token
# 1. Open http://localhost:3102/test-tiptap
# 2. Sign in
# 3. Open browser console
# 4. Run: await firebase.auth().currentUser.getIdToken()
# 5. Copy the token

# Upload FDX
./scripts/upload-test-fdx.sh \
  test_assets/silk_road_090825.fdx \
  "YOUR_FIREBASE_TOKEN_HERE"

# Output will show script ID like:
# Script ID for testing:
# a1b2c3d4-5e6f-7g8h-9i0j-k1l2m3n4o5p6
```

**Option B: Via curl**

```bash
curl -X POST http://localhost:8000/api/fdx/upload \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -F "file=@test_assets/silk_road_090825.fdx"
```

**Expected Response**:
```json
{
  "success": true,
  "script_id": "a1b2c3d4-5e6f-7g8h-9i0j-k1l2m3n4o5p6",
  "title": "Silk Road",
  "scene_count": 45,
  "scenes": [...]
}
```

**Save the `script_id`** - you'll need it for Step 2!

---

### Step 2: Load in TipTap Editor

1. Navigate to http://localhost:3102/test-tiptap
2. Find the "Load Script from Backend" section
3. Paste the script ID from Step 1
4. Click "Load Script"

**Expected Result**:
- ✅ Success message: "Loaded: X blocks, Y words • Z scenes"
- ✅ Content appears in editor with proper formatting
- ✅ Pagination shows multiple pages
- ✅ Formatting matches industry standards

---

### Step 3: Verify Formatting

Check each screenplay element type:

**Scene Headings**:
- ✅ ALL CAPS
- ✅ Bold text
- ✅ Flush left (no indent)
- ✅ Double-space before, single-space after

**Action**:
- ✅ Normal case
- ✅ Flush left
- ✅ Full width (6" from left margin)

**Character Names**:
- ✅ ALL CAPS
- ✅ Positioned at 4.0" from left edge
- ✅ Single-space before, no space after

**Dialogue**:
- ✅ Normal case
- ✅ Indented at 2.5" from left edge
- ✅ Width of 3.5"
- ✅ Single-space after

**Parenthetical**:
- ✅ Italic text
- ✅ Auto-wrapped in parentheses ()
- ✅ Positioned at 3.5" from left edge
- ✅ Width of 3.0"
- ✅ No space after (dialogue follows)

**Transition**:
- ✅ ALL CAPS
- ✅ Right-aligned
- ✅ Auto-colon added (:)
- ✅ Single-space before and after

---

### Step 4: Test Pagination

**Page Break Accuracy**:
- ✅ Pages show correct numbering
- ✅ Page breaks at approximately 55 lines
- ✅ Content respects page boundaries
- ✅ No text bleeding into margins

**Visual Inspection**:
- ✅ Page gaps visible between pages
- ✅ Page numbers displayed in header
- ✅ Margins correct: 1.5" left, 1.0" right/top/bottom

---

### Step 5: Test Collaboration

1. **Open Second Tab**:
   - Click "Open in New Tab" button
   - Both tabs should connect to same script

2. **Test Real-Time Sync**:
   - Type in one tab → appears in other tab instantly
   - Move cursor → cursor appears in other tab
   - Format text → formatting syncs

3. **Verify Status**:
   - ✅ Status shows "synced" (green dot)
   - ✅ Both tabs show same content
   - ✅ No conflicts or errors

---

## Testing Checklist

### Data Conversion
- [ ] FDX upload succeeds
- [ ] Script ID returned
- [ ] Content blocks populated
- [ ] All element types present
- [ ] Conversion completes without errors
- [ ] Statistics show correct counts

### Editor Loading
- [ ] Script loads into TipTap
- [ ] All blocks converted correctly
- [ ] No missing content
- [ ] No extra/duplicate content
- [ ] Loading indicators work
- [ ] Error messages clear

### Formatting Accuracy
- [ ] Scene headings formatted correctly
- [ ] Action formatted correctly
- [ ] Character names formatted correctly
- [ ] Dialogue formatted correctly
- [ ] Parentheticals formatted correctly
- [ ] Transitions formatted correctly

### Pagination
- [ ] Pages render correctly
- [ ] Page breaks appear
- [ ] Page numbers correct
- [ ] ~55 lines per page
- [ ] Margins correct
- [ ] No overflow issues

### Collaboration
- [ ] WebSocket connects
- [ ] Real-time sync works
- [ ] Cursor sync works
- [ ] Multiple tabs work
- [ ] No conflicts
- [ ] Reconnection works

### Performance
- [ ] Load time < 2 seconds
- [ ] Typing responsive
- [ ] Scrolling smooth
- [ ] No memory leaks
- [ ] No console errors

---

## Expected Test Files

### Small Test (Quick Validation)
- **File**: `test_assets/test.fdx` (2KB)
- **Content**: Simple test screenplay
- **Use For**: Quick smoke test

### Medium Test (Format Validation)
- **File**: `test_assets/sr_first_look_final.fdx` (105KB)
- **Content**: Substantial screenplay
- **Use For**: Format and pagination testing

### Large Test (Performance & Pagination)
- **File**: `test_assets/silk_road_090825.fdx` (469KB)
- **Content**: Full-length feature screenplay
- **Use For**: Comprehensive testing, performance validation

---

## Troubleshooting

### Script Won't Load

**Error**: "Failed to fetch script: 404"
- **Cause**: Script ID doesn't exist
- **Fix**: Upload FDX again, use returned script_id

**Error**: "Script has no content"
- **Cause**: FDX upload didn't populate content_blocks
- **Fix**: Check backend logs, verify FDX file is valid

**Error**: "Failed to fetch script: 401"
- **Cause**: Invalid or expired Firebase token
- **Fix**: Sign out and sign in again

### Formatting Issues

**Issue**: Elements not positioned correctly
- **Check**: CSS loaded correctly (`styles/screenplay.css`)
- **Check**: Element types match (camelCase vs snake_case)
- **Check**: Browser cache cleared

**Issue**: Page breaks in wrong places
- **Check**: Pagination extension configured correctly
- **Check**: Margins set correctly in page.tsx
- **Check**: Line height calculations

### Collaboration Issues

**Issue**: Not syncing between tabs
- **Check**: Both tabs using same script_id
- **Check**: WebSocket connected (status shows "synced")
- **Check**: Backend WebSocket server running

**Issue**: Connection keeps dropping
- **Check**: Firebase token valid
- **Check**: Backend logs for errors
- **Check**: Network tab for WebSocket errors

---

## Console Debugging

Enable detailed logging in browser console:

```javascript
// Watch script loading
// Look for: [ScriptLoader]

// Watch conversion
// Look for: [ContentBlocksConverter]

// Watch collaboration
// Look for: [Yjs] [WebSocket]

// Watch authentication
// Look for: [AUTH DEBUG]
```

---

## Success Criteria

### Functional
- ✅ FDX import creates script
- ✅ Script loads into TipTap
- ✅ All content preserved
- ✅ Formatting correct
- ✅ Pagination accurate
- ✅ Collaboration works

### Quality
- ✅ No data loss
- ✅ No console errors
- ✅ Professional appearance
- ✅ Matches Final Draft output
- ✅ Industry-standard formatting

### Performance
- ✅ Load time < 2s for 469KB file
- ✅ Typing latency < 50ms
- ✅ Scroll performance smooth
- ✅ Memory usage stable

---

## Next Steps After Testing

### If Tests Pass ✅
1. Document any minor issues
2. Test with more FDX files
3. Compare with Final Draft output
4. Prepare for production integration

### If Tests Fail ❌
1. Document specific failures
2. Check conversion logic
3. Verify type mappings
4. Review CSS specificity
5. Debug with small test file first

---

## Test Data Files

All test files in `test_assets/`:

| File | Size | Purpose |
|------|------|---------|
| `test.fdx` | 2KB | Quick smoke test |
| `test-detailed.fdx` | 1.6KB | Element type coverage |
| `test-transitions.fdx` | 1KB | Transition formatting |
| `test-silk-road.fdx` | 894B | Mini silk road sample |
| `sr_first_look_final.fdx` | 105KB | Medium screenplay |
| `silk_road_090825.fdx` | 469KB | Full feature film |

---

## Reference Documentation

- [Content Blocks Converter Design](/docs/CONTENT_BLOCKS_CONVERTER_DESIGN.md)
- [Screenplay CSS Formatting](/frontend/styles/screenplay.css)
- [TipTap Extensions](/frontend/extensions/screenplay/)
- [FDX Parser](/backend/app/services/fdx_parser.py)

---

## Report Template

```markdown
# TipTap FDX Import Test Report

**Date**: YYYY-MM-DD
**Tester**: Name
**Test File**: filename.fdx (size)

## Results

### Data Conversion: ✅ / ❌
- Script ID: xxx
- Blocks loaded: N
- Element types: X
- Issues: None / Description

### Formatting: ✅ / ❌
- Scene headings: ✅ / ❌
- Actions: ✅ / ❌
- Characters: ✅ / ❌
- Dialogue: ✅ / ❌
- Parentheticals: ✅ / ❌
- Transitions: ✅ / ❌

### Pagination: ✅ / ❌
- Pages: N
- Lines per page: ~55
- Issues: None / Description

### Collaboration: ✅ / ❌
- Sync: Working
- Cursors: Visible
- Issues: None / Description

### Performance: ✅ / ❌
- Load time: X seconds
- Typing latency: X ms
- Issues: None / Description

## Overall: PASS / FAIL

## Notes:
- Any observations
- Issues found
- Suggestions
```

---

**Status**: ✅ READY FOR TESTING
**Updated**: 2025-10-29
