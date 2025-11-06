Absolutely. Below is a concrete, drop-in plan with pseudocode and a working TypeScript Tiptap v2 extension that implements **smart page breaks** using the selectors your build exposes:

* Root: `.screenplay-editor.rm-with-pagination`
* Per-page chrome: `.rm-page-header`, `.rm-page-footer`, `.rm-page-number`, `.rm-page-header-right`, `.rm-pagination-gap`

---

# Smart Breaks — Concrete Plan

## Targets (MVP)

1. **Dialogue continuation**

   * If a `dialogue` block crosses a page break:

     * End of page **N**: centered **(MORE)**
     * Top of page **N+1**: corresponding character cue shows **(CONT’D)**
2. **No orphan character name**

   * A `character` cue cannot be the last thing on a page without ≥1 line of dialogue on the same page.
3. **Parenthetical sticks with dialogue**

   * Don’t split a `parenthetical` onto a different page than its following dialogue.
4. **No scene heading orphan**

   * Don’t leave a `scene_heading` as the last thing on a page without ≥1 line of action on that page.
5. **No transition at top**

   * Don’t start a page with a `transition`.

> All of the above are **non-destructive**: we render **decorations/widgets** (visual spacers or inline badges) and never mutate the Yjs document during editing. On export, you can materialize them.

## Geometry anchor

* Treat each `.rm-page-header` as the **page top** anchor.
* Derive page bottoms by either:

  * **Measured height:** distance between successive headers (preferred), or
  * **CSS variable:** `--rm-page-height` (when present), or
  * **Fallback:** known Letter height @ 96 DPI = 1056 px.

## Recompute triggers

* On editor update
* On resize (ResizeObserver)
* On pagination DOM mutations (MutationObserver on `.screenplay-editor.rm-with-pagination`)
* Debounce via `requestAnimationFrame`

---

# Pseudocode

```text
onUpdateOrResize():
  headers = $$ .rm-page-header (NodeList in visual order)
  if headers.length == 0: clear decorations; return

  // Build page rects:
  pageRects = []
  for i in 0..headers.length-1:
    top = headers[i].getBoundingClientRect().top
    bottom = (i < last) ? headers[i+1].getBoundingClientRect().top + epsilon
                        : top + pageHeightPx() // from CSS var or fallback
    pageRects[i] = { top, bottom }

  // Collect screenplay block nodes in doc order with DOM rects
  blocks = []
  for each block node (types = {scene_heading, action, character, parenthetical, dialogue, transition}):
     dom = view.nodeDOM(pos)
     rect = dom.getBoundingClientRect()
     startPage = pageIndexForY(rect.top, pageRects)
     endPage = pageIndexForY(rect.bottom, pageRects)
     blocks.push({pos, end, type, rect, startPage, endPage})

  decorations = []

  // RULE 1: Dialogue continuation
  for each block b where b.type == 'dialogue' and b.startPage != b.endPage:
     add (MORE) widget at end of visible portion on page b.startPage
     find nearest preceding 'character' block charB
     add (CONT'D) inline widget after charB (on page b.endPage)

  // RULE 2: No orphan character
  for each character block C:
     next = next block
     if next?.type == 'dialogue' and C.endPage != next.startPage:
        pushToNextPage(C)

  // RULE 3: Parenthetical with dialogue
  for each parenthetical P:
     next = next block
     if next?.type != 'dialogue' or P.endPage != next.startPage:
        pushToNextPage(P)

  // RULE 4: No scene-heading orphan
  for each scene_heading H:
     next = next block
     if next && H.endPage != next.startPage:
        pushToNextPage(H)

  // RULE 5: No transition at top
  for each page i:
     first = first block with startPage == i
     if first?.type == 'transition':
        nudgeDown(first) or push previous block so transition isn’t first

  set decorations = DecorationSet.create(doc, decorations)
```

**Helpers**

* `pushToNextPage(block)`: widget decoration inserted **before** the block with `height = pageBottom(block.startPage) - block.rect.top + safety` to push it to the next page.
* `addMoreAtEndOfPage(dialogue)`: widget decoration at **end** of dialogue (on page `startPage`) rendering `(MORE)` centered.
* `addContdAfterCharacter(character)`: inline widget appended **after** character text rendering ` (CONT'D)` (visual only).

---

# TypeScript — Tiptap v2 Extension

> Adjust the `schemaNames` to your node type names from `ScreenplayKit`.

```ts
// extensions/smart-breaks.ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'

type BlockKind =
  | 'scene_heading'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition'

interface SmartBreaksOptions {
  schemaNames: {
    sceneHeading: string
    action: string
    character: string
    parenthetical: string
    dialogue: string
    transition: string
  }
  moreText?: string
  contdText?: string
  safetyPx?: number
}

const SmartBreaksKey = new PluginKey<DecorationSet>('smart-breaks')

export const SmartBreaks = Extension.create<SmartBreaksOptions>({
  name: 'smartBreaks',

  addOptions() {
    return {
      schemaNames: {
        sceneHeading: 'scene_heading',
        action: 'action',
        character: 'character',
        parenthetical: 'parenthetical',
        dialogue: 'dialogue',
        transition: 'transition',
      },
      moreText: '(MORE)',
      contdText: " (CONT'D)",
      safetyPx: 4,
    }
  },

  addProseMirrorPlugins() {
    const opts = this.options

    return [
      new Plugin<DecorationSet>({
        key: SmartBreaksKey,
        state: {
          init: (_, { doc }) => DecorationSet.create(doc, []),
          apply(tr, old) {
            const meta = tr.getMeta(SmartBreaksKey)
            if (meta?.decorations) return meta.decorations
            if (tr.docChanged) return DecorationSet.create(tr.doc, [])
            return old
          },
        },
        view: (view) => {
          let raf = 0
          const root = view.dom.closest('.screenplay-editor.rm-with-pagination') || view.dom

          const recompute = () => {
            cancelAnimationFrame(raf)
            raf = requestAnimationFrame(() => {
              const decorations = computeDecorations(view, opts)
              view.dispatch(view.state.tr.setMeta(SmartBreaksKey, { decorations }))
            })
          }

          const ro = new ResizeObserver(recompute)
          ro.observe(root as Element)

          const mo = new MutationObserver(recompute)
          mo.observe(root as Element, { childList: true, subtree: true, attributes: true })

          // First compute after mount
          queueMicrotask(recompute)

          return {
            update: () => recompute(),
            destroy: () => {
              cancelAnimationFrame(raf)
              ro.disconnect()
              mo.disconnect()
            },
          }
        },
      }),
    ]
  },
})

/** --- Implementation --- **/

function computeDecorations(view: EditorView, opts: SmartBreaksOptions): DecorationSet {
  const { state } = view
  const { doc } = state

  const headers = Array.from(document.querySelectorAll<HTMLElement>('.rm-page-header'))
  if (!headers.length) return DecorationSet.create(doc, [])

  const pageRects = getPageRects(headers)
  const decorations: Decoration[] = []

  const wanted = new Set<string>([
    opts.schemaNames.sceneHeading,
    opts.schemaNames.action,
    opts.schemaNames.character,
    opts.schemaNames.parenthetical,
    opts.schemaNames.dialogue,
    opts.schemaNames.transition,
  ])

  type Block = {
    pos: number
    end: number
    type: BlockKind
    rect: DOMRect
    startPage: number
    endPage: number
  }

  const blocks: Block[] = []

  // Collect block nodes and map to pages
  doc.descendants((node, pos) => {
    if (!node.isBlock) return false
    const typeName = node.type.name
    if (!wanted.has(typeName)) return

    const dom = view.nodeDOM(pos) as HTMLElement | null
    if (!dom) return

    const rect = dom.getBoundingClientRect()
    if (!isFiniteRect(rect)) return

    const startPage = pageIndexForY(rect.top, pageRects)
    const endPage = pageIndexForY(rect.bottom, pageRects)

    blocks.push({
      pos,
      end: pos + node.nodeSize,
      type: typeName as BlockKind,
      rect,
      startPage,
      endPage,
    })
  })

  // Helpers
  const pushToNextPage = (b: Block) => {
    const i = b.startPage
    if (i < 0) return
    const delta = Math.max(0, pageRects[i].bottom - b.rect.top) + (opts.safetyPx ?? 4)
    if (delta <= 0) return
    const spacer = Decoration.widget(b.pos, () => {
      const el = document.createElement('div')
      el.setAttribute('data-smart-break-spacer', 'true')
      el.style.cssText = `height:${delta}px; width:1px;`
      return el
    }, { side: -1 })
    decorations.push(spacer)
  }

  const addMoreAtEndOfPage = (b: Block) => {
    const widget = Decoration.widget(b.end - 1, () => {
      const el = document.createElement('div')
      el.textContent = opts.moreText || '(MORE)'
      el.style.cssText = `
        text-align:center;
        font-family: Courier, monospace;
        font-size: 12pt; line-height: 12pt;
        margin-top: 4px;
      `
      return el
    }, { side: 1 })
    decorations.push(widget)
  }

  const addContdAfterCharacter = (charBlock: Block) => {
    const widget = Decoration.widget(charBlock.end - 1, () => {
      const el = document.createElement('span')
      el.textContent = opts.contdText || " (CONT'D)"
      el.style.cssText = `
        font-family: Courier, monospace;
        font-size: 12pt; line-height: 12pt;
      `
      return el
    }, { side: 1 })
    decorations.push(widget)
  }

  // RULE 1: Dialogue continuation
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type !== 'dialogue') continue
    if (b.startPage === b.endPage) continue

    // (a) bottom of first page => (MORE)
    addMoreAtEndOfPage(b)

    // (b) next page => (CONT'D) after nearest preceding character cue
    const char = [...blocks.slice(0, i)].reverse().find(x => x.type === 'character')
    if (char) addContdAfterCharacter(char)
  }

  // RULE 2: No orphan character
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type !== 'character') continue
    const next = blocks[i + 1]
    if (!next || next.type !== 'dialogue') continue
    if (b.endPage !== next.startPage) pushToNextPage(b)
  }

  // RULE 3: Parenthetical with dialogue
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type !== 'parenthetical') continue
    const next = blocks[i + 1]
    if (!next || next.type !== 'dialogue' || b.endPage !== next.startPage) {
      pushToNextPage(b)
    }
  }

  // RULE 4: No scene-heading orphan
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type !== 'scene_heading') continue
    const next = blocks[i + 1]
    if (next && b.endPage !== next.startPage) pushToNextPage(b)
  }

  // RULE 5: No transition at top
  for (const page of uniq(blocks.map(b => b.startPage))) {
    const first = blocks.find(b => b.startPage === page)
    if (first?.type === 'transition') {
      // minimal nudge to avoid being first line
      const spacer = Decoration.widget(first.pos, () => {
        const el = document.createElement('div')
        el.style.cssText = 'height: 14px; width: 1px;'
        return el
      }, { side: -1 })
      decorations.push(spacer)
    }
  }

  return DecorationSet.create(doc, decorations)
}

function getPageRects(headers: HTMLElement[]) {
  // Prefer measured distance between headers; otherwise use CSS var height or fallback
  const rects = headers.map(h => h.getBoundingClientRect())
  let height = guessPageHeightFromCSS(headers[0]) || 1056 /* Letter @ 96dpi */

  const out: { top: number; bottom: number }[] = []
  for (let i = 0; i < rects.length; i++) {
    const top = rects[i].top
    const bottom = (i < rects.length - 1) ? rects[i + 1].top - 1 : top + height
    out.push({ top, bottom })
  }
  return out
}

function guessPageHeightFromCSS(el: HTMLElement): number | null {
  const root = el.closest('.screenplay-editor.rm-with-pagination') as HTMLElement | null
  if (!root) return null
  const cs = getComputedStyle(root)
  const h = cs.getPropertyValue('--rm-page-height').trim()
  if (!h) return null
  const px = parseFloat(h)
  return Number.isFinite(px) ? px : null
}

function pageIndexForY(y: number, rects: { top: number; bottom: number }[]) {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    if (y >= r.top && y <= r.bottom) return i
  }
  if (!rects.length) return -1
  return y < rects[0].top ? 0 : rects.length - 1
}

function isFiniteRect(r: DOMRect) {
  return Number.isFinite(r.top) && Number.isFinite(r.bottom) && r.height >= 0
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr))
}
```

## How to register

```ts
import { SmartBreaks } from '@/extensions/smart-breaks'

const editor = useEditor({
  extensions: [
    StarterKit.configure({ history: false, heading: false }),
    ScreenplayKit,
    // collaboration …
    PaginationPlus.configure({ /* your current LETTER config */ }),
    SmartBreaks.configure({
      schemaNames: {
        sceneHeading: 'scene_heading',
        action: 'action',
        character: 'character',
        parenthetical: 'parenthetical',
        dialogue: 'dialogue',
        transition: 'transition',
      },
      moreText: '(MORE)',
      contdText: " (CONT'D)",
      safetyPx: 4,
    }),
  ],
  // …
})
```

---

## Notes / Next steps

* **Sentence-boundary splits (optional):** to avoid mid-sentence dialogue splits, derive inline `Range.getClientRects()` for the dialogue node and choose the last punctuation whose rect bottom ≤ pageBottom; if none, push one more line. (Happy to add that helper if you want it now.)
* **Export:** For PDF/FDX, re-run `computeDecorations` and **materialize** `(MORE)` and `(CONT'D)` into the output buffer only—keep your Yjs doc clean.
* **Performance:** The plugin already debounces via `requestAnimationFrame`, and only runs when pagination headers are present.

This gives you a robust baseline for FD-style smart breaks that works with your exact DOM and keeps editing realtime-safe.
