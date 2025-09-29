# Autosave Integration Guide

This guide explains how to integrate the autosave functionality into your WritersRoom components.

## Overview

The autosave system provides:
- **Debounced saving** (1.5s delay, max 5s wait)
- **Optimistic concurrency control** with version conflicts
- **Offline queue** using IndexedDB
- **Rate limiting** with exponential backoff
- **Visual indicators** for save states
- **Conflict resolution** UI

## Quick Start

### Basic Usage

```tsx
import { ScreenplayEditorWithAutosave } from '@/components/screenplay-editor-with-autosave';

function SceneEditor({ sceneId, initialVersion, authToken }) {
  const [content, setContent] = useState('');

  return (
    <ScreenplayEditorWithAutosave
      sceneId={sceneId}
      initialVersion={initialVersion}
      content={content}
      authToken={authToken}
      onChange={setContent}
      onVersionUpdate={(newVersion) => {
        console.log('Scene updated to version:', newVersion);
      }}
    />
  );
}
```

### Advanced Configuration

```tsx
<ScreenplayEditorWithAutosave
  sceneId="scene-123"
  initialVersion={5}
  content={sceneContent}
  authToken={userToken}
  onChange={handleContentChange}
  onVersionUpdate={handleVersionUpdate}
  autosaveOptions={{
    debounceMs: 2000,        // Wait 2s before saving
    maxWaitMs: 8000,         // Force save after 8s
    maxRetries: 5,           // Retry failed saves 5 times
    enableOfflineQueue: true // Queue saves when offline
  }}
  showAutosaveIndicator={true}
  compactIndicator={false}
/>
```

## Components

### ScreenplayEditorWithAutosave

The main component that wraps the screenplay editor with autosave functionality.

**Props:**
- `sceneId: string` - Unique scene identifier
- `initialVersion: number` - Current scene version for CAS
- `content?: string` - Initial scene content
- `authToken: string` - Authentication token
- `onChange?: (content: string) => void` - Content change callback
- `onVersionUpdate?: (version: number) => void` - Version update callback
- `autosaveOptions?` - Configuration options
- `showAutosaveIndicator?: boolean` - Show save status indicator
- `compactIndicator?: boolean` - Use compact indicator style

### AutosaveIndicator

Visual indicator showing the current save state.

```tsx
import { AutosaveIndicator } from '@/components/autosave-indicator';

<AutosaveIndicator
  saveState="saving"
  lastSaved={new Date()}
  error={null}
  retryAfter={null}
  onRetry={() => {}}
  onResolveConflict={() => {}}
/>
```

**Save States:**
- `idle` - No pending changes
- `pending` - Changes waiting for debounce
- `saving` - Currently saving
- `saved` - Successfully saved
- `offline` - Offline, queued for sync
- `conflict` - Version conflict detected
- `error` - Save failed
- `rate_limited` - Rate limited, will retry

### ConflictResolutionDialog

Modal dialog for resolving version conflicts.

```tsx
import { ConflictResolutionDialog } from '@/components/conflict-resolution-dialog';

<ConflictResolutionDialog
  open={showDialog}
  onOpenChange={setShowDialog}
  conflictData={conflictInfo}
  localContent={currentContent}
  onAcceptServer={() => {
    // Accept server version
  }}
  onForceLocal={async () => {
    // Force local version
  }}
  onCancel={() => {
    // Cancel resolution
  }}
/>
```

## Hooks

### useAutosave

Core hook for autosave functionality.

```tsx
import { useAutosave } from '@/hooks/use-autosave';

function MyComponent() {
  const getContent = () => editorContent;
  
  const [autosaveState, autosaveActions] = useAutosave(
    'scene-123',
    5, // initial version
    getContent,
    authToken,
    {
      debounceMs: 1500,
      maxWaitMs: 5000,
      maxRetries: 3,
      enableOfflineQueue: true
    }
  );

  // Trigger save when content changes
  useEffect(() => {
    autosaveActions.markChanged();
  }, [editorContent]);

  return (
    <div>
      <div>Status: {autosaveState.saveState}</div>
      <button onClick={autosaveActions.saveNow}>Save Now</button>
      {autosaveState.saveState === 'conflict' && (
        <button onClick={autosaveActions.acceptServerVersion}>
          Accept Server Version
        </button>
      )}
    </div>
  );
}
```

**State:**
- `saveState` - Current save state
- `lastSaved` - Last successful save timestamp
- `currentVersion` - Current scene version
- `pendingChanges` - Whether there are unsaved changes
- `conflictData` - Conflict information (if any)
- `error` - Error message (if any)
- `retryAfter` - Retry delay for rate limiting

**Actions:**
- `saveNow()` - Trigger immediate save
- `markChanged()` - Mark content as changed (triggers debounced save)
- `acceptServerVersion()` - Accept server version in conflict
- `forceLocalVersion()` - Force local version in conflict
- `retry()` - Retry failed save
- `processOfflineQueue()` - Process offline queue

## API Integration

### Backend Endpoint

The autosave system calls `PATCH /api/scenes/{scene_id}` with:

```json
{
  "position": 0,
  "scene_heading": "INT. OFFICE - DAY",
  "blocks": [
    {"type": "scene_heading", "text": "INT. OFFICE - DAY"},
    {"type": "action", "text": "John enters the office."}
  ],
  "updated_at_client": "2025-09-28T19:00:00Z",
  "base_version": 5,
  "op_id": "uuid-for-idempotency"
}
```

**Headers:**
- `Authorization: Bearer <token>`
- `Idempotency-Key: <uuid>` (optional)

**Responses:**
- `200` - Success with new version
- `409` - Version conflict with latest data
- `429` - Rate limited with `Retry-After` header

### Environment Variables

Set in your `.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Error Handling

### Version Conflicts

When a 409 conflict occurs:

1. **Automatic detection** - Hook detects conflict response
2. **UI notification** - Shows conflict indicator/notification
3. **Resolution dialog** - User can choose:
   - Accept server version (lose local changes)
   - Keep local changes (force save with new base version)
   - Cancel (stay in conflict state)

### Rate Limiting

When a 429 rate limit occurs:

1. **Automatic retry** - Respects `Retry-After` header
2. **Visual feedback** - Shows rate limit status
3. **Exponential backoff** - For subsequent failures

### Offline Handling

When offline:

1. **Queue saves** - Stores in IndexedDB
2. **Visual indicator** - Shows "Offline — queued" status
3. **Auto-sync** - Processes queue when back online
4. **Conflict resolution** - Handles conflicts during sync

## Best Practices

### Performance

- **Debounce timing** - Balance responsiveness vs. server load
- **Content diffing** - Only save when content actually changes
- **Batch operations** - Process offline queue efficiently

### User Experience

- **Clear indicators** - Always show save status
- **Conflict guidance** - Provide clear resolution options
- **Keyboard shortcuts** - Support Cmd/Ctrl+S for manual save
- **Graceful degradation** - Work without autosave if needed

### Error Recovery

- **Retry logic** - Exponential backoff for transient errors
- **Offline queue** - Never lose user changes
- **Version tracking** - Maintain consistency across sessions

## Testing

### Unit Tests

```tsx
import { renderHook, act } from '@testing-library/react';
import { useAutosave } from '@/hooks/use-autosave';

test('should debounce saves', async () => {
  const getContent = jest.fn(() => 'test content');
  const { result } = renderHook(() => 
    useAutosave('scene-1', 1, getContent, 'token')
  );

  act(() => {
    result.current[1].markChanged();
  });

  expect(result.current[0].saveState).toBe('pending');
  
  // Wait for debounce
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 1600));
  });

  expect(result.current[0].saveState).toBe('saving');
});
```

### Integration Tests

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScreenplayEditorWithAutosave } from '@/components/screenplay-editor-with-autosave';

test('should show conflict dialog on version conflict', async () => {
  // Mock API to return 409 conflict
  global.fetch = jest.fn(() =>
    Promise.resolve({
      status: 409,
      json: () => Promise.resolve({
        detail: {
          latest: { version: 6, blocks: [] },
          your_base_version: 5,
          conflict: true
        }
      })
    })
  );

  render(
    <ScreenplayEditorWithAutosave
      sceneId="scene-1"
      initialVersion={5}
      authToken="token"
    />
  );

  // Trigger save
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'new content' }
  });

  // Wait for conflict dialog
  await waitFor(() => {
    expect(screen.getByText('Version Conflict Detected')).toBeInTheDocument();
  });
});
```

## Troubleshooting

### Common Issues

1. **Saves not triggering**
   - Check `markChanged()` is called on content changes
   - Verify `getContent()` returns updated content
   - Check network connectivity

2. **Version conflicts**
   - Ensure `initialVersion` matches server state
   - Check for concurrent editing sessions
   - Verify conflict resolution logic

3. **Rate limiting**
   - Reduce save frequency
   - Check server rate limit configuration
   - Implement proper backoff

4. **Offline queue issues**
   - Verify IndexedDB is available
   - Check browser storage limits
   - Clear corrupted queue data

### Debug Mode

Enable debug logging:

```tsx
// In your component
useEffect(() => {
  if (process.env.NODE_ENV === 'development') {
    console.log('Autosave state:', autosaveState);
  }
}, [autosaveState]);
```

This completes the autosave integration guide. The system provides robust, user-friendly automatic saving with comprehensive error handling and conflict resolution.
