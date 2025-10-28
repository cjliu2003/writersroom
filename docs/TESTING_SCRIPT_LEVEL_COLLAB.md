# Testing Script-Level Collaboration

This guide provides instructions for testing the script-level real-time collaboration implementation.

## Overview

The script-level collaboration test page validates:
- WebSocket connection to backend
- Yjs CRDT synchronization
- Scene boundary tracking
- Page break calculation
- Real-time multi-client collaboration
- Connection resilience (offline/reconnect)

## Test Page Location

**Frontend URL**: `http://localhost:3102/test-script-collab?scriptId=<uuid>`

**Component**: `frontend/app/test-script-collab/page.tsx`

## Prerequisites

### 1. Backend Running

```bash
cd backend
source .venv/bin/activate  # or: .venv\Scripts\activate on Windows
python main.py
```

**Expected**: Backend running on `http://localhost:8000`

### 2. Database Setup

Ensure you have a valid script ID in the database:

```sql
-- Check existing scripts
SELECT id, title, created_at FROM scripts;

-- Or create a test script
INSERT INTO scripts (id, title, user_id, created_at, updated_at)
VALUES (
  '12345678-1234-1234-1234-123456789012',  -- Use this ID in URL
  'Test Script for Collaboration',
  'your-user-id',
  NOW(),
  NOW()
);
```

### 3. Redis (Optional)

Redis enables multi-server coordination but is optional. The system falls back to single-server mode if Redis is unavailable.

**With Redis** (recommended for full testing):
```bash
# Start Redis if you have it
redis-server
```

**Without Redis**: Backend logs will show fallback messages, but collaboration will work within a single server instance.

### 4. Frontend Running

```bash
cd frontend
npm run dev
```

**Expected**: Frontend running on `http://localhost:3102`

## Authentication Setup

The test page uses the **real Firebase authentication** that's integrated throughout the app. You must be signed in to access the test page.

### How It Works

1. **Automatic Authentication**: The test page uses the same `AuthContext` as the rest of the application
2. **Sign In Required**: If you're not authenticated, you'll see a message prompting you to sign in
3. **Token Management**: Firebase auth tokens are automatically managed and refreshed
4. **Access Control**: You can only access scripts you have permission to view/edit

### Before Testing

1. **Sign in to the application** using your normal Firebase credentials
2. **Upload or create a script** - note the script ID from the database or API response
3. **Navigate to test page** with your script ID: `/test-script-collab?scriptId=<your-script-id>`

## Test Scenarios

### 1. Basic Connection Test

**Steps**:
1. Open `http://localhost:3102/test-script-collab?scriptId=<your-script-id>`
2. Check connection status in top-right (should show "Synced")
3. Check right panel shows "Status: Synced"

**Expected**:
- Status indicator: Green dot + "Synced"
- No connection errors in browser console
- Backend logs show WebSocket connection established

**Troubleshooting**:
- If "Connecting..." persists: Check backend is running
- If "Error": Check backend logs for authentication issues
- If "Offline": Check WebSocket endpoint configuration

### 2. Content Editing Test

**Steps**:
1. Type in the editor: "This is a test."
2. Wait 500ms (debounce delay)
3. Check right panel "Total Elements" count updates

**Expected**:
- Content appears in editor immediately
- Element count updates after typing
- No lag or cursor jumping

### 3. Real-Time Collaboration Test

**Steps**:
1. Open test page in Browser 1
2. Open SAME URL in Browser 2 (or incognito/different browser)
3. Type in Browser 1: "Hello from Browser 1"
4. Observe Browser 2

**Expected**:
- Changes from Browser 1 appear in Browser 2 within ~100ms
- Both browsers show "Synced" status
- No conflicts or lost characters
- Cursor positions remain stable

**Advanced**:
- Try typing simultaneously in both browsers
- Verify Yjs CRDT correctly merges changes
- Check for character ordering consistency

### 4. Scene Boundary Tracking Test

**Steps**:
1. Type a scene heading (must match pattern):
   ```
   INT. TEST ROOM - DAY
   ```
2. Press Enter, type action: "Character enters."
3. Press Enter, type another scene heading:
   ```
   EXT. STREET - NIGHT
   ```
4. Check right panel "Scene Boundaries" section

**Expected**:
- Scene count shows 2 scenes
- Each scene boundary shows:
  - Scene number (1, 2)
  - Heading text
  - Element indices (start-end)

**Scene Heading Patterns**:
- Must start with `INT.`, `EXT.`, `INT./EXT.`, or `EXT./INT.`
- Format: `LOCATION - TIME`
- Examples: `INT. HOUSE - DAY`, `EXT. PARK - NIGHT`

### 5. Page Break Calculation Test

**Steps**:
1. Add enough content to exceed 55 lines (industry standard)
2. Add multiple scene headings and action paragraphs
3. Wait 500ms for debounced calculation
4. Check right panel "Total Pages" and "Page Breaks"

**Expected**:
- Page count increases as content grows
- "Page Breaks" count shows where breaks occur
- "(calculating...)" appears briefly during calculation
- No UI blocking or lag

**Approximate Content for 2 Pages**:
- 1 scene heading (2 lines)
- 20 action paragraphs (~53 lines)
- Content should trigger first page break

### 6. Connection Resilience Test

**Steps**:
1. Open test page with working connection
2. Stop backend server (`Ctrl+C`)
3. Observe status change to "Offline"
4. Try typing (should still work locally)
5. Restart backend server
6. Observe automatic reconnection

**Expected**:
- Status changes: Synced → Offline
- Typing continues to work (local Slate editor)
- On backend restart: Offline → Connecting → Connected → Synced
- Changes made offline sync when reconnected

**Troubleshooting**:
- If no auto-reconnect: Check console for retry attempts
- Max 5 retry attempts with exponential backoff
- After 5 failures, shows "Error" status

### 7. Multi-Scene Script Test

**Steps**:
1. Create a realistic script structure:
   ```
   INT. COFFEE SHOP - DAY

   JANE sits alone, reading a book.

   MARK enters, spots Jane.

   MARK
   Mind if I join you?

   JANE
   (looking up)
   Please do.

   EXT. PARK - LATER

   Jane and Mark walk together.
   ```
2. Check scene boundaries list
3. Verify page count updates
4. Test real-time sync with multiple scenes

**Expected**:
- 2 scenes detected
- Character elements properly formatted (centered)
- Dialogue elements indented correctly
- Page breaks calculated across scene boundaries

## Debug Information

### Browser Console

Check for these log messages:

```javascript
// Yjs collaboration hook
[ScriptYjsCollaboration] Connecting to: ws://...
[ScriptYjsCollaboration] Status: connected
[ScriptYjsCollaboration] Synced: true
[ScriptYjsCollaboration] doc.update { bytes: 123, origin: ... }

// Page break calculation
[usePageBreaks] Worker initialized
[usePageBreaks] Calculation requested for N elements

// Editor
[ScriptEditor] Synchronized Slate from Yjs
[ScriptEditor] Seeded Y.Doc with initial content
```

### Backend Logs

Check for these log messages:

```python
# WebSocket connection
[WebSocketManager] Client connected: scene=<id> user=<uid>
[WebSocketManager] Broadcasting to N clients

# Yjs persistence
[YjsPersistence] Loading N updates for script=<id>
[YjsPersistence] Stored update: script=<id> size=X bytes

# Redis pub/sub (if enabled)
[RedisPubSub] Subscribed to channels for script=<id>
[RedisPubSub] Published update to channel: scripts:<id>:updates
```

## Common Issues

### Issue: Status stays on "Connecting..."

**Causes**:
- Backend not running
- WebSocket endpoint misconfigured
- CORS issues

**Solutions**:
1. Check backend is running on port 8000
2. Verify `NEXT_PUBLIC_BACKEND_URL` environment variable
3. Check browser console for WebSocket errors

### Issue: "Error" status after connection attempts

**Causes**:
- Authentication failure
- Script ID not found in database
- Backend rejecting connection

**Solutions**:
1. Check backend logs for error details
2. Verify script ID exists in database
3. Check authentication token validity
4. Try with mock authentication first

### Issue: Changes not syncing between clients

**Causes**:
- Different script IDs in URLs
- Connection not fully synced
- Y.Doc seeding issue

**Solutions**:
1. Verify both clients use SAME scriptId parameter
2. Wait for "Synced" status before testing
3. Check browser console for Yjs errors
4. Refresh both clients and retry

### Issue: Page breaks not calculating

**Causes**:
- Web Worker not loading
- Content structure incorrect
- Debounce delay

**Solutions**:
1. Wait 500ms after typing for debounce
2. Check browser console for worker errors
3. Verify content is ScreenplayElement[] format
4. Check DevTools → Sources → Workers tab

### Issue: Scene boundaries not detected

**Causes**:
- Scene heading format incorrect
- Missing metadata on elements
- Tracker not updating

**Solutions**:
1. Use proper scene heading format (INT./EXT. LOCATION - TIME)
2. Verify elements have `type: 'scene_heading'`
3. Check scene boundary extraction logic
4. Ensure onChange callback is firing

## Performance Expectations

### Connection Speed
- Initial connection: < 500ms
- Sync status: < 1s after connection
- First content load: < 2s

### Real-Time Latency
- Local edit → Remote display: 50-200ms
- Typical network delay: ~100ms
- Max acceptable latency: < 500ms

### Page Break Calculation
- Debounce delay: 500ms
- Calculation time: < 100ms for 200 elements
- No UI blocking (runs in Web Worker)

### Memory Usage
- Base memory: ~50MB
- Per 1000 elements: +5MB
- Web Worker overhead: +10MB

## Success Criteria

### ✅ Connection Tests
- [ ] Connects to WebSocket successfully
- [ ] Shows "Synced" status within 2 seconds
- [ ] Maintains stable connection during editing
- [ ] Reconnects automatically after disconnection

### ✅ Collaboration Tests
- [ ] Changes appear in second client < 500ms
- [ ] Concurrent edits merge correctly (no conflicts)
- [ ] Cursor positions remain stable
- [ ] No data loss during simultaneous edits

### ✅ Feature Tests
- [ ] Scene boundaries track correctly
- [ ] Scene count updates with new headings
- [ ] Page breaks calculate accurately
- [ ] Page count updates with content changes

### ✅ Resilience Tests
- [ ] Works offline (local editing continues)
- [ ] Reconnects automatically (< 5 attempts)
- [ ] Syncs offline changes on reconnect
- [ ] Handles server restart gracefully

## Next Steps After Testing

Once all tests pass:

1. **Phase 3 Implementation** (if not done):
   - Section 5.1: Script-Level Autosave API
   - Section 5.2: Scene Sync (optional)

2. **Advanced Features**:
   - Virtual scrolling optimization (if needed for long scripts)
   - Conflict resolution UI
   - Version history integration

3. **Migration Path**:
   - Gradually migrate existing scenes to script-level
   - Maintain backward compatibility
   - Data migration scripts

## Support

For issues or questions:
- Check `docs/SCRIPT_LEVEL_MIGRATION_PLAN.md` for architecture details
- Review browser console and backend logs
- Test with single client first before multi-client
- Start with mock auth before real Firebase tokens
