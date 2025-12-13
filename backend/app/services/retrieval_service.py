"""
Retrieval Service

Screenplay-aware retrieval using vector search + metadata filtering.
Implements intent-specific retrieval strategies.
"""

from typing import Optional, List, Tuple, Dict
from uuid import UUID
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from app.models.scene import Scene
from app.models.scene_summary import SceneSummary
from app.models.scene_embedding import SceneEmbedding
from app.models.scene_character import SceneCharacter
from app.services.embedding_service import EmbeddingService
from app.schemas.ai import IntentType


class RetrievalService:
    """
    Screenplay-aware retrieval using vector search + metadata filtering.
    """

    def __init__(self, db: AsyncSession):
        """Initialize retrieval service with database session."""
        self.db = db
        self.embedding_service = EmbeddingService(db)

    async def vector_search(
        self,
        script_id: UUID,
        query: str,
        limit: int = 10,
        filters: Optional[Dict] = None
    ) -> List[Tuple[Scene, SceneSummary, float]]:
        """
        Semantic search over scene embeddings.

        Args:
            script_id: Script to search within
            query: Search query text
            limit: Max results to return
            filters: Optional filters (act, character, is_key_scene)

        Returns:
            List of (Scene, SceneSummary, similarity_score) tuples
        """
        import time
        import logging
        logger = logging.getLogger(__name__)

        # Generate query embedding
        step_start = time.perf_counter()
        query_embedding = await self.embedding_service.generate_scene_embedding(query)
        logger.info(f"[RETRIEVAL] Embedding generation took {(time.perf_counter() - step_start) * 1000:.2f}ms")

        # Build base query using pgvector cosine distance
        stmt = (
            select(
                Scene,
                SceneSummary,
                SceneEmbedding
            )
            .join(SceneSummary, Scene.scene_id == SceneSummary.scene_id)
            .join(SceneEmbedding, Scene.scene_id == SceneEmbedding.scene_id)
            .where(Scene.script_id == script_id)
        )

        # Apply filters
        if filters:
            if 'act' in filters:
                # Assuming Scene model has act_number field (from FDX parser)
                stmt = stmt.where(Scene.act_number == filters['act'])

            if 'characters' in filters:
                # Filter by characters in scene
                stmt = stmt.join(SceneCharacter).where(
                    SceneCharacter.character_name.in_(filters['characters'])
                )

            if 'is_key_scene' in filters:
                stmt = stmt.where(Scene.is_key_scene == filters['is_key_scene'])

        # Order by similarity (cosine distance) and limit
        # pgvector uses <=> operator for cosine distance (0 = identical, 2 = opposite)
        # We'll execute raw SQL through SQLAlchemy for pgvector operations
        from sqlalchemy import text

        # Convert embedding list to string format for PostgreSQL vector type
        # Format: '[1.0, 2.0, 3.0]' -> PostgreSQL can cast this as vector
        embedding_str = '[' + ','.join(str(x) for x in query_embedding) + ']'

        # Build filter clauses and params dict for named parameters
        filter_clauses = ["s.script_id = :script_id"]
        params = {
            'embedding': embedding_str,
            'script_id': str(script_id),
            'limit': limit
        }

        if filters:
            if 'act' in filters:
                filter_clauses.append("s.act_number = :act")
                params['act'] = filters['act']

            if 'is_key_scene' in filters:
                filter_clauses.append("s.is_key_scene = :is_key_scene")
                params['is_key_scene'] = filters['is_key_scene']

        where_clause = " AND ".join(filter_clauses)

        # Raw SQL query for vector search using named parameters
        query_sql = f"""
        SELECT
            s.scene_id,
            s.position,
            s.scene_heading,
            s.full_content,
            s.content_blocks,
            ss.summary_text,
            1 - (se.embedding <=> CAST(:embedding AS vector)) as similarity
        FROM scenes s
        JOIN scene_summaries ss ON s.scene_id = ss.scene_id
        JOIN scene_embeddings se ON s.scene_id = se.scene_id
        WHERE {where_clause}
        ORDER BY se.embedding <=> CAST(:embedding AS vector)
        LIMIT :limit
        """

        # Execute with named parameters as dictionary
        step_start = time.perf_counter()
        result = await self.db.execute(text(query_sql), params)
        rows = result.fetchall()
        logger.info(f"[RETRIEVAL] Vector search query execution took {(time.perf_counter() - step_start) * 1000:.2f}ms (returned {len(rows)} results)")

        # Map results to tuples
        results = []
        for row in rows:
            # Reconstruct Scene and SceneSummary objects
            scene = Scene(
                scene_id=row.scene_id,
                position=row.position,
                scene_heading=row.scene_heading,
                full_content=row.full_content,
                content_blocks=row.content_blocks
            )
            summary = SceneSummary(
                scene_id=row.scene_id,
                summary_text=row.summary_text
            )
            similarity = float(row.similarity)

            results.append((scene, summary, similarity))

        return results

    async def get_scene_with_neighbors(
        self,
        scene_id: UUID,
        neighbor_count: int = 1
    ) -> List[Tuple[Scene, SceneSummary]]:
        """
        Get a scene plus N neighboring scenes for context.

        Respects narrative flow - returns scenes in order.

        Args:
            scene_id: Target scene ID
            neighbor_count: Number of scenes before and after

        Returns:
            List of (Scene, SceneSummary) tuples in order
        """
        # Get target scene - use noload to prevent eager loading of 8 relationships
        # Scene has selectin relationships that cascade to Script->ALL scenes (148!)
        target_scene_result = await self.db.execute(
            select(Scene)
            .options(noload('*'))
            .where(Scene.scene_id == scene_id)
        )
        target_scene = target_scene_result.scalar_one_or_none()

        if not target_scene:
            return []

        # Get neighbors by position - use noload on both Scene and SceneSummary
        stmt = (
            select(Scene, SceneSummary)
            .options(noload('*'))  # Prevent loading Scene relationships
            .join(SceneSummary, Scene.scene_id == SceneSummary.scene_id)
            .where(
                and_(
                    Scene.script_id == target_scene.script_id,
                    Scene.position >= target_scene.position - neighbor_count,
                    Scene.position <= target_scene.position + neighbor_count
                )
            )
            .order_by(Scene.position)
        )

        results = await self.db.execute(stmt)
        return [(scene, summary) for scene, summary in results.all()]

    async def retrieve_for_intent(
        self,
        script_id: UUID,
        message: str,
        intent: IntentType,
        current_scene_id: Optional[UUID] = None
    ) -> Dict:
        """
        Intent-specific retrieval strategy.

        Different intents require different context assembly approaches.

        Args:
            script_id: Script ID
            message: User's message
            intent: Classified intent
            current_scene_id: Current scene context (optional)

        Returns:
            Dict with retrieval_type, scenes, and focus
        """
        if intent == IntentType.LOCAL_EDIT:
            # Positional retrieval - current scene + neighbors
            if not current_scene_id:
                # Fallback to semantic search if no current scene
                results = await self.vector_search(
                    script_id=script_id,
                    query=message,
                    limit=3
                )
                return {
                    "retrieval_type": "semantic",
                    "scenes": [(scene, summary) for scene, summary, _ in results],
                    "focus": "current_scene"
                }

            scenes = await self.get_scene_with_neighbors(current_scene_id, neighbor_count=1)

            return {
                "retrieval_type": "positional",
                "scenes": scenes,
                "focus": "current_scene"
            }

        elif intent == IntentType.GLOBAL_QUESTION:
            # Pure semantic search across all scenes
            results = await self.vector_search(
                script_id=script_id,
                query=message,
                limit=10
            )

            return {
                "retrieval_type": "semantic",
                "scenes": [(scene, summary) for scene, summary, _ in results],
                "focus": "global_understanding"
            }

        elif intent == IntentType.SCENE_FEEDBACK:
            # Hybrid: current scene + semantically similar scenes
            current_scenes = []
            if current_scene_id:
                current_scenes = await self.get_scene_with_neighbors(
                    current_scene_id,
                    neighbor_count=0
                )

            semantic_results = await self.vector_search(
                script_id=script_id,
                query=message,
                limit=5
            )

            # Merge and deduplicate
            all_scenes = current_scenes + [
                (scene, summary)
                for scene, summary, _ in semantic_results
            ]

            # Deduplicate by scene_id
            seen = set()
            unique_scenes = []
            for scene, summary in all_scenes:
                if scene.scene_id not in seen:
                    seen.add(scene.scene_id)
                    unique_scenes.append((scene, summary))

            return {
                "retrieval_type": "hybrid",
                "scenes": unique_scenes,
                "focus": "scene_context"
            }

        else:  # BRAINSTORM
            # Minimal context - just outline (handled by context builder)
            return {
                "retrieval_type": "minimal",
                "scenes": [],
                "focus": "creative_freedom"
            }
