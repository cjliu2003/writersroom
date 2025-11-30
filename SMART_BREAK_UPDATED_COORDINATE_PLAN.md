awesome — since your private pagination package now gives us the missing guarantees, here’s a crisp, end-to-end spec for your Smart Page Breaks extension.

# What you have now (new guarantees you can rely on)

1. Stable page indexing in the DOM

   * Per-page container: `.rm-page-break[data-page-index="N"]` (N = 0..P-1)
   * Page headers:

     * first page: `.rm-first-page-header[data-page-index="0"]`
     * subsequent pages: `.rm-page-header[data-page-index="N"]` (N ≥ 1)

2. A total page height CSS variable

   * On the editor root `.rm-with-pagination`: `--rm-page-height` (pixels, stringified number)

3. Unchanged structural anchors

   * Pagination root: element with `[data-rm-pagination]` inside `.rm-with-pagination`
   * One `.rm-first-page-header` widget rendered outside the page list (still indexed “0”)

These three guarantees remove the “header at 0px” ambiguity and let us build page bands deterministically without guessing order.

---

# SmartBreaks Plugin — spec

## Purpose

Render non-destructive decorations to enforce screenplay pagination rules:

1. Dialogue continuation markers: `(MORE)` at the bottom and `(CONT'D)` after the next page’s character name.
2. No orphan character names (character line can’t appear at the bottom without at least one dialogue line).
3. Parenthetical grouping (parenthetical stays with its dialogue block).
4. Scene heading orphan protection (don’t strand a scene heading at page bottom).
5. No transition at a page top (transitions shouldn’t begin a page).

## Inputs

* ProseMirror view + schema mappings (node names): `sceneHeading`, `action`, `character`, `parenthetical`, `dialogue`, `transition`.
* Pagination DOM from your private package.
* CSS var: `--rm-page-height`.

## Outputs

* A `DecorationSet` composed of:

  * **spacer widgets** (block-level `Decoration.widget(pos, el)`) to push a block to the next page by filling remaining space on the current page.
  * **inline widgets** for `(MORE)` and `(CONT'D)` markers.
  * (optional) **highlight decorations** when a rule is violated but can’t be fixed non-destructively.

---

## Lifecycle & recompute triggers

* Recompute on:

  * `docChanged`
  * Resize of `.rm-with-pagination`
  * Mutations under `[data-rm-pagination]` (page list is rebuilt by pagination plugin)
* Debounce with `requestAnimationFrame` (you already have this pattern).

---

## Geometry model

### Page bands

1. Select headers in **doc order** (thanks to `data-page-index`):

   * `const headers = [...root.querySelectorAll('.rm-first-page-header, .rm-page-header')]`
   * Sort by `Number(h.dataset.pageIndex)`
2. Read `pageHeight = +getComputedStyle(root).getPropertyValue('--rm-page-height')`.
3. For each `i` in 0..P-1, define a band:

   * `top = headers[i].getBoundingClientRect().top`
   * `bottom = top + pageHeight`
   * Store: `{ page: i, top, bottom }`
4. **Sanity guard:** number of `headers` equals number of `.rm-page-break`. If not, skip compute (pagination still mounting).

### Block rects and page assignment

* For each screenplay block node (by type set), get DOM rect: `dom.getBoundingClientRect()`.
* A block’s start page = the **highest** band where `band.top <= block.top < band.bottom`.
  End page computed similarly using `block.bottom`.

---

## Rule evaluation order (tie-breaker = push smallest set)

1. **No Transition at Top**
   If a `transition` block starts at the top of page N (i.e., `block.top - bands[N].top < EDGE_TOL`), push it to page N+1.

2. **Scene Heading Orphan**
   If a `sceneHeading` ends within `ORPHAN_TOL` of bands[N].bottom and the next block is not on the same page, push the `sceneHeading` to page N+1.

3. **No Orphan Character**
   If a `character` block starts near bottom and its first dialogue line would land on the next page, push the `character` block to the next page.

4. **Parenthetical Grouping**
   If a `parenthetical` following a `character` is split across pages, push the `parenthetical` + its associated first dialogue line to next page (or push `character` earlier if that causes fewer pushes).

5. **Dialogue Continuation**
   If a `dialogue` block spans pages:

   * Add `(MORE)` widget at the end of page N (right-aligned, small caps).
   * Add `(CONT'D)` after the **character** name on page N+1 (inline after character).

**Constants** (tuneable via options):

* `EDGE_TOL = 6px` (top-of-page detection)
* `ORPHAN_TOL = 40px` (heading/character near-bottom detection)
* `SAFETY_PX = 4px` (leave breathing room when pushing)

---

## Decoration construction

### 1) Spacer before a block (push-to-next-page)

* Compute remaining space on current page:
  `remain = bands[startPage].bottom - block.bottom - SAFETY_PX`
* Insert a block-level widget immediately **before** the node (at `pos`):

  ```ts
  Decoration.widget(pos, () => {
    const el = document.createElement('div');
    el.style.height = `${Math.max(0, remain)}px`;
    el.style.width = '1px';
    el.style.float = 'none';
    el.style.clear = 'both';
    return el;
  }, { side: -1 })
  ```
* Note: We’re not using `position: absolute` — a simple flowing spacer keeps layout stable inside the pagination container.

### 2) `(MORE)` at page bottom

* Create a widget at a position just before the page break in the split dialogue’s portion that stays on page N:

  ```ts
  Decoration.widget(endPosOnPageN, () => {
    const el = document.createElement('div');
    el.textContent = '(MORE)';
    el.style.fontSize = '0.8em';
    el.style.fontStyle = 'italic';
    el.style.textAlign = 'right';
    el.style.paddingRight = 'var(--rm-margin-right)';
    return el;
  })
  ```

### 3) `(CONT'D)` after character at start of page N+1

* Insert an **inline** widget immediately after the character node’s text on page N+1:

  ```ts
  Decoration.widget(characterTextEndPos, () => {
    const el = document.createElement('span');
    el.textContent = " (CONT'D)";
    el.style.fontSize = '0.9em';
    el.style.fontStyle = 'italic';
    return el;
  }, { side: 1 })
  ```

(Exact `pos` calculations: use node positions from your traversal; for inline, place after the character node content offset. If node structure nests text, resolve with `view.coordsAtPos`/`posAtDOM` helpers as needed.)

---

## Data pipeline (per recompute)

1. **Collect page bands**

   * Using headers + `--rm-page-height` (spec above).

2. **Collect blocks**

   * Walk `doc.descendants`; if `node.isBlock` and `type in wantedTypes`, record:

     * `{ pos, end, type, rect: getBoundingClientRect(), startPage, endPage }`

3. **Build adjacency**

   * For each block, keep reference to `prev`/`next` block (by doc order) for rules like scene-heading and character→dialogue grouping.

4. **Run rules in order**

   * For each violation, decide whether to insert a **spacer** before one anchor block (minimal movement).
   * Accumulate decorations into an array; avoid double-pushing the same block (track pushed `pos`).

5. **Add continuation markers**

   * Scan blocks with `startPage != endPage` and type `dialogue` (with a preceding `character` in the same scene). Emit `(MORE)` and `(CONT'D)` widgets.

6. **Create `DecorationSet`**

   * `DecorationSet.create(state.doc, decorations)` and set via plugin meta (you already do this).

---

## Options (for your plugin)

```ts
interface SmartBreaksOptions {
  schemaNames: {
    sceneHeading: string;
    action: string;
    character: string;
    parenthetical: string;
    dialogue: string;
    transition: string;
  };
  safetyPx?: number;      // default 4
  edgeTolPx?: number;     // default 6
  orphanTolPx?: number;   // default 40
  moreText?: string;      // default "(MORE)"
  contdText?: string;     // default " (CONT'D)"
  enableDebug?: boolean;  // default false
}
```

---

## Performance notes

* Bail out early if:

  * headers count < 2
  * headers count !== page-break count
  * pageHeight is NaN or ≤ 0
* Use a single `ResizeObserver` on `.rm-with-pagination`.
* Throttle recompute with `rAF` (already in your view).
* Avoid reading rects repeatedly — collect all rects in one pass and reuse.

---

## Edge cases & fallbacks

* **Single page**: if headers length = 1, skip rules (no page splits possible).
* **Rapid reflow** (fonts/images): rely on your existing debounce; recompute will settle when layout stabilizes.
* **Very small blocks** (character names alone): protect with `ORPHAN_TOL`.

---

## Debug instrumentation

* `console.table` page bands: `{page, top, bottom}`
* `console.table` blocks: `{type, pos, startPage, endPage, top, bottom}`
* Counters for applied rules: `{pushedBlocks, moreCount, contdCount}`

---

## Test checklist (manual)

1. A scene heading at the last 2 lines of a page moves to next page.
2. A `character` without room for one dialogue line moves to next page.
3. A `parenthetical` split across pages drags to next page with its first dialogue line.
4. A long dialogue spanning pages shows `(MORE)` at bottom of page N and `(CONT'D)` after the character on page N+1.
5. A `transition` never appears at a page top.
6. Resizing the window keeps rules true (spacers and markers recompute).
7. Headers/pages count alignment guard prevents flicker during mount.

---

## Minimal code delta you need to add (summary)

* **Geometry**: `getPageBands()` using `data-page-index` + `--rm-page-height`.
* **Block collection**: traverse doc + map to bands by `getBoundingClientRect()`.
* **Decoration builders**: `pushToNextPage` spacer, `addMoreAtEndOfPage`, `addContdAfterCharacter`.
* **Rule runners**: implement in the order above; short-circuit when a spacer resolves multiple potential violations.

That’s it. With your private package’s stable indices and page-height var, SmartBreaks no longer needs any heuristics or normalization tricks—everything’s deterministic and fast.
