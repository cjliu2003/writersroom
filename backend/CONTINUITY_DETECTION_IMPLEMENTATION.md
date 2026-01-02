# Continuity Detection Implementation Plan

Comprehensive implementation plan for improving topic continuity detection with user control.

---

## Overview

### Problem Statement
The current topic detection system incorrectly classifies follow-up messages as new topics when:
- Messages are longer than 10 words (default → NEW_TOPIC)
- User is disagreeing/questioning previous AI advice
- Referential pronouns appear mid-sentence rather than at start

### Solution Architecture
A hybrid approach combining:
1. **Improved heuristics** with FOLLOW_UP as default
2. **User override control** via frontend toggle
3. **Confidence-based prompting** for uncertain cases

---

## Phase A: Backend Quick Fix (Immediate)

**Effort**: 15 minutes
**Impact**: Fixes immediate false-negative bug

### Changes to `app/services/topic_detector.py`

#### 1. Add Missing Follow-Up Patterns (Line ~36)

```python
FOLLOW_UP_PATTERNS = [
    # Existing patterns
    "also", "additionally", "another thing",
    "what about", "how about", "and what",
    "you mentioned", "earlier you said",
    "going back to", "regarding that",
    "same scene", "that character", "the scene",
    "can you", "could you also",
    "more about", "tell me more",
    "what else", "anything else",
    "in addition", "furthermore",
    "related to that", "on that note",
    "continuing", "following up",

    # NEW: Disagreement/questioning patterns
    "i don't know", "i disagree", "i'm not sure",
    "i think", "i feel like", "i feel",
    "but i", "but that", "but this", "but it",
    "why doesn't", "why does", "why is", "why did", "why would",
    "doesn't feel", "doesn't work", "doesn't make",
    "to you", "for you",
    "your suggestion", "your point", "your analysis",
]
```

#### 2. Add Referential Pronoun Check (After line ~120)

```python
# Check for referential pronouns ANYWHERE in message (not just start)
# These suggest referring back to something previously discussed
if last_assistant_message:
    referential_pronouns = ["this ", "that ", "these ", "those "]
    if any(p in message_lower for p in referential_pronouns):
        logger.debug("Referential pronoun found mid-sentence - likely follow-up")
        return TopicMode.FOLLOW_UP, 0.65
```

#### 3. Add Question-to-AI Detection (After line ~130)

```python
# Questions addressing the AI's perspective are follow-ups
# e.g., "Why doesn't this feel authentic to you?"
if "?" in current_message:
    ai_reference_patterns = ["you ", "your ", "to you", "for you"]
    if any(p in message_lower for p in ai_reference_patterns):
        logger.debug("Question addressing AI perspective - follow-up")
        return TopicMode.FOLLOW_UP, 0.75
```

#### 4. Invert Default Behavior (Line ~149-157)

```python
# BEFORE:
# Default heuristic: short messages are more likely follow-ups
word_count = len(current_message.split())
if word_count < 10:
    logger.debug(f"Short message ({word_count} words) - treating as follow-up")
    return TopicMode.FOLLOW_UP, 0.5

# Longer messages without clear signals = likely new topic
logger.debug(f"Long message ({word_count} words) - treating as new topic")
return TopicMode.NEW_TOPIC, 0.5

# AFTER:
# Default: within an active conversation, assume FOLLOW_UP
# Rationale: Losing context (false NEW_TOPIC) causes worse UX than
# including extra context (false FOLLOW_UP)
word_count = len(current_message.split())
if word_count < 8:
    logger.debug(f"Short message ({word_count} words) - strong follow-up signal")
    return TopicMode.FOLLOW_UP, 0.7

# Default to FOLLOW_UP for ambiguous cases
logger.debug(f"Ambiguous ({word_count} words) - defaulting to follow-up")
return TopicMode.FOLLOW_UP, 0.5
```

---

## Phase B: Backend API Support for User Override

**Effort**: 30 minutes
**Impact**: Enables frontend control

### 1. Add TopicModeOverride to Schema (`app/schemas/ai.py`)

After line 83 (TopicMode enum):

```python
class TopicModeOverride(str, Enum):
    """
    User override for topic continuity.

    When set, bypasses automatic detection.
    """
    CONTINUE = "continue"     # Include conversation history
    NEW_TOPIC = "new_topic"   # Skip conversation history, fresh context
```

### 2. Update ChatMessageRequest (`app/schemas/ai.py`)

Add field after `max_iterations` (around line 258):

```python
class ChatMessageRequest(BaseModel):
    """..."""
    script_id: UUID = Field(..., description="Script to discuss")
    conversation_id: Optional[UUID] = Field(None, description="Existing conversation (optional)")
    current_scene_id: Optional[UUID] = Field(None, description="Current scene context (optional)")
    message: str = Field(..., description="User's message")
    intent_hint: Optional[IntentType] = Field(None, description="Optional intent classification hint")
    max_tokens: Optional[int] = Field(600, le=4000, description="Maximum output tokens")
    budget_tier: Optional[BudgetTier] = Field(BudgetTier.STANDARD, description="Token budget tier")

    # Phase 6: Hybrid mode support
    enable_tools: bool = Field(True, description="Enable MCP tool calling (default: True)")
    max_iterations: int = Field(5, ge=1, le=10, description="Maximum tool calling iterations")

    # NEW: Topic continuity override
    topic_mode: Optional[TopicModeOverride] = Field(
        None,
        description="Override topic detection: 'continue' includes history, 'new_topic' skips it"
    )
```

### 3. Update ContextBuilder (`app/services/context_builder.py`)

Modify `build_prompt` method signature to accept override:

```python
async def build_prompt(
    self,
    script_id: UUID,
    message: str,
    intent: IntentType,
    conversation_id: Optional[UUID] = None,
    current_scene_id: Optional[UUID] = None,
    budget_tier: BudgetTier = BudgetTier.STANDARD,
    skip_scene_retrieval: bool = False,
    tools_enabled: bool = False,
    request_type: RequestType = RequestType.SUGGEST,
    domain: DomainType = DomainType.SCRIPT,
    topic_mode_override: Optional[str] = None  # NEW
) -> Dict:
```

Inside the method, around line 161 where topic detection happens:

```python
# Detect topic mode for history gating
topic_mode = TopicMode.NEW_TOPIC
topic_confidence = 1.0

if conversation_id:
    # Check for user override first
    if topic_mode_override:
        if topic_mode_override == "continue":
            topic_mode = TopicMode.FOLLOW_UP
            topic_confidence = 1.0
            logger.info("[CONTEXT] Topic mode: FOLLOW_UP (user override)")
        elif topic_mode_override == "new_topic":
            topic_mode = TopicMode.NEW_TOPIC
            topic_confidence = 1.0
            logger.info("[CONTEXT] Topic mode: NEW_TOPIC (user override)")
    else:
        # Auto-detect topic mode
        topic_mode, topic_confidence = await self.topic_detector.detect_mode(
            current_message=message,
            last_assistant_message=last_assistant,
            last_user_message=last_user
        )
        logger.info(
            f"[CONTEXT] Topic mode: {topic_mode.value} "
            f"(confidence: {topic_confidence:.2f})"
        )
```

### 4. Update AI Router (`app/routers/ai_router.py`)

Pass the override through to context_builder (around line 1685):

```python
prompt = await context_builder.build_prompt(
    script_id=request.script_id,
    message=enriched_message,
    intent=intent,
    conversation_id=conversation.conversation_id,
    current_scene_id=request.current_scene_id,
    budget_tier=request.budget_tier or "standard",
    skip_scene_retrieval=tools_enabled,
    tools_enabled=tools_enabled,
    request_type=request_type,
    domain=domain,
    topic_mode_override=request.topic_mode  # NEW
)
```

---

## Phase C: Frontend Toggle Implementation

**Effort**: 2-3 hours
**Impact**: Complete user experience

### 1. Update API Types (`frontend/lib/api.ts`)

```typescript
// Add type for topic mode override
export type TopicModeOverride = 'continue' | 'new_topic';

export interface ChatMessageRequest {
  script_id: string;
  conversation_id?: string;
  current_scene_id?: string;
  message: string;
  intent_hint?: 'scene_specific' | 'character' | 'global_context' | 'general';
  max_tokens?: number;
  budget_tier?: 'quick' | 'standard' | 'deep';
  enable_tools?: boolean;
  max_iterations?: number;

  // NEW: Topic continuity override
  topic_mode?: TopicModeOverride;
}
```

### 2. Create Topic Mode Toggle Component

Create `frontend/components/ui/topic-mode-toggle.tsx`:

```tsx
"use client"

import React from 'react'
import { cn } from "@/lib/utils"
import { MessageSquare, RefreshCw } from "lucide-react"

export type TopicMode = 'continue' | 'new_topic'

interface TopicModeToggleProps {
  value: TopicMode
  onChange: (mode: TopicMode) => void
  disabled?: boolean
  className?: string
}

export function TopicModeToggle({
  value,
  onChange,
  disabled = false,
  className
}: TopicModeToggleProps) {
  return (
    <div className={cn(
      "inline-flex items-center rounded-full bg-muted p-0.5 text-xs",
      disabled && "opacity-50 pointer-events-none",
      className
    )}>
      <button
        type="button"
        onClick={() => onChange('continue')}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-full transition-colors",
          value === 'continue'
            ? "bg-primary text-primary-foreground"
            : "hover:bg-muted-foreground/10"
        )}
        title="Continue the current conversation thread"
      >
        <MessageSquare className="h-3 w-3" />
        <span>Continue</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('new_topic')}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-full transition-colors",
          value === 'new_topic'
            ? "bg-primary text-primary-foreground"
            : "hover:bg-muted-foreground/10"
        )}
        title="Start a new topic (fresh context)"
      >
        <RefreshCw className="h-3 w-3" />
        <span>New Topic</span>
      </button>
    </div>
  )
}
```

### 3. Integrate into AI Chatbot (`frontend/components/ai-chatbot.tsx`)

Add state and UI:

```tsx
// Add import
import { TopicModeToggle, type TopicMode } from "@/components/ui/topic-mode-toggle"

// Add state (around line 46)
const [topicMode, setTopicMode] = useState<TopicMode>('continue')

// Auto-reset to 'continue' after sending with 'new_topic'
// (in handleSendMessage, after successful send)
if (topicMode === 'new_topic') {
  setTopicMode('continue')  // Reset for next message
}

// Update sendChatMessageWithStatusStream call to include topic_mode
await sendChatMessageWithStatusStream(
  {
    script_id: projectId,
    conversation_id: conversationId,
    current_scene_id: currentSceneId,
    message: inputValue.trim(),
    budget_tier: 'standard',
    topic_mode: topicMode === 'continue' ? undefined : topicMode,  // Only send if not default
  },
  callbacks
)

// Add toggle to UI (above the input area, around line 280)
<div className="flex items-center justify-between px-3 py-1 border-t border-border/50">
  <TopicModeToggle
    value={topicMode}
    onChange={setTopicMode}
    disabled={isLoading}
  />
  <span className="text-[10px] text-muted-foreground">
    {topicMode === 'continue'
      ? "AI will reference previous messages"
      : "AI will start fresh"}
  </span>
</div>
```

---

## Phase D: Confidence-Based Prompting (Optional Enhancement)

**Effort**: 1-2 hours
**Impact**: Smart prompting only when uncertain

### 1. Add UNCERTAIN State to TopicMode

In `app/schemas/ai.py`:

```python
class TopicMode(str, Enum):
    FOLLOW_UP = "follow_up"
    NEW_TOPIC = "new_topic"
    UNCERTAIN = "uncertain"  # NEW: Requires user confirmation
```

### 2. Update TopicDetector to Return UNCERTAIN

In `app/services/topic_detector.py`, before the default return:

```python
# If confidence is low, return UNCERTAIN to prompt user
if topic_confidence < 0.6:
    logger.debug(f"Low confidence ({topic_confidence:.2f}) - returning UNCERTAIN")
    return TopicMode.UNCERTAIN, topic_confidence
```

### 3. Include Uncertainty in API Response

Add to ChatMessageResponse in `app/schemas/ai.py`:

```python
class ChatMessageResponse(BaseModel):
    message: str
    conversation_id: str
    usage: TokenUsage
    context_used: ContextUsed
    tool_metadata: Optional[ToolCallMetadata] = None

    # NEW: Topic mode detection info
    topic_mode_detected: Optional[str] = None
    topic_mode_confidence: Optional[float] = None
    topic_mode_uncertain: bool = False  # True if user should confirm
```

### 4. Frontend Inline Prompt

When `topic_mode_uncertain` is true, show an inline prompt before displaying the response:

```tsx
// In ai-chatbot.tsx, when processing response
if (response.topic_mode_uncertain) {
  // Show inline confirmation UI
  setShowTopicConfirmation(true)
  setPendingResponse(response)
  return  // Don't show response until confirmed
}
```

---

## Testing Plan

### Unit Tests for Phase A

```python
# tests/test_topic_detector_improvements.py

def test_disagreement_detected_as_follow_up():
    """User disagreeing with AI advice should be FOLLOW_UP."""
    detector = TopicDetector()
    mode, conf = await detector.detect_mode(
        current_message="I don't know, I feel like the dialogue isn't disguising exposition",
        last_assistant_message="The scene relies too heavily on exposition..."
    )
    assert mode == TopicMode.FOLLOW_UP
    assert conf >= 0.5

def test_question_to_ai_detected_as_follow_up():
    """Question addressing AI's opinion should be FOLLOW_UP."""
    detector = TopicDetector()
    mode, conf = await detector.detect_mode(
        current_message="Why doesn't this feel authentic to you?",
        last_assistant_message="The dialogue feels inauthentic because..."
    )
    assert mode == TopicMode.FOLLOW_UP
    assert conf >= 0.7

def test_referential_pronoun_mid_sentence():
    """'This' mid-sentence should trigger FOLLOW_UP."""
    detector = TopicDetector()
    mode, conf = await detector.detect_mode(
        current_message="I feel like this is actually working well",
        last_assistant_message="The pacing in scene 5 is problematic..."
    )
    assert mode == TopicMode.FOLLOW_UP

def test_default_is_follow_up():
    """Ambiguous messages should default to FOLLOW_UP."""
    detector = TopicDetector()
    mode, conf = await detector.detect_mode(
        current_message="The character development seems fine to me overall",
        last_assistant_message="I have concerns about character development..."
    )
    assert mode == TopicMode.FOLLOW_UP
```

### Integration Tests for Phase B

```python
# tests/test_topic_mode_override.py

async def test_topic_mode_continue_override():
    """topic_mode='continue' should force history inclusion."""
    request = ChatMessageRequest(
        script_id=test_script_id,
        message="Tell me more",
        topic_mode="continue"
    )
    # Verify history is included regardless of message content

async def test_topic_mode_new_topic_override():
    """topic_mode='new_topic' should skip history."""
    request = ChatMessageRequest(
        script_id=test_script_id,
        message="What about scene 5?",  # Would normally be follow-up
        topic_mode="new_topic"
    )
    # Verify history is NOT included
```

---

## Rollout Plan

### Stage 1: Phase A Only
1. Deploy improved heuristics
2. Monitor logs for topic mode classification
3. Verify false-negative rate decreases

### Stage 2: Phase B + C
1. Deploy backend API support
2. Deploy frontend toggle
3. Default toggle to "Continue"
4. Collect user behavior data

### Stage 3: Phase D (Optional)
1. Deploy UNCERTAIN state
2. A/B test inline prompts vs always-visible toggle
3. Optimize confidence threshold based on user corrections

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| False NEW_TOPIC rate | ~30% estimated | < 5% |
| User override usage | N/A | < 10% of messages |
| "Context lost" complaints | Common | Rare |
| User satisfaction | Unknown | Measurable via toggle usage |

---

## File Change Summary

| Phase | File | Change Type |
|-------|------|-------------|
| A | `app/services/topic_detector.py` | Modify |
| B | `app/schemas/ai.py` | Modify |
| B | `app/services/context_builder.py` | Modify |
| B | `app/routers/ai_router.py` | Modify |
| C | `frontend/lib/api.ts` | Modify |
| C | `frontend/components/ui/topic-mode-toggle.tsx` | Create |
| C | `frontend/components/ai-chatbot.tsx` | Modify |
| D | `app/schemas/ai.py` | Modify |
| D | `app/services/topic_detector.py` | Modify |
| D | `frontend/components/ai-chatbot.tsx` | Modify |
