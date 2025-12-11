"""
Embedding Service - Generate and manage vector embeddings for scene summaries
"""

import logging
import math
from typing import List, Optional
from uuid import UUID

import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scene_embedding import SceneEmbedding
from app.models.scene_summary import SceneSummary
from app.models.scene import Scene
from app.core.config import settings
from app.services.scene_service import SceneService

logger = logging.getLogger(__name__)


class EmbeddingService:
    """
    Service for generating and managing vector embeddings using OpenAI's
    text-embedding-3-small model.
    """

    EMBEDDING_MODEL = "text-embedding-3-small"
    EMBEDDING_DIMENSIONS = 1536
    SIMILARITY_THRESHOLD = 0.95  # For re-embedding decisions

    def __init__(self, db: AsyncSession):
        self.db = db
        self.api_key = settings.OPENAI_API_KEY
        self.base_url = "https://api.openai.com/v1"
        self.timeout = 30.0

    async def generate_scene_embedding(
        self,
        scene_card: str
    ) -> List[float]:
        """
        Generate embedding vector for scene card using text-embedding-3-small.

        Cost: $0.00002 per 1K tokens (90% cheaper than ada-002)
        Dimensions: 1536

        Args:
            scene_card: Scene summary text to embed

        Returns:
            List of floats representing the embedding vector

        Raises:
            Exception: If OpenAI API call fails
        """
        if not scene_card.strip():
            raise ValueError("Cannot generate embedding for empty scene card")

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/embeddings",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.EMBEDDING_MODEL,
                        "input": scene_card,
                        "encoding_format": "float"
                    }
                )

                if response.status_code != 200:
                    logger.error(f"OpenAI embeddings API error: {response.status_code} - {response.text}")
                    raise Exception(f"OpenAI embeddings API error: {response.status_code}")

                data = response.json()
                embedding = data["data"][0]["embedding"]

                if len(embedding) != self.EMBEDDING_DIMENSIONS:
                    raise Exception(f"Unexpected embedding dimensions: {len(embedding)}")

                return embedding

        except httpx.TimeoutException:
            logger.error("OpenAI embeddings API request timed out")
            raise Exception("OpenAI embeddings API request timed out")
        except Exception as e:
            logger.error(f"Error generating embedding: {str(e)}")
            raise

    async def embed_scene_summary(
        self,
        scene_summary: SceneSummary,
        force_regenerate: bool = False
    ) -> SceneEmbedding:
        """
        Generate and store embedding for a scene summary.

        Args:
            scene_summary: SceneSummary object to embed
            force_regenerate: If True, regenerate even if embedding exists

        Returns:
            SceneEmbedding object
        """
        # Check if embedding already exists
        existing = await self.db.execute(
            select(SceneEmbedding).where(SceneEmbedding.scene_id == scene_summary.scene_id)
        )
        existing_embedding = existing.scalar_one_or_none()

        # Always regenerate embedding if forced or doesn't exist
        # (No tracking of summary_text_snapshot since it's not in model)

        # Generate new embedding
        try:
            embedding_vector = await self.generate_scene_embedding(scene_summary.summary_text)

            # Get scene to access script_id
            scene = await self.db.get(Scene, scene_summary.scene_id)
            if not scene:
                raise ValueError(f"Scene {scene_summary.scene_id} not found")

            if existing_embedding:
                # Update existing
                existing_embedding.embedding = embedding_vector
                await self.db.commit()
                return existing_embedding
            else:
                # Create new
                scene_embedding = SceneEmbedding(
                    script_id=scene.script_id,
                    scene_id=scene_summary.scene_id,
                    embedding=embedding_vector
                )
                self.db.add(scene_embedding)
                await self.db.commit()
                return scene_embedding

        except Exception as e:
            logger.error(f"Error embedding scene summary {scene_summary.scene_id}: {str(e)}")
            raise

    async def batch_embed_scene_summaries(
        self,
        script_id: UUID
    ) -> List[SceneEmbedding]:
        """
        Generate embeddings for all scene summaries in a script.

        Args:
            script_id: Script ID

        Returns:
            List of SceneEmbedding objects
        """
        # Get all scene summaries for script
        summaries_result = await self.db.execute(
            select(SceneSummary)
            .join(Scene, SceneSummary.scene_id == Scene.scene_id)
            .where(Scene.script_id == script_id)
            .order_by(Scene.position)
        )

        summaries = summaries_result.scalars().all()
        embeddings = []

        for summary in summaries:
            try:
                embedding = await self.embed_scene_summary(summary)
                embeddings.append(embedding)
                logger.info(f"Generated embedding for scene {summary.scene_id}")

            except Exception as e:
                logger.error(f"Failed to embed scene {summary.scene_id}: {str(e)}")
                # Continue with other scenes
                continue

        return embeddings

    async def batch_generate_scene_embeddings(
        self,
        script_id: UUID,
        db: AsyncSession
    ) -> List[SceneEmbedding]:
        """
        Alias for batch_embed_scene_summaries for consistency with IngestionService naming.
        Generate embeddings for all scene summaries in a script.

        Args:
            script_id: Script ID
            db: Database session (for compatibility with test signature)

        Returns:
            List of SceneEmbedding objects
        """
        return await self.batch_embed_scene_summaries(script_id)

    async def should_reembed(self, scene: Scene) -> bool:
        """
        Determine if scene embedding needs regeneration.

        Checks:
        1. No embedding exists
        2. Content hash changed (scene.hash differs from current content)

        Args:
            scene: Scene to check

        Returns:
            True if re-embedding needed
        """
        # No embedding exists
        if not scene.embedding:
            return True

        # Check if content changed
        scene_service = SceneService(self.db)
        return await scene_service.detect_scene_changes(scene)

    async def semantic_search_scenes(
        self,
        script_id: UUID,
        query: str,
        top_k: int = 5
    ) -> List[tuple[Scene, float]]:
        """
        Perform semantic search to find most relevant scenes.

        Args:
            script_id: Script ID to search within
            query: Natural language query
            top_k: Number of results to return

        Returns:
            List of (Scene, similarity_score) tuples
        """
        # Generate query embedding
        query_embedding = await self.generate_scene_embedding(query)

        # Perform vector similarity search using pgvector
        # Using cosine distance (1 - cosine_similarity)
        query_str = text("""
            SELECT
                s.scene_id,
                s.position,
                s.scene_heading,
                s.content_blocks,
                1 - (se.embedding <=> :query_embedding) as similarity
            FROM scenes s
            JOIN scene_embeddings se ON s.scene_id = se.scene_id
            WHERE s.script_id = :script_id
            ORDER BY se.embedding <=> :query_embedding
            LIMIT :top_k
        """)

        result = await self.db.execute(
            query_str,
            {
                "query_embedding": str(query_embedding),
                "script_id": str(script_id),
                "top_k": top_k
            }
        )

        results = []
        for row in result:
            # Fetch complete scene object
            scene = await self.db.execute(
                select(Scene).where(Scene.scene_id == row.scene_id)
            )
            scene_obj = scene.scalar_one()
            results.append((scene_obj, row.similarity))

        return results

    @staticmethod
    def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
        """
        Compute cosine similarity between two vectors.

        Args:
            vec1: First vector
            vec2: Second vector

        Returns:
            Cosine similarity (0 to 1, where 1 is identical)
        """
        if len(vec1) != len(vec2):
            raise ValueError("Vectors must have same dimensions")

        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        magnitude1 = math.sqrt(sum(a * a for a in vec1))
        magnitude2 = math.sqrt(sum(b * b for b in vec2))

        if magnitude1 == 0 or magnitude2 == 0:
            return 0.0

        return dot_product / (magnitude1 * magnitude2)
