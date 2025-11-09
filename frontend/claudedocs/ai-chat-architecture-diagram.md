# AI Chat Frontend Architecture - Visual Diagrams

**Purpose**: Visual representations of component structure, data flow, and state management

---

## COMPONENT TREE

```
page.tsx (script-editor)
├── ProcessingScreen
├── CompactHeader
├── HorizontalSceneBar
├── EditorContent (TipTap)
│   └── [Screenplay content with Yjs collaboration]
└── AIAssistantBottomSheet ← Chat Widget
    ├── AnimatePresence (framer-motion)
    │   └── motion.div (chat window)
    │       └── AIChatbot
    │           ├── Header
    │           │   ├── Sparkles icon
    │           │   └── "AI Assistant" title
    │           ├── ScrollArea (messages)
    │           │   ├── Empty State (if no messages)
    │           │   ├── Message bubbles (user/assistant)
    │           │   └── Loading indicator
    │           └── Input Area
    │               ├── input field
    │               └── Send button
    └── Tooltip
        └── motion.button (toggle)
            ├── Sparkles icon
            └── "AI" text
```

---

## STATE FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────┐
│                    page.tsx (Parent)                        │
│                                                             │
│  State:                                                     │
│  ┌─────────────────────────────────────────────┐          │
│  │ const [isAssistantOpen, setIsAssistantOpen] │          │
│  │       = useState(false)                      │          │
│  └─────────────────────────────────────────────┘          │
│                      │                                      │
│                      │ Props ↓                              │
│                      │                                      │
│  ┌──────────────────▼──────────────────────────┐          │
│  │     AIAssistantBottomSheet                  │          │
│  │  - isOpen: boolean (controlled)             │          │
│  │  - onToggle: () => void                     │          │
│  │  - projectId: string                        │          │
│  └──────────────────┬──────────────────────────┘          │
│                     │                                       │
│                     │ Props ↓                               │
│                     │                                       │
│  ┌─────────────────▼──────────────────────────────┐       │
│  │            AIChatbot                            │       │
│  │                                                 │       │
│  │  Local State:                                  │       │
│  │  ┌────────────────────────────────────┐       │       │
│  │  │ messages: ChatMessage[]            │       │       │
│  │  │ inputValue: string                 │       │       │
│  │  │ isLoading: boolean                 │       │       │
│  │  └────────────────────────────────────┘       │       │
│  │                                                 │       │
│  │  Effects:                                      │       │
│  │  • Load from localStorage on mount            │       │
│  │  • Save to localStorage on messages change    │       │
│  │  • Auto-scroll on messages change             │       │
│  │                                                 │       │
│  └─────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

---

## DATA FLOW: SENDING A MESSAGE

```
┌──────────────────────────────────────────────────────────────┐
│                        USER ACTION                           │
│                  (Types message, clicks Send)                │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  sendMessage() │
                    │   async fn     │
                    └────────┬───────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐  ┌──────────────┐  ┌───────────────┐
│ Create user msg │  │ Add to state │  │ Clear input   │
│ {role, content, │  │ (optimistic) │  │ setInputValue │
│  timestamp}     │  │              │  │    ('')       │
└─────────────────┘  └──────┬───────┘  └───────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │ setIsLoading  │
                    │    (true)     │
                    └───────┬───────┘
                            │
                            ▼
                ┌───────────────────────┐
                │  API Call             │
                │  sendChatMessage({    │
                │    script_id,         │
                │    messages,          │
                │    include_scenes     │
                │  })                   │
                └──────────┬────────────┘
                           │
           ┌───────────────┴───────────────┐
           │                               │
           ▼ SUCCESS                       ▼ ERROR
  ┌─────────────────┐            ┌─────────────────┐
  │ Add assistant   │            │ Add error msg   │
  │ msg to state    │            │ to state        │
  └────────┬────────┘            └────────┬────────┘
           │                               │
           └───────────────┬───────────────┘
                           │
                           ▼
                  ┌────────────────┐
                  │ setIsLoading   │
                  │   (false)      │
                  └────────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌──────────────┐  ┌────────────────┐  ┌──────────────┐
│ localStorage │  │ Auto-scroll    │  │ Re-render UI │
│ .setItem     │  │ to bottom      │  │              │
└──────────────┘  └────────────────┘  └──────────────┘
```

---

## POSITIONING & LAYOUT SYSTEM

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser Viewport                         │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ CompactHeader (fixed top-0, z-50)                     │ │
│  │ Height: 48px                                          │ │
│  └───────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ HorizontalSceneBar (fixed top-12, z-40)              │ │
│  │ Height: ~60px                                         │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                                                       │ │
│  │  Screenplay Editor (pt-[116px])                      │ │
│  │  Center-aligned, main content                        │ │
│  │                                                       │ │
│  │                                                       │ │
│  │                                                       │ │
│  │                                                       │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│                                       ┌──────────────────┐  │
│                                       │ AI Chat Widget   │  │
│                                       │ (fixed bottom-0  │  │
│                                       │  right-4, z-50)  │  │
│                                       │                  │  │
│                                       │ Width: 350px     │  │
│                                       │ Height: 400px    │  │
│                                       │ (resizable)      │  │
│                                       │                  │  │
│                                       │ [Header]         │  │
│                                       │ [Messages]       │  │
│                                       │ [Input]          │  │
│                                       └──────────────────┘  │
│                                       ┌──────┐              │
│                                       │  AI  │ ← Toggle     │
│                                       │  ⭐  │   Button     │
│                                       └──────┘   (z-40)     │
│                                     (fixed bottom-4 right-4)│
└─────────────────────────────────────────────────────────────┘
```

**Z-Index Stack** (bottom to top):
1. Editor content: default (z-0)
2. Toggle button: z-40
3. Scene bar: z-40
4. Chat window: z-50
5. Header: z-50

---

## ANIMATION SEQUENCE

```
OPENING CHAT:
═══════════════

Frame 0 (initial):
┌────────────────┐
│ [User clicks]  │
│   AI button    │
└────────────────┘

Frame 1 (0ms - start):
setIsAssistantOpen(true)
  ↓
AnimatePresence mounts motion.div
  ↓
initial={{ opacity: 0, y: 20 }}
(invisible, 20px below final position)

Frame N (0-200ms - animating):
CSS transforms applied:
  opacity: 0 → 1
  translateY: 20px → 0px

(smooth spring transition)

Frame Final (200ms - complete):
animate={{ opacity: 1, y: 0 }}
(fully visible, at final position)


CLOSING CHAT:
═════════════

Frame 0:
┌────────────────┐
│ [User clicks]  │
│   AI button    │
└────────────────┘

Frame 1 (0ms):
setIsAssistantOpen(false)
  ↓
exit={{ opacity: 0, y: 20 }}
(reverse animation)

Frame N (0-200ms):
  opacity: 1 → 0
  translateY: 0px → 20px

Frame Final (200ms):
AnimatePresence unmounts component
(removed from DOM)
```

---

## RESIZE MECHANISM (CURRENT IMPLEMENTATION)

```
┌──────────────────────────────────────────────────────────┐
│                  motion.div (chat container)             │
│                                                          │
│  CSS Properties:                                        │
│  ┌────────────────────────────────────────────────┐    │
│  │ resize: vertical                                │    │
│  │ overflow: hidden                                │    │
│  │ height: 400px                                   │    │
│  │ min-height: 200px                               │    │
│  │ max-height: calc(100vh - 140px)                │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │ Header (p-1.5)                                  │    │
│  ├────────────────────────────────────────────────┤    │
│  │                                                 │    │
│  │ ScrollArea (flex-1, overflow-auto)             │    │
│  │  • This provides the required overflow         │    │
│  │    for CSS resize to work                      │    │
│  │                                                 │    │
│  ├────────────────────────────────────────────────┤    │
│  │ Input Area (p-1.5)                             │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│                              ┌─────┐ ← Native browser   │
│                              │ ::: │   resize handle     │
│                              └─────┘   (bottom-right)    │
└──────────────────────────────────────────────────────────┘

ISSUE: resize property on motion.div with overflow-hidden
       may not work - needs overflow: auto/scroll

SOLUTION: Move resize to inner container OR
          Change outer overflow to 'auto'
```

---

## PERSISTENCE FLOW

```
SESSION START:
═════════════

┌─────────────────┐
│ Component Mount │
└────────┬────────┘
         │
         ▼
┌────────────────────────────┐
│ useEffect(() => {          │
│   if (projectId) {         │
│     const saved =          │
│       localStorage.getItem │
│       (`chat-${projectId}`)│
│   }                        │
│ }, [projectId])            │
└────────┬───────────────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│ Parse JSON       │────▶│ setMessages()    │
│ array            │     │                  │
└──────────────────┘     └──────────────────┘


MESSAGE SEND/RECEIVE:
════════════════════

┌──────────────────┐
│ messages change  │
└────────┬─────────┘
         │
         ▼
┌────────────────────────────┐
│ useEffect(() => {          │
│   if (projectId &&         │
│       messages.length > 0) │
│     localStorage.setItem   │
│     (`chat-${projectId}`,  │
│      JSON.stringify(...))  │
│ }, [projectId, messages])  │
└────────────────────────────┘


STORAGE FORMAT:
══════════════

Key: `chat-${projectId}`
Value: JSON array of ChatMessage objects

[
  {
    role: "user",
    content: "What is the plot?",
    timestamp: "2025-01-08T12:34:56.789Z"
  },
  {
    role: "assistant",
    content: "The plot involves...",
    timestamp: "2025-01-08T12:34:58.123Z"
  }
]
```

---

## RESPONSIVE BEHAVIOR (CURRENT - NOT IMPLEMENTED)

```
Desktop (>1024px):
┌─────────────────────────────────────────────┐
│                                             │
│   Screenplay Editor (centered)              │
│                                             │
│                            ┌─────────────┐  │
│                            │  Chat 350px │  │
│                            │             │  │
│                            └─────────────┘  │
└─────────────────────────────────────────────┘


Tablet (768px - 1024px):
┌─────────────────────────────────────────┐
│                                         │
│  Screenplay (narrower)                  │
│                                         │
│                       ┌──────────────┐  │
│                       │  Chat 350px  │  │ ← Covers more %
│                       │              │  │
│                       └──────────────┘  │
└─────────────────────────────────────────┘


Mobile (<768px):
┌─────────────────────────────┐
│                             │
│  Screenplay                 │
│  (full width)               │
│                             │
│ ┌─────────────────────────┐ │
│ │  Chat (should be 90vw)  │ │ ← PROBLEM: still 350px
│ │  OVERLAPS CONTENT       │ │   fixed width
│ └─────────────────────────┘ │
└─────────────────────────────┘

NOTE: No @media queries implemented
      Chat width always 350px regardless of viewport
```

---

## API INTEGRATION FLOW

```
┌──────────────────────────────────────────────────────────┐
│                 FRONTEND (AIChatbot)                     │
│                                                          │
│  sendMessage() function                                 │
│  ┌────────────────────────────────────────────┐        │
│  │ const response = await sendChatMessage({   │        │
│  │   script_id: projectId,                    │        │
│  │   messages: [...messages, userMessage],    │        │
│  │   include_scenes: true                     │        │
│  │ })                                         │        │
│  └───────────────────┬────────────────────────┘        │
└────────────────────────┼───────────────────────────────┘
                         │
                         │ HTTP POST
                         │ /api/chat (or similar endpoint)
                         │ Headers: { Authorization: Bearer <token> }
                         │ Body: JSON payload
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                    BACKEND API                           │
│                                                          │
│  Request Processing:                                    │
│  1. Verify Firebase auth token                         │
│  2. Validate script_id access                          │
│  3. If include_scenes: fetch scene content             │
│  4. Build AI prompt with context                       │
│  5. Call OpenAI API                                    │
│  6. Format response as ChatMessage                     │
│                                                          │
│  Response:                                              │
│  ┌────────────────────────────────────────────┐        │
│  │ {                                          │        │
│  │   success: true,                           │        │
│  │   message: {                               │        │
│  │     role: "assistant",                     │        │
│  │     content: "AI response text...",        │        │
│  │     timestamp: "2025-01-08T..."            │        │
│  │   }                                        │        │
│  │ }                                          │        │
│  └────────────────────────────────────────────┘        │
└─────────────────────────┬────────────────────────────────┘
                          │
                          │ JSON response
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│                  FRONTEND (AIChatbot)                    │
│                                                          │
│  Response Handling:                                     │
│  if (response.success && response.message) {            │
│    setMessages(prev => [...prev, response.message!])   │
│  }                                                       │
│                                                          │
│  Triggers:                                              │
│  • State update → localStorage save                     │
│  • State update → auto-scroll                          │
│  • State update → re-render                            │
└──────────────────────────────────────────────────────────┘
```

---

## STYLING ARCHITECTURE

```
COMPONENT STYLING PATTERN:
═════════════════════════

┌─────────────────────────────────────────────────────┐
│          Conditional Class Strings                  │
│                                                     │
│  const containerClass = compact                    │
│    ? "h-full flex flex-col bg-white ..."          │
│    : "h-[calc(100vh-112px)] flex flex-col ..."    │
│                                                     │
│  Advantages:                                       │
│  • No CSS files, everything inline                │
│  • Tailwind utility classes                       │
│  • TypeScript type safety                         │
│                                                     │
│  Disadvantages:                                    │
│  • Long className strings                         │
│  • Duplication across components                  │
│  • Hard to maintain color palette                 │
└─────────────────────────────────────────────────────┘


DESIGN TOKEN USAGE:
═══════════════════

Colors:
  blue-600   → User messages, primary actions, icons
  blue-500   → Hover states, loading spinners
  blue-50    → Empty state icon background

  gray-100   → Button active state
  gray-200   → Borders, assistant messages
  gray-300   → Input borders
  gray-600   → Secondary text
  gray-700   → Primary text

  white      → Backgrounds, cards
  white/95   → Semi-transparent backgrounds (glassmorphism)

Spacing:
  p-1.5  → 6px  (tight compact mode)
  p-2    → 8px  (standard compact)
  gap-1  → 4px  (minimal gaps)
  gap-2  → 8px  (standard gaps)

Shadows:
  shadow-md  → Button depth
  shadow-lg  → Window depth

Effects:
  backdrop-blur-sm  → Glassmorphism
  rounded-lg        → 8px corners
  rounded-t-lg      → Top corners only
```

---

This visual architecture guide complements the detailed diagnostic and provides quick reference for understanding the chat system structure.
