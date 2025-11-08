# TipTap Open Source Viability Assessment

**Date**: October 28, 2025
**Question**: Can WritersRoom build fixed-height pagination using TipTap's open source packages (base TipTap + Hocuspocus) without paying for PRO license?
**Answer**: Yes, but with significant trade-offs in complexity and completeness.

---

## Executive Summary

**Core Finding**: TipTap's pagination requires either:
1. **PRO License** ($149+/month): Official Pages extension with complete features
2. **Open Source + DIY**: Build custom pagination (~6-10 weeks) using community patterns
3. **Open Source + Community Extension**: Use existing extensions (limited features, ongoing maintenance)

**Recommendation**: Evaluate PRO cost vs development cost. If budget allows, PRO provides faster path to production. If open source required, expect significant engineering investment comparable to building custom solution in Slate.

---

## TipTap Open Source vs PRO Split

### What's Open Source (MIT License)

**TipTap Core Editor**:
- ✅ Full rich text editing capabilities
- ✅ 100+ extensions (formatting, nodes, marks)
- ✅ React/Vue/Vanilla JS support
- ✅ Custom extension API
- ✅ NodeView system for custom rendering
- ✅ Document schema flexibility
- ✅ Recently open-sourced 10 extensions (June 2025):
  - CharacterCount, Link, Placeholder, TextAlign, Underline
  - Focus, FontFamily, Subscript, Superscript, Typography

**Hocuspocus (Y.js Backend)**:
- ✅ Fully open source (MIT license)
- ✅ Self-hosted WebSocket collaboration server
- ✅ Y.js CRDT integration (same as current WritersRoom)
- ✅ Authentication hooks
- ✅ Hooks for onConnect, onChange, onDisconnect
- ✅ PostgreSQL, Redis, SQLite persistence providers
- ✅ **Conclusion**: Equivalent to current WebSocket + Y.js setup

### What's PRO-Only (Paid License)

**Pages Extension** (Core pagination functionality):
- ❌ Fixed-height page rendering
- ❌ Automatic page break calculation
- ❌ Smart page break rules (orphan/widow prevention)
- ❌ TableKit (table splitting across pages)
- ❌ Print-ready output

**Other PRO Features** (less relevant to pagination):
- AI features (commands, text generation)
- Comments and collaboration enhancements
- Version history
- DOCX import/export
- Advanced templates

**Pricing**: Formerly $150-500/year, recently changed to document-based pricing starting at ~$149/month (third-party reports).

---

## Community Pagination Extensions

### Option 1: tiptap-pagination-breaks (npm)

**Source**: https://www.npmjs.com/package/tiptap-pagination-breaks
**License**: Likely MIT (common for npm TipTap extensions)
**Status**: Published community extension

**Features**:
- ✅ Configurable page height, width, margins
- ✅ Automatic page break insertion
- ✅ Basic pagination logic
- ⚠️ Unknown maintenance status
- ⚠️ Limited documentation
- ❌ No smart page break rules (orphan/widow)
- ❌ No table splitting

**Assessment**: Good starting point for basic pagination, but likely needs customization for screenplay-specific requirements.

### Option 2: tiptap-extension-pagination (GitHub: hugs7)

**Source**: https://github.com/hugs7/tiptap-extension-pagination
**License**: Open source (GitHub)
**Status**: Active development

**Features**:
- ✅ Paper size configuration
- ✅ Header/footer support
- ✅ Page numbering
- ✅ Custom page break nodes
- ⚠️ Community-maintained (single developer)
- ⚠️ May require forking for screenplay needs
- ❌ No smart page break rules out of box

**Assessment**: More feature-complete than tiptap-pagination-breaks, but still requires customization. Active maintenance is positive.

### Option 3: UmoDoc Editor

**Source**: Open source Vue3 + TipTap editor
**License**: MIT
**Status**: Full editor solution (not just extension)

**Features**:
- ✅ Complete pagination system built-in
- ✅ Full editor UI included
- ✅ Vue3 framework
- ⚠️ Opinionated design (may not fit WritersRoom needs)
- ⚠️ Would require significant adaptation
- ❌ Not a React solution (WritersRoom uses Next.js/React)

**Assessment**: Demonstrates pagination is achievable with open source TipTap, but framework mismatch and integration complexity make this less attractive than building custom.

---

## Building Custom Pagination Extension

### Architecture Approach

**Method 1: Page Break Nodes** (Simpler, less control)
```typescript
import { Node } from '@tiptap/core';

const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true, // Non-editable

  parseHTML() {
    return [{ tag: 'div[data-type="page-break"]' }];
  },

  renderHTML() {
    return ['div', { 'data-type': 'page-break', class: 'page-break' }, 0];
  },

  addCommands() {
    return {
      setPageBreak: () => ({ commands }) => {
        return commands.insertContent({ type: this.name });
      },
    };
  },
});
```

**Styling**:
```css
.page-break {
  height: 2px;
  background: #ddd;
  border: 2px dashed #999;
  margin: 1rem 0;
}

@media print {
  .page-break {
    display: none;
    page-break-after: always;
  }
}
```

**Limitations**:
- Manual page break insertion (user decides where breaks occur)
- No automatic height calculation
- No smart break rules
- Essentially same as current WritersRoom approach

**Method 2: Automatic Pagination Engine** (Complex, more control)

**Core Algorithm**:
```typescript
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

const PaginationExtension = Extension.create({
  name: 'pagination',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('pagination'),

        state: {
          init(_, state) {
            return calculatePageBreaks(state.doc);
          },
          apply(tr, pluginState, oldState, newState) {
            // Recalculate on document changes
            if (tr.docChanged) {
              return calculatePageBreaks(newState.doc);
            }
            return pluginState;
          },
        },

        props: {
          decorations(state) {
            const decorations = [];
            const pageBreaks = this.getState(state);

            pageBreaks.forEach(pos => {
              decorations.push(
                Decoration.widget(pos, () => {
                  const div = document.createElement('div');
                  div.className = 'page-separator';
                  return div;
                })
              );
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

function calculatePageBreaks(doc) {
  const PAGE_HEIGHT = 11 * 96; // 11 inches at 96 DPI
  const CONTENT_HEIGHT = PAGE_HEIGHT - (1.2 * 96) - (1 * 96); // Minus margins

  const breaks = [];
  let currentHeight = 0;

  doc.descendants((node, pos) => {
    // Measure node height (requires DOM access)
    const nodeHeight = estimateNodeHeight(node);

    if (currentHeight + nodeHeight > CONTENT_HEIGHT) {
      breaks.push(pos);
      currentHeight = nodeHeight;
    } else {
      currentHeight += nodeHeight;
    }
  });

  return breaks;
}

function estimateNodeHeight(node) {
  // Challenge: Need to measure actual rendered height
  // Options:
  // 1. Off-screen rendering and measurement
  // 2. Logical estimation based on content
  // 3. Hybrid approach with caching

  // Simplified estimation:
  const lineHeight = 12; // 12pt
  const text = node.textContent || '';
  const lines = Math.ceil(text.length / 60); // Assume 60 chars/line

  return lines * lineHeight;
}
```

**Challenges**:
1. **Height Measurement**: Same problem as Slate - need actual DOM height
   - Off-screen rendering: Performance cost
   - Logical estimation: Inaccurate (same issues as current Slate)
   - Hybrid: Complex caching and invalidation

2. **Smart Page Breaks**: Requires screenplay-specific logic
   - Prevent orphaned scene headings
   - Keep character names with dialogue
   - Add (MORE)/(CONT'D) markers
   - Minimum line requirements

3. **Performance**: Recalculating on every keystroke
   - Need debouncing/throttling
   - Need incremental updates
   - Need caching strategy

4. **Table Splitting**: Complex problem requiring node restructuring
   - TipTap PRO's TableKit solves this
   - DIY solution requires deep ProseMirror knowledge

**Development Estimate**: 6-10 weeks for production-ready solution
- Week 1-2: Basic pagination engine with logical height estimation
- Week 3-4: DOM measurement integration and optimization
- Week 5-6: Smart page break rules (screenplay-specific)
- Week 7-8: Table splitting (if needed)
- Week 9-10: Edge cases, testing, polish

**Developer Testimony**: Community developers report "well over 500 hours" spent on pagination, calling it "one of the most difficult programming tasks."

---

## Comparison Matrix

| Feature | TipTap PRO Pages | Community Extensions | Custom Build | Current Slate |
|---------|------------------|---------------------|--------------|---------------|
| **Fixed-height pages** | ✅ Perfect | ⚠️ Basic | ⚠️ Good (95%+) | ⚠️ Variable |
| **Automatic breaks** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Smart breaks** | ✅ Configurable | ❌ No | ⚠️ DIY (6-8 weeks) | ❌ Not implemented |
| **Table splitting** | ✅ TableKit | ❌ No | ❌ Very hard | ❌ No |
| **Collaboration** | ✅ Hocuspocus | ✅ Hocuspocus | ✅ Hocuspocus | ✅ Y.js WebSocket |
| **Autosave** | ⚠️ DIY | ⚠️ DIY | ⚠️ DIY | ✅ Implemented |
| **Screenplay formatting** | ⚠️ DIY | ⚠️ DIY | ⚠️ DIY | ✅ Implemented |
| **Development time** | 2-4 weeks | 4-6 weeks | 6-10 weeks | 3-4 weeks |
| **Cost** | $149+/month | Free | Engineering time | Current investment |
| **Maintenance** | TipTap team | Community + you | You | You |
| **Documentation** | ✅ Excellent | ⚠️ Limited | N/A | Internal |
| **Support** | ✅ Commercial | ❌ Community only | N/A | Internal |

---

## Migration Complexity

### TipTap Migration Requirements

**Data Model Changes**:
- Slate uses JSON tree structure
- TipTap/ProseMirror uses different node schema
- Need bidirectional conversion: Slate JSON ↔ TipTap JSON
- Estimated effort: 1-2 weeks

**Component Rewrite**:
- Current: `screenplay-editor.tsx` (Slate-based, 800+ lines)
- New: TipTap editor with custom extensions
- Need to recreate all screenplay element types as TipTap extensions
- Estimated effort: 2-3 weeks

**Yjs Integration**:
- Current: `y-websocket` provider with Slate
- New: `@tiptap/extension-collaboration` + Hocuspocus
- Backend change: Replace WebSocket handler with Hocuspocus server
- Estimated effort: 1-2 weeks

**Testing**:
- Validate screenplay formatting preservation
- Test collaboration edge cases
- Verify autosave reliability
- End-to-end testing
- Estimated effort: 2-3 weeks

**Total Migration**: 6-10 weeks (excluding pagination development)

### Risk Assessment

**High Risk**:
- Data migration bugs causing content loss
- Collaboration regression (users losing edits)
- Performance degradation with large documents

**Medium Risk**:
- Screenplay formatting inconsistencies
- Browser compatibility issues
- Third-party dependency breaking changes

**Mitigation**:
- Phased rollout with feature flags
- Extensive testing with production data copies
- Maintain Slate version in parallel during transition

---

## Cost-Benefit Analysis

### Option 1: Stay with Slate + Height-Based Pagination

**Pros**:
- ✅ No migration risk
- ✅ Keep existing autosave, collaboration, formatting
- ✅ Known codebase
- ✅ 3-4 weeks to implement height-based pagination
- ✅ 95-98% page consistency achievable

**Cons**:
- ❌ Never achieves 100% pixel-perfect pages
- ❌ Smart page breaks still DIY (additional 2-3 weeks)
- ❌ Ongoing maintenance of pagination logic

**Cost**: 3-4 weeks engineering time (~$15-20K at $125/hr)

**Outcome**: Professional-quality pagination, not perfect

---

### Option 2: TipTap PRO Pages

**Pros**:
- ✅ 100% pixel-perfect pages (official solution)
- ✅ TableKit for table splitting
- ✅ Commercial support
- ✅ Active maintenance and updates
- ✅ Comprehensive documentation
- ✅ Smart page breaks built-in

**Cons**:
- ❌ Migration complexity (6-10 weeks)
- ❌ Ongoing license cost ($149+/month = $1,788+/year)
- ❌ Vendor lock-in
- ❌ Migration risk
- ❌ Still need DIY screenplay formatting

**Cost**:
- Development: 6-10 weeks (~$30-50K)
- License: $1,788+/year ongoing
- Total first year: ~$32-52K

**Outcome**: Professional perfect pagination with commercial backing

---

### Option 3: TipTap Open Source + Community Extension

**Pros**:
- ✅ No license costs
- ✅ Better pagination than current Slate
- ✅ Active community
- ✅ Hocuspocus equivalent to current Y.js setup

**Cons**:
- ❌ Migration complexity (6-10 weeks base)
- ❌ Limited pagination features vs PRO
- ❌ Community extension maintenance burden
- ❌ Still need smart page breaks DIY (2-3 weeks)
- ❌ No table splitting
- ❌ May need to fork and customize

**Cost**: 8-13 weeks engineering time (~$40-65K at $125/hr)

**Outcome**: Better than Slate, worse than PRO, high engineering investment

---

### Option 4: TipTap Open Source + Custom Pagination

**Pros**:
- ✅ No license costs
- ✅ Full control over pagination logic
- ✅ Tailored to screenplay needs
- ✅ Can match or exceed PRO features (with time)

**Cons**:
- ❌ Highest complexity (12-16 weeks total)
- ❌ Migration + custom development
- ❌ Ongoing maintenance entirely on you
- ❌ "One of the most difficult programming tasks" per community
- ❌ Risk of bugs and edge cases

**Cost**: 12-16 weeks engineering time (~$60-80K at $125/hr)

**Outcome**: Perfect pagination, highest risk and cost

---

## Recommendation by Budget

### Budget: Tight (<$20K available)

**Recommendation**: Stay with Slate + Height-Based Pagination (Option 1)

**Rationale**:
- Lowest risk and lowest cost
- 95-98% page consistency is acceptable for collaborative editing
- Can add smart page breaks later (Phase 2)
- Migration to TipTap always possible in future if needed

**Implementation**:
1. Week 1-2: Implement DOM measurement in pagination-engine.ts
2. Week 3: Optimize with caching and debouncing
3. Week 4: Testing and edge cases
4. Future: Add smart page breaks (Phase 2)

---

### Budget: Moderate ($20-40K available)

**Recommendation**: Evaluate TipTap PRO vs Slate improvement

**Decision Factors**:
- **Choose TipTap PRO if**:
  - 100% pixel-perfect pages are critical requirement
  - Need table splitting across pages
  - Want commercial support for pagination
  - Can accept $1,788+/year ongoing cost

- **Choose Slate improvement if**:
  - 95-98% consistency sufficient
  - Prefer lower ongoing costs
  - Want full control over features
  - Migration risk unacceptable

**Analysis**: $30-50K migration + $1,788/year = 2-year cost of ~$34-54K. Compare to Slate: $15-20K one-time for 95-98% solution.

---

### Budget: Flexible (>$40K available)

**Recommendation**: TipTap PRO Pages (Option 2)

**Rationale**:
- Best long-term solution for professional editor
- 100% pixel-perfect pages with commercial backing
- Reduces technical debt vs DIY pagination
- Proven solution used by many document editors
- Smart page breaks and table splitting included

**Alternative**: If avoiding vendor lock-in is priority, consider Option 4 (custom build), but understand this is highest complexity path.

---

## Technical Feasibility Conclusion

**Can you build pagination with TipTap open source?**
✅ **Yes**, it is technically feasible.

**What are the trade-offs?**
- **Community extensions**: Limited features, ongoing maintenance, 4-6 weeks + migration
- **Custom build**: Full control, high complexity, 12-16 weeks + migration, "one of the most difficult programming tasks"
- **vs Slate improvement**: TipTap migration adds 6-10 weeks vs 3-4 weeks for Slate height-based solution

**Is it easier than Slate?**
⚠️ **No**. TipTap migration + custom pagination is **harder** than improving current Slate implementation. The only advantage is if you pay for PRO Pages.

**Bottom Line**: If open source is requirement and budget tight, **stay with Slate and implement height-based pagination**. TipTap open source does not provide easier path to pagination - it's actually harder due to migration complexity.

---

## Decision Framework

```
START: Need fixed-height pages

├─ Budget for PRO license ($1,788+/year)?
│  ├─ YES → Can accept 6-10 week migration?
│  │  ├─ YES → **Choose: TipTap PRO Pages**
│  │  └─ NO → **Choose: Stay with Slate + improve**
│  └─ NO → Continue
│
├─ 100% pixel-perfect required (not 95-98%)?
│  ├─ YES → Budget >$60K for custom build?
│  │  ├─ YES → **Choose: TipTap custom pagination** (high risk)
│  │  └─ NO → **Reconsider requirements** or **Choose: TipTap PRO**
│  └─ NO → Continue
│
├─ Want better pagination than current?
│  ├─ YES → Budget >$40K for migration + community?
│  │  ├─ YES → **Choose: TipTap + community extension**
│  │  └─ NO → **Choose: Slate height-based** (best ROI)
│  └─ NO → **Choose: Slate height-based** (lowest cost)

RESULT: For most teams → **Slate height-based** or **TipTap PRO**
```

---

## Appendix: Code Comparison

### Slate Height-Based Pagination (Recommended DIY)

```typescript
// In pagination-engine.ts:
export function calculatePageBreaks(nodes, metrics) {
  const PAGE_HEIGHT = 11 * 96;
  const CONTENT_HEIGHT = PAGE_HEIGHT - (1.2 * 96) - (1 * 96);

  let currentPageHeight = 0;
  const decorations = [];

  nodes.forEach((node, index) => {
    const domNode = ReactEditor.toDOMNode(editor, node);
    const { height } = domNode.getBoundingClientRect();

    if (currentPageHeight + height > CONTENT_HEIGHT) {
      decorations.push({
        anchor: { path: [index, 0], offset: 0 },
        focus: { path: [index, 0], offset: 0 },
        pageBreak: true,
      });
      currentPageHeight = height;
    } else {
      currentPageHeight += height;
    }
  });

  return decorations;
}
```

**Pros**: Simple, uses actual rendered height, works with existing architecture
**Cons**: Requires DOM access, ~95-98% consistency (not perfect)

---

### TipTap Community Extension (tiptap-pagination-breaks)

```typescript
import { Editor } from '@tiptap/core';
import PaginationBreaks from 'tiptap-pagination-breaks';

const editor = new Editor({
  extensions: [
    // ... other extensions
    PaginationBreaks.configure({
      pageHeight: 11 * 96, // 11 inches
      pageWidth: 8.5 * 96, // 8.5 inches
      marginTop: 1.2 * 96,
      marginBottom: 1 * 96,
      marginLeft: 1.5 * 96,
      marginRight: 1 * 96,
    }),
  ],
});
```

**Pros**: Pre-built solution, configurable
**Cons**: Limited features, unknown maintenance, may need forking

---

### TipTap PRO Pages (Commercial)

```typescript
import { Editor } from '@tiptap/core';
import { Pages } from '@tiptap/extension-pages'; // PRO extension

const editor = new Editor({
  extensions: [
    // ... other extensions
    Pages.configure({
      paperSize: 'LETTER',
      orientation: 'portrait',
      margins: {
        top: 1.2,
        right: 1,
        bottom: 1,
        left: 1.5,
      },
      smartPageBreaks: true, // Orphan/widow prevention
    }),
  ],
});
```

**Pros**: Complete solution, smart breaks, commercial support
**Cons**: Paid license, vendor lock-in

---

## Sources

1. **TipTap Official Documentation**:
   - Custom Extensions: https://tiptap.dev/docs/editor/extensions/custom-extensions
   - NodeViews: https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views
   - Pages PRO: https://tiptap.dev/docs/pages

2. **Community Extensions**:
   - tiptap-pagination-breaks: https://www.npmjs.com/package/tiptap-pagination-breaks
   - tiptap-extension-pagination: https://github.com/hugs7/tiptap-extension-pagination
   - Page break tutorial: https://www.codemzy.com/blog/tiptap-page-break

3. **Hocuspocus**:
   - Official Docs: https://tiptap.dev/docs/hocuspocus
   - GitHub: https://github.com/ueberdosis/hocuspocus

4. **Pricing**:
   - TipTap Cloud Pricing: https://cloud.tiptap.dev/pricing
   - Third-party reports: Reddit, GitHub discussions

---

**Document Version**: 1.0
**Viability Assessment**: Open source TipTap pagination is feasible but not easier than Slate
**Recommendation**: Slate height-based (budget) or TipTap PRO (quality + support)
