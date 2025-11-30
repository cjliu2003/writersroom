**What’s going wrong (root causes)**

1. **Early-return bug:** When `textBetween(dialogueStart, rawBreakPos)` is empty you return `max(dialogueStart, rawBreakPos-1)`. If `dialogueStart === rawBreakPos`, this yields **`safeBreakPos === rawBreakPos`**, so “(MORE)” is anchored to **page N+1**.
2. **Off-by-one / feedback:** You binary-search with live decorations applied and also add `accumulatedHeight`. That can shift coords and produce the 1252 vs 1253 discrepancy. You’re measuring on a moving target.
3. **Mid-word insertion:** When the raw break lands inside a word you sometimes keep a position **inside that word**; the widget node splits the inline run, causing stray letters (“e”, “d”) to wrap separately.
4. **Same-pos widgets ≠ page split:** Putting `(MORE)` (side:-1) and `CHARACTER (CONT’D)` (side:1) at the **same doc position** does not guarantee different pages; `side` controls ordering at the *same* position, not pagination. Both can end up on page N+1 once layout reflows.
5. **Block widgets affecting flow:** Your widgets are block DIVs in the inline flow; they change line breaks and page fill, which then invalidates the break you measured.

**What to change (succinct spec)**

* **Always enforce** `safeBreakPos < rawBreakPos`. In the empty-text case:

  ```ts
  let p = rawBreakPos - 1;
  while (p > dialogueStart && !/\s/.test(doc.textBetween(p-1, p, ''))) p--;
  safeBreakPos = (p > dialogueStart) ? p : dialogueStart; // never >= rawBreakPos
  ```
* **Never anchor mid-word.** If the backtrack above doesn’t find whitespace, **push the whole last word** to the next page (i.e., set `safeBreakPos = dialogueStart` so nothing is left on page N).
* **Two-pass measure:** Compute `rawBreakPos` and `safeBreakPos` on a **clean state with no continuation decorations** (plugin temporarily returns none during measurement). Don’t use `accumulatedHeight`; re-measure after inserting.
* **Separate anchors by page, not by `side`:**

  * Place **(MORE)** at `safeBreakPos` but render it **outside text flow** (absolute in page-N footer container), not as a block in the paragraph.
  * Place **CHARACTER (CONT’D)** at **`rawBreakPos`** (or the first non-whitespace on page N+1) and render it in the **page-N+1 header**. Don’t stack both widgets at the same doc position.
* **CSS guards:** Ensure dialogue text uses `white-space: pre-wrap; word-break: normal; overflow-wrap: normal; hyphens: manual;` so words don’t fracture.
* **Log on text, not shifting coords:** Log `dialogueStart`, `rawBreakPos`, and a 20-char window via `textBetween` to verify you’re not mid-word, and call `coordsAtPos` only after decoration insertion for a sanity check—not to decide page.

If Claude implements just these five changes (enforce `<`, backtrack to whitespace, two-pass measurement, page-anchored widgets, and non-flow CSS), the “(MORE) on N+1” and orphaned letters issues should disappear.
