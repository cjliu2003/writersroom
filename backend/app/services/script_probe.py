"""
Script Probe Service

Lightweight script relevance check for ambiguous domain classification.
"""

from typing import Optional, List, Tuple
from uuid import UUID
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.retrieval_service import RetrievalService

logger = logging.getLogger(__name__)


class ScriptProbe:
    """
    Lightweight probe to check if a question relates to script content.

    Used when domain classification is uncertain to determine if
    the question should be SCRIPT or GENERAL.
    """

    RELEVANCE_THRESHOLD = 0.5

    def __init__(self, db: AsyncSession):
        self.db = db
        self.retrieval_service = RetrievalService(db)

    async def probe_relevance(
        self,
        script_id: UUID,
        query: str,
        limit: int = 3
    ) -> Tuple[bool, List[dict]]:
        """
        Quick check if query relates to script content.

        Args:
            script_id: Script to search
            query: User's question
            limit: Max results to check

        Returns:
            Tuple of (is_relevant, top_matches)
        """
        try:
            results = await self.retrieval_service.vector_search(
                script_id=script_id,
                query=query,
                limit=limit
            )

            if not results:
                logger.info(f"Script probe: query='{query[:50]}...' no results found")
                return False, []

            # Check if any result exceeds relevance threshold
            relevant_matches = []
            for scene, summary, score in results:
                if score >= self.RELEVANCE_THRESHOLD:
                    relevant_matches.append({
                        "scene_id": str(scene.scene_id),
                        "scene_heading": scene.scene_heading,
                        "position": scene.position,
                        "score": score
                    })

            is_relevant = len(relevant_matches) > 0

            logger.info(
                f"Script probe: query='{query[:50]}...' "
                f"relevant={is_relevant} matches={len(relevant_matches)}"
            )

            return is_relevant, relevant_matches

        except Exception as e:
            logger.warning(f"Script probe failed: {e}")
            # On error, assume relevant (safer default - will use tools)
            return True, []

    async def get_quick_context(
        self,
        script_id: UUID,
        query: str,
        limit: int = 3
    ) -> Optional[str]:
        """
        Get quick context summary for hybrid responses.

        Returns a brief summary of relevant script content for hybrid questions
        that need both general and script-specific context.

        Args:
            script_id: Script to search
            query: User's question
            limit: Max results to summarize

        Returns:
            Brief context string or None if no relevant content found
        """
        is_relevant, matches = await self.probe_relevance(script_id, query, limit)

        if not is_relevant or not matches:
            return None

        # Build brief context from matches
        context_parts = []
        for match in matches[:2]:  # Use top 2 matches
            context_parts.append(
                f"Scene {match['position'] + 1}: {match['scene_heading']}"
            )

        if context_parts:
            return "Relevant script context: " + "; ".join(context_parts)

        return None
