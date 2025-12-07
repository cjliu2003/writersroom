# Scene Navigation Bar Redesign - Implementation Plan

**Created**: 2025-12-06
**Status**: APPROVED - Ready for Implementation
**Branch**: `frontend`

---

## Overview

Transform the Controls Bar (second bar below main header) from a simple toggle bar into a **horizontally scrollable scene navigation strip**. Remove the left sidebar entirely and move the AI button to a floating position.

---

## Confirmed Requirements

| Decision | Specification |
|----------|---------------|
| Left Sidebar | **Remove entirely** - replaced by horizontal nav bar |
| Scene Item Content | **Minimal** - scene number + truncated heading |
| Scene Item Design | Clean, uniform, stylish, matching existing Courier Prime aesthetic |
| AI Assistant Button | **Floating button** - bottom-right corner |

---

## Visual Design

### Before
```
┌──────────────────────────────────────────────────────────────────────────┐
│ [▲] [Home] [File] [Edit]     SCRIPT TITLE     [Share] [Export]  • Saved │  ← Top Bar
├──────────────────────────────────────────────────────────────────────────┤
│ [☰ Hide Scenes]                                        [AI Assistant]   │  ← Controls Bar
├────────────┬─────────────────────────────────────────────┬───────────────┤
│            │                                             │               │
│  Scene     │              EDITOR                         │  AI Chat      │
│  Sidebar   │                                             │  Sidebar      │
│  (320px)   │                                             │  (384px)      │
│            │                                             │               │
└────────────┴─────────────────────────────────────────────┴───────────────┘
```

### After
```
┌──────────────────────────────────────────────────────────────────────────┐
│ [▲] [Home] [File] [Edit]     SCRIPT TITLE     [Share] [Export]  • Saved │  ← Top Bar (unchanged)
├──────────────────────────────────────────────────────────────────────────┤
│ ◄ │ [1] INT. OFFICE │ [2] EXT. PARK │ [3] INT. CAR │ [4] ... │ ►       │  ← Scene Nav Bar (new)
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│                              EDITOR                                      │
│                         (full width, centered)                           │
│                                                                          │
│                                                                     ┌───┐│
│                                                                     │ AI││  ← Floating button
│                                                                     └───┘│
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. SceneNavBar Component

**File**: `frontend/components/scene-nav-bar.tsx` (CREATE)

**Props Interface**:
```typescript
interface SceneNavBarProps {
  scenes: SceneBoundary[];
  onSceneClick: (sceneIndex: number) => void;
  currentSceneIndex: number | null;
}
```

**Design Tokens**:
- Font: `var(--font-courier-prime), 'Courier New', monospace`
- Height: `44px` (matching current controls bar)
- Background: `white` with `border-b border-gray-200`
- Scene items:
  - Inactive: `bg-gray-50 text-gray-700 border border-gray-200`
  - Active: `bg-blue-50 text-blue-800 border border-blue-300`
  - Hover: `bg-gray-100`
- Scene number: Small pill/badge `bg-blue-100 text-blue-700`
- Heading text: Truncated with ellipsis, `text-xs` or `text-sm`
- Gap between items: `8px`
- Padding: `px-4` container, `px-3 py-1.5` per item

**Behavior**:
- Horizontal scroll with CSS `overflow-x: auto`
- `scroll-snap-type: x mandatory` for clean snapping
- Auto-scroll active scene into view on mount and when `currentSceneIndex` changes
- Scroll fade indicators (gradient overlays) on left/right edges when content overflows
- Use `useRef` for scroll container to enable programmatic scrolling
- Truncate headings to ~18-20 characters with ellipsis
- Scene items should have `flex-shrink-0` to prevent compression

---

### 2. FloatingAIButton Component

**File**: `frontend/components/floating-ai-button.tsx` (CREATE)

**Props Interface**:
```typescript
interface FloatingAIButtonProps {
  onClick: () => void;
  isOpen: boolean;
}
```

**Design Tokens**:
- Position: `fixed bottom-6 right-6 z-50`
- Size: `w-12 h-12` (48px circular) or `w-14 h-14` (56px)
- Background:
  - Closed: `bg-purple-600 hover:bg-purple-700`
  - Open: `bg-purple-700 ring-2 ring-purple-300`
- Icon: Sparkles or MessageCircle from Lucide
- Shadow: `shadow-lg hover:shadow-xl`
- Transition: `transition-all duration-200`
- Tooltip on hover: "AI Assistant"

---

## File Changes Summary

| File | Action | Changes |
|------|--------|---------|
| `components/scene-nav-bar.tsx` | **CREATE** | New horizontal scene navigation component |
| `components/floating-ai-button.tsx` | **CREATE** | New floating AI toggle button |
| `app/script-editor/page.tsx` | **MODIFY** | Remove sidebar, replace controls bar, add floating button, adjust layout |
| `components/script-scene-sidebar.tsx` | **NO CHANGE** | Keep file but no longer imported in script-editor |

---

## Detailed Changes to `script-editor/page.tsx`

### State Changes

**Remove**:
```typescript
const [isSceneSidebarOpen, setIsSceneSidebarOpen] = useState(true);
```

**Keep**:
```typescript
const [sceneBoundaries, setSceneBoundaries] = useState<SceneBoundary[]>([]);
const [currentSceneIndex, setCurrentSceneIndex] = useState<number | null>(null);
const [isAssistantOpen, setIsAssistantOpen] = useState(true);
```

**Evaluate for removal**:
```typescript
// liveSlateContent was used for sidebar features (summaries, characters)
// With minimal nav bar, this may no longer be needed
const [liveSlateContent, setLiveSlateContent] = useState<any[]>([]);
```

### Import Changes

**Add**:
```typescript
import { SceneNavBar } from '@/components/scene-nav-bar';
import { FloatingAIButton } from '@/components/floating-ai-button';
```

**Remove**:
```typescript
import { ScriptSceneSidebar } from '@/components/script-scene-sidebar';
```

### Layout Preference Changes

Simplify to only persist AI assistant state (scene sidebar preference no longer relevant).

### JSX Changes

1. **Replace Controls Bar** (lines 635-663) with `<SceneNavBar />`
2. **Remove Left Sidebar** (lines 682-698) entirely
3. **Add Floating Button** after main content
4. **Adjust Main Content Margins**: Remove left margin, keep right margin for AI chat
5. **Simplify Max Width Calculation**: Only account for AI sidebar

---

## Implementation Order

1. **Create `scene-nav-bar.tsx`** - New component, can be built in isolation
2. **Create `floating-ai-button.tsx`** - New component, simple and isolated
3. **Modify `script-editor/page.tsx`** - Integration:
   - Update imports
   - Remove sidebar state
   - Replace controls bar JSX
   - Remove sidebar JSX
   - Add floating button JSX
   - Adjust layout margins
   - Simplify layout preferences
4. **Test & Polish** - Verify navigation works, active states, scrolling behavior

---

## Verification Checklist

- [ ] Scene nav bar displays all scenes horizontally
- [ ] Clicking a scene scrolls editor to that scene (same as before)
- [ ] Active scene is highlighted in nav bar
- [ ] Nav bar auto-scrolls to show active scene when cursor moves
- [ ] Horizontal scrolling works smoothly on mouse/trackpad/touch
- [ ] Floating AI button appears bottom-right
- [ ] Clicking AI button toggles chat sidebar
- [ ] Editor layout adjusts correctly when chat opens/closes
- [ ] Layout preferences persist across page refreshes
- [ ] Design matches existing site aesthetic (fonts, colors, spacing)

---

## Key Files Reference

### Existing files to understand:
- `frontend/app/script-editor/page.tsx` - Main editor (lines 635-698 are key modification areas)
- `frontend/utils/tiptap-scene-tracker.ts` - Scene extraction utilities (reuse as-is)
- `frontend/components/script-scene-sidebar.tsx` - Reference for existing functionality

### Navigation functions to reuse:
- `extractSceneBoundariesFromTipTap()` - Gets scenes from editor
- `scrollToScene()` - Scrolls editor to scene position
- `getCurrentSceneIndex()` - Tracks active scene based on cursor

---

## Session Context

This plan was created after comprehensive analysis of the existing scene navigation sidebar system. The analysis examined:
- 3 sidebar components (ScriptSceneSidebar is active, others legacy)
- 2 scene tracking utilities (TipTap tracker is active)
- Full data flow from editor → scene extraction → sidebar → navigation

The existing navigation logic remains unchanged - only the visual presentation changes.

---

**To implement**: Run `/sc:load` and reference this document, then proceed with implementation order above.
