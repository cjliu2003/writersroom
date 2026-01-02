Not bad design at all — for a writing assistant, it’s often *good* design.

Continuity detection is inherently ambiguous (especially in creative chats where “that” could refer to tone, pacing, a character, or your last suggestion). A lightweight UI control can remove a whole class of failures and make the experience feel more “intentional,” not less magical.

## What a button solves (and why users won’t hate it)

* Eliminates wrong-thread contamination (“why are you still talking about scene 12?”).
* Lets users intentionally “pivot” without paying a cognitive tax (“new question: how do I format montages?”).
* Avoids you over-relying on classifier thresholds that will always be imperfect.

In practice, users generally appreciate *optional* control when the assistant is operating on a large artifact (their script) and conversation context matters.

## Best UI patterns that work well

### 1) A subtle “Context mode” pill (recommended)

Right above the input box:

* **Continue thread** (default)
* **New topic** (one click)

Keep it sticky per conversation, but auto-reset to “Continue” after a new topic if you want.

### 2) Auto-detect + confirm only when uncertain (best of both worlds)

Your classifier returns: `FOLLOW_UP | NEW_TOPIC | UNCERTAIN`.

* If confident: do it silently.
* If **UNCERTAIN**: show a small inline prompt:

  * “Continue the previous thread or start a new topic?”
  * [Continue] [New topic]

This makes the UI show up only when it’s actually useful, so it doesn’t feel like friction.

### 3) “New topic” command shortcut

Let power users type:

* `/new …`
* or `new topic: …`

This is surprisingly popular with writers.

## How to implement without breaking flow

Treat the toggle as a **hard constraint** on context building:

* **New topic:** do not include previous turns except a tiny stable “user prefs” summary (optional) and your script index (tools still available).
* **Continue:** include working-set anchors (active scenes/chars/threads) + last few relevant turns.

Also consider creating an internal **thread_id** per topic so you can store multiple threads in the same chat UI.

## One important nuance for your product

Even when the user clicks **New topic**, they may still mean “new question about the same script.” So the toggle should control **conversation continuity**, not “script vs general.”

That’s why pairing this with your `domain = SCRIPT | GENERAL | HYBRID` router is ideal:

* “New topic + SCRIPT” = new thread, same script grounding
* “New topic + GENERAL” = no script grounding

## Copy that doesn’t feel technical

Avoid “continuity detection.” Use writer-friendly labels:

* **Continue** / **New thread**
* or **Same topic** / **Switch topic**
* or **Keep context** / **Start fresh**

---

If you want a simple rule: ship **Auto-detect + confirm on UNCERTAIN**. It’s low friction, feels smart, and gives users control exactly when the model is most likely to mess up.
