"""
Message Router Service

Unified classification for domain, request type, intent, and continuity.
Replaces separate IntentClassifier and TopicDetector with single coherent decision.
"""

from typing import Optional
import json
import re
import logging
from anthropic import AsyncAnthropic

from app.core.config import settings
from app.schemas.ai import (
    DomainType, RequestType, IntentType, TopicMode,
    ReferenceType, RouterResult
)

logger = logging.getLogger(__name__)


class MessageRouter:
    """
    Unified message classification for optimal context assembly.

    Single LLM call returns all classification decisions:
    - domain: GENERAL / SCRIPT / HYBRID
    - request_type: SUGGEST / REWRITE / DIAGNOSE / BRAINSTORM / FACTUAL
    - intent: LOCAL_EDIT / SCENE_FEEDBACK / GLOBAL_QUESTION / BRAINSTORM
    - continuity: FOLLOW_UP / NEW_TOPIC
    - refers_to: SCENE / CHARACTER / THREAD / PRIOR_ADVICE / NONE
    """

    # Keywords that strongly indicate GENERAL domain
    GENERAL_KEYWORDS = [
        "what is", "what are", "how do you", "define", "explain",
        "in general", "typically", "usually", "best practice",
        "screenwriting term", "what does", "how does one",
        "save the cat", "beat sheet", "three act", "three acts",
        "inciting incident", "hero's journey", "heros journey", "hero journey",
        "midpoint", "climax", "rising action", "falling action", "cold open",
        "b-story", "pinch point", "dark night", "break into"
    ]

    # Keywords that strongly indicate SCRIPT domain
    # Note: Use specific phrases to avoid substring matches (e.g., "our" matches "journey")
    SCRIPT_KEYWORDS = [
        "my script", "this script", "the script", "in my", "our script",
        "scene", "character", "dialogue", " act ", "my draft", "this draft",
        "this scene", "that scene", "this part", "my story"
    ]

    # Keywords that indicate REWRITE request type
    REWRITE_KEYWORDS = [
        "rewrite", "revise", "draft", "give me new lines",
        "write me", "create a version", "make this", "change it to",
        "write alternative", "give me alt", "punch up",
        "reword", "rephrase", "redo"
    ]

    # Keywords that indicate SUGGEST request type (default)
    SUGGEST_KEYWORDS = [
        "feedback", "thoughts", "opinion", "suggestions",
        "what do you think", "how can i improve", "any ideas",
        "advice", "recommend", "critique", "review"
    ]

    # Keywords that indicate DIAGNOSE request type
    DIAGNOSE_KEYWORDS = [
        "analyze", "analysis", "diagnose", "what's wrong",
        "what works", "what doesn't", "evaluate", "assess"
    ]

    def __init__(self):
        self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    def classify_heuristic(
        self,
        message: str,
        last_assistant_commitment: Optional[str] = None,
        has_active_scene: bool = False
    ) -> Optional[RouterResult]:
        """
        Fast heuristic classification for clear cases.

        Returns RouterResult if confident, None if LLM needed.
        """
        message_lower = message.lower()

        # Score domain
        general_score = sum(1 for kw in self.GENERAL_KEYWORDS if kw in message_lower)
        script_score = sum(1 for kw in self.SCRIPT_KEYWORDS if kw in message_lower)

        # Score request type
        rewrite_score = sum(1 for kw in self.REWRITE_KEYWORDS if kw in message_lower)
        suggest_score = sum(1 for kw in self.SUGGEST_KEYWORDS if kw in message_lower)
        diagnose_score = sum(1 for kw in self.DIAGNOSE_KEYWORDS if kw in message_lower)

        # Check for brainstorm keywords (before domain decision)
        is_brainstorm = "brainstorm" in message_lower or "ideas for" in message_lower or "what if" in message_lower

        # Determine domain
        domain = None
        if general_score > 0 and script_score == 0 and not is_brainstorm:
            # Clear GENERAL signal with no SCRIPT indicators
            domain = DomainType.GENERAL
        elif general_score > script_score + 1:
            domain = DomainType.GENERAL
        elif script_score > general_score:
            domain = DomainType.SCRIPT
        elif rewrite_score > 0 or diagnose_score > 0 or is_brainstorm:
            # REWRITE, DIAGNOSE, and BRAINSTORM requests imply SCRIPT domain
            domain = DomainType.SCRIPT
        elif has_active_scene and script_score > 0:
            # Bias toward SCRIPT when we have context AND script indicators
            domain = DomainType.SCRIPT

        # Determine request type
        request_type = RequestType.SUGGEST  # Default
        if rewrite_score > 0:
            request_type = RequestType.REWRITE
        elif diagnose_score > suggest_score:
            request_type = RequestType.DIAGNOSE
        elif "brainstorm" in message_lower or "ideas for" in message_lower or "what if" in message_lower:
            request_type = RequestType.BRAINSTORM
        elif "?" not in message and any(x in message_lower for x in ["what is", "define", "explain"]):
            request_type = RequestType.FACTUAL

        # Check for continuity indicators
        continuity = TopicMode.NEW_TOPIC
        refers_to = ReferenceType.NONE

        # Pronouns at start suggest follow-up
        pronoun_patterns = ["it ", "they ", "that ", "this ", "those ", "these ", "he ", "she ", "what about"]
        if any(message_lower.startswith(p) for p in pronoun_patterns):
            continuity = TopicMode.FOLLOW_UP
            # Try to determine what the pronoun refers to
            if any(x in message_lower for x in ["scene", "part", "section", "moment"]):
                refers_to = ReferenceType.SCENE
            elif any(x in message_lower for x in ["his ", "her ", "their ", "him ", "motivation", "backstory", "arc"]):
                # Character-related pronouns or attributes
                refers_to = ReferenceType.CHARACTER
            elif any(x in message_lower for x in ["character", "he ", "she ", "they "]):
                refers_to = ReferenceType.CHARACTER

        # "What you said/suggested" indicates prior advice reference
        if any(x in message_lower for x in ["you said", "you suggested", "your suggestion", "what you", "you mentioned", "you recommended"]):
            continuity = TopicMode.FOLLOW_UP
            refers_to = ReferenceType.PRIOR_ADVICE

        # "What about" often indicates follow-up
        if message_lower.startswith("what about") or message_lower.startswith("how about"):
            continuity = TopicMode.FOLLOW_UP

        # "And" at the start suggests continuation
        if message_lower.startswith("and ") or message_lower.startswith("also "):
            continuity = TopicMode.FOLLOW_UP

        # If domain is clear OR we have a strong continuity signal, return heuristic result
        # Follow-up messages should be SCRIPT domain by default (they're continuing a script discussion)
        needs_probe_flag = False
        if domain is None and continuity == TopicMode.FOLLOW_UP:
            domain = DomainType.SCRIPT  # Continuity questions are typically about the script
            # Mark for probe if we don't have a clear reference
            needs_probe_flag = refers_to == ReferenceType.NONE

        if domain:
            # Map to intent (simplified)
            intent = IntentType.SCENE_FEEDBACK  # Default
            if domain == DomainType.GENERAL:
                intent = IntentType.GLOBAL_QUESTION
            elif any(x in message_lower for x in ["edit", "fix", "change", "punch up"]):
                intent = IntentType.LOCAL_EDIT
            elif request_type == RequestType.BRAINSTORM:
                intent = IntentType.BRAINSTORM
            elif any(x in message_lower for x in ["arc", "theme", "structure", "pacing", "overall"]):
                intent = IntentType.GLOBAL_QUESTION

            return RouterResult(
                domain=domain,
                request_type=request_type,
                intent=intent,
                continuity=continuity,
                refers_to=refers_to,
                confidence=0.75 if needs_probe_flag else 0.8,
                needs_probe=needs_probe_flag
            )

        return None  # Need LLM classification

    async def classify_with_llm(
        self,
        message: str,
        last_assistant_commitment: Optional[str] = None,
        active_characters: Optional[list] = None,
        active_scene_ids: Optional[list] = None
    ) -> RouterResult:
        """
        LLM-based classification for ambiguous cases.

        Single call returns all classification decisions.
        Cost: ~150 tokens (~$0.00002 with Haiku)
        """
        context_info = ""
        if last_assistant_commitment:
            context_info += f"\nPrevious assistant said: \"{last_assistant_commitment[:200]}\""
        if active_characters:
            context_info += f"\nActive characters in conversation: {', '.join(active_characters[:5])}"
        if active_scene_ids:
            context_info += f"\nRecently discussed scenes: {active_scene_ids[:3]}"

        prompt = f"""Classify this user message. Return ONLY valid JSON.

Message: "{message}"
{context_info}

Classification schema:
{{
  "domain": "general" | "script" | "hybrid",
  "request_type": "suggest" | "rewrite" | "diagnose" | "brainstorm" | "factual",
  "intent": "local_edit" | "scene_feedback" | "global_question" | "brainstorm",
  "continuity": "follow_up" | "new_topic",
  "refers_to": "scene" | "character" | "thread" | "prior_advice" | "none",
  "confidence": 0.0-1.0
}}

Rules:
- domain: "general" = not about this specific script (e.g., screenwriting theory), "script" = about this script, "hybrid" = both
- request_type: "rewrite" ONLY if user explicitly asks for rewrite/revision/draft, default "suggest"
- refers_to: what does "it/they/that" refer to? Use "prior_advice" if referencing previous suggestions

JSON only:"""

        try:
            response = await self.client.messages.create(
                model="claude-haiku-4-5-20250514",
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}]
            )

            result_text = response.content[0].text.strip()

            # Parse JSON (handle potential markdown code blocks)
            if "```" in result_text:
                match = re.search(r'\{.*\}', result_text, re.DOTALL)
                if match:
                    result_text = match.group()

            result_json = json.loads(result_text)

            return RouterResult(
                domain=DomainType(result_json.get("domain", "script")),
                request_type=RequestType(result_json.get("request_type", "suggest")),
                intent=IntentType(result_json.get("intent", "scene_feedback")),
                continuity=TopicMode(result_json.get("continuity", "new_topic")),
                refers_to=ReferenceType(result_json.get("refers_to", "none")),
                confidence=float(result_json.get("confidence", 0.7)),
                needs_probe=result_json.get("domain") == "hybrid"
            )

        except Exception as e:
            logger.warning(f"LLM classification failed: {e}, using defaults")
            return RouterResult(
                domain=DomainType.SCRIPT,
                request_type=RequestType.SUGGEST,
                intent=IntentType.SCENE_FEEDBACK,
                continuity=TopicMode.NEW_TOPIC,
                refers_to=ReferenceType.NONE,
                confidence=0.5,
                needs_probe=True
            )

    async def route(
        self,
        message: str,
        last_assistant_commitment: Optional[str] = None,
        active_characters: Optional[list] = None,
        active_scene_ids: Optional[list] = None,
        has_active_scene: bool = False
    ) -> RouterResult:
        """
        Main routing method.

        Priority:
        1. Heuristic classification (fast, free)
        2. LLM classification (accurate, ~$0.00002)

        Returns unified RouterResult with all classification decisions.
        """
        # Try heuristics first
        heuristic_result = self.classify_heuristic(
            message,
            last_assistant_commitment,
            has_active_scene
        )

        if heuristic_result and heuristic_result.confidence >= 0.8:
            logger.info(f"Router: Heuristic classification - domain={heuristic_result.domain.value}, request_type={heuristic_result.request_type.value}, intent={heuristic_result.intent.value}")
            return heuristic_result

        # Fall back to LLM
        llm_result = await self.classify_with_llm(
            message,
            last_assistant_commitment,
            active_characters,
            active_scene_ids
        )

        logger.info(f"Router: LLM classification - domain={llm_result.domain.value}, request_type={llm_result.request_type.value}, intent={llm_result.intent.value}")
        return llm_result
