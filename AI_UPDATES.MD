I read your report, and you’re right that the “increase max_tokens” ideas are mostly bandaids. The root problems are: **(1) the tool loop is allowed to “talk” while it’s supposed to “act,” (2) you’re appending raw tool outputs/history in ways that amplify recency bias, and (3) your RAG-only default output cap is accidentally tiny**. All of that compounds as the conversation goes on.

Below are fixes I’d prioritize for a system exactly like yours (MCP tools + screenplay retrieval + multi-turn agent). I’ll reference specifics from your flow where relevant. 

---

## P0: Fix the truncation + “partial return” failure modes (real bugs, not tuning)

### 1) RAG-only mode is effectively capped at 600 unless client overrides

Your report shows `max_tokens=request.max_tokens or 600` in RAG-only mode. That guarantees truncation for any meaningful answer unless the frontend always sends `max_tokens`. 

**Fix**

* Raise the default for RAG-only (e.g., 1200–2000), *and* have the client always pass an explicit value.

### 2) You’re only returning `response.content[0].text` in `AIService.generate_response`

That’s fragile: Anthropic responses can contain multiple content blocks, and even in non-tool calls you can end up dropping text if it’s not in the first block. Your report shows `response.content[0].text`. 

**Fix**

* Concatenate **all** `text` blocks in `response.content`, not just `[0]`.

### 3) In the tool loop, `stop_reason != "tool_use"` immediately returns the first text block

Per your snippet, if a loop iteration ends (including `max_tokens`) you return the first `text` block and exit. 
That means:

* if the model was *mid-plan* and got cut off → you prematurely return junk to the user
* you never attempt a “continue” recovery

**Fix**

* Treat `stop_reason == "max_tokens"` during tool loop as “need to continue planning,” not “return to user.”
* Add an automatic recovery step: re-call with a short “Continue tool planning; output tool calls only.” (No user-facing message yet.)

---

## P1: Make the tool loop “tool-only” (this removes 80% of your drift + truncation)

Right now, each tool-loop step has `max_tokens=600`. Your report explicitly calls out the risk: the model sometimes tries to answer + call tools and gets cut off. 

**Best practice:** during the loop, force the assistant to output **only tool calls (and optionally a tiny plan)**. No prose answers until the final synthesis.

Concretely:

* Add a hard instruction:
  “In tool loop iterations, do not write the user-facing answer. Either call tools or say you have enough info.”
* Enforce it in code: if the assistant emits >N characters of text in a tool iteration, discard and retry with a stricter reminder.

This matters more than increasing `TOOL_LOOP_MAX_TOKENS`.

---

## P1: Stop “reversing tool results” and replace with evidence assembly

Your loop appends tool results “reversed for recency bias.” 
That’s a clever hack, but it’s still a hack: the model will overweight *whatever is most salient / longest / most recent*, and raw tool dumps remain the problem.

**Replace with:**

1. Execute tools
2. Convert results into a **single structured “Evidence” object** (ranked + trimmed)
3. Feed only that evidence into synthesis

Example evidence structure:

* `evidence[ ]`: `{source_tool, scene_ids, snippet, why_relevant}`
* cap snippets (e.g., 600–1200 chars each)
* order by relevance score (embedding similarity to the user question)

Also: your system prompt says “give equal weight to every tool result.” 
That instruction is *counterproductive* in practice—some tool outputs are noise. Better: **weight by relevance**, and allow discarding.

---

## P1: Batch your tools (yes, do it)

You’re seeing sequential `get_scene` calls. That’s exactly the case where batching is the “correct” primitive.

Add:

* `get_scenes(scene_indices: int[], fields: ["summary","text"], max_chars_per_scene)`
* `get_scene_context_batch(scene_indices: int[], window_size, max_chars_per_scene)`
* and consider merging `get_scene` + `get_scene_context` into one tool with parameters.

This reduces:

* latency (one round trip)
* tokens (one tool schema + one tool_result)
* recency problems (one unified result)

---

## P2: Fix “independent question” contamination (history isn’t “context,” it’s training signal)

Your current prompt says history “may not be relevant,” but you still include it, so the model uses it. 

**Best practice:** don’t send history unless you’ve decided it’s relevant.

Implement a tiny “mode gate” before context building:

* `mode = follow_up | new_topic`
* If `new_topic`: include **0** prior turns (or just a 1–2 sentence stable user preference summary), then proceed with fresh retrieval.

This will also improve cache hit stability because you won’t keep appending changing history to the prompt prefix.

---

## Model / cost recommendations (pragmatic ladder)

You currently use `claude-haiku-4-5` for everything. 
That’s fine, but agentic systems usually do better with a “ladder”:

* **Haiku (cheap):** intent classification, tool selection, evidence compression
* **Stronger model:** final synthesis only when needed (complex narrative analysis, multi-source reasoning)

If you consider switching to OpenAI: prompt caching is automatic there (no cache_control blocks needed), which can simplify your pipeline. ([OpenAI Platform][1])
OpenAI also publishes “cached input” pricing explicitly (useful if your prefix is stable). ([OpenAI Platform][2])

Anthropic caching: `cache_control: {"type":"ephemeral"}` is currently the supported cache type and has a short lifetime (commonly documented as ~5 minutes), so the “~90% cost reduction” claim only holds when traffic patterns reuse the prefix within that window. ([Claude][3])

---

## Output length: stop relying on token caps

Even with `FINAL_SYNTHESIS_MAX_TOKENS=1200`, the model will ramble and then get cut off. 

**Instead:**

* Force a response format: e.g. “5 bullets max, 1 sentence each.”
* Add a word budget (“≤180 words”)—models follow this better than token numbers.
* Put “most important first” instruction (truncation-safe).

---

## A recommended architecture for your exact flow

**Tool loop**

1. Plan/tools (tool-only)
2. Execute tools (batch)
3. Evidence builder (compress + rank + discard)
4. Synthesis (short, formatted)

**Key principle:** the synthesis step should see *clean evidence*, not raw history + raw tool dumps.

---

If you want, paste one real failing trace (user message + tool calls + tool outputs sizes + final answer). With that, I can propose:

* the exact “Evidence JSON schema” I’d use,
* the batching tool signatures,
* and a concrete gating heuristic for new-topic vs follow-up tuned to screenplay chat.

[1]: https://platform.openai.com/docs/guides/prompt-caching?utm_source=chatgpt.com "Prompt caching | OpenAI API"
[2]: https://platform.openai.com/docs/pricing?utm_source=chatgpt.com "Pricing | OpenAI API"
[3]: https://platform.claude.com/docs/en/build-with-claude/prompt-caching?utm_source=chatgpt.com "Prompt caching - Claude Docs"
