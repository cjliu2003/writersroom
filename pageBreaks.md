Here is the full **Paginated Screenwriting in Slate + Yjs** design draft:

---

## 📝 Paginated Screenwriting in Slate + Yjs

*Design Spec — Live Final Draft-Style Pages*

---

### 🎯 Goals

* Real-time collaboration (slate-yjs + Awareness)
* Accurate screenplay format (Courier 12pt, industry margins/indents)
* True live pagination: **clean page frames**, page numbers, snapping
* Performance suitable for long scripts

---

## 1️⃣ Document / Schema Strategy

Persist only **semantic** screenplay structure in the Yjs+Slate document:

| Element Type                 | Example Behavior             | Width Rules                |
| ---------------------------- | ---------------------------- | -------------------------- |
| `scene_heading`              | Uppercase, slugline          | Full width                 |
| `action`                     | Narrative text               | Full width                 |
| `character`                  | Center-ish name              | Narrow width               |
| `parenthetical`              | Inline notes under character | Narrow width               |
| `dialogue`                   | Block of lines               | Medium width               |
| `transition`                 | Right aligned                | Full width                 |
| `page_break` (optional void) | Hard page break              | System-managed (not typed) |

**NO layout geometry stored** — formatting is deterministic client-side.

---

## 2️⃣ Fonts & Frame Metrics (Non-negotiables)

| Property       | Value                                     |
| -------------- | ----------------------------------------- |
| Font           | Courier Prime / Courier New, Monospace    |
| Size           | 12pt                                      |
| Line height    | **12pt exact** (not fractional)           |
| Page size      | 8.5in × 11in                              |
| Margins        | Top/Bottom 1.0in, Left 1.5in, Right 1.0in |
| Lines per page | ~55 lines (exact once line-height locked) |

**Keep zoom constant** — if UI zoom shifts, apply `transform: scale()` ONLY to the page container — **character metrics must not change**.

---

## 3️⃣ Pagination as Derived Decorations

The **entire pagination layer** is derived from:

> **(block text + block style widths + page constants)**

We produce:

✅ `pageBreak` decorations
✅ Optional line/column debugging guides
✅ Page-indexed frame wrappers

Decoration shape example:

```ts
{
  anchor: { path, offset: 0 },
  focus: { path, offset: 0 },
  pageBreak: true,
  pageIndex: i,
}
```

Not persisted into Yjs → always deterministic across collaborators.

---

## 4️⃣ Incremental Pagination Algorithm (with Backward + Forward Passes)

### 🔍 Detect dirty region

* Inspect applied Slate/Yjs ops
* If no text/structural changes → skip
* Track earliest affected block: `firstDirtyBlockPath`

### ⬅️ Backward stabilization (deletions / shrinkage)

Walk **backwards** one block at a time:

* Check: Has this block’s **page index** changed?
* If yes → continue up
* If no → stop

Determine `stabilizedStartBlock`.

### ➡️ Forward reflow

Walk forward from that block:

1. Compute `lineCount` using cached text hashes
2. Update `pageOfBlock` + `lineOffset`
3. If new value == old **AND** subsequent block boundary matches → **stop** early

✅ Typical pagination update: 1–2 pages only
✅ Idle pass finishes full stability in background

---

## 5️⃣ Performance Tactics

✔ Debounce updates (150–250ms)
✔ Cache `lineCountOfBlock` by `(key, textHash, styleKey)`
✔ Early exit once stable section reached
✔ Idle continuation (`requestIdleCallback`)
✔ Optionally offload line-wrapping to a WebWorker
✔ Minimal DOM updates — re-decorate only changed page boundaries

---

## 6️⃣ Wrapping Model (Courier Monospace Physics)

Either:

* Assume **10 characters per inch** metric (Courier standard), OR
* Calibrate once at mount:

```ts
const width = ctx.measureText("MMMMMMMMMM").width; // 10 Ms
const cpi = 10 / inches(width);
```

Then for each block type:

```ts
maxCols = round(cpi * usableInchesForType)
```

Wrap text to `maxCols` and count physical lines.

---

## 7️⃣ Awareness + Collaboration (slate-yjs)

* Text sync via CRDT (Yjs Doc)
* Presence (cursor, selection) as separate decoration stream:

  ```
  finalDecorations = paginationDecorations ∪ presenceDecorations
  ```
* Pagination automatically stays in sync because it derives from shared doc state

---

## 8️⃣ Export / Print Strategy

* Generate a clean read-only HTML snapshot
* Run **Paged.js** (or Vivliostyle) for:

  * Accurate page breaks & numbering
  * Widow/orphan rules
  * PDF generation

This avoids CPU spikes in edit mode.

---

## 9️⃣ UX Enhancements

* Block cycling (TAB moves Action→Character→Dialogue)
* Automatic uppercase for sluglines/characters
* Keep-with-next rules for character + dialogue (no lonely names)
* Page jump minimization UI (prevent sudden scroll jumps on pagination changes)

---

## 🔁 Edit Responses Summary

| Edit Type             |                      Reaction | Scope of Reflow           |
| --------------------- | ----------------------------: | ------------------------- |
| Typing inside a block |                 Pages forward | Usually ≤ 1–2 pages       |
| Delete text           | Backwards first, then forward | Short ripple              |
| Paste large content   |     Debounce + chunked reflow | Idle continuation         |
| Remote edits          |                Same algorithm | Deterministic convergence |

---

## ✅ Overall result

| Feature                            | Status |
| ---------------------------------- | ------ |
| Google Docs-style page UI          | ✅      |
| Final Draft-accurate text geometry | ✅      |
| Real-time collaboration            | ✅      |
| No full-reflow per keystroke       | ✅      |
| Deterministic & convergent state   | ✅      |

---

### 📦 Next steps

If you want, I can provide:

✅ The `decorate()` function skeleton
✅ Pagination state store with caches
✅ CSS for exact page frames & indents
✅ Demo PR structure for your Slate editor
✅ Unit tests for pagination math

---

If you'd like, I can turn this into:

A) A full **Engineering RFC** for your team
B) A **ticket breakdown** (2–3 sprints worth)
C) A **starter implementation** ready to drop into your repo this week

Which one would you like next?
