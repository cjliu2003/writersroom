Here’s a tight prompt you can paste:

---

**Fix TipTap editor background (React + Tailwind)**

Issue: With **one page**, a **grey strip** shows below the editor (app shell bg). I want the **editor’s own background** (gutters + between pages) to use that **same grey**, while **pages stay white** with a subtle shadow. No overlays.

**Do:**

* Use one CSS var for the shell grey (copy exact value from current UI): `--app-chrome-bg`.
* Apply `background: var(--app-chrome-bg)` to the **scrollable editor wrapper**.
* Keep `.ProseMirror` transparent; make `.page` white with shadow.
* Ensure the wrapper fills the viewport (`min-height: 100vh`) so no app background peeks through.
* Between-page gaps inherit the same grey.
* Remove/neutralize any absolute white background layers.

**Accept if:**

* One page: bottom area matches between-page grey.
* Many pages: gaps match wrapper grey.
* Page = white, background = grey, no z-index glitches.

**Likely selectors (adjust to our code):**

* Wrapper: `.screenplay-editor-wrapper`
* TipTap root: `.tiptap.ProseMirror.screenplay-editor`
* Pagination: `.rm-with-pagination`
* Page: `.page`
* Break: `.rm-page-break`

**Patch examples:**

```tsx
// wrapper
<div className="screenplay-editor-wrapper min-h-screen overflow-auto">
  <EditorComponent />
</div>
```

```css
:root { --app-chrome-bg: #f1f3f5; /* replace with our exact shell grey */ }

.screenplay-editor-wrapper { background: var(--app-chrome-bg); }

.tiptap.ProseMirror.screenplay-editor,
.ProseMirror { background: transparent; }

.rm-with-pagination { background: transparent; }

.rm-with-pagination .page {
  background: #fff;
  box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 8px 24px rgba(0,0,0,.06);
}

.rm-page-break { background: transparent; }

/* Only if legacy rules force white */
.editor-bg-layer { background: var(--app-chrome-bg) !important; position: static; z-index: auto; }
```

**Check:** Inspect grey source, set `--app-chrome-bg` to that exact value; confirm wrapper bg + 100vh, transparent ProseMirror, white pages.
