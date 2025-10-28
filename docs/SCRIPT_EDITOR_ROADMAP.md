# Script Editor Implementation Roadmap

**Status**: Ready for Implementation
**Priority**: High (Core Editor Features)
**Estimated Timeline**: 2-3 weeks (8-12 development hours)
**Last Updated**: 2025-10-27

---

## Overview

This roadmap outlines the implementation plan to bring the script-level editor to feature parity with the scene-level editor, focusing on scene sidebar navigation and professional page formatting.

### Success Criteria
- ✅ Scene sidebar with click navigation
- ✅ Professional page formatting (8.5" x 11" visual pages)
- ✅ Keyboard shortcuts for formatting
- ✅ Collaboration UI (share/invite)
- ✅ Version history viewer

---

## Phase 1: Core Navigation & Formatting (PRIORITY)

**Timeline**: 4-6 hours
**Complexity**: Medium
**Risk**: Low (adapting proven patterns)

### 1.1 Scene Sidebar with Navigation

**Estimated Time**: 2-3 hours

#### Requirements
- Left sidebar displaying scene list
- Scene heading extraction from script content
- Click navigation to scroll to scene
- Current scene highlighting
- Scene metadata (count, estimated runtime)

#### Technical Approach

**Step 1: Create ScriptSceneSidebar Component** (45 min)

File: `frontend/components/script-scene-sidebar.tsx`

```typescript
interface ScriptSceneSidebarProps {
  scenes: SceneBoundary[];  // Already tracked by SceneBoundaryTracker
  onSceneClick: (sceneIndex: number) => void;
  currentSceneIndex: number | null;
}
```

**Component Structure:**
- Adapt `scene-outline-sidebar.tsx` (90% code reuse)
- Props: scenes array, click handler, current scene index
- UI: Same styling as scene-level sidebar
- Metadata: Total scenes, estimated runtime

**Design Pattern:**
```tsx
<div className="h-[calc(100vh-112px)] flex flex-col bg-white border-r">
  {/* Header */}
  <div className="border-b p-4">
    <h3>Scene Navigation</h3>
  </div>

  {/* Scene List */}
  <div className="flex-1 overflow-auto">
    {scenes.map((scene, idx) => (
      <div
        key={scene.startBlockIndex}
        onClick={() => onSceneClick(idx)}
        className={currentSceneIndex === idx ? 'bg-blue-50' : ''}
      >
        {scene.heading}
      </div>
    ))}
  </div>
</div>
```

**Step 2: Add Scroll Navigation** (45 min)

File: `frontend/components/script-editor-with-collaboration.tsx`

**Implementation:**
```typescript
const editorRef = useRef<HTMLDivElement>(null);

const scrollToScene = useCallback((sceneIndex: number) => {
  const scene = sceneBoundaries[sceneIndex];
  if (!scene || !editorRef.current) return;

  // Calculate scroll position based on block index
  const targetBlock = editor.children[scene.startBlockIndex];
  const blockElement = ReactEditor.toDOMNode(editor, targetBlock);

  blockElement.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}, [sceneBoundaries, editor]);
```

**Step 3: Track Current Scene** (30 min)

**Approach:** Use IntersectionObserver to detect which scene is in viewport

```typescript
const [currentSceneIndex, setCurrentSceneIndex] = useState<number | null>(null);

useEffect(() => {
  // Set up IntersectionObserver for scene headings
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const sceneIdx = /* calculate from entry */;
          setCurrentSceneIndex(sceneIdx);
        }
      });
    },
    { threshold: 0.5 }
  );

  // Observe scene heading elements
  // ...
}, [sceneBoundaries]);
```

**Step 4: Update Layout** (30 min)

File: `frontend/app/script-editor/page.tsx`

```tsx
<div className="flex h-screen">
  <ScriptSceneSidebar
    scenes={sceneBoundaries}
    onSceneClick={scrollToScene}
    currentSceneIndex={currentSceneIndex}
  />
  <div className="flex-1">
    <ScriptEditorWithAutosave {...props} />
  </div>
</div>
```

**Testing Checklist:**
- [ ] Sidebar displays all scenes
- [ ] Click navigation scrolls to correct scene
- [ ] Current scene highlighted properly
- [ ] Sidebar responsive on mobile (collapsed by default)

---

### 1.2 Professional Page Formatting

**Estimated Time**: 2-3 hours

#### Requirements
- 8.5" x 11" white paper visual
- Centered content with shadows
- 1" margins (1.5" left)
- Page break lines
- Page numbers
- Courier Prime font, 12pt

#### Technical Approach

**Step 1: Integrate Page Break Calculation** (30 min)

File: `frontend/components/script-editor-with-collaboration.tsx`

```typescript
import { calculatePageBreaks } from '@/utils/fdx-format';

const [pages, setPages] = useState({ pages: [{ number: 1, startLine: 0 }] });

useEffect(() => {
  if (value && value.length > 0) {
    const calculated = calculatePageBreaks(value);
    setPages(calculated);
  }
}, [value]);
```

**Step 2: Create Page Container Layout** (45 min)

**Replace Current Layout:**
```tsx
{/* OLD: Simple overflow-auto */}
<div className="flex-1 overflow-auto">
  <Editable className="px-8 py-6" />
</div>

{/* NEW: Centered page layout */}
<div className="flex-1 overflow-auto py-8 px-4 bg-gray-100">
  <div className="max-w-none mx-auto flex flex-col items-center">
    <div
      className="bg-white shadow-lg border border-gray-300 relative"
      style={{
        width: '8.5in',
        minHeight: `${Math.max(pages.pages.length, 1) * 11}in`,
        marginBottom: '32px'
      }}
    >
      {/* Page content here */}
    </div>
  </div>
</div>
```

**Step 3: Add Page Numbers** (20 min)

```tsx
{/* Render page numbers */}
{pages.pages.map((page, index) => (
  <div
    key={page.number}
    className="absolute text-xs text-gray-500"
    style={{
      top: `${index * 11 + 0.5}in`,
      right: '1in',
      fontFamily: '"Courier Prime", Courier, monospace'
    }}
  >
    {page.number}.
  </div>
))}
```

**Step 4: Add Page Break Lines** (20 min)

```tsx
{/* Page break indicators */}
{pages.pages.slice(0, -1).map((_, index) => (
  <div
    key={`break-${index}`}
    className="absolute left-0 right-0 border-b border-gray-300 border-dashed"
    style={{ top: `${(index + 1) * 11}in` }}
  />
))}
```

**Step 5: Style Editor Content** (45 min)

```tsx
<div
  style={{
    padding: '1in 1in 1in 1.5in',
    paddingTop: '1.2in',
    minHeight: `${Math.max(pages.pages.length, 1) * 11}in`,
    fontFamily: '"Courier Prime", Courier, monospace',
    fontSize: '12pt',
    lineHeight: '1.5',
    position: 'relative'
  }}
>
  <Slate editor={editor} initialValue={value} onChange={handleChange}>
    <Editable
      renderElement={renderElement}
      renderLeaf={renderLeaf}
      placeholder="Start writing your screenplay..."
      className="focus:outline-none"
    />
  </Slate>
</div>
```

**Testing Checklist:**
- [ ] Pages display as 8.5" x 11" white sheets
- [ ] Content centered with proper margins
- [ ] Page numbers show on each page
- [ ] Page breaks visible between pages
- [ ] Courier Prime font loads correctly
- [ ] Responsive behavior (mobile shows smaller scale)

---

## Phase 2: Keyboard Shortcuts

**Timeline**: 1-2 hours
**Complexity**: Low
**Risk**: Low (utilities already exist)

### 2.1 Implement Hotkeys

**Estimated Time**: 1-2 hours

#### Requirements
- Enter: Smart new line (scene heading → action, dialogue → dialogue, etc.)
- Tab: Cycle block types
- Cmd+1: Scene Heading
- Cmd+2: Action
- Cmd+3: Character
- Cmd+4: Dialogue
- Cmd+5: Parenthetical
- Cmd+6: Transition
- Cmd+7: Shot
- Cmd+B/I/U: Bold/Italic/Underline

#### Technical Approach

**Step 1: Import Handlers** (10 min)

File: `frontend/components/script-editor-with-collaboration.tsx`

```typescript
import {
  handleEnterKey,
  handleTabKey,
  handleCommandShortcut,
  toggleFormat
} from '@/utils/screenplay-utils';
```

**Step 2: Add onKeyDown Handler** (30 min)

```typescript
const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
  // Enter key
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleEnterKey(editor);
    return;
  }

  // Tab key
  if (event.key === 'Tab') {
    event.preventDefault();
    handleTabKey(editor, event.shiftKey);
    return;
  }

  // Command shortcuts (Cmd+1-7)
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
    const handled = handleCommandShortcut(editor, event.key);
    if (handled) {
      event.preventDefault();
      return;
    }
  }

  // Format shortcuts (Cmd+B/I/U)
  if ((event.metaKey || event.ctrlKey)) {
    if (event.key === 'b') {
      event.preventDefault();
      toggleFormat(editor, 'bold');
    } else if (event.key === 'i') {
      event.preventDefault();
      toggleFormat(editor, 'italic');
    } else if (event.key === 'u') {
      event.preventDefault();
      toggleFormat(editor, 'underline');
    }
  }
}, [editor]);
```

**Step 3: Attach to Editable** (10 min)

```tsx
<Editable
  onKeyDown={handleKeyDown}
  renderElement={renderElement}
  renderLeaf={renderLeaf}
  // ... other props
/>
```

**Step 4: Test with Yjs** (30 min)

Ensure keyboard shortcuts work correctly with Yjs collaboration:
- Test in single-user mode
- Test in multi-user mode
- Verify no conflicts with Yjs bindings

**Testing Checklist:**
- [ ] Enter creates correct next block type
- [ ] Tab cycles through block types
- [ ] Cmd+1-7 set block types correctly
- [ ] Cmd+B/I/U toggle formatting
- [ ] Shortcuts work with Yjs enabled
- [ ] Shortcuts work on both Mac and Windows

---

## Phase 3: Collaboration UI

**Timeline**: 2-3 hours
**Complexity**: Medium
**Risk**: Medium (requires backend integration)

### 3.1 Share/Invite Interface

**Estimated Time**: 2-3 hours

#### Requirements
- Share button in editor toolbar
- Invite modal with email input
- Permission selector (Editor/Viewer)
- User avatars showing active collaborators
- Copy link functionality

#### Technical Approach

**Step 1: Create ShareButton Component** (45 min)

File: `frontend/components/script-share-button.tsx`

```typescript
interface ScriptShareButtonProps {
  scriptId: string;
  currentUserRole: 'OWNER' | 'EDITOR' | 'VIEWER';
  onShare: (email: string, role: 'EDITOR' | 'VIEWER') => Promise<void>;
}
```

**Step 2: Create InviteModal Component** (60 min)

File: `frontend/components/script-invite-modal.tsx`

**Features:**
- Email input with validation
- Role dropdown (Editor/Viewer)
- List of current collaborators
- Remove collaborator button (owner only)

**Step 3: Backend Integration** (45 min)

**Endpoints to Use:**
- POST `/api/scripts/{script_id}/collaborators` - Add collaborator
- GET `/api/scripts/{script_id}/collaborators` - List collaborators
- DELETE `/api/scripts/{script_id}/collaborators/{user_id}` - Remove collaborator

**Step 4: Add to Editor Layout** (30 min)

```tsx
<div className="flex items-center justify-between p-4 border-b">
  <h1>Script Editor</h1>
  <div className="flex items-center gap-4">
    {/* Collaborator Avatars */}
    <CollaboratorAvatars awareness={awareness} />

    {/* Share Button */}
    <ScriptShareButton
      scriptId={scriptId}
      currentUserRole={userRole}
      onShare={handleShare}
    />
  </div>
</div>
```

**Testing Checklist:**
- [ ] Share button opens modal
- [ ] Email validation works
- [ ] Role selection works
- [ ] Invitation sent successfully
- [ ] Collaborator list updates
- [ ] Copy link functionality works
- [ ] Permissions enforced (only owner can invite)

---

## Phase 4: Version History

**Timeline**: 4-6 hours
**Complexity**: High
**Risk**: Medium (complex UI and data handling)

### 4.1 Version History Viewer

**Estimated Time**: 4-6 hours

#### Requirements
- Timeline view of script versions
- Diff view comparing versions
- Restore version functionality
- Automatic snapshots on significant changes
- Manual snapshot creation

#### Technical Approach

**Step 1: Create VersionHistoryPanel Component** (90 min)

File: `frontend/components/script-version-history.tsx`

**Features:**
- Timeline list of versions
- Timestamp and author display
- Diff preview
- Restore button

**Step 2: Implement Diff Viewer** (90 min)

File: `frontend/components/script-version-diff.tsx`

**Libraries to Consider:**
- `react-diff-viewer` for visual diff
- Custom diff algorithm for screenplay blocks

**Step 3: Backend Integration** (60 min)

**Endpoints:**
- GET `/api/scripts/{script_id}/versions` - List versions
- GET `/api/scripts/{script_id}/versions/{version_id}` - Get specific version
- POST `/api/scripts/{script_id}/versions/{version_id}/restore` - Restore version
- POST `/api/scripts/{script_id}/versions` - Create manual snapshot

**Step 4: Add to Editor UI** (30 min)

```tsx
<div className="flex">
  <ScriptSceneSidebar />
  <ScriptEditor />
  <VersionHistoryPanel
    scriptId={scriptId}
    onRestore={handleRestore}
  />
</div>
```

**Testing Checklist:**
- [ ] Version list loads correctly
- [ ] Diff view displays changes
- [ ] Restore version works
- [ ] Manual snapshot creation works
- [ ] Permissions enforced (viewer can't restore)
- [ ] Performance acceptable with many versions

---

## Implementation Schedule

### Week 1: Core Features
**Days 1-2: Scene Sidebar** (4-6 hours)
- Create ScriptSceneSidebar component
- Implement scroll navigation
- Track current scene
- Update layout

**Days 3-4: Page Formatting** (4-6 hours)
- Integrate page break calculation
- Create page container layout
- Add page numbers and breaks
- Style editor content

### Week 2: Enhancements
**Day 5: Keyboard Shortcuts** (2-3 hours)
- Implement all hotkeys
- Test with Yjs
- Document shortcuts

**Days 6-7: Collaboration UI** (4-6 hours)
- Create share components
- Backend integration
- Test permissions

### Week 3: Advanced Features
**Days 8-10: Version History** (8-10 hours)
- Create version history panel
- Implement diff viewer
- Backend integration
- Testing and polish

---

## Risk Mitigation

### High Risk Areas

**1. Yjs Sync Conflicts with Page Formatting**
- **Risk**: Page layout changes might interfere with Yjs document sync
- **Mitigation**: Test extensively with Yjs enabled; maintain separate layout state

**2. Performance with Large Scripts**
- **Risk**: Page break calculation on large scripts might be slow
- **Mitigation**: Debounce calculations; use Web Worker for heavy computation

**3. Scroll Navigation Accuracy**
- **Risk**: Scroll-to-scene might not be accurate with variable block heights
- **Mitigation**: Use `ReactEditor.toDOMNode` for precise element location

### Medium Risk Areas

**1. Mobile Responsiveness**
- **Risk**: Page formatting might not scale well on mobile
- **Mitigation**: Add responsive breakpoints; show single column on mobile

**2. Browser Compatibility**
- **Risk**: Page size units (inches) might render differently across browsers
- **Mitigation**: Test on Chrome, Firefox, Safari; use CSS transforms for consistency

---

## Testing Strategy

### Unit Tests
- [ ] SceneBoundaryTracker extracts scenes correctly
- [ ] calculatePageBreaks produces accurate page breaks
- [ ] Keyboard shortcuts trigger correct handlers

### Integration Tests
- [ ] Scene sidebar navigation scrolls correctly
- [ ] Page formatting updates on content change
- [ ] Collaboration UI interacts with backend correctly

### E2E Tests (Playwright)
- [ ] Click scene in sidebar → scroll to scene
- [ ] Type content → page numbers update
- [ ] Use keyboard shortcuts → content formatted correctly
- [ ] Share script → collaborator receives invite

### Manual Testing
- [ ] Visual QA of page formatting
- [ ] Cross-browser testing
- [ ] Mobile device testing
- [ ] Accessibility testing (keyboard navigation)

---

## Success Metrics

### Functional Completeness
- ✅ Scene sidebar with navigation (100%)
- ✅ Page formatting with breaks (100%)
- ✅ Keyboard shortcuts (100%)
- ✅ Collaboration UI (100%)
- ✅ Version history (100%)

### User Experience
- Scene navigation latency < 200ms
- Page calculation latency < 100ms
- No visual jank during scroll
- Professional appearance matching Final Draft

### Code Quality
- TypeScript strict mode enabled
- 80%+ test coverage
- No console errors
- Proper error boundaries

---

## Dependencies

### External Libraries
- `react-diff-viewer` (for version diffs)
- `lucide-react` (icons - already used)
- `date-fns` (date formatting - already used)

### Internal Dependencies
- `SceneBoundaryTracker` utility ✅
- `calculatePageBreaks` from fdx-format ✅
- `screenplay-utils` handlers ✅
- Backend collaborator APIs ✅

---

## Rollout Plan

### Phase 1 (Week 1)
- Deploy scene sidebar + page formatting to staging
- User testing with 5-10 beta users
- Collect feedback and iterate

### Phase 2 (Week 2)
- Deploy keyboard shortcuts + collaboration UI
- Expand beta testing to 20-30 users
- Monitor for issues

### Phase 3 (Week 3)
- Deploy version history
- Full production rollout
- Announce new features

---

## Future Enhancements (Post-Roadmap)

### Nice-to-Have Features
1. **Virtual Scrolling** - Performance optimization for 100+ page scripts
2. **Customizable Formatting** - User preferences for font, margins
3. **Export to PDF** - Generate PDFs with exact formatting
4. **Real-time Comments** - Inline commenting on specific lines
5. **Script Statistics** - Word count, page count, scene count
6. **Auto-backup** - Automatic cloud backups every N minutes
7. **Offline Mode** - Full offline editing capability

### Technical Debt
1. **Refactor ScriptEditorWithCollaboration** - Component is large, split into smaller pieces
2. **Optimize Page Break Calculation** - Move to Web Worker for large scripts
3. **Improve Error Handling** - Add comprehensive error boundaries
4. **Accessibility Audit** - Ensure WCAG 2.1 AA compliance

---

## Appendix: Code Reuse Matrix

| Feature | Source Component | Adaptation Effort | Reuse % |
|---------|-----------------|-------------------|---------|
| Scene Sidebar | scene-outline-sidebar.tsx | Low - mostly styling | 90% |
| Page Formatting | screenplay-editor.tsx lines 1084-1149 | Medium - layout changes | 80% |
| Keyboard Shortcuts | screenplay-utils.ts handlers | Low - import and use | 95% |
| Collaboration UI | N/A - new component | High - new design | 0% |
| Version History | N/A - new feature | High - complex UI | 0% |

---

## Contact & Support

**Primary Developer**: [Your Name]
**Design Review**: [Design Lead]
**Backend Support**: [Backend Team]
**QA Lead**: [QA Lead]

**Questions?** Reach out in #script-editor-dev Slack channel

---

**Document Version**: 1.0
**Last Updated**: 2025-10-27
**Next Review**: After Phase 1 completion
