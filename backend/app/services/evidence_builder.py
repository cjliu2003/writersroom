"""
Evidence Builder Service

Converts raw tool results into structured, ranked evidence for synthesis.

P1.2 Implementation: Replaces raw tool dump accumulation with a structured
Evidence object that ranks results by relevance and compresses to token budget.

Key Benefits:
- Reduces recency bias by ranking all evidence by relevance
- Compresses tool results to fit token budgets
- Provides clean, structured input for synthesis
- Maintains source attribution for transparency
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from uuid import UUID
import re
import logging

logger = logging.getLogger(__name__)


@dataclass
class EvidenceItem:
    """
    Single piece of evidence extracted from a tool result.

    Represents a discrete piece of information from a tool call that
    can be ranked by relevance and included in synthesis.
    """

    source_tool: str
    scene_numbers: List[int]  # 1-based for user clarity
    content: str
    relevance_score: float = 0.0
    char_count: int = 0

    def __post_init__(self):
        self.char_count = len(self.content)


@dataclass
class Evidence:
    """
    Structured evidence collection ready for synthesis.

    Contains ranked, compressed evidence from all tool calls,
    formatted for optimal synthesis by Claude.
    """

    user_question: str
    items: List[EvidenceItem] = field(default_factory=list)
    total_chars: int = 0
    was_truncated: bool = False
    original_item_count: int = 0

    def to_prompt_text(self) -> str:
        """
        Format evidence for synthesis prompt.

        Returns a structured text representation that helps Claude
        understand the source and relevance of each piece of evidence.
        """
        if not self.items:
            return """=== GATHERED EVIDENCE ===
No evidence was gathered from tool calls.
Please provide an answer based on general knowledge, or explain that
specific information could not be retrieved."""

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
            lines.append(
                f"⚠️ {self.original_item_count - len(self.items)} lower-relevance results omitted to fit context"
            )

        return "\n".join(lines)


class EvidenceBuilder:
    """
    Build structured evidence from tool results.

    Process:
    1. Parse tool results into EvidenceItems
    2. Score by relevance to user question
    3. Rank and truncate to budget
    4. Format for synthesis

    This replaces the previous approach of directly appending raw tool
    outputs to the message history, which caused recency bias.
    """

    # Configuration
    MAX_CHARS_PER_ITEM = 1500  # Truncate individual items
    MAX_TOTAL_CHARS = 8000    # ~2000 tokens total budget
    MAX_ITEMS = 10            # Maximum evidence items

    def __init__(self, embedding_service=None):
        """
        Initialize evidence builder.

        Args:
            embedding_service: Optional service for semantic relevance scoring.
                             Falls back to keyword matching if not provided.
        """
        self.embedding_service = embedding_service

    async def build_evidence(
        self,
        tool_results: List[Dict[str, Any]],
        user_question: str,
        max_items: int = None
    ) -> Evidence:
        """
        Build evidence from tool results.

        Args:
            tool_results: List of {tool_name, tool_input, result} dicts
            user_question: Original user question for relevance scoring
            max_items: Maximum evidence items to include (default: self.MAX_ITEMS)

        Returns:
            Evidence object ready for synthesis
        """
        max_items = max_items or self.MAX_ITEMS
        evidence = Evidence(user_question=user_question)
        items: List[EvidenceItem] = []

        # Parse each tool result into EvidenceItems
        for result in tool_results:
            parsed = self._parse_tool_result(result)
            items.extend(parsed)

        evidence.original_item_count = len(items)

        if not items:
            logger.info("No evidence items extracted from tool results")
            return evidence

        # Score by relevance to user question
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

            # Check character budget
            if total_chars + item.char_count > self.MAX_TOTAL_CHARS:
                evidence.was_truncated = True
                break

            # Check item count budget
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
        """
        Parse a tool result into EvidenceItems.

        For batch tools, splits into per-scene items for better granularity
        in relevance scoring.
        """
        tool_name = result.get("tool_name", "unknown")
        content = result.get("result", "")

        if not content or content.startswith("Error:"):
            return []  # Skip empty or error results

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
        fallback_scene_numbers: List[int]
    ) -> List[EvidenceItem]:
        """
        Parse batch tool result into per-scene items.

        Splits the batch response at scene headers to allow individual
        scene content to be ranked by relevance.
        """
        items = []

        # Match pattern: --- SCENE N ... ---\n\n<content>
        # This handles both get_scenes and get_scenes_context formats
        scene_pattern = r'--- SCENE (\d+).*?---\n\n(.*?)(?=--- SCENE |\Z)'
        matches = re.findall(scene_pattern, content, re.DOTALL)

        for scene_num_str, scene_content in matches:
            scene_num = int(scene_num_str)
            scene_content = scene_content.strip()
            if scene_content:  # Only add non-empty content
                items.append(EvidenceItem(
                    source_tool=tool_name,
                    scene_numbers=[scene_num],
                    content=scene_content
                ))

        # Fallback if parsing fails - return as single item
        if not items:
            items.append(EvidenceItem(
                source_tool=tool_name,
                scene_numbers=fallback_scene_numbers,
                content=content
            ))

        return items

    def _extract_scene_numbers(self, result: Dict[str, Any]) -> List[int]:
        """
        Extract scene numbers from tool input or result.

        Returns 1-based scene numbers for user clarity.
        """
        tool_input = result.get("tool_input", {})

        # Direct scene index (single scene tools)
        if "scene_index" in tool_input:
            return [tool_input["scene_index"] + 1]  # Convert to 1-based

        # Batch scene indices
        if "scene_indices" in tool_input:
            return [i + 1 for i in tool_input["scene_indices"]]

        # Parse from result content as fallback
        content = result.get("result", "")
        matches = re.findall(r'SCENE (\d+)', content)
        return [int(m) for m in matches[:10]]  # Cap at 10

    async def _score_items(self, items: List[EvidenceItem], question: str):
        """
        Score items by relevance to question.

        Uses keyword overlap scoring with bonuses for exact phrase matches.
        Could be upgraded to embedding-based semantic similarity.
        """
        question_lower = question.lower()
        question_words = set(question_lower.split())

        # Remove common stop words for better matching
        stop_words = {"the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "to", "for", "of", "and", "or"}
        question_words -= stop_words

        for item in items:
            content_lower = item.content.lower()
            content_words = set(content_lower.split())

            # Keyword overlap scoring
            overlap = len(question_words & content_words)

            # Normalize by question length
            base_score = overlap / max(len(question_words), 1)

            # Bonus for phrase matches (first 20 chars of question)
            phrase_bonus = 0.3 if question_lower[:20] in content_lower else 0

            # Bonus for character name matches (common query pattern)
            name_bonus = 0
            for word in question_words:
                if len(word) >= 3 and word.upper() in content_lower.upper():
                    name_bonus = 0.2
                    break

            item.relevance_score = min(base_score + phrase_bonus + name_bonus, 1.0)

            # TODO: Add embedding-based semantic similarity for better ranking
            # if self.embedding_service:
            #     similarity = await self.embedding_service.compute_similarity(question, item.content)
            #     item.relevance_score = 0.3 * item.relevance_score + 0.7 * similarity
