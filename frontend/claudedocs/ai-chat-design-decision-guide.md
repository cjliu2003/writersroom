# AI Chat Design Decision Guide

**Purpose**: Quick reference for making informed design decisions about the chat interface

---

## CURRENT PAIN POINTS (From User Feedback)

### 1. Drag Sensitivity Issue
**Problem**: "The drag is way too sensitive and does not drag consistent with the cursor"

**Root Cause**:
- Using CSS `resize: vertical` property
- Applied to framer-motion animated container
- Outer container has `overflow-hidden` which conflicts with resize requirements
- No state persistence for user-resized height

**Why It Fails**:
```tsx
<motion.div
  style={{ resize: 'vertical', overflow: 'hidden' }} // ❌ Conflict
>
```
CSS resize requires `overflow: auto` or `overflow: scroll` to function properly.

**Current Workaround**: None - feature likely doesn't work at all

---

### 2. Dead Space Problem
**Problem**: "Ton of dead space in the chat window"

**Measured Dead Space** (Compact Mode):
- Header padding: 6px top/bottom + border = ~7px total
- Message container padding: 6px all sides = 12px vertical
- Message spacing: 4px between messages
- Empty state padding: 8px
- Input container padding: 6px all sides = 12px vertical

**Total Wasted**: ~45-50px of non-content space in 400px window = 11-12.5% overhead

**Comparison to Minimal Design**:
- Could reduce to: 2px padding throughout
- Potential savings: ~30px = 7.5% more usable space

**Non-Compact Mode**: 67% more padding (16px vs 6px patterns)

---

### 3. Inconsistent Design
**Problem**: "I don't like the look of the window"

**Visual Inconsistencies**:
1. ❌ Purple header icon (`bg-purple-100 text-purple-600`)
   - Rest of site uses blue accents
   - Scene badges are blue
   - Should be blue-100/blue-600

2. ✅ Background matches site (white/95 with backdrop-blur-sm)

3. ✅ Border style matches (border-gray-200)

4. ✅ Spacing matches compact header pattern (p-1.5)

5. ❓ Button position (bottom-right) - user wants more subtle

---

### 4. Button Design Issue
**Problem**: "Nor the popup button associated with it"

**Current Design**:
- Position: Fixed bottom-right (bottom-4 right-4)
- Size: ~60px wide (icon + "AI" text + padding)
- States: White bg when closed, gray-100 when open
- Icon: Sparkles (blue-600)

**User Perception**: Too prominent, not seamless

**Design Tension**:
- Needs to be discoverable (visible)
- Needs to be unobtrusive (minimal)
- Bottom-right is standard chat widget position BUT
- Screenplay writers focus center screen, button is peripheral

---

### 5. Seamlessness Problem
**Problem**: "Makes the use of the chat much more seamless and logical"

**Current Friction Points**:
1. **Discoverability**: User must find button first time
2. **Context Switch**: Opening chat requires explicit click
3. **Space Management**: Chat covers screenplay content
4. **Resize Confusion**: Unclear that it's resizable (if it works)
5. **No Keyboard Shortcut**: Must use mouse to open/close

**Industry Patterns for Seamless Chat**:
- Cmd/Ctrl+K command palette style
- Inline expansion in workflow
- Contextual appearance (AI suggests when relevant)
- Always-visible but minimized state

---

## DESIGN PATTERN ANALYSIS

### Pattern A: Bottom-Right Widget (CURRENT)

**Visual Example**:
```
┌─────────────────────────────┐
│                             │
│   Screenplay Content        │
│   (center focused)          │
│                             │
│                ┌─────────┐  │
│                │  Chat   │  │
│                │  350px  │  │
│                │  400px  │  │
│                └─────────┘  │
│                  [AI] ← btn │
└─────────────────────────────┘
```

**Pros**:
✅ Industry standard (Intercom, Drift, etc.)
✅ Doesn't push content (overlay)
✅ User-controlled visibility
✅ Familiar pattern

**Cons**:
❌ Covers screenplay text
❌ Fixed position distracts
❌ Button always visible (clutter)
❌ Not keyboard-accessible

**Use Cases**:
- Customer support sites
- Marketing sites
- General web apps

**Screenplay Writing Fit**: ⭐⭐ (2/5)
- Writers focus center screen
- Peripheral UI is ignored
- Covering text is disruptive

---

### Pattern B: Command Palette Style

**Visual Example**:
```
┌─────────────────────────────┐
│  Screenplay Content         │
│                             │
│  ┌───────────────────────┐  │
│  │ AI: Ask a question... │  │ ← Appears on Cmd+K
│  │                       │  │
│  │ [Recent chats...]     │  │
│  └───────────────────────┘  │
│                             │
└─────────────────────────────┘
```

**Pros**:
✅ Keyboard-first (Cmd+K)
✅ Center-screen (where focus is)
✅ Minimal visual noise when closed
✅ Fast access during writing

**Cons**:
❌ No persistent conversation view
❌ Requires learning keyboard shortcut
❌ Can't see chat while writing

**Examples**:
- Linear
- GitHub command palette
- VSCode command palette

**Screenplay Writing Fit**: ⭐⭐⭐⭐ (4/5)
- Matches writer's mental model
- Quick questions during flow
- Doesn't interrupt visual space

---

### Pattern C: Inline Assistant

**Visual Example**:
```
┌─────────────────────────────┐
│  INT. COFFEE SHOP - DAY     │
│                             │
│  JANE sits alone.           │
│                             │
│  💬 AI suggests: Add dialog │ ← Contextual
│  or scenery details?        │
│                             │
└─────────────────────────────┘
```

**Pros**:
✅ Contextually aware
✅ No UI chrome
✅ Appears when helpful
✅ Integrated into content

**Cons**:
❌ Complex to implement
❌ May be distracting
❌ Hard to predict when to show
❌ Limited conversation history

**Examples**:
- Notion AI
- Grammarly inline suggestions
- GitHub Copilot

**Screenplay Writing Fit**: ⭐⭐⭐⭐⭐ (5/5)
- Most natural for writing
- Context-aware suggestions
- Minimal UI footprint

---

### Pattern D: Collapsible Side Panel

**Visual Example**:
```
┌──────────────┬──────────────┐
│ Screenplay   │  AI Chat     │
│ Content      │              │
│ (70%)        │  Messages... │
│              │              │
│              │  [Input]     │
└──────────────┴──────────────┘
     ↕ Resizable divider
```

**Pros**:
✅ Side-by-side reference
✅ Persistent conversation
✅ Adjustable width
✅ Familiar IDE pattern

**Cons**:
❌ Reduces screenplay width
❌ Layout shift on open/close
❌ Fixed screen space division

**Examples**:
- VS Code side panels
- Slack threads
- Discord chat

**Screenplay Writing Fit**: ⭐⭐⭐ (3/5)
- Good for long conversations
- Bad for writing focus (reduces width)
- Better for editing phase

---

### Pattern E: Floating Tooltip Style

**Visual Example**:
```
┌─────────────────────────────┐
│  Screenplay Content         │
│                             │
│  JOHN                       │
│  Where's the money?         │
│     ↓                       │
│  [💬] ← Hover shows AI icon │
│                             │
│  Click opens:               │
│  ┌─────────────────┐        │
│  │ Analyze dialog  │        │
│  │ Suggest rewrite │        │
│  │ Check tone      │        │
│  └─────────────────┘        │
└─────────────────────────────┘
```

**Pros**:
✅ Zero UI when not needed
✅ Contextual to selection
✅ Quick actions
✅ Doesn't break flow

**Cons**:
❌ No persistent chat
❌ Discovery challenge
❌ Limited use cases

**Examples**:
- Google Docs smart chips
- Notion @mentions
- Figma quick actions

**Screenplay Writing Fit**: ⭐⭐⭐⭐ (4/5)
- Great for quick edits
- Not good for conversations
- Hybrid approach needed

---

## INTERACTION MODEL COMPARISON

### Current Model: Explicit Toggle
```
Writer → Stops writing → Finds button → Clicks → Chat opens → Types question → Waits → Reads response → Closes → Resumes writing
```
**Steps**: 9
**Cognitive Load**: High (context switch)
**Time**: ~30-60 seconds

---

### Keyboard-First Model
```
Writer → Cmd+K → Types question inline → AI responds → ESC → Continues writing
```
**Steps**: 5
**Cognitive Load**: Low (no UI context switch)
**Time**: ~10-20 seconds

---

### Contextual Model
```
Writer → [AI detects scene/dialog issue] → Subtle indicator appears → Writer clicks → Suggestion shown → Accepts/Dismisses → Continues
```
**Steps**: 6
**Cognitive Load**: Medium (AI-initiated)
**Time**: ~15-30 seconds

---

## MOBILE RESPONSIVE REQUIREMENTS

### Current Viewport Breakpoints (Tailwind)
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px

### Chat Responsive Needs

**Mobile (<640px)**:
- Width: 100vw (full screen) or 90vw
- Height: 60-70vh (more vertical space)
- Position: bottom-0, left/right-0 (centered)
- No resize handle (touch incompatible)
- Swipe to close gesture

**Tablet (640-1024px)**:
- Width: 70-80% or 500px max
- Height: 50vh
- Centered horizontally
- Touch-friendly resize drag handle

**Desktop (>1024px)**:
- Width: 350-450px (current 350px okay)
- Height: User-controlled with CSS resize
- Bottom-right positioning okay

**Not Implemented**: No responsive styles at all currently

---

## ACCESSIBILITY REQUIREMENTS

### WCAG 2.1 Level AA Compliance Checklist

**Keyboard Navigation**:
- [ ] Tab to chat button
- [ ] Enter/Space to toggle
- [ ] Tab through messages
- [ ] Tab to input
- [ ] ESC to close
- [ ] Arrow keys to navigate messages (optional)

**Screen Reader Support**:
- [ ] Button: `aria-label="Open AI assistant"`
- [ ] Chat window: `role="dialog"` + `aria-labelledby`
- [ ] Messages area: `role="log"` + `aria-live="polite"`
- [ ] New message announcements
- [ ] Loading state announcements
- [ ] Error announcements

**Focus Management**:
- [ ] Focus moves to input on open
- [ ] Focus trap within dialog
- [ ] Focus returns to button on close

**Color Contrast** (4.5:1 minimum):
- ✅ Blue-600 on white: 7.5:1 (pass)
- ✅ Gray-700 on white: 5.9:1 (pass)
- ⚠️ Gray-400 on white: May fail for small text

**Visual Indicators**:
- ✅ Focus rings on interactive elements
- [ ] Loading state visible without color
- [ ] Error states clearly marked

---

## PERFORMANCE CONSIDERATIONS

### Bundle Size Impact

**Current**:
- framer-motion: ~60KB gzipped
- Total chat bundle: ~80KB

**Optimization Opportunities**:
1. Lazy load chat on first open: Save ~80KB initial load
2. Remove framer-motion, use CSS transitions: Save ~60KB
3. Code split by route: Only load on editor pages

**Implementation**:
```tsx
const AIChatbot = lazy(() => import('@/components/ai-chatbot'));
```

### Render Performance

**Re-render Triggers**:
- Every keystroke in input (inputValue state)
- Every message add (messages state)
- Every loading toggle (isLoading state)

**Optimizations**:
1. Debounce input: `useDebouncedValue(inputValue, 300)`
2. Memoize message list: `React.memo(MessageList)`
3. Virtual scrolling: For 100+ message conversations

### Network Performance

**Current**: Full message history sent on every request
**Problem**: Grows unbounded over long sessions

**Better Approach**:
- Send only last N messages (context window)
- Compress old messages on backend
- Paginate conversation history

---

## DESIGN DECISION FRAMEWORK

### Questions to Ask Before Implementation

**1. User Mental Model**
- How do screenplay writers think about AI assistance?
- Is it a tool they consult, or a pair programmer?
- Do they want async conversation or instant answers?

**2. Workflow Integration**
- At what points in writing flow is AI most useful?
- Does chat interrupt creative flow or enhance it?
- Should AI be proactive or reactive?

**3. Visual Hierarchy**
- What's the primary task? (Writing screenplay)
- What's the supporting task? (AI assistance)
- How much screen real estate deserves each?

**4. Interaction Cost**
- How many clicks/keystrokes to get help?
- Can user maintain context while using chat?
- Is return to writing smooth or jarring?

**5. Technical Feasibility**
- Can we implement this with current tech stack?
- What's the development time vs. value?
- Are there library dependencies we should avoid?

---

## RECOMMENDED HYBRID APPROACH

Based on screenplay writing workflow and user feedback:

### Proposal: "Minimal Command Palette + Persistent History"

**Core Features**:
1. **Keyboard-first access**: Cmd/Ctrl+K to open
2. **Center-screen overlay**: Doesn't cover text, darkens background slightly
3. **Quick question mode**: Type → Enter → See response inline
4. **Expand to full chat**: Click "View full conversation" for history
5. **Minimal button**: Small icon bottom-right, barely visible, click also opens
6. **No persistent widget**: Closes after response unless expanded

**Visual**:
```
QUICK MODE (Cmd+K):
┌───────────────────────────────────┐
│ Screenplay dimmed 20%             │
│                                   │
│  ┌─────────────────────────────┐  │
│  │ 💬 Ask AI about screenplay  │  │
│  │ [Type question...]          │  │
│  │                             │  │
│  │ Response appears here...    │  │
│  │                             │  │
│  │ [View full conversation]    │  │
│  └─────────────────────────────┘  │
│                                   │
│              ⚪ ← tiny icon        │
└───────────────────────────────────┘

FULL CHAT MODE (expanded):
┌───────────────────────────────────┐
│  ┌─────────────────────────────┐  │
│  │ AI Assistant    [Minimize] │  │
│  ├─────────────────────────────┤  │
│  │ Message history...          │  │
│  │ Scrollable                  │  │
│  │                             │  │
│  ├─────────────────────────────┤  │
│  │ [Type question...]    [→]  │  │
│  └─────────────────────────────┘  │
│                                   │
└───────────────────────────────────┘
```

**Benefits**:
✅ Keyboard-first for speed
✅ Minimal visual footprint
✅ Center-screen for focus
✅ Persistent history when needed
✅ Familiar pattern (command palettes)
✅ Doesn't cover screenplay content
✅ Easy to dismiss (ESC)

**Tradeoffs**:
⚠️ Requires learning keyboard shortcut
⚠️ Less discoverable than persistent button
⚠️ More complex implementation

---

## ACTIONABLE NEXT STEPS

### Immediate Fixes (No Design Change)
1. **Remove or fix resize**:
   - Either remove `resize: vertical` entirely
   - Or move it to inner ScrollArea container with `overflow: auto`

2. **Fix purple icon**:
   - Change `bg-purple-100 text-purple-600` → `bg-blue-100 text-blue-600`

3. **Add ESC to close**:
   ```tsx
   useEffect(() => {
     const handleEsc = (e: KeyboardEvent) => {
       if (e.key === 'Escape' && isOpen) onToggle();
     };
     window.addEventListener('keydown', handleEsc);
     return () => window.removeEventListener('keydown', handleEsc);
   }, [isOpen, onToggle]);
   ```

### Short-term Improvements (Minor Design)
1. **Add keyboard shortcut** (Cmd/Ctrl+K)
2. **Add close X button** in header
3. **Switch to textarea** with auto-resize
4. **Add mobile breakpoints**
5. **Improve empty state** with examples

### Long-term Redesign (Major Change)
1. **Evaluate command palette pattern** vs widget
2. **User test both patterns** with screenplay writers
3. **Consider inline AI suggestions** for contextual help
4. **Implement proper accessibility**
5. **Add message streaming** for real-time responses

---

## DECISION MATRIX

| Pattern | Discoverability | Speed | Focus | Conversation | Dev Time |
|---------|----------------|-------|-------|--------------|----------|
| Current Widget | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ✅ Done |
| Command Palette | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| Inline Assistant | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| Side Panel | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| Tooltip Style | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐ |

**Recommendation for Screenplay Context**: Command Palette or Inline Assistant hybrid

---

Use this guide to inform your next design direction based on:
- User workflow priorities
- Technical constraints
- Development timeline
- User testing feedback
