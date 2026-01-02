# AI System Improvements Analysis

Analysis of current system gaps and proposed improvements for conversation continuity, question classification, and response formatting.

---

## Current System Summary

| Component | Current State | Gap |
|-----------|---------------|-----|
| **Intent Classification** | 4 types: LOCAL_EDIT, SCENE_FEEDBACK, GLOBAL_QUESTION, BRAINSTORM | No GENERAL (non-script), no request type |
| **Topic Detection** | Binary: FOLLOW_UP / NEW_TOPIC via patterns | No `refers_to` field, no working set tracking |
| **Conversation History** | Sliding window of 4 messages + summary | No vector retrieval, loses entity context |
| **Tool Decision** | Keyword-based + intent-based rules | No domain awareness (always assumes script) |
| **Response Formatting** | Intent-specific synthesis instructions | No SUGGEST vs REWRITE gating |

---

## Identified Issues

### 1. Continuity Management
**Problem:** Struggles with references to previous questions/discussions in the chat.

**Root cause:** TopicDetector only looks at patterns/pronouns. When user says "What about her motivation?" there's no memory of WHO "her" was.

### 2. Unsolicited Revisions
**Problem:** AI likes offering revisions when writers often prefer suggestions.

**Root cause:** No request_type classification (SUGGEST vs REWRITE). System prompt doesn't explicitly restrict rewrites.

### 3. General Questions Not Handled
**Problem:** Should be able to answer general screenwriting questions not specific to the script.

**Root cause:** No GENERAL domain classification. Currently all questions assume script context.

### 4. Implicit Script References Missed
**Problem:** If user doesn't explicitly mention the script, AI doesn't reference it.

**Root cause:** No probe/search to detect if question is script-relevant when ambiguous. Tool enablement decision doesn't consider this.

---

## Proposed Changes Analysis

### 1. Working Set State Object ✅ STRONGLY AGREE

**Proposed structure:**
```python
{
  "active_scene_ids": [4, 5],
  "active_characters": ["SARAH", "MIKE"],
  "active_plot_threads": ["romance_arc"],
  "last_user_intent": "pacing critique",
  "last_assistant_commitment": "I suggested cutting scene 12's opener"
}
```

**Impact:** HIGH - This is the core fix for continuity. Without explicit state, pronouns and callbacks will always be fragile.

**Recommendation:** Implement as a new `ConversationState` model stored per conversation, updated after each assistant turn.

---

### 2. Enhanced Continuity Classifier ✅ AGREE

**Proposed output:**
```python
{
  "continuity": "FOLLOW_UP | NEW_TOPIC | UNCERTAIN",
  "refers_to": "SCENE | CHARACTER | THREAD | PRIOR_ADVICE | NONE",
  "confidence": 0.8,
  "needs_disambiguation": false
}
```

**Current:** TopicDetector returns `(TopicMode, confidence)` - only FOLLOW_UP/NEW_TOPIC, no `refers_to`.

**The `refers_to` field is the key addition.** It tells us *what* the user is referencing:
- `PRIOR_ADVICE` → retrieve last assistant commitment from working set
- `CHARACTER` → use active_characters to resolve "he/she/they"
- `SCENE` → use active_scene_ids for "that scene" / "this part"

**Recommendation:** Extend TopicDetector to return `refers_to` type. This enables targeted context retrieval instead of blind history inclusion.

---

### 3. Domain Router (SCRIPT / GENERAL / HYBRID) ✅ CRITICAL

**This is the biggest gap.** Currently:
- "What's a save the cat beat?" → Gets confused, may try to use tools
- "How's the pacing in my script?" (implicit) → May not use tools because no scene mentioned

**Proposed 3-way classification:**

| Domain | Behavior |
|--------|----------|
| **GENERAL** | No tools, no script context, just expert knowledge |
| **SCRIPT** | Tools enabled, script-grounded answer |
| **HYBRID** | Answer general first, then "Applied to your script:" |

**Key insight:** "Bias toward SCRIPT when ambiguous, but verify with lightweight probe."

**Recommendation:**
1. Add `DomainType` enum: `GENERAL`, `SCRIPT`, `HYBRID`
2. When ambiguous, do a quick `search_script(query, limit=3)` probe
3. If probe returns relevant results → SCRIPT or HYBRID
4. If probe returns nothing → GENERAL

---

### 4. Request Type Classification ✅ CRITICAL

**This fixes the "unsolicited rewrites" problem.**

**Proposed types:**
```python
class RequestType(str, Enum):
    SUGGEST = "suggest"     # Default - diagnosis + suggestions
    REWRITE = "rewrite"     # Explicit - full revision
    DIAGNOSE = "diagnose"   # Analysis only
    BRAINSTORM = "brainstorm"
    FACTUAL = "factual"     # General knowledge
```

**Rewrite indicators (explicit only):**
- "rewrite", "revise", "draft", "give me alt lines", "make this better by rewriting"

**Response contract:**
```
DEFAULT (SUGGEST/DIAGNOSE):
- What's working
- What's not
- 2-6 concrete edits you can make
- (Optional) "If you want, paste the lines and I can rewrite them"

REWRITE (explicit request only):
- Full revised version with REVISED: prefix
```

---

### 5. Tool Batching / Multi-tool Guardrails ⚠️ PARTIALLY DONE

**Current state:**
- We have `get_scenes` batch tool
- Multi-tool-per-turn is allowed
- No explicit cap or "why" requirement

**Proposed additions worth considering:**
- Cap at 3 tool calls per planning step (prevents runaway)
- Max 1 "expensive" tool unless explicitly asked
- Require one-line "why" per tool call (helps synthesis)

**Recommendation:** Add soft guardrails in system prompt rather than hard-coding.

---

### 6. Evidence Assembly ✅ ALREADY IMPLEMENTED

Current `EvidenceBuilder`:
- Ranks tool results by relevance
- Truncates to budget (10 items, 8K chars)
- Feeds to synthesis prompt

No changes needed.

---

## Recommended Implementation

### Phase 1: Domain + Request Type Classification (Highest Impact)

**New enums:**
```python
class DomainType(str, Enum):
    GENERAL = "general"     # Non-script question
    SCRIPT = "script"       # Script-grounded answer
    HYBRID = "hybrid"       # Both

class RequestType(str, Enum):
    SUGGEST = "suggest"     # Default - diagnosis + suggestions
    REWRITE = "rewrite"     # Explicit revision request
    DIAGNOSE = "diagnose"   # Analysis only
    BRAINSTORM = "brainstorm"
    FACTUAL = "factual"     # General knowledge
```

**Single router call returns:**
```python
{
  "domain": "SCRIPT",
  "request_type": "SUGGEST",
  "intent": "SCENE_FEEDBACK"  # Keep existing for context assembly
}
```

**Unified Router Prompt:**
```python
prompt = """Classify this message:
1. domain: GENERAL (not about script) | SCRIPT (about this script) | HYBRID (both)
2. request_type: SUGGEST | REWRITE | DIAGNOSE | BRAINSTORM | FACTUAL
3. continuity: FOLLOW_UP | NEW_TOPIC
4. refers_to: SCENE | CHARACTER | THREAD | PRIOR_ADVICE | NONE

Message: "{message}"
Previous assistant said: "{last_commitment}"

Respond JSON only."""
```

**Cost:** ~150 tokens per call (~$0.00002 with Haiku)
**Benefit:** Coherent decisions, single round-trip

---

### Phase 2: Working Set State

**New model:**
```python
class ConversationState(Base):
    __tablename__ = "conversation_states"

    id: UUID
    conversation_id: UUID                # FK to chat_conversations
    active_scene_ids: List[int]          # Last 1-3 scenes referenced
    active_characters: List[str]         # Last 1-5 characters
    active_threads: List[str]            # Last 1-3 plot threads
    last_user_intent: str
    last_assistant_commitment: str       # Key for "what you suggested"
    updated_at: datetime
```

**Update logic after each assistant response:**
1. Parse scene numbers mentioned in response
2. Extract character names mentioned
3. Detect any commitments made ("I suggest...", "You could try...")
4. Update state object

---

### Phase 3: Enhanced Continuity with `refers_to`

**Extend TopicDetector output:**
```python
class ContinuityResult:
    continuity: TopicMode           # FOLLOW_UP | NEW_TOPIC
    refers_to: ReferenceType        # SCENE | CHARACTER | THREAD | PRIOR_ADVICE | NONE
    confidence: float
```

**Context retrieval based on `refers_to`:**

| refers_to | Action |
|-----------|--------|
| `PRIOR_ADVICE` | Retrieve `last_assistant_commitment` from working set |
| `CHARACTER` | Resolve pronouns using `active_characters`, add character context |
| `SCENE` | Use `active_scene_ids` to resolve "that scene" / "this part" |
| `THREAD` | Include plot thread context from `active_threads` |
| `NONE` | Standard context assembly |

---

## System Prompt Updates

Add explicit response contract to system prompt:

```
RESPONSE GUIDELINES:

1. REQUEST TYPE AWARENESS:
   - Default to diagnosis and suggestions, NOT full rewrites
   - Only provide full rewrites when user explicitly asks (words: rewrite, revise, draft, "give me new lines")
   - Structure feedback as: What works → What doesn't → Specific suggestions

2. DOMAIN AWARENESS:
   - For general screenwriting questions (not about this specific script): Answer directly without tools
   - For script-specific questions: Ground your answer in the actual script content
   - For hybrid questions: Answer the general concept first, then apply to this script

3. SUGGESTION FORMAT (default):
   - What's working well (1-2 sentences)
   - What could be improved (1-2 sentences)
   - 2-4 specific, actionable suggestions
   - Optional: "If you'd like, I can rewrite specific lines for you"

4. REWRITE FORMAT (only when explicitly requested):
   - REVISED: [full rewritten content]
   - Brief explanation of changes (1-2 sentences)
```

---

## Probe-Based Domain Detection

When domain classification is uncertain, use lightweight script probe:

```python
async def probe_script_relevance(question: str, script_id: UUID) -> bool:
    """Quick check if question relates to script content."""
    results = await search_script(
        script_id=script_id,
        query=question,
        limit=3,
        max_chars=500  # Minimal retrieval
    )
    return any(r.score > 0.5 for r in results)
```

**Decision flow:**
```
Domain unclear?
    ├─ Run probe_script_relevance()
    ├─ If hits found → SCRIPT or HYBRID
    └─ If no hits → GENERAL
```

---

## Summary Table

| Proposed Change | Verdict | Priority | Effort |
|-----------------|---------|----------|--------|
| Domain Router (SCRIPT/GENERAL/HYBRID) | ✅ **Critical** | P1 | Medium |
| Request Type (SUGGEST/REWRITE) | ✅ **Critical** | P1 | Low |
| Response Contract (system prompt) | ✅ Implement | P1 | Low |
| Working Set State | ✅ Implement | P2 | Medium |
| Enhanced Continuity (`refers_to`) | ✅ Implement | P3 | Low |
| Tool Batching Guardrails | ⚠️ Soft limits via prompt | P3 | Low |
| Evidence Assembly | ✅ Already done | - | - |

---

## Expected Outcomes

### After Phase 1 (Domain + Request Type):
- General questions answered without tool confusion
- Implicit script questions properly grounded
- No more unsolicited rewrites
- Writers get suggestions by default

### After Phase 2 (Working Set State):
- Pronouns resolve correctly ("What about her?" → knows who "her" is)
- Can reference "what you suggested" accurately
- Scene/character context persists across turns

### After Phase 3 (Enhanced Continuity):
- Targeted context retrieval based on reference type
- Minimal token usage (only fetch what's needed)
- Robust conversation continuity

---

## Files to Modify

| File | Changes |
|------|---------|
| `app/schemas/ai.py` | Add `DomainType`, `RequestType`, `ReferenceType` enums |
| `app/services/intent_classifier.py` | Extend to unified router returning domain + request_type + continuity |
| `app/services/topic_detector.py` | Add `refers_to` detection |
| `app/services/context_builder.py` | Update system prompt, add domain-aware context assembly |
| `app/services/conversation_service.py` | Add working set state management |
| `app/models/` | Add `ConversationState` model |
| `app/routers/ai_router.py` | Integrate new classification into flow |
