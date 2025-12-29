Inline rename (edit-in-place) is usually the best fit for your vibe: fast, minimal, “writer tool” feeling. But you still want a **menu entry to trigger it** so people discover the feature and you avoid accidental edits.

### Best pattern for you: **Menu → Inline rename**

* In the chat switcher list, each row has `…`
* Click `…` → **Rename**
* That row immediately turns into an inline text field with the current title selected
* `Enter` = save, `Esc` or click away = cancel

Why this is best:

* **Minimal UI** (no extra modal)
* **Fast** (rename without context switch)
* **Low cognitive load** for writers (it behaves like renaming a document tab/file)
* Avoids accidental renames because the edit mode is explicit


### Small UX details that make it feel polished

* **Auto-focus + select-all** on entry so they can type immediately
* **Allow blank?** If blank, revert to auto-title (“New chat” or first user message)
* **Character limit** (e.g., 60) with graceful truncation in the list
* Show truncated titles with hover tooltip in desktop

### Quick recommendation

Keep the `Rename` action in the `…` menu (like your screenshot), but don’t open another popup—**switch the row to inline edit**. That’s the cleanest + most writer-friendly.
