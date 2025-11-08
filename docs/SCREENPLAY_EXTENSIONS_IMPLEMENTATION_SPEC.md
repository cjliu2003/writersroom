# Screenplay Extensions Implementation Specification

**Date**: October 29, 2025
**Phase**: Phase 2 - Screenplay Extensions
**Status**: Design Complete, Ready for Implementation
**Estimated Timeline**: 5 days

---

## Executive Summary

This specification defines the implementation of custom TipTap node extensions for screenplay formatting. These extensions will provide industry-standard screenplay element types (Scene Heading, Action, Character, Dialogue, Parenthetical, Transition) with proper formatting, positioning, and keyboard navigation.

**Key Design Decisions**:
- All elements implemented as TipTap Node extensions (block-level)
- Semantic `<p>` tags instead of `<div>` for better ProseMirror behavior
- `mergeAttributes()` to preserve extension attributes
- `defining: true` for structural screenplay boundaries
- CSS-based positioning using millimeter units (consistent with pagination extension)
- TAB-based keyboard navigation matching Final Draft behavior
- Smart Enter via ProseMirror plugin (not global hijacking)
- Auto-formatting for uppercase elements via input rules
- Full Yjs collaboration compatibility
- Smart page breaks deferred to Phase 3

**Pattern Improvements from Best Practices**:
1. **Semantic HTML**: Use `<p>` tags for text blocks (better copy/paste, CSS predictability)
2. **Attribute Preservation**: `mergeAttributes()` doesn't drop attrs from other extensions
3. **Smart Enter Plugin**: ProseMirror `appendTransaction` plugin handles transitions without hijacking Enter
4. **Explicit Commands**: Named commands (e.g., `setSceneHeading()`) for clarity
5. **Structural Boundaries**: `defining: true` marks screenplay elements as PM boundaries
6. **Input Rules**: Auto-convert patterns (e.g., "INT. " → scene heading)
7. **Selective Selection**: `selectable: false` for transitions (optional)

---

## 1. Architecture Overview

### 1.1 Component Structure

```
frontend/
├── extensions/
│   └── screenplay/
│       ├── nodes/
│       │   ├── scene-heading.ts      # Scene heading node extension
│       │   ├── action.ts              # Action/description node extension
│       │   ├── character.ts           # Character name node extension
│       │   ├── dialogue.ts            # Dialogue node extension
│       │   ├── parenthetical.ts       # Parenthetical node extension
│       │   └── transition.ts          # Transition node extension
│       ├── plugins/
│       │   └── smart-enter-plugin.ts  # Smart Enter ProseMirror plugin
│       ├── screenplay-kit.ts          # Extension bundle (exports all)
│       ├── types.ts                   # Shared TypeScript types
│       └── utils/
│           ├── keyboard-navigation.ts # TAB cycling logic
│           └── auto-formatting.ts     # Uppercase/parentheses helpers
├── styles/
│   └── screenplay.css                 # Global screenplay styles
```

### 1.2 Extension Pattern

Each screenplay element follows this structure:

```typescript
import { Node, mergeAttributes } from '@tiptap/core';

export const ElementName = Node.create({
  name: 'elementName',
  group: 'block',
  content: 'inline*',
  defining: true, // PM treats as structural boundary (critical for screenplay elements)

  parseHTML() {
    return [{ tag: 'p[data-type="element-name"]' }]; // Use semantic <p> tag
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'element-name',
      class: 'screenplay-element-name',
    }), 0];
  },

  addKeyboardShortcuts() {
    return {
      'Tab': () => this.editor.commands.setElementName(), // Use explicit command
      // Enter handled by ProseMirror plugin for smart transitions
    };
  },

  addCommands() {
    return {
      setElementName: () => ({ commands }) => {
        return commands.setNode(this.name);
      },
    };
  },

  // Optional: Input rules for auto-conversion (e.g., "INT. " → scene heading)
  addInputRules() {
    return [
      // Example: Auto-convert to scene heading if line starts with INT./EXT.
      // nodeInputRule({
      //   find: /^(INT\.|EXT\.)\s/i,
      //   type: this.type,
      // }),
    ];
  },
});
```

**Key Pattern Improvements**:
1. **Use `<p>` instead of `<div>`**: Semantic HTML, better ProseMirror copy/paste behavior
2. **Use `mergeAttributes()`**: Preserves attributes from other extensions (alignment, etc.)
3. **Add `defining: true`**: Marks as structural boundary for screenplay elements
4. **Explicit commands**: Named commands (e.g., `setSceneHeading()`) for clarity
5. **Smart Enter via plugin**: Don't hijack Enter globally; use ProseMirror `appendTransaction` plugin
6. **Input rules**: Auto-convert patterns (e.g., "INT. " → scene heading)

---

## 2. Element Specifications

### 2.1 Scene Heading (Slug Line)

**Purpose**: Introduces a new scene by establishing location and time

**Technical Specs**:
- **Node Name**: `sceneHeading`
- **Group**: `block`
- **Content**: `inline*` (plain text only)
- **Data Attribute**: `data-type="scene-heading"`

**Formatting Requirements**:
- Font: Courier 12pt (inherited)
- Text: ALL CAPS (auto-formatted)
- Position: Flush with left margin (margin-left: 0)
- Spacing: Double-space before (24pt), single-space after (12pt)
- Style: Bold

**Structure**: `INT./EXT. LOCATION - TIME OF DAY`

**CSS Styling**:
```css
[data-type="scene-heading"] {
  margin-left: 0;
  text-transform: uppercase;
  font-weight: bold;
  margin-top: 24pt;
  margin-bottom: 12pt;
}
```

**Keyboard Shortcuts**:
- `Cmd/Ctrl+Alt+1`: Set current block to scene heading
- `Enter`: Create new Action element below

**Auto-formatting**:
- Force uppercase as user types
- Validate INT./EXT. pattern (optional warning)

**Example**:
```
INT. COFFEE SHOP - DAY
```

---

### 2.2 Action (Scene Description)

**Purpose**: Describes what can be seen or heard in the scene

**Technical Specs**:
- **Node Name**: `action`
- **Group**: `block`
- **Content**: `inline*`
- **Data Attribute**: `data-type="action"`

**Formatting Requirements**:
- Font: Courier 12pt (inherited)
- Text: Normal case
- Position: Flush with left margin (margin-left: 0)
- Spacing: Single-space between paragraphs (12pt)

**CSS Styling**:
```css
[data-type="action"] {
  margin-left: 0;
  margin-bottom: 12pt;
  line-height: 12pt;
}
```

**Keyboard Shortcuts**:
- `Cmd/Ctrl+Alt+2`: Set current block to action
- `Enter`: Create new action paragraph

**Guidelines**:
- Default element type for new content
- Write in present tense
- Keep paragraphs short (3-4 lines recommended)

**Example**:
```
The rain pounds against the window. SARAH (30s, determined)
enters the room, dripping wet. She tosses her keys on the
counter.
```

---

### 2.3 Character Name (Character Cue)

**Purpose**: Indicates which character is speaking

**Technical Specs**:
- **Node Name**: `character`
- **Group**: `block`
- **Content**: `inline*`
- **Data Attribute**: `data-type="character"`

**Formatting Requirements**:
- Font: Courier 12pt (inherited)
- Text: ALL CAPS (auto-formatted)
- Position: 3.7" from page edge = 2.2" from left margin = 55.9mm
- Spacing: Single-space above (12pt), no space below

**CSS Styling**:
```css
[data-type="character"] {
  margin-left: 55.9mm; /* 2.2 inches from left margin */
  text-transform: uppercase;
  margin-top: 12pt;
  margin-bottom: 0;
}
```

**Keyboard Shortcuts**:
- `Cmd/Ctrl+Alt+3`: Set current block to character
- `Enter`: Create new Dialogue element below
- `Tab`: Cycle to next element type

**Auto-formatting**:
- Force uppercase
- Support special notations: (V.O.), (O.S.), (CONT'D), (filtered)

**Special Notations**:
- `(V.O.)` = Voice Over (character not present in scene)
- `(O.S.)` = Off Screen (character present but not visible)
- `(CONT'D)` = Continued (dialogue continues after interruption)
- `(filtered)` = Voice through phone, radio, etc.

**Examples**:
```
SARAH

JOHN (V.O.)

DETECTIVE MILLER (O.S.)

SARAH (CONT'D)
```

---

### 2.4 Dialogue

**Purpose**: The spoken words of a character

**Technical Specs**:
- **Node Name**: `dialogue`
- **Group**: `block`
- **Content**: `inline*`
- **Data Attribute**: `data-type="dialogue"`

**Formatting Requirements**:
- Font: Courier 12pt (inherited)
- Text: Normal case
- Position: 2.5" from page edge = 1" from left margin = 25.4mm
- Width: Maximum 3.5" = 88.9mm
- Spacing: Single-space within dialogue, 12pt after block

**CSS Styling**:
```css
[data-type="dialogue"] {
  margin-left: 25.4mm; /* 1 inch from left margin */
  max-width: 88.9mm; /* 3.5 inches wide */
  margin-bottom: 12pt;
}
```

**Keyboard Shortcuts**:
- `Cmd/Ctrl+Alt+4`: Set current block to dialogue
- `Enter`: Continue dialogue OR switch to Action (context-dependent)
- `Tab`: Cycle to next element type

**Guidelines**:
- Natural, conversational language
- Each character should have distinct voice
- Break long speeches with action or parentheticals

**Example**:
```
          I can't believe you did this. After
          everything we've been through, you
          just threw it all away.
```

---

### 2.5 Parenthetical (Wryly)

**Purpose**: Provides brief direction about how dialogue is delivered

**Technical Specs**:
- **Node Name**: `parenthetical`
- **Group**: `block`
- **Content**: `inline*`
- **Data Attribute**: `data-type="parenthetical"`

**Formatting Requirements**:
- Font: Courier 12pt (inherited)
- Text: Lowercase/normal case, italicized
- Position: 3.0" from page edge = 1.5" from left margin = 38.1mm
- Enclosed: Parentheses automatically added
- Spacing: No space below (dialogue follows immediately)

**CSS Styling**:
```css
[data-type="parenthetical"] {
  margin-left: 38.1mm; /* 1.5 inches from left margin */
  font-style: italic;
  margin-bottom: 0;
}

[data-type="parenthetical"]::before {
  content: '(';
}

[data-type="parenthetical"]::after {
  content: ')';
}
```

**Keyboard Shortcuts**:
- `Cmd/Ctrl+Alt+5`: Set current block to parenthetical
- `Enter`: Create new Dialogue element below
- `Tab`: Cycle to next element type

**Guidelines**:
- Use sparingly (only when essential)
- Keep brief (3-4 words maximum)
- Common uses: (beat), (pause), (to John), (whispers), (angry)

**Validation**:
- Warn if content exceeds ~20 characters

**Examples**:
```
          (whispering)

          (to John)

          (realizing)
```

---

### 2.6 Transition

**Purpose**: Indicates how one scene transitions to the next

**Technical Specs**:
- **Node Name**: `transition`
- **Group**: `block`
- **Content**: `inline*`
- **Data Attribute**: `data-type="transition"`
- **Selectable**: `false` (optional - prevents independent selection)

**Formatting Requirements**:
- Font: Courier 12pt (inherited)
- Text: ALL CAPS (auto-formatted)
- Position: Right-aligned
- Punctuation: Colon automatically added if missing
- Spacing: Double-space before and after (12pt)

**CSS Styling**:
```css
[data-type="transition"] {
  text-align: right;
  text-transform: uppercase;
  margin-top: 12pt;
  margin-bottom: 12pt;
}

[data-type="transition"]::after {
  content: ':';
}
```

**Keyboard Shortcuts**:
- `Cmd/Ctrl+Alt+6`: Set current block to transition
- `Enter`: Create new Scene Heading element below
- `Tab`: Cycle to next element type

**Auto-formatting**:
- Force uppercase
- Add colon if missing

**Common Transitions**:
- `CUT TO:`
- `DISSOLVE TO:`
- `FADE TO BLACK`
- `SMASH CUT TO:`
- `MATCH CUT TO:`
- `FADE IN:` (screenplay opening only, left-aligned)
- `FADE OUT.` (screenplay ending only)

**Guidelines**:
- Use sparingly in modern screenplays
- Most scene changes don't require explicit transitions

**Example**:
```
                                        CUT TO:
```

---

## 3. Keyboard Navigation System

### 3.1 TAB Cycling Flow

**Cycle Sequence**:
```
Action → Scene Heading → Character → Dialogue → Parenthetical → Transition → Action
```

**Implementation**:
```typescript
// utils/keyboard-navigation.ts
export function getNextElementType(currentType: string): string {
  const cycle = [
    'action',
    'sceneHeading',
    'character',
    'dialogue',
    'parenthetical',
    'transition',
  ];

  const currentIndex = cycle.indexOf(currentType);
  if (currentIndex === -1) return 'action'; // Default

  return cycle[(currentIndex + 1) % cycle.length];
}

// Add to each extension's keyboard shortcuts:
addKeyboardShortcuts() {
  return {
    'Tab': () => {
      const nextType = getNextElementType(this.name);
      return this.editor.commands.setNode(nextType);
    },
  };
}
```

### 3.2 Smart Enter Behavior

**Transition Map**:
```
Scene Heading + Enter (at end) → Action
Action + Enter → New Action paragraph (default PM behavior)
Character + Enter (at end) → Dialogue
Dialogue + Enter → New Dialogue line (default PM behavior)
Parenthetical + Enter (at end) → Dialogue
Transition + Enter (at end) → Scene Heading
```

**Implementation**: See Section 6 (Smart Enter Plugin)

Smart Enter is implemented as a ProseMirror `appendTransaction` plugin rather than hijacking Enter in keyboard shortcuts. This preserves normal ProseMirror block-splitting behavior while adding smart transitions only when the cursor is at the end of specific node types.

**Benefits**:
- Doesn't break normal Enter behavior (split paragraph mid-line)
- Only triggers transitions when cursor at end of node
- Can be easily configured or disabled
- Follows ProseMirror best practices

### 3.3 Direct Element Shortcuts

**Shortcuts**:
- `Cmd/Ctrl+Alt+1`: Scene Heading
- `Cmd/Ctrl+Alt+2`: Action
- `Cmd/Ctrl+Alt+3`: Character
- `Cmd/Ctrl+Alt+4`: Dialogue
- `Cmd/Ctrl+Alt+5`: Parenthetical
- `Cmd/Ctrl+Alt+6`: Transition

---

## 4. Auto-Formatting System

### 4.1 Uppercase Transformation

**Elements Requiring Uppercase**:
- Scene Heading
- Character
- Transition

**Implementation**:
```typescript
// utils/auto-formatting.ts
import { Extension } from '@tiptap/core';

export const AutoUppercase = Extension.create({
  name: 'autoUppercase',

  addInputRules() {
    return [
      {
        find: /(.)/,
        handler: ({ state, range, match }) => {
          const { $from } = state.selection;
          const nodeType = $from.parent.type.name;

          if (['sceneHeading', 'character', 'transition'].includes(nodeType)) {
            const char = match[1].toUpperCase();
            return state.tr.insertText(char, range.from, range.to);
          }
        },
      },
    ];
  },
});
```

### 4.2 Parentheses Auto-Wrap

**For Parenthetical Elements**:

Option 1: CSS pseudo-elements (simpler):
```css
[data-type="parenthetical"]::before { content: '('; }
[data-type="parenthetical"]::after { content: ')'; }
```

Option 2: Text transformation (more control):
```typescript
addInputRules() {
  return [
    {
      find: /^(.+)$/,
      handler: ({ state, range, match }) => {
        const content = match[1];
        if (!content.startsWith('(')) {
          return state.tr.insertText('(' + content + ')', range.from, range.to);
        }
      },
    },
  ];
}
```

### 4.3 Transition Colon Auto-Add

```typescript
addInputRules() {
  return [
    {
      find: /^(.+)$/,
      handler: ({ state, range, match }) => {
        const content = match[1];
        if (!content.endsWith(':')) {
          return state.tr.insertText(content + ':', range.from, range.to);
        }
      },
    },
  ];
}
```

---

## 5. ScreenplayKit Bundle

**File**: `frontend/extensions/screenplay/screenplay-kit.ts`

```typescript
import { Extension } from '@tiptap/core';
import { SceneHeading } from './nodes/scene-heading';
import { Action } from './nodes/action';
import { Character } from './nodes/character';
import { Dialogue } from './nodes/dialogue';
import { Parenthetical } from './nodes/parenthetical';
import { Transition } from './nodes/transition';

export interface ScreenplayKitOptions {
  // Future configuration options
  enableAutoFormatting?: boolean;
  enableSmartPageBreaks?: boolean;
}

export const ScreenplayKit = Extension.create<ScreenplayKitOptions>({
  name: 'screenplayKit',

  addExtensions() {
    return [
      SceneHeading,
      Action,
      Character,
      Dialogue,
      Parenthetical,
      Transition,
    ];
  },
});

// Usage in test-tiptap/page.tsx:
import { ScreenplayKit } from '@/extensions/screenplay/screenplay-kit';

const editor = useEditor({
  extensions: [
    // Remove StarterKit or configure to not conflict
    StarterKit.configure({
      paragraph: false, // Disable default paragraph
      heading: false,   // Disable default heading
    }),
    ScreenplayKit,
    Collaboration.configure({ document: doc }),
    CollaborationCursor.configure({ provider, user: { name, color } }),
    Pagination.configure({ /* ... */ }),
  ],
});
```

---

## 6. Smart Enter Plugin

Instead of hijacking Enter globally in each extension's keyboard shortcuts, we implement a ProseMirror plugin that handles smart transitions based on cursor position and current node type.

**File**: `frontend/extensions/screenplay/plugins/smart-enter-plugin.ts`

```typescript
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Node as PMNode } from '@tiptap/pm/model';

export const SmartEnterPluginKey = new PluginKey('smartEnter');

export interface SmartEnterOptions {
  types: {
    [key: string]: string; // nodeType → transitionType
  };
}

export function SmartEnterPlugin(options: SmartEnterOptions) {
  return new Plugin({
    key: SmartEnterPluginKey,

    appendTransaction(transactions, oldState, newState) {
      const tr = newState.tr;
      let modified = false;

      // Check if Enter was pressed
      const enterPressed = transactions.some(transaction =>
        transaction.steps.some(step => step.toJSON().stepType === 'replace')
      );

      if (!enterPressed) return null;

      const { $from } = newState.selection;
      const currentNode = $from.parent;
      const currentType = currentNode.type.name;

      // Check if cursor is at end of node
      const atEnd = $from.parentOffset === currentNode.content.size;

      // Get transition type for current node
      const transitionType = options.types[currentType];

      if (transitionType && atEnd) {
        // Get the node type from schema
        const nextNodeType = newState.schema.nodes[transitionType];

        if (nextNodeType) {
          // Replace the newly created node with the transition type
          const pos = $from.after();
          const $pos = newState.doc.resolve(pos);

          if ($pos.parent.type.name === currentType) {
            tr.setNodeMarkup(pos - 1, nextNodeType);
            modified = true;
          }
        }
      }

      return modified ? tr : null;
    },
  });
}
```

**Integration in ScreenplayKit**:

```typescript
import { Extension } from '@tiptap/core';
import { SmartEnterPlugin } from './plugins/smart-enter-plugin';

export const ScreenplayKit = Extension.create({
  name: 'screenplayKit',

  addExtensions() {
    return [
      SceneHeading,
      Action,
      Character,
      Dialogue,
      Parenthetical,
      Transition,
    ];
  },

  addProseMirrorPlugins() {
    return [
      SmartEnterPlugin({
        types: {
          'sceneHeading': 'action',
          'character': 'dialogue',
          'parenthetical': 'dialogue',
          'transition': 'sceneHeading',
          // 'action' and 'dialogue' use default Enter behavior (new paragraph)
        },
      }),
    ];
  },
});
```

**Benefits**:
- Doesn't hijack Enter globally (preserves normal split-block behavior)
- Only triggers when cursor at end of specific node types
- Cleanly handles transitions without breaking ProseMirror expectations
- Can be disabled/modified without touching individual extensions

---

## 7. CSS Styling System

**File**: `frontend/styles/screenplay.css`

```css
/* Global Screenplay Editor Styles */
.screenplay-editor {
  font-family: 'Courier', 'Courier New', monospace;
  font-size: 12pt;
  line-height: 12pt;
  color: #000;
  background: #fff;
}

/* Scene Heading */
[data-type="scene-heading"] {
  margin-left: 0;
  text-transform: uppercase;
  font-weight: bold;
  margin-top: 24pt;
  margin-bottom: 12pt;
}

/* Action */
[data-type="action"] {
  margin-left: 0;
  margin-bottom: 12pt;
  line-height: 12pt;
}

/* Character Name */
[data-type="character"] {
  margin-left: 55.9mm; /* 2.2 inches from left margin */
  text-transform: uppercase;
  margin-top: 12pt;
  margin-bottom: 0;
}

/* Dialogue */
[data-type="dialogue"] {
  margin-left: 25.4mm; /* 1 inch from left margin */
  max-width: 88.9mm; /* 3.5 inches wide */
  margin-bottom: 12pt;
}

/* Parenthetical */
[data-type="parenthetical"] {
  margin-left: 38.1mm; /* 1.5 inches from left margin */
  font-style: italic;
  margin-bottom: 0;
}

[data-type="parenthetical"]::before {
  content: '(';
}

[data-type="parenthetical"]::after {
  content: ')';
}

/* Transition */
[data-type="transition"] {
  text-align: right;
  text-transform: uppercase;
  margin-top: 12pt;
  margin-bottom: 12pt;
}

[data-type="transition"]::after {
  content: ':';
}

/* Collaboration Cursor Styling (preserve existing) */
.collaboration-cursor__caret {
  position: relative;
  margin-left: -1px;
  margin-right: -1px;
  border-left: 1px solid;
  border-right: 1px solid;
  word-break: normal;
  pointer-events: none;
}

.collaboration-cursor__label {
  position: absolute;
  top: -1.4em;
  left: -1px;
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
  user-select: none;
  color: #fff;
  padding: 0.1rem 0.3rem;
  border-radius: 3px 3px 3px 0;
  white-space: nowrap;
}
```

**Integration**: Import in `test-tiptap/page.tsx`:
```typescript
import '@/styles/screenplay.css';
```

---

## 7. Implementation Phases

### Phase 2A: Core Extensions (2 days)

**Day 1**:
1. Create directory structure
2. Set up types.ts with shared interfaces
3. Implement Action extension (simplest, default element)
4. Implement Scene Heading extension
5. Test basic element creation and rendering

**Day 2**:
1. Implement Character extension
2. Implement Dialogue extension
3. Test Character → Dialogue flow
4. Verify CSS positioning

**Deliverables**:
- 4 working extensions: Action, Scene Heading, Character, Dialogue
- Basic element switching functional
- CSS positioning accurate

### Phase 2B: Advanced Features (2 days)

**Day 3**:
1. Implement Parenthetical extension
2. Implement Transition extension
3. Create keyboard navigation utilities
4. Add TAB cycling to all extensions

**Day 4**:
1. Implement smart Enter transitions
2. Add auto-formatting (uppercase, parentheses, colons)
3. Create ScreenplayKit bundle
4. Test full keyboard workflow

**Deliverables**:
- All 6 extensions complete
- TAB cycling functional
- Smart Enter behavior working
- Auto-formatting active

### Phase 2C: Polish & Testing (1 day)

**Day 5**:
1. Refine CSS styling
2. Test all keyboard shortcuts
3. Test with Yjs collaboration (multi-tab editing)
4. Fix any bugs discovered
5. Document usage in test-tiptap route
6. Update PHASE1_POC_IMPLEMENTATION_SPEC.md with completion status

**Deliverables**:
- Production-ready extensions
- Full test coverage
- Documentation updated
- Go/no-go decision for Phase 3

---

## 8. Testing Strategy

### 8.1 Unit Tests

**Test Files**: `frontend/extensions/screenplay/__tests__/`

**Coverage**:
- Each extension renders correctly
- Data attributes set properly
- CSS classes applied
- Commands execute successfully

**Example**:
```typescript
describe('SceneHeading Extension', () => {
  it('renders with correct data-type', () => {
    const editor = createEditor([SceneHeading]);
    editor.commands.setSceneHeading();
    expect(editor.getHTML()).toContain('data-type="scene-heading"');
  });

  it('applies uppercase transformation', () => {
    const editor = createEditor([SceneHeading]);
    editor.commands.setSceneHeading();
    editor.commands.insertContent('int. coffee shop - day');
    expect(editor.getText()).toBe('INT. COFFEE SHOP - DAY');
  });
});
```

### 8.2 Integration Tests

**Test Scenarios**:
1. TAB cycles through all element types correctly
2. Enter transitions follow smart behavior map
3. Direct shortcuts (Cmd+Alt+1-6) set element types
4. Auto-formatting applies in real-time
5. Multiple users can edit simultaneously (Yjs sync)

**Test Route**: `/test-tiptap` (existing POC route)

### 8.3 Manual Testing Checklist

**Basic Functionality**:
- [ ] Create each element type via TAB cycling
- [ ] Verify CSS positioning matches industry standards
- [ ] Test Enter key transitions for each element
- [ ] Verify uppercase auto-formatting (Scene Heading, Character, Transition)
- [ ] Verify parentheses auto-wrap (Parenthetical)
- [ ] Verify colon auto-add (Transition)

**Keyboard Navigation**:
- [ ] TAB cycles through all 6 element types
- [ ] Shift+TAB cycles backwards (if implemented)
- [ ] Cmd+Alt+1-6 shortcuts work
- [ ] Enter creates correct element transitions

**Collaboration**:
- [ ] Open two browser tabs
- [ ] Edit in one tab, see updates in other
- [ ] Type different element types simultaneously
- [ ] Verify no conflicts or sync issues

**Pagination**:
- [ ] Type ~55 lines to trigger page break
- [ ] Verify page break appears correctly
- [ ] Verify elements span across pages properly

---

## 9. Integration with Existing System

### 9.1 Y.js Compatibility

**Status**: ✅ Fully Compatible

**Why**: TipTap extensions create ProseMirror nodes, which Yjs syncs automatically via the Collaboration extension. No additional work required.

**Testing**: Multi-tab editing in test-tiptap route confirms real-time sync.

### 9.2 Autosave System

**Status**: ✅ Already Working

**Why**: Yjs updates are automatically persisted to `script_versions` table by `ScriptYjsPersistence` service. Every keystroke is saved.

**No changes needed**: Autosave is handled at the Yjs layer, not the editor layer.

### 9.3 Pagination Extension

**Status**: ✅ Compatible

**Integration**: Screenplay extensions render as HTML elements with data attributes. Pagination extension can:
1. Calculate line heights
2. Insert page breaks at ~55 lines
3. Preserve element integrity across pages

**Smart Page Breaks** (Phase 3 enhancement):
- Detect orphaned elements (scene headings, character names)
- Force page breaks at appropriate locations
- Insert (MORE)/(CONT'D) indicators for dialogue

### 9.4 Existing Test Route

**File**: `frontend/app/test-tiptap/page.tsx`

**Changes Required**:
1. Import ScreenplayKit
2. Replace StarterKit with ScreenplayKit
3. Import screenplay.css
4. Update UI to show element type selection

**Example**:
```typescript
import { ScreenplayKit } from '@/extensions/screenplay/screenplay-kit';
import '@/styles/screenplay.css';

const editor = useEditor({
  extensions: [
    ScreenplayKit,
    Collaboration.configure({ document: doc }),
    CollaborationCursor.configure({ provider, user }),
    Pagination.configure({ /* ... */ }),
  ],
});
```

---

## 10. Future Enhancements (Phase 3+)

### 10.1 Smart Page Breaks

**Goal**: Prevent orphaned elements and implement continuation indicators

**Implementation**:
- Extend pagination extension with screenplay-aware logic
- Detect scene headings at bottom of page → move to next page
- Detect character names at bottom of page → move with dialogue
- Break dialogue across pages with (MORE)/(CONT'D)
- Keep parentheticals with dialogue

**Estimated Effort**: 2-3 days

### 10.2 Dual Dialogue

**Goal**: Show two characters speaking simultaneously

**Implementation**:
- Create special container node
- Render two dialogue columns side-by-side
- Adjust column widths

**Estimated Effort**: 1-2 days

### 10.3 Additional Elements

**Goal**: Support specialized screenplay elements

**Elements**:
- Shot (camera direction)
- Montage
- Intercut
- Flashback markers

**Estimated Effort**: 1 day per element

### 10.4 Element Validation

**Goal**: Provide real-time feedback on formatting issues

**Validations**:
- Scene heading structure (INT./EXT. LOCATION - TIME)
- Parenthetical length (warn if > 4 words)
- Action paragraph length (warn if > 4 lines)
- Excessive transitions (warn if overused)

**Estimated Effort**: 2-3 days

---

## 11. Success Criteria

### Phase 2 Completion Requirements

**Core Functionality**:
- ✅ All 6 element types implemented and functional
- ✅ TAB cycling works correctly through all elements
- ✅ Smart Enter transitions follow specification
- ✅ CSS positioning matches industry standards (±5mm tolerance)
- ✅ Auto-formatting applies (uppercase, parentheses, colons)

**Integration**:
- ✅ Works with existing Yjs collaboration (multi-user editing)
- ✅ Works with pagination extension (page breaks at ~55 lines)
- ✅ Autosave continues to work (Yjs persistence)
- ✅ No regressions in Phase 1 POC functionality

**Quality**:
- ✅ Unit tests pass for all extensions
- ✅ Manual testing checklist 100% complete
- ✅ No console errors or warnings
- ✅ Code follows TypeScript best practices
- ✅ Documentation complete and accurate

**Performance**:
- ✅ No noticeable lag when typing
- ✅ TAB cycling responsive (<100ms)
- ✅ Collaboration sync remains fast (<200ms)
- ✅ Memory usage stable (no leaks)

### Go/No-Go Decision for Phase 3

**Proceed to Phase 3 (Data Migration) If**:
- All Phase 2 success criteria met
- Extensions feel natural to use (user testing)
- Performance acceptable for 120-page scripts
- No critical bugs discovered

**Pause and Iterate If**:
- Keyboard navigation feels awkward
- CSS positioning significantly off (>10mm)
- Performance issues with large documents
- Critical bugs affecting core functionality

---

## 12. References

### Industry Standards
- **Source**: `docs/SCREENPLAY_FORMATTING_STANDARDS.md`
- **Standards**: Final Draft formatting specifications
- **Positioning**: Element-specific margin and spacing requirements

### TipTap Documentation
- **Extensions Guide**: https://tiptap.dev/docs/editor/extensions/custom-extensions
- **Node Extensions**: https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new
- **Keyboard Shortcuts**: https://tiptap.dev/docs/editor/extensions/functionality/keyboard-shortcuts
- **Commands**: https://tiptap.dev/docs/editor/api/commands

### Existing Implementation
- **Test Route**: `frontend/app/test-tiptap/page.tsx`
- **Yjs Hook**: `frontend/hooks/use-script-yjs-collaboration.ts`
- **Pagination**: `frontend/node_modules/tiptap-extension-pagination/`

---

## Appendix A: Quick Reference

### Element Positioning (from left margin)

| Element | Left Position | Width | CSS Value |
|---------|---------------|-------|-----------|
| Scene Heading | 0" | Full | margin-left: 0 |
| Action | 0" | Full | margin-left: 0 |
| Character | 2.2" | Auto | margin-left: 55.9mm |
| Parenthetical | 1.5" | Auto | margin-left: 38.1mm |
| Dialogue | 1.0" | 3.5" | margin-left: 25.4mm, max-width: 88.9mm |
| Transition | Right | Auto | text-align: right |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Tab | Cycle to next element type |
| Enter | Smart transition to logical next element |
| Cmd/Ctrl+Alt+1 | Scene Heading |
| Cmd/Ctrl+Alt+2 | Action |
| Cmd/Ctrl+Alt+3 | Character |
| Cmd/Ctrl+Alt+4 | Dialogue |
| Cmd/Ctrl+Alt+5 | Parenthetical |
| Cmd/Ctrl+Alt+6 | Transition |

### Auto-Formatting Rules

| Element | Auto-Formatting |
|---------|----------------|
| Scene Heading | Force uppercase |
| Character | Force uppercase |
| Transition | Force uppercase + add colon |
| Parenthetical | Add parentheses |

---

**Document Version**: 1.0
**Last Updated**: October 29, 2025
**Next Review**: After Phase 2 completion
**Status**: Ready for Implementation
