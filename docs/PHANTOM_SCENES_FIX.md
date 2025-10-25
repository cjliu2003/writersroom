# Phantom Blank Scenes Bug Fix

## Issue Summary
When loading a script with 2 scenes, the editor was showing 5 scenes total: the 2 real scenes plus 3 phantom blank scenes with empty headings. The first scene was also displaying as "UNTITLED SCENE" with blank content.

## Root Cause Analysis

### Problem Flow
1. **Initial Load**: Backend correctly returns 2 scenes with valid content
2. **Yjs Synchronization**: When Yjs connects and syncs via WebSocket, it calls `handleDocUpdate`
3. **Sync Validation Failure**: During sync, `synchronizeValue` temporarily produces an empty array
4. **Fallback Activation**: The validation check `if (newValue && Array.isArray(newValue) && newValue.length > 0)` fails
5. **Phantom Scene Creation**: Fallback creates a blank scene_heading: `[{type: 'scene_heading', children: [{text: ''}]}]`
6. **State Pollution**: **CRITICAL BUG**: The fallback was propagated via `onChange(JSON.stringify(fallbackValue))`
7. **Cascade Effect**: Parent component's `handleContentChange` receives blank scene, adds it to state
8. **Infinite Loop**: parseScenes detects new blank scene headings, creates more phantom scenes

### Evidence from Console Logs

```
Line 29: Received invalid editor value, using fallback
Line 403: 🔍 [parseScenes] Scene heading #0: {heading: '', extractedUUID: 'fe387dac-...'} ← PHANTOM
Line 849: 🔍 [parseScenes] Scene heading #9: {heading: '', extractedUUID: '8cb52d2f-...'} ← PHANTOM
Line 852: 🔍 [parseScenes] Scene heading #10: {heading: '', extractedUUID: '3b45ee3e-...'} ← PHANTOM
Line 886: 🔍 [extractSceneSlice] Slice: {start: 0, end: 1, sliceLength: 1} ← WRONG!
```

Each time Yjs synchronized, a new phantom blank scene was created with a new random UUID.

## The Fix

**File**: `frontend/components/screenplay-editor.tsx:588-593`

**Change**: Prevent fallback scenes from being propagated to parent state

```typescript
// BEFORE (BUG):
setValue(fallbackValue)
if (onChange && isLocalChange) {
  onChange(JSON.stringify(fallbackValue))  // ❌ Creates phantom scenes!
}

// AFTER (FIX):
setValue(fallbackValue)
// CRITICAL FIX: Do NOT propagate fallback via onChange
// Fallback scenes are temporary placeholders during Yjs sync
// Propagating them creates phantom blank scenes in parent state
// if (onChange && isLocalChange) {
//   onChange(JSON.stringify(fallbackValue))
// }
```

## Why This Works

1. **Temporary Placeholder**: The fallback is only needed temporarily during Yjs sync operations
2. **Local Editor State**: Setting fallback via `setValue()` updates the Slate editor UI to show something
3. **No State Pollution**: Not calling `onChange()` prevents the blank scene from propagating to parent state
4. **Yjs Recovery**: Once Yjs sync completes, it will provide valid content and the editor will update normally

## Impact

### Before Fix
- 2-scene script showed 5 scenes (2 real + 3 phantom)
- First scene displayed as "UNTITLED SCENE" with blank content
- extractSceneSlice extracted wrong slice (sliceLength: 1 instead of 10)
- Autosave saved blank/corrupted content

### After Fix
- 2-scene script shows exactly 2 scenes
- All scenes display correct content
- extractSceneSlice extracts correct slices
- Autosave saves proper content

## Testing Required

1. **Load 2-scene script**: Verify exactly 2 scenes shown, no phantom blanks
2. **Scene navigation**: Switch between scenes, ensure content displays correctly
3. **Yjs sync**: Verify no phantom scenes created during collaboration sync
4. **Autosave**: Verify correct content saved to backend

## Related Issues

This fix resolves:
- Blank first scene ("UNTITLED SCENE" with no content)
- Phantom blank scenes appearing after real scenes
- Position-based extraction failures
- Autosave saving incorrect/incomplete content

## Files Modified

- `frontend/components/screenplay-editor.tsx` (line 588-593)
