Totally aligned with your framing: this is mainly a **routing + state** problem, not “the model is bad.”

What you want is a router that can reliably answer four questions *before* you build context / call tools:

1. **Is this a follow-up to the current thread or a new topic?**
2. **Is it about *this script* (even implicitly), general (not script-specific), or hybrid?**
3. **Is the user asking for *suggestions* vs an actual *rewrite/revision*?**
4. **If it’s script-related but underspecified, what’s the *best default anchor* (scene/character/thread) to fetch?**

Below is a concrete approach that fixes all four failure types without making the system brittle.

---

## 1) Conversation continuity: stop treating “history” as the mechanism

Instead of “include more history,” use **explicit conversation state** + **targeted retrieval**.

### A. Maintain a small “Working Set” state object per conversation

Update it after every assistant turn.

**Example state**

* `active_scene_ids`: last 1–3 scenes referenced or retrieved
* `active_characters`: last 1–5 character names referenced
* `active_plot_threads`: last 1–3 threads referenced
* `last_user_intent`: e.g., “pacing critique”, “dialogue improvement”
* `last_assistant_commitment`: e.g., “I suggested cutting scene 12’s opener”

Then continuity is not “did we include 40 turns,” it’s “do we have anchors for pronouns and callbacks.”

### B. Add a dedicated Continuity Classifier (cheap + strict)

Have a small classification step that outputs **JSON only**:

* `continuity`: `FOLLOW_UP | NEW_TOPIC | UNCERTAIN`
* `refers_to`: `SCENE | CHARACTER | THREAD | PRIOR_ADVICE | NONE`
* `confidence`: 0–1
* `needs_disambiguation`: boolean (rare)

**Hard rule:**
If `NEW_TOPIC`, you **drop prior turns** (except the state object) and do *not* pull old conversation snippets.

### C. When follow-up is detected, retrieve only the relevant prior snippets

Don’t re-inject the whole chat. Store prior turns in a vector index and retrieve top-k *only when needed* (e.g., `refers_to=PRIOR_ADVICE`).

This is what eliminates “it keeps talking about the first unrelated question.”

---

## 2) Question understanding: introduce a 3-way domain router

Right now you basically have “script/tool” vs “not.” You need:

* `SCRIPT`: user wants script-grounded answer
* `GENERAL`: user wants general knowledge/craft/brainstorming not tied to script
* `HYBRID`: answer generally **and** optionally apply to the script

### The key: bias toward script *when ambiguous*, but verify cheaply

This solves your “if we don’t explicitly mention the script, it doesn’t reference it.”

**Practical strategy**

* If a script is loaded and the question is plausibly script-related (“is this character arc working?”, “how can I improve this dialogue?”), treat it as `SCRIPT` by default.
* Do a **lightweight `search_script` probe** (top_k=3, low max_chars) using the user question + any `active_characters/scenes` from state.
* If the probe returns nothing above a similarity threshold → fall back to `GENERAL`.

So you get:

* script grounding when it’s there
* general answers when the script doesn’t match

---

## 3) “It likes offering revisions” → fix with response-mode gating

Yes, mostly a system/developer prompt change, but do it with a **request-type classifier** so it’s consistent.

### Add `request_type` classification

`SUGGEST | REWRITE | DIAGNOSE | BRAINSTORM | FACTUAL`

**Rewrite is only allowed if explicitly asked** (words like “rewrite,” “revise,” “draft,” “give me alt lines,” “make this better by rewriting”).

### Response contract (important)

* Default for writers: **diagnosis + suggestions**, not full rewrites.
* If user did not ask for a rewrite, do:

  * “What’s working”
  * “What’s not”
  * “2–6 concrete edits you can make”
  * “If you want, paste the lines and I can rewrite them” (optional, short)

This will feel *much* more like a co-writer rather than a “rewrite bot.”

---

## 4) Tooling / MCP best practices for your specific toolset

You’re already moving this direction, but here’s the “clean” ideal:

### A. Batch within tools for same-tool repeats

* `get_scenes(scene_ids[])`
* `get_scene_context_batch(scene_ids[])`

### B. Allow multi-tool-per-turn, but cap it

Yes: let the model emit multiple tool calls in one planning turn **when independent**, but add guardrails:

* max 3 tool calls per planning step
* max 1 “expensive” tool (`analyze_pacing`, `get_plot_threads`) unless user explicitly asked for it
* require a one-line “why” per tool call (structured)

### C. Evidence assembly step stays mandatory

Even with better batching, keep:

* tool results → ranked EvidenceItems → final synthesis
  And **do not** show raw loop transcripts to the final synthesis step (that’s where contamination sneaks back in).

---

## Putting it together: the router you want

A single small “Router” call (or heuristics + tiny model) returns:

* `continuity`: FOLLOW_UP / NEW_TOPIC
* `domain`: SCRIPT / GENERAL / HYBRID
* `request_type`: SUGGEST / REWRITE / DIAGNOSE / etc.
* `anchors`: {scene_ids?, character_names?, thread_ids?}

Then:

### If GENERAL

* no tools
* no script context (maybe just “you’re a screenwriting assistant”)
* concise answer

### If SCRIPT

* run script probe / tools
* answer grounded in EvidenceItems
* default to SUGGEST/DIAGNOSE unless REWRITE requested

### If HYBRID

* answer general first (short)
* then “Applied to your script:” with tool-grounded points (short)

