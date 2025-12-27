# AI Chat Improvements - Implementation Design Document

This document provides detailed implementation specifications for fixing the AI chat truncation issues and improving the agentic tool loop architecture.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [P0: Critical Bug Fixes](#p0-critical-bug-fixes)
3. [P1: Tool-Only Mode Enforcement](#p1-tool-only-mode-enforcement)
4. [P1: Batch Tools Implementation](#p1-batch-tools-implementation)
5. [P1: Evidence Builder Architecture](#p1-evidence-builder-architecture)
6. [P2: History Gating (New Topic Detection)](#p2-history-gating-new-topic-detection)
7. [P2: Output Format Constraints](#p2-output-format-constraints)
8. [Implementation Order](#implementation-order)
9. [Testing Strategy](#testing-strategy)

---

## Executive Summary

### Problem Statement

The current AI chat system experiences message truncation and quality degradation due to:
1. Token limit bugs (RAG-only defaults to 600, content blocks not concatenated)
2. Architectural issues (tool loop allows prose, raw tool dumps cause recency bias)
3. Missing primitives (no batch tools, no evidence compression)

### Solution Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        NEW TOOL LOOP FLOW                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. HISTORY GATE         ─────────────────────────────────────────► │
│     │                                                               │
│     ├── follow_up → Include conversation context                   │
│     └── new_topic → Fresh start, minimal context                   │
│                                                                     │
│  2. TOOL-ONLY LOOP       ─────────────────────────────────────────► │
│     │                                                               │
│     ├── Instruction: "Output ONLY tool calls, no prose"           │
│     ├── Recovery: If max_tokens hit → retry with continue prompt  │
│     └── Exit: When stop_reason != tool_use                         │
│                                                                     │
│  3. EVIDENCE BUILDER     ─────────────────────────────────────────► │
│     │                                                               │
│     ├── Collect all tool results                                   │
│     ├── Score by relevance to user question                        │
│     ├── Truncate/compress to budget                                │
│     └── Build structured Evidence object                           │
│                                                                     │
│  4. SYNTHESIS            ─────────────────────────────────────────► │
│     │                                                               │
│     ├── Input: Evidence object (not raw tool dumps)                │
│     ├── Format: "≤200 words, 5 bullets max, most important first" │
│     └── Output: Clean user-facing response                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## P0: Critical Bug Fixes

### P0.1: Concatenate All Text Blocks

**Problem**: `ai_service.py:69` only returns `response.content[0].text`, dropping content from additional text blocks.

**File**: `app/services/ai_service.py`

**Current Code** (line 69):
```python
return {
    "content": response.content[0].text,
    ...
}
```

**New Code**:
```python
def _extract_all_text(self, content_blocks) -> str:
    """
    Extract and concatenate all text blocks from Claude response.

    Claude responses can contain multiple content blocks. This ensures
    we don't silently drop any text content.

    Args:
        content_blocks: List of ContentBlock objects from Claude response

    Returns:
        Concatenated text from all text blocks
    """
    text_parts = []
    for block in content_blocks:
        if hasattr(block, 'type') and block.type == "text":
            text_parts.append(block.text)
    return "\n".join(text_parts) if text_parts else ""


async def generate_response(self, prompt: dict, max_tokens: int = 1200, stream: bool = False) -> Dict:
    # ... existing code ...

    return {
        "content": self._extract_all_text(response.content),  # Changed
        "usage": {...},
        "stop_reason": response.stop_reason
    }
```

**Also update in `ai_router.py`** (tool loop text extraction, ~line 387):
```python
# Current
final_text = next(
    (block.text for block in response.content if block.type == "text"),
    ""
)

# New
final_text = "\n".join(
    block.text for block in response.content
    if hasattr(block, 'type') and block.type == "text"
)
```

---

### P0.2: Increase RAG-Only Default Token Limit

**Problem**: `ai_router.py:974` defaults to 600 tokens if client doesn't specify.

**File**: `app/routers/ai_router.py`

**Current Code** (line 974):
```python
response = await ai_service.generate_response(
    prompt=prompt,
    max_tokens=request.max_tokens or 600
)
```

**New Code**:
```python
# New constant at top of file
RAG_ONLY_DEFAULT_MAX_TOKENS = 1200

# In chat_message endpoint
response = await ai_service.generate_response(
    prompt=prompt,
    max_tokens=request.max_tokens or RAG_ONLY_DEFAULT_MAX_TOKENS
)
```

**Also update** `ai_service.py` default:
```python
async def generate_response(
    self,
    prompt: dict,
    max_tokens: int = 1200,  # Changed from 600
    stream: bool = False
) -> Dict:
```

---

### P0.3: Add Recovery Loop for max_tokens Truncation

**Problem**: When `stop_reason == "max_tokens"` during tool loop, we return partial content instead of continuing.

**File**: `app/routers/ai_router.py`

**New Logic** (insert after line 380):
```python
# Constants
MAX_RECOVERY_ATTEMPTS = 2  # Prevent infinite loops
RECOVERY_PROMPT = """Continue your tool planning.
Output ONLY tool calls - no explanations or user-facing text.
If you have gathered enough information, output no tools and I will ask for synthesis."""

async def _handle_tool_loop(...) -> tuple[str, dict, ToolCallMetadata]:
    """Handle multi-turn tool calling loop with recovery."""

    messages = initial_messages.copy()
    total_usage = {...}
    tools_used = []
    tool_executor = MCPToolExecutor(db=db, script_id=script_id)
    recovery_attempts = 0

    for iteration in range(max_iterations):
        logger.info(f"Tool loop iteration {iteration + 1}/{max_iterations}")

        response = await client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=TOOL_LOOP_MAX_TOKENS,
            system=system,
            messages=messages,
            tools=tools
        )

        # Aggregate usage
        _aggregate_usage(total_usage, response.usage)

        # Handle truncation with recovery
        if response.stop_reason == "max_tokens":
            logger.warning(f"Tool loop truncated at iteration {iteration + 1}")

            if recovery_attempts < MAX_RECOVERY_ATTEMPTS:
                recovery_attempts += 1
                logger.info(f"Attempting recovery ({recovery_attempts}/{MAX_RECOVERY_ATTEMPTS})")

                # Append partial response and recovery instruction
                messages.append({"role": "assistant", "content": response.content})
                messages.append({
                    "role": "user",
                    "content": RECOVERY_PROMPT
                })
                continue  # Retry the loop
            else:
                logger.error("Max recovery attempts reached, returning partial response")
                # Fall through to return

        # Normal exit: not a tool_use response
        if response.stop_reason != "tool_use":
            final_text = _extract_all_text(response.content)

            return final_text, total_usage, ToolCallMetadata(
                tool_calls_made=iteration + 1,
                tools_used=list(set(tools_used)),
                stop_reason=response.stop_reason,
                recovery_attempts=recovery_attempts  # New field
            )

        # Execute tools (existing logic)
        # ...
```

**Update Schema** (`app/schemas/ai.py`):
```python
class ToolCallMetadata(BaseModel):
    tool_calls_made: int
    tools_used: List[str]
    stop_reason: str
    recovery_attempts: int = 0  # New field
```

---

## P1: Tool-Only Mode Enforcement

### Design

During tool loop iterations, the model should output **only tool calls**, not prose. This prevents:
- Wasted tokens on text that gets discarded
- Truncation mid-thought
- Confusion about what's user-facing vs internal planning

### Implementation

**File**: `app/services/context_builder.py`

**Add new method**:
```python
def _get_tool_loop_system_prompt(self) -> str:
    """
    Get system prompt optimized for tool-only mode during tool loop iterations.

    This prompt enforces that the model outputs ONLY tool calls, no prose.
    """
    return """You are an expert screenplay analyst with access to tools.

CRITICAL INSTRUCTION: In this phase, output ONLY tool calls.
- Do NOT write any user-facing text
- Do NOT explain what you're doing
- Do NOT provide partial answers
- ONLY call tools to gather information

When you have gathered enough information to answer, call no tools.
The next phase will ask you to synthesize.

SCENE INDEXING: Tools use 0-based indexing. Scene 5 = index 4.

Available tools:
- get_scene / get_scenes: Get scene text (use batch when fetching multiple)
- get_scene_context: Get scene with neighbors
- get_character_scenes: Track character appearances
- search_script: Semantic search
- analyze_pacing: Quantitative metrics
- get_plot_threads: Plot thread information
- get_scene_relationships: Scene connections"""
```

**File**: `app/routers/ai_router.py`

**Modify `_handle_tool_loop`**:
```python
async def _handle_tool_loop(
    client: AsyncAnthropic,
    system: List[dict],  # This is now the TOOL-ONLY system prompt
    synthesis_system: List[dict],  # New: separate synthesis prompt
    initial_messages: List[dict],
    tools: List[dict],
    max_iterations: int,
    script_id: UUID,
    db: AsyncSession,
    user_question: str,  # New: for synthesis anchoring
    ai_conv_logger: AIConversationLogger = None
) -> tuple[str, dict, ToolCallMetadata]:
    """
    Handle multi-turn tool calling loop.

    Architecture:
    1. Tool-only loop: Model calls tools, no prose allowed
    2. Evidence building: Compress tool results
    3. Synthesis: Generate user-facing response from evidence
    """

    # Use tool-only system prompt for iterations
    tool_system = context_builder._get_tool_loop_system_prompt()

    messages = initial_messages.copy()
    all_tool_results = []  # Collect for evidence building

    for iteration in range(max_iterations):
        response = await client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=TOOL_LOOP_MAX_TOKENS,
            system=[{"type": "text", "text": tool_system}],
            messages=messages,
            tools=tools
        )

        # Check for prose in response (enforcement)
        text_content = _extract_all_text(response.content)
        if len(text_content) > 50 and response.stop_reason == "tool_use":
            logger.warning(f"Model output prose during tool loop: {text_content[:100]}...")
            # Option: Could retry with stricter prompt, but for now just log

        if response.stop_reason != "tool_use":
            # Model is done gathering - move to evidence building
            break

        # Execute tools and collect results
        tool_results = await _execute_tools(response.content, tool_executor)
        all_tool_results.extend(tool_results)

        # Append to messages for next iteration
        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})

    # Build evidence from collected tool results
    evidence = _build_evidence(all_tool_results, user_question)

    # Synthesis call with original system prompt
    synthesis_response = await _synthesize_response(
        client, synthesis_system, evidence, user_question
    )

    return synthesis_response
```

---

## P1: Batch Tools Implementation

### Design

Add batch versions of frequently-used tools to reduce:
- API round trips
- Token overhead (one tool call vs N)
- Recency bias (unified result)

### New Tool Definitions

**File**: `app/services/mcp_tools.py`

```python
# Add to SCREENPLAY_TOOLS list

{
    "name": "get_scenes",
    "description": "Get full text of multiple scenes at once. More efficient than multiple get_scene calls.",
    "input_schema": {
        "type": "object",
        "properties": {
            "scene_indices": {
                "type": "array",
                "items": {"type": "integer"},
                "description": "Array of 0-based scene indices. Scene 1 = 0, Scene 5 = 4."
            },
            "include_summaries": {
                "type": "boolean",
                "default": True,
                "description": "Include scene summaries in addition to full text"
            },
            "max_chars_per_scene": {
                "type": "integer",
                "default": 3000,
                "description": "Max characters per scene to prevent huge responses"
            }
        },
        "required": ["scene_indices"]
    }
},

{
    "name": "get_scenes_context",
    "description": "Get multiple scenes with their surrounding context. Batch version of get_scene_context.",
    "input_schema": {
        "type": "object",
        "properties": {
            "scene_indices": {
                "type": "array",
                "items": {"type": "integer"},
                "description": "Array of 0-based target scene indices"
            },
            "neighbor_count": {
                "type": "integer",
                "default": 1,
                "description": "How many scenes before/after each target to include"
            },
            "max_chars_per_scene": {
                "type": "integer",
                "default": 2000,
                "description": "Max characters per scene"
            }
        },
        "required": ["scene_indices"]
    }
}
```

### Executor Implementation

**File**: `app/services/mcp_tools.py`

```python
class MCPToolExecutor:

    async def execute_tool(self, tool_name: str, tool_input: dict) -> str:
        # Add to the if/elif chain:

        elif tool_name == "get_scenes":
            return await self._get_scenes_batch(
                script_id=self.script_id,
                scene_indices=tool_input["scene_indices"],
                include_summaries=tool_input.get("include_summaries", True),
                max_chars_per_scene=tool_input.get("max_chars_per_scene", 3000)
            )

        elif tool_name == "get_scenes_context":
            return await self._get_scenes_context_batch(
                script_id=self.script_id,
                scene_indices=tool_input["scene_indices"],
                neighbor_count=tool_input.get("neighbor_count", 1),
                max_chars_per_scene=tool_input.get("max_chars_per_scene", 2000)
            )

    async def _get_scenes_batch(
        self,
        script_id: UUID,
        scene_indices: List[int],
        include_summaries: bool = True,
        max_chars_per_scene: int = 3000
    ) -> str:
        """
        Batch fetch multiple scenes efficiently.

        Returns unified structured output to reduce recency bias.
        """
        if not scene_indices:
            return "Error: No scene indices provided"

        if len(scene_indices) > 10:
            return f"Error: Maximum 10 scenes per batch (requested {len(scene_indices)})"

        # Single query for all scenes
        scenes = await self.db.execute(
            select(Scene)
            .options(noload('*'))
            .where(
                Scene.script_id == script_id,
                Scene.position.in_(scene_indices)
            )
            .order_by(Scene.position)
        )
        scenes_list = scenes.scalars().all()

        # Build unified response
        result = f"""=== BATCH SCENE DATA ===
requested_scenes: {[i + 1 for i in scene_indices]} (user-facing, 1-based)
found_scenes: {len(scenes_list)}
===========================

"""

        for scene in scenes_list:
            result += f"--- SCENE {scene.position + 1} (index {scene.position}): {scene.scene_heading} ---\n\n"

            content = scene.full_content or ""
            if len(content) > max_chars_per_scene:
                content = content[:max_chars_per_scene] + "\n...[TRUNCATED]..."

            if content:
                result += content + "\n\n"
            elif scene.summary and include_summaries:
                result += f"[Summary]: {scene.summary}\n\n"
            else:
                result += "[No content available]\n\n"

        # Check for missing scenes
        found_positions = {s.position for s in scenes_list}
        missing = [i for i in scene_indices if i not in found_positions]
        if missing:
            result += f"\n⚠️ Scenes not found: {[i + 1 for i in missing]} (indices: {missing})\n"

        return result.strip()

    async def _get_scenes_context_batch(
        self,
        script_id: UUID,
        scene_indices: List[int],
        neighbor_count: int = 1,
        max_chars_per_scene: int = 2000
    ) -> str:
        """
        Batch fetch scenes with context, deduplicating overlapping neighbors.
        """
        if not scene_indices:
            return "Error: No scene indices provided"

        # Calculate full range including all neighbors (deduplicated)
        all_positions = set()
        for idx in scene_indices:
            for offset in range(-neighbor_count, neighbor_count + 1):
                pos = idx + offset
                if pos >= 0:
                    all_positions.add(pos)

        # Single query
        scenes = await self.db.execute(
            select(Scene)
            .options(noload('*'))
            .where(
                Scene.script_id == script_id,
                Scene.position.in_(list(all_positions))
            )
            .order_by(Scene.position)
        )
        scenes_list = scenes.scalars().all()

        # Build response with target markers
        target_set = set(scene_indices)

        result = f"""=== BATCH SCENE CONTEXT DATA ===
target_scenes: {[i + 1 for i in scene_indices]} (user-facing, 1-based)
context_window: ±{neighbor_count} scenes
total_scenes_returned: {len(scenes_list)}
================================

"""

        for scene in scenes_list:
            is_target = scene.position in target_set
            marker = " [TARGET]" if is_target else ""

            result += f"--- SCENE {scene.position + 1}{marker}: {scene.scene_heading} ---\n\n"

            content = scene.full_content or ""
            if len(content) > max_chars_per_scene:
                content = content[:max_chars_per_scene] + "\n...[TRUNCATED]..."

            if content:
                result += content + "\n\n"
            elif scene.summary:
                result += f"[Summary]: {scene.summary}\n\n"

        return result.strip()
```

### Update Tool Status Messages

```python
TOOL_STATUS_MESSAGES = {
    # ... existing ...

    "get_scenes": {
        "active": "Reading scenes {scene_indices}...",
        "active_default": "Reading multiple scenes...",
        "complete": "Finished reading scenes"
    },
    "get_scenes_context": {
        "active": "Looking at scenes {scene_indices} and surrounding context...",
        "active_default": "Looking at multiple scenes and context...",
        "complete": "Finished reviewing scene contexts"
    }
}
```

---

## P1: Evidence Builder Architecture

### Design

Replace raw tool dump accumulation with a structured Evidence object that:
- Ranks results by relevance to user question
- Compresses/truncates to token budget
- Provides clean input for synthesis

### Data Structures

**File**: `app/services/evidence_builder.py` (NEW FILE)

```python
"""
Evidence Builder Service

Converts raw tool results into structured, ranked evidence for synthesis.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from uuid import UUID
import tiktoken
import logging

logger = logging.getLogger(__name__)


@dataclass
class EvidenceItem:
    """Single piece of evidence from a tool result."""

    source_tool: str
    scene_numbers: List[int]  # 1-based for clarity
    content: str
    relevance_score: float = 0.0
    char_count: int = 0

    def __post_init__(self):
        self.char_count = len(self.content)


@dataclass
class Evidence:
    """Structured evidence collection for synthesis."""

    user_question: str
    items: List[EvidenceItem] = field(default_factory=list)
    total_chars: int = 0
    was_truncated: bool = False
    original_item_count: int = 0

    def to_prompt_text(self) -> str:
        """Format evidence for synthesis prompt."""

        lines = [
            "=== GATHERED EVIDENCE ===",
            f"Question: {self.user_question}",
            f"Sources: {len(self.items)} relevant results",
            ""
        ]

        for i, item in enumerate(self.items, 1):
            scenes_str = ", ".join(str(s) for s in item.scene_numbers) if item.scene_numbers else "N/A"
            lines.append(f"[{i}] From {item.source_tool} (Scenes: {scenes_str}):")
            lines.append(item.content)
            lines.append("")

        if self.was_truncated:
            lines.append(f"⚠️ {self.original_item_count - len(self.items)} lower-relevance results omitted")

        return "\n".join(lines)


class EvidenceBuilder:
    """
    Build structured evidence from tool results.

    Process:
    1. Parse tool results into EvidenceItems
    2. Score by relevance to user question
    3. Rank and truncate to budget
    4. Format for synthesis
    """

    MAX_CHARS_PER_ITEM = 1500
    MAX_TOTAL_CHARS = 8000  # ~2000 tokens

    def __init__(self, embedding_service=None):
        """
        Initialize evidence builder.

        Args:
            embedding_service: Optional service for semantic relevance scoring.
                             Falls back to keyword matching if not provided.
        """
        self.embedding_service = embedding_service
        self.tokenizer = tiktoken.get_encoding("cl100k_base")

    async def build_evidence(
        self,
        tool_results: List[Dict[str, Any]],
        user_question: str,
        max_items: int = 10
    ) -> Evidence:
        """
        Build evidence from tool results.

        Args:
            tool_results: List of {tool_name, tool_input, result} dicts
            user_question: Original user question for relevance scoring
            max_items: Maximum evidence items to include

        Returns:
            Evidence object ready for synthesis
        """
        evidence = Evidence(user_question=user_question)
        items = []

        # Parse each tool result into EvidenceItems
        for result in tool_results:
            parsed = self._parse_tool_result(result)
            items.extend(parsed)

        evidence.original_item_count = len(items)

        if not items:
            return evidence

        # Score by relevance
        await self._score_items(items, user_question)

        # Sort by relevance (highest first)
        items.sort(key=lambda x: x.relevance_score, reverse=True)

        # Truncate to budget
        selected_items = []
        total_chars = 0

        for item in items:
            # Truncate individual item if too long
            if item.char_count > self.MAX_CHARS_PER_ITEM:
                item.content = item.content[:self.MAX_CHARS_PER_ITEM] + "...[truncated]"
                item.char_count = len(item.content)

            # Check budget
            if total_chars + item.char_count > self.MAX_TOTAL_CHARS:
                evidence.was_truncated = True
                break

            if len(selected_items) >= max_items:
                evidence.was_truncated = True
                break

            selected_items.append(item)
            total_chars += item.char_count

        evidence.items = selected_items
        evidence.total_chars = total_chars

        logger.info(
            f"Evidence built: {len(selected_items)}/{len(items)} items, "
            f"{total_chars} chars, truncated={evidence.was_truncated}"
        )

        return evidence

    def _parse_tool_result(self, result: Dict[str, Any]) -> List[EvidenceItem]:
        """Parse a tool result into EvidenceItems."""

        tool_name = result.get("tool_name", "unknown")
        content = result.get("result", "")

        # Extract scene numbers from content or input
        scene_numbers = self._extract_scene_numbers(result)

        # For batch tools, try to split into per-scene items
        if tool_name in ("get_scenes", "get_scenes_context"):
            return self._parse_batch_result(tool_name, content, scene_numbers)

        # Single item for non-batch tools
        return [EvidenceItem(
            source_tool=tool_name,
            scene_numbers=scene_numbers,
            content=content
        )]

    def _parse_batch_result(
        self,
        tool_name: str,
        content: str,
        scene_numbers: List[int]
    ) -> List[EvidenceItem]:
        """Parse batch tool result into per-scene items."""

        items = []

        # Split on scene headers
        import re
        scene_pattern = r'--- SCENE (\d+).*?---\n\n(.*?)(?=--- SCENE |\Z)'
        matches = re.findall(scene_pattern, content, re.DOTALL)

        for scene_num_str, scene_content in matches:
            scene_num = int(scene_num_str)
            items.append(EvidenceItem(
                source_tool=tool_name,
                scene_numbers=[scene_num],
                content=scene_content.strip()
            ))

        # Fallback if parsing fails
        if not items:
            items.append(EvidenceItem(
                source_tool=tool_name,
                scene_numbers=scene_numbers,
                content=content
            ))

        return items

    def _extract_scene_numbers(self, result: Dict[str, Any]) -> List[int]:
        """Extract scene numbers from tool input or result."""

        tool_input = result.get("tool_input", {})

        # Direct scene index
        if "scene_index" in tool_input:
            return [tool_input["scene_index"] + 1]  # Convert to 1-based

        # Batch scene indices
        if "scene_indices" in tool_input:
            return [i + 1 for i in tool_input["scene_indices"]]

        # Parse from result content
        import re
        content = result.get("result", "")
        matches = re.findall(r'SCENE (\d+)', content)
        return [int(m) for m in matches[:10]]  # Cap at 10

    async def _score_items(self, items: List[EvidenceItem], question: str):
        """Score items by relevance to question."""

        question_lower = question.lower()
        question_words = set(question_lower.split())

        for item in items:
            content_lower = item.content.lower()

            # Simple keyword overlap scoring (could upgrade to embeddings)
            content_words = set(content_lower.split())
            overlap = len(question_words & content_words)

            # Bonus for exact phrase matches
            phrase_bonus = 0.5 if question_lower[:20] in content_lower else 0

            # Normalize by question length
            item.relevance_score = (overlap / max(len(question_words), 1)) + phrase_bonus

            # TODO: Add embedding-based semantic similarity
            # if self.embedding_service:
            #     similarity = await self.embedding_service.compute_similarity(question, item.content)
            #     item.relevance_score = 0.3 * item.relevance_score + 0.7 * similarity
```

### Integration with Tool Loop

**File**: `app/routers/ai_router.py`

```python
from app.services.evidence_builder import EvidenceBuilder, Evidence

async def _handle_tool_loop(...) -> tuple[str, dict, ToolCallMetadata]:
    """Handle tool loop with evidence building."""

    evidence_builder = EvidenceBuilder()
    all_tool_results = []

    # Tool loop (existing, but collecting results)
    for iteration in range(max_iterations):
        response = await client.messages.create(...)

        if response.stop_reason != "tool_use":
            break

        # Execute and collect
        for block in response.content:
            if block.type == "tool_use":
                result = await tool_executor.execute_tool(block.name, block.input)
                all_tool_results.append({
                    "tool_name": block.name,
                    "tool_input": block.input,
                    "result": result
                })

        # Append to messages for next iteration
        # ...

    # Build evidence
    evidence = await evidence_builder.build_evidence(
        tool_results=all_tool_results,
        user_question=user_question
    )

    # Synthesis with clean evidence
    final_message = await _synthesize_with_evidence(
        client, synthesis_system, evidence
    )

    return final_message, total_usage, tool_metadata


async def _synthesize_with_evidence(
    client: AsyncAnthropic,
    system: List[dict],
    evidence: Evidence
) -> str:
    """Generate final response from structured evidence."""

    synthesis_prompt = f"""Based on the evidence below, answer the user's question.

{evidence.to_prompt_text()}

RESPONSE FORMAT:
- Lead with the most important finding
- Maximum 5 bullet points if listing
- Maximum 200 words total
- Be specific: cite scene numbers and quote key lines
- Do not mention tools or evidence gathering"""

    response = await client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=FINAL_SYNTHESIS_MAX_TOKENS,
        system=system,
        messages=[{"role": "user", "content": synthesis_prompt}]
    )

    return _extract_all_text(response.content)
```

---

## P2: History Gating (New Topic Detection)

### Design

Add a "mode gate" before context building to determine if conversation history is relevant:
- `follow_up`: Include conversation context (continuing previous discussion)
- `new_topic`: Fresh start with minimal context

### Implementation

**File**: `app/services/topic_detector.py` (NEW FILE)

```python
"""
Topic Detection Service

Determines if a message is a follow-up to previous conversation or a new topic.
"""

from typing import Optional, Tuple
from anthropic import AsyncAnthropic
import logging

from app.core.config import settings
from app.schemas.ai import TopicMode

logger = logging.getLogger(__name__)


class TopicDetector:
    """
    Detect if user message continues previous topic or starts new one.

    Strategy:
    1. Heuristic rules for clear cases
    2. Simple comparison for ambiguous cases
    """

    # Phrases that indicate follow-up
    FOLLOW_UP_PATTERNS = [
        "also", "additionally", "another thing",
        "what about", "how about", "and what",
        "you mentioned", "earlier you said",
        "going back to", "regarding that",
        "same scene", "that character", "the scene",
        "can you", "could you also"
    ]

    # Phrases that indicate new topic
    NEW_TOPIC_PATTERNS = [
        "new question", "different question",
        "switching topics", "unrelated",
        "actually,", "by the way,",
        "separate question", "quick question"
    ]

    async def detect_mode(
        self,
        current_message: str,
        last_assistant_message: Optional[str] = None,
        last_user_message: Optional[str] = None
    ) -> Tuple[TopicMode, float]:
        """
        Detect topic mode for current message.

        Args:
            current_message: Current user message
            last_assistant_message: Previous assistant response (if any)
            last_user_message: Previous user message (if any)

        Returns:
            Tuple of (TopicMode, confidence 0-1)
        """
        message_lower = current_message.lower()

        # No history = definitely new topic
        if not last_assistant_message and not last_user_message:
            return TopicMode.NEW_TOPIC, 1.0

        # Check explicit patterns
        follow_up_score = sum(
            1 for p in self.FOLLOW_UP_PATTERNS
            if p in message_lower
        )
        new_topic_score = sum(
            1 for p in self.NEW_TOPIC_PATTERNS
            if p in message_lower
        )

        if follow_up_score > new_topic_score + 1:
            return TopicMode.FOLLOW_UP, 0.9

        if new_topic_score > follow_up_score + 1:
            return TopicMode.NEW_TOPIC, 0.9

        # Check for pronoun references (suggests follow-up)
        pronouns = ["it", "they", "that", "this", "those", "these", "he", "she"]
        pronoun_at_start = any(
            message_lower.startswith(p + " ") or message_lower.startswith(p + "'")
            for p in pronouns
        )
        if pronoun_at_start:
            return TopicMode.FOLLOW_UP, 0.7

        # Check for scene number references matching previous context
        if last_assistant_message:
            import re
            prev_scenes = set(re.findall(r'[Ss]cene (\d+)', last_assistant_message))
            curr_scenes = set(re.findall(r'[Ss]cene (\d+)', current_message))

            if prev_scenes and curr_scenes and prev_scenes & curr_scenes:
                return TopicMode.FOLLOW_UP, 0.8

        # Default: treat short messages as more likely follow-ups
        if len(current_message.split()) < 10:
            return TopicMode.FOLLOW_UP, 0.5

        return TopicMode.NEW_TOPIC, 0.5


# Add to schemas/ai.py
from enum import Enum

class TopicMode(str, Enum):
    FOLLOW_UP = "follow_up"
    NEW_TOPIC = "new_topic"
```

### Integration with Context Builder

**File**: `app/services/context_builder.py`

```python
from app.services.topic_detector import TopicDetector, TopicMode

class ContextBuilder:

    def __init__(self, db: AsyncSession):
        self.db = db
        self.topic_detector = TopicDetector()
        # ... existing init ...

    async def build_prompt(
        self,
        script_id: UUID,
        message: str,
        intent: IntentType,
        conversation_id: Optional[UUID] = None,
        current_scene_id: Optional[UUID] = None,
        budget_tier: BudgetTier = BudgetTier.STANDARD,
        skip_scene_retrieval: bool = False,
        tools_enabled: bool = False
    ) -> Dict:
        """Build prompt with topic-aware history gating."""

        # Detect topic mode
        topic_mode = TopicMode.NEW_TOPIC
        if conversation_id:
            # Get last messages for topic detection
            last_messages = await self.conversation_service.get_recent_messages(
                conversation_id, limit=2
            )

            if last_messages:
                last_user = next(
                    (m.content for m in last_messages if m.role == "user"),
                    None
                )
                last_assistant = next(
                    (m.content for m in last_messages if m.role == "assistant"),
                    None
                )

                topic_mode, confidence = await self.topic_detector.detect_mode(
                    current_message=message,
                    last_assistant_message=last_assistant,
                    last_user_message=last_user
                )

                logger.info(f"Topic mode: {topic_mode} (confidence: {confidence:.2f})")

        # Get conversation history based on topic mode
        if topic_mode == TopicMode.NEW_TOPIC:
            # Fresh start - no history, or just a 1-sentence summary
            conversation_context = ""
        else:
            # Follow-up - include recent history
            conversation_context = await self._get_conversation_context(
                conversation_id, budget_tier
            )

        # ... rest of build_prompt ...
```

---

## P2: Output Format Constraints

### Design

Replace token-based limits with structural constraints that models follow better:
- Word budget ("≤200 words")
- Bullet limits ("5 bullets max")
- Priority ordering ("most important first")

### Implementation

**File**: `app/routers/ai_router.py`

```python
# Synthesis prompt with format constraints
SYNTHESIS_FORMAT_INSTRUCTIONS = """
RESPONSE FORMAT REQUIREMENTS (CRITICAL):
1. Maximum 200 words
2. Maximum 5 bullet points if listing
3. Lead with the most important finding
4. Be specific: cite scene numbers, quote key lines
5. Do not mention tools, evidence, or analysis process

If you cannot fit everything, prioritize the MOST IMPORTANT information first.
Truncation from the end is acceptable; truncation of the key insight is not.
"""

async def _synthesize_with_evidence(
    client: AsyncAnthropic,
    system: List[dict],
    evidence: Evidence
) -> str:
    """Generate final response with format constraints."""

    synthesis_prompt = f"""Answer this question: {evidence.user_question}

Using this evidence:
{evidence.to_prompt_text()}

{SYNTHESIS_FORMAT_INSTRUCTIONS}"""

    response = await client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=FINAL_SYNTHESIS_MAX_TOKENS,  # Still set as safety limit
        system=system,
        messages=[{"role": "user", "content": synthesis_prompt}]
    )

    return _extract_all_text(response.content)
```

### Intent-Specific Format Constraints

**File**: `app/services/context_builder.py`

```python
FORMAT_CONSTRAINTS = {
    IntentType.LOCAL_EDIT: """
        FORMAT: Provide exactly one revised version.
        Maximum 3 sentences of explanation before the revision.
        The revision should be clearly marked.""",

    IntentType.SCENE_FEEDBACK: """
        FORMAT: Structure as:
        1. Strength (1-2 sentences)
        2. Area for improvement (1-2 sentences)
        3. Specific suggestion (1-2 sentences)
        Maximum 150 words total.""",

    IntentType.GLOBAL_QUESTION: """
        FORMAT: Maximum 5 bullet points.
        Each bullet: scene reference + specific observation.
        Lead with the most significant finding.
        Maximum 200 words total.""",

    IntentType.BRAINSTORM: """
        FORMAT: Provide 3-5 options, each in 1-2 sentences.
        Briefly note trade-offs.
        Maximum 200 words total.""",

    IntentType.NARRATIVE_ANALYSIS: """
        FORMAT:
        - Key finding (1 sentence)
        - Supporting evidence with scene numbers (2-3 bullets)
        - Implication (1 sentence)
        Maximum 200 words total."""
}
```

---

## Implementation Order

### Phase 1: P0 Bug Fixes (Day 1-2)
1. ✅ P0.1: Concatenate all text blocks
2. ✅ P0.2: Increase RAG-only default
3. ✅ P0.3: Add recovery loop for truncation

**Verification**: Run existing tests, manual testing with long questions

### Phase 2: Tool Architecture (Day 3-5)
1. P1.1: Add batch tools (`get_scenes`, `get_scenes_context`)
2. P1.2: Create Evidence Builder service
3. P1.3: Integrate Evidence Builder with tool loop

**Verification**: Test with multi-scene queries, verify evidence ranking

### Phase 3: Tool-Only Mode (Day 6-7)
1. P1.4: Create tool-only system prompt
2. P1.5: Modify tool loop to use separate prompts
3. P1.6: Add prose detection/logging

**Verification**: Check tool loop logs, verify no prose in intermediate iterations

### Phase 4: History Gating (Day 8-9)
1. P2.1: Create TopicDetector service
2. P2.2: Integrate with ContextBuilder
3. P2.3: Add format constraints

**Verification**: Test follow-up vs new topic detection, verify cache hit rates

---

## Testing Strategy

### Unit Tests

```python
# tests/test_evidence_builder.py

import pytest
from app.services.evidence_builder import EvidenceBuilder, EvidenceItem

class TestEvidenceBuilder:

    @pytest.fixture
    def builder(self):
        return EvidenceBuilder()

    def test_parse_single_tool_result(self, builder):
        result = {
            "tool_name": "get_scene",
            "tool_input": {"scene_index": 4},
            "result": "SCENE 5: INT. OFFICE - DAY\n\nJohn enters..."
        }

        items = builder._parse_tool_result(result)

        assert len(items) == 1
        assert items[0].source_tool == "get_scene"
        assert items[0].scene_numbers == [5]

    def test_parse_batch_result_splits_scenes(self, builder):
        result = {
            "tool_name": "get_scenes",
            "tool_input": {"scene_indices": [0, 1, 2]},
            "result": """--- SCENE 1: INT. OFFICE ---

Content 1

--- SCENE 2: EXT. PARK ---

Content 2

--- SCENE 3: INT. HOME ---

Content 3"""
        }

        items = builder._parse_tool_result(result)

        assert len(items) == 3
        assert items[0].scene_numbers == [1]
        assert items[1].scene_numbers == [2]

    @pytest.mark.asyncio
    async def test_relevance_scoring(self, builder):
        items = [
            EvidenceItem("get_scene", [1], "John meets Mary at the park"),
            EvidenceItem("get_scene", [2], "Car chase through downtown"),
            EvidenceItem("get_scene", [3], "John confesses his love to Mary")
        ]

        await builder._score_items(items, "What happens between John and Mary?")

        # Items with John and Mary should score higher
        assert items[0].relevance_score > items[1].relevance_score
        assert items[2].relevance_score > items[1].relevance_score

    @pytest.mark.asyncio
    async def test_truncation_to_budget(self, builder):
        builder.MAX_TOTAL_CHARS = 500

        tool_results = [
            {"tool_name": "get_scene", "tool_input": {"scene_index": i}, "result": "x" * 200}
            for i in range(10)
        ]

        evidence = await builder.build_evidence(tool_results, "Test question")

        assert evidence.was_truncated
        assert evidence.total_chars <= 500
        assert len(evidence.items) < 10


# tests/test_topic_detector.py

import pytest
from app.services.topic_detector import TopicDetector, TopicMode

class TestTopicDetector:

    @pytest.fixture
    def detector(self):
        return TopicDetector()

    @pytest.mark.asyncio
    async def test_no_history_is_new_topic(self, detector):
        mode, conf = await detector.detect_mode("What happens in scene 5?")
        assert mode == TopicMode.NEW_TOPIC
        assert conf == 1.0

    @pytest.mark.asyncio
    async def test_explicit_follow_up(self, detector):
        mode, conf = await detector.detect_mode(
            "Also, what about scene 6?",
            last_assistant_message="Scene 5 shows..."
        )
        assert mode == TopicMode.FOLLOW_UP

    @pytest.mark.asyncio
    async def test_pronoun_reference(self, detector):
        mode, conf = await detector.detect_mode(
            "It seems rushed, doesn't it?",
            last_assistant_message="Scene 5 is a romantic scene..."
        )
        assert mode == TopicMode.FOLLOW_UP

    @pytest.mark.asyncio
    async def test_scene_number_overlap(self, detector):
        mode, conf = await detector.detect_mode(
            "What's John's motivation in scene 5?",
            last_assistant_message="In Scene 5, we see John and Mary meet..."
        )
        assert mode == TopicMode.FOLLOW_UP
```

### Integration Tests

```python
# tests/test_tool_loop_integration.py

@pytest.mark.asyncio
async def test_tool_loop_with_evidence_builder():
    """Test full tool loop with evidence building."""
    # Setup mock responses, verify evidence is built correctly
    pass

@pytest.mark.asyncio
async def test_truncation_recovery():
    """Test that max_tokens truncation triggers recovery."""
    # Mock a truncated response, verify recovery attempt
    pass

@pytest.mark.asyncio
async def test_batch_tools_reduce_round_trips():
    """Test that batch tools reduce API calls."""
    # Compare get_scene x 5 vs get_scenes([0,1,2,3,4])
    pass
```

### Manual Testing Checklist

- [ ] Long question in RAG-only mode → no truncation
- [ ] Multi-scene comparison query → uses batch tool
- [ ] Follow-up question → includes history
- [ ] New topic question → fresh context
- [ ] Max iterations reached → clean synthesis
- [ ] Tool loop truncation → recovery attempted

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `app/services/ai_service.py` | `_extract_all_text()`, default max_tokens |
| `app/routers/ai_router.py` | Recovery loop, tool-only mode, evidence integration |
| `app/services/mcp_tools.py` | Batch tools, status messages |
| `app/services/evidence_builder.py` | NEW: Evidence building |
| `app/services/topic_detector.py` | NEW: Topic detection |
| `app/services/context_builder.py` | History gating, format constraints |
| `app/schemas/ai.py` | TopicMode enum, ToolCallMetadata updates |

---

## Success Metrics

1. **Truncation Rate**: < 5% of responses hit max_tokens (currently ~15%)
2. **Recovery Success**: > 90% of truncation recoveries succeed
3. **Batch Tool Adoption**: > 50% of multi-scene queries use batch tools
4. **Cache Hit Rate**: > 60% on repeated interactions (improved by history gating)
5. **Response Quality**: User satisfaction (qualitative)
