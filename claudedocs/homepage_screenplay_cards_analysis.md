# Homepage Screenplay Cards - UI/UX Analysis

**Date**: 2025-10-29
**Focus**: Screenplay card display on homepage (`frontend/app/page.tsx`)
**Purpose**: Analysis before UI/UX improvements

## Current Implementation Overview

### Card Location in Code
**File**: `frontend/app/page.tsx` (Lines 266-298)
**Component**: Card component from `@/components/ui/card.tsx`

### Current Card Design

#### Visual Structure
The screenplay cards follow a **title card aesthetic** inspired by screenplay formatting:

```tsx
<Card> (Lines 267-298)
  ├─ Title Card Section (Lines 273-284)
  │  ├─ Background: #FFFEF0 (cream/screenplay paper color)
  │  ├─ Height: 48 (h-48, 192px)
  │  ├─ Script Title: Courier Prime font, uppercase, centered
  │  └─ Writing Credit: "by [Writer Name]" in Courier Prime
  │
  └─ Footer Section (Lines 287-297)
     ├─ Border-top separator
     ├─ Timestamp with Clock icon
     └─ Description (truncated, max 120px)
```

#### Styling Details

**Card Container**:
- `border-2 border-slate-200` - Visible border
- `bg-white/90 backdrop-blur-md` - Semi-transparent white with blur
- `shadow-xl` - Strong shadow
- `hover:scale-[1.02]` - Slight scale on hover
- `hover:shadow-2xl` - Enhanced shadow on hover
- `cursor-pointer` - Indicates clickability

**Title Card Section** (Lines 273-284):
- Background: `bg-[#FFFEF0]` (cream paper color)
- Height: `h-48` (192px fixed height)
- Padding: `p-8`
- Layout: `flex flex-col items-center justify-center`
- Typography:
  - Title: `font-[family-name:var(--font-courier-prime)]` with `text-2xl font-bold uppercase tracking-wide`
  - Credit: Same Courier Prime font, `text-base` for "by", `font-semibold` for author name

**Footer Section** (Lines 287-297):
- Border: `border-t border-slate-100`
- Padding: `pt-3 pb-4`
- Text: `text-xs text-slate-500`
- Layout: Flex between timestamp and description

### Grid Layout
- **Grid**: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` (responsive)
- **Gap**: `gap-6` (1.5rem spacing)
- **Cards per row**: 1 mobile, 2 tablet, 3 desktop

## Visual Design Assessment

### Strengths ✅

1. **Thematic Consistency**: The screenplay title card design is creative and thematically appropriate
2. **Clear Hierarchy**: Title → Author → Metadata is well-structured
3. **Professional Typography**: Courier Prime is authentic to screenplay formatting
4. **Responsive**: Grid adapts well to different screen sizes
5. **Interactive Feedback**: Hover effects (scale, shadow) provide clear affordance

### Weaknesses ⚠️

1. **Visual Monotony**: All cards look identical (same cream background, same layout)
2. **Limited Information Density**: Large card (h-48 = 192px) with minimal info
3. **Wasted Space**: Significant empty space in title card section
4. **No Visual Differentiation**: Nothing distinguishes scripts by genre, status, or type
5. **Typography Hierarchy Issues**:
   - Title at `text-2xl` feels small for a 192px tall card
   - "by [Author]" takes significant space but low information value
6. **Footer Cramped**: Tiny `text-xs` footer feels disconnected from main card
7. **Description Truncation**: `max-w-[120px]` severely limits description visibility
8. **No Progress Indicators**: No way to see completion status, page count, or last edit info

## User Experience Issues

### Discoverability Problems
- **No Search/Filter**: Can't find scripts quickly in a large list
- **No Sorting**: Can't reorder by date, title, or custom criteria
- **No Categories**: No way to organize by project type, genre, or status

### Information Architecture
- **Missing Metadata**:
  - No page count
  - No scene count
  - No collaboration status (solo vs shared)
  - No last editor information
  - No version/draft number
- **Temporal Information**: Only "updated_at" shown, no "created_at" or "days since edit"

### Interaction Patterns
- **Single Action**: Only clicking opens script (no quick actions)
- **No Context Menu**: Can't rename, delete, duplicate, or share from homepage
- **No Drag-and-Drop**: Can't reorder or organize scripts
- **No Bulk Actions**: Can't select multiple scripts for operations

## Technical Observations

### Component Structure
**Base Card Component** (`frontend/components/ui/card.tsx`):
- Clean, composable API with `Card`, `CardHeader`, `CardContent`, `CardFooter`
- Uses Radix UI patterns with `data-slot` attributes
- Tailwind-based styling with `cn()` utility for class merging

**Current Usage Pattern**:
```tsx
<Card> with heavy className overrides
  <div> (title card - NOT using CardHeader)
  <CardContent> (footer info)
</Card>
```

**Issue**: Not using semantic `CardHeader`, `CardTitle`, `CardDescription` - creates accessibility and maintainability concerns

### Data Model
**ScriptSummary Interface** (from `@/lib/api`):
```typescript
{
  script_id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
}
```

**Missing Backend Data**:
- Scene count
- Page count
- Collaborator count
- Last editor
- Status/tags
- Cover image/custom styling

## Comparison with Action Cards

The homepage also includes two action cards (Upload, Create New) that have better visual design:

**Upload Card** (Lines 302-330):
- Icon badge: `w-12 h-12 rounded-lg bg-blue-600/20` with centered icon
- Clear title: `font-semibold text-slate-900`
- Subtitle: `text-xs text-slate-500`
- Dashed border for "drop zone" affordance

**Create New Card** (Lines 333-348):
- Similar icon badge pattern with purple theme
- Consistent spacing and typography
- Better visual hierarchy

**Key Difference**: Action cards use icon badges with color-coded backgrounds, while screenplay cards use generic cream background

## Improvement Opportunities

### Visual Design

1. **Add Visual Variety**:
   - Random or user-selected accent colors per script
   - Genre-based color schemes
   - Custom cover images or patterns
   - Script-specific iconography

2. **Better Space Utilization**:
   - Reduce card height or add more information
   - Use vertical space for metadata (page count, scenes, collaborators)
   - Consider horizontal card layout option

3. **Enhanced Typography**:
   - Larger title (text-3xl or text-4xl) to fill space
   - Remove or minimize "by [Author]" (redundant on personal dashboard)
   - Use subtitle area for description instead of cramped footer

4. **Visual Indicators**:
   - Progress bar (completion percentage)
   - Status badge (draft, in review, final)
   - Collaboration indicator (solo, shared, # of collaborators)
   - Recent activity dot/pulse

### Information Architecture

1. **Richer Metadata**:
   - Page count (e.g., "87 pages")
   - Scene count (e.g., "42 scenes")
   - Last edit timeframe ("2 hours ago" vs just date)
   - Collaborator avatars or count
   - Version/draft number

2. **Quick Actions**:
   - Hover menu with rename, duplicate, delete, share
   - Right-click context menu
   - Favorite/pin functionality
   - Export options

3. **Organization Features**:
   - Folders/collections
   - Tags/labels
   - Custom sorting (alphabetical, date, manual)
   - Search/filter bar
   - List vs grid view toggle

### Interaction Design

1. **Improved Affordances**:
   - Subtle animation on load (stagger entrance)
   - Loading skeleton matching actual card design
   - Drag handles for reordering
   - Multi-select checkboxes

2. **Contextual Actions**:
   - Quick-edit title inline
   - Archive/restore functionality
   - Duplicate with modifier
   - Share modal from card

### Accessibility

1. **Semantic HTML**:
   - Use `CardHeader`, `CardTitle`, `CardDescription` components
   - Proper heading hierarchy (h2, h3)
   - ARIA labels for interactive elements

2. **Keyboard Navigation**:
   - Tab through cards
   - Space/Enter to open
   - Arrow keys for grid navigation
   - Context menu key support

## Design System Considerations

### Current Stack
- **Framework**: Next.js 14 with React 18
- **Styling**: Tailwind CSS 4.1
- **Components**: Radix UI primitives
- **Fonts**: Inter (body), Courier Prime (screenplay)
- **Icons**: Lucide React

### Design Tokens in Use
- **Colors**: slate palette (200-900), blue-600, purple-600
- **Spacing**: Tailwind scale (gap-6, p-8, pt-3)
- **Shadows**: xl, 2xl
- **Border Radius**: rounded-2xl, rounded-xl
- **Transitions**: duration-300, scale-[1.02]

### Consistency Patterns
- Backdrop blur: `backdrop-blur-md`, `backdrop-blur-xl`
- Semi-transparency: `bg-white/90`, `bg-white/80`
- Border weights: `border-2`, `border-4` (heavy borders throughout)
- Hover patterns: scale + shadow enhancement

## Recommended Next Steps

### Phase 1: Quick Wins (Low Effort, High Impact)
1. **Increase title font size** to text-3xl or text-4xl
2. **Remove or minimize author credit** (user knows it's their script)
3. **Move description** from cramped footer to subtitle position
4. **Add page count** to footer (if backend provides it)
5. **Improve footer readability** with larger text (text-sm instead of text-xs)

### Phase 2: Visual Enhancement (Medium Effort)
1. **Add script cover colors** (user-selectable or auto-generated)
2. **Implement icon badges** similar to action cards
3. **Add status indicators** (draft/final badges)
4. **Create hover menu** with quick actions
5. **Improve spacing** and reduce card height if needed

### Phase 3: Information Architecture (Higher Effort)
1. **Fetch additional metadata** (page count, scene count, collaborators)
2. **Implement search/filter** functionality
3. **Add sorting options** (date, title, custom)
4. **Create folder/tag system** for organization
5. **Add collaboration indicators** (avatars, shared status)

### Phase 4: Advanced Features (Future)
1. **Custom cover images** upload
2. **Drag-and-drop reordering**
3. **List view alternative**
4. **Bulk selection and actions**
5. **Advanced filtering** (by date range, collaborator, status)

## Design Inspiration Sources

Consider looking at:
- **Notion**: Card-based project views with rich metadata
- **Linear**: Clean project cards with status indicators
- **Dropbox Paper**: Document cards with collaboration info
- **Google Docs**: Recent documents with thumbnails and metadata
- **Final Draft**: Screenplay management UI patterns

## Code References

**Key Files**:
- `frontend/app/page.tsx:266-298` - Screenplay card implementation
- `frontend/components/ui/card.tsx` - Base Card component
- `frontend/lib/api.ts` - ScriptSummary type definition
- `frontend/app/layout.tsx:11-15` - Courier Prime font configuration

**Related Components**:
- `frontend/components/MoviePosterBanner.tsx` - Background effect
- `frontend/components/DragOverlay.tsx` - Drag-and-drop visual feedback
- `frontend/components/LoadingOverlay.tsx` - Loading states

## Conclusion

The current screenplay card design has a strong thematic concept (title card aesthetic) but suffers from **visual monotony**, **limited information density**, and **lack of organizational features**. The cards take up significant space but provide minimal information, and there's no way to differentiate, organize, or quickly act on scripts.

**Primary Issues to Address**:
1. ⚠️ **Visual sameness** - all cards look identical
2. ⚠️ **Wasted vertical space** - 192px tall card with minimal content
3. ⚠️ **Missing metadata** - no page count, scene count, collaboration info
4. ⚠️ **No organization tools** - no search, sort, filter, or folders
5. ⚠️ **Limited actions** - only click to open, no quick actions

**Recommended Priority**: Start with Phase 1 (quick visual improvements) while planning backend changes for richer metadata in Phase 3.
