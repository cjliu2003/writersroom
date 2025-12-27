Yeah—this is a super common failure mode in agentic setups. Models have a strong **recency/attention bias**: whatever you put *last* (often the last tool output) can “feel” like the most important evidence, even when it isn’t.

Here are the most reliable fixes, in roughly descending order of impact:

## 1) Don’t feed raw tool output directly into the final answer

Instead, add an explicit **“evidence selection + compression” step** between tool-calling and answering.

**Pattern**

1. Tools run (possibly many).
2. A *separate* step produces a short “Selected Evidence” block:

   * ranks results by relevance
   * extracts only the needed snippets
   * discards/mentions irrelevant results
3. Final response is generated **from the Selected Evidence**, not from raw outputs.

This alone usually kills the “last tool dominates” problem.

## 2) Re-rank and assemble context by relevance, not by time

If you currently append tool outputs in chronological order, flip it:

* Compute a relevance score for each tool result (can be simple cosine similarity to the user query, BM25, or even an LLM judge).
* Build the final context as:

  * **User question**
  * **Top evidence (most relevant first)**
  * **Secondary evidence**
  * **Low relevance (optional / omitted)**

Critically: the last tool call should not automatically be the last thing in the model’s input.

## 3) Add “citation discipline” to force synthesis across evidence

In your system/developer prompt, require the model to reference multiple tool results when appropriate:

* “Use the most relevant evidence even if it’s earlier.”
* “If multiple tool results conflict, reconcile or state uncertainty.”
* “Do not base the answer solely on the most recent tool output.”

Even better: require an internal step like:

* “List which tool outputs you used (IDs) and why.”

This nudges it away from blindly parroting the last block.

## 4) Cap and normalize tool outputs (avoid huge attention sinks)

A single long tool output can drown everything else.

Good guardrails:

* Hard cap each tool’s returned tokens (or truncate to top-k snippets).
* Strip boilerplate and repeated text.
* Prefer structured returns (JSON with fields like `answer`, `supporting_quotes`, `confidence`) over walls of text.
* If a tool returns a lot, run a **tool-specific summarizer** before it ever reaches the final model.

## 5) Put the *user question + task* immediately before final generation

This is a simple but effective hack:

Right before asking for the final answer, include:

* the user’s question (verbatim)
* a short “What you must do” instruction
* your ranked evidence

That anchors the model back to the actual task, not the last tool blob.

## 6) Add a “discard irrelevant tool results” mechanism

Make it allowed (and normal) for the agent to say internally:

* “Tool result X is not relevant; exclude it from final context.”

If you always include everything “just in case,” you’re guaranteeing noise.

---

### A concrete template that works well

After tools finish, construct the final prompt like:

* **User Question:** …
* **Answer Requirements:** (short bullets)
* **Selected Evidence (ranked):**

  1. Tool A: (2–6 bullets, only what matters)
  2. Tool B: (2–6 bullets)
* **Other tool outputs:** omitted as low relevance (list IDs)

Then: “Write the final answer using only Selected Evidence + general knowledge.”

---