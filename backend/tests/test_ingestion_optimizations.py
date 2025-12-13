"""
Unit tests for AI ingestion pipeline optimizations

Tests for:
- Optimization 1: Parallel scene summary generation with semaphore
- Optimization 2: Batch OpenAI embeddings API
- Optimization 3: Parallel Phase 2 execution (outline + sheets + embeddings)
- Optimization 4: Parallel character sheet generation with semaphore
- Optimization 5: N+1 query elimination (covered by pre-fetch tests)
"""

import asyncio
import pytest
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from uuid import uuid4
from datetime import datetime
from typing import List


# =============================================================================
# OPTIMIZATION 1: Parallel Scene Summary Generation
# =============================================================================

class TestParallelSceneSummaries:
    """Tests for Optimization 1: Parallel scene summary generation"""

    @pytest.mark.asyncio
    async def test_batch_generate_uses_semaphore(self):
        """Test that parallel generation respects semaphore concurrency limit"""
        # Patch at module level before importing
        with patch('app.services.ingestion_service.AsyncAnthropic') as mock_anthropic:
            from app.services.ingestion_service import IngestionService

            db_mock = AsyncMock()
            service = IngestionService(db_mock)

            script_id = uuid4()

            # Create mock scenes
            scenes = [
                Mock(scene_id=uuid4(), position=i, scene_heading=f"INT. SCENE {i}", content_blocks=[{"text": f"Scene {i} content"}], hash=None)
                for i in range(5)
            ]

            # Mock database queries
            db_mock.execute = AsyncMock(side_effect=[
                # First call: get scenes
                Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=scenes)))),
                # Second call: get existing summaries (empty)
                Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[])))),
            ])
            db_mock.commit = AsyncMock()

            # Track concurrent calls
            max_concurrent = 0
            current_concurrent = 0
            lock = asyncio.Lock()

            async def mock_api_call(*args, **kwargs):
                nonlocal current_concurrent, max_concurrent
                async with lock:
                    current_concurrent += 1
                    max_concurrent = max(max_concurrent, current_concurrent)

                await asyncio.sleep(0.01)  # Simulate API latency

                async with lock:
                    current_concurrent -= 1

                return Mock(content=[Mock(text="**Action:** Test summary")])

            service.client.messages.create = mock_api_call

            # Use max_concurrent=2 to verify semaphore works
            await service.batch_generate_scene_summaries(
                script_id,
                max_concurrent=2
            )

            # Semaphore should have limited concurrency to 2
            assert max_concurrent <= 2

    @pytest.mark.asyncio
    async def test_batch_generate_prefetches_existing(self):
        """Test that batch generation pre-fetches existing summaries"""
        with patch('app.services.ingestion_service.AsyncAnthropic') as mock_anthropic:
            from app.services.ingestion_service import IngestionService

            db_mock = AsyncMock()
            service = IngestionService(db_mock)

            script_id = uuid4()
            scene_id_1 = uuid4()
            scene_id_2 = uuid4()

            # Create mock scenes
            scenes = [
                Mock(scene_id=scene_id_1, position=1, scene_heading="INT. SCENE 1", content_blocks=[{"text": "Content 1"}], hash=None),
                Mock(scene_id=scene_id_2, position=2, scene_heading="INT. SCENE 2", content_blocks=[{"text": "Content 2"}], hash=None),
            ]

            # Existing summary for scene 1
            existing_summary = Mock(scene_id=scene_id_1, summary_text="Existing summary")

            call_count = 0

            async def mock_execute(query):
                nonlocal call_count
                call_count += 1

                if call_count == 1:
                    # First call: get scenes
                    return Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=scenes))))
                elif call_count == 2:
                    # Second call: get existing summaries (pre-fetch)
                    return Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[existing_summary]))))
                return Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[]))))

            db_mock.execute = mock_execute
            db_mock.commit = AsyncMock()
            db_mock.add = Mock()

            async def mock_api_call(*args, **kwargs):
                return Mock(content=[Mock(text="**Action:** New summary")])

            service.client.messages.create = mock_api_call

            summaries = await service.batch_generate_scene_summaries(script_id)

            # Should have made exactly 2 database queries (scenes + pre-fetch summaries)
            # Not N+1 queries (one per scene)
            assert call_count == 2

    @pytest.mark.asyncio
    async def test_batch_generate_batch_commits(self):
        """Test that batch generation uses single batch commit"""
        with patch('app.services.ingestion_service.AsyncAnthropic') as mock_anthropic:
            from app.services.ingestion_service import IngestionService

            db_mock = AsyncMock()
            service = IngestionService(db_mock)

            script_id = uuid4()

            scenes = [
                Mock(scene_id=uuid4(), position=i, scene_heading=f"INT. SCENE {i}", content_blocks=[{"text": f"Content {i}"}], hash=None)
                for i in range(3)
            ]

            db_mock.execute = AsyncMock(side_effect=[
                Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=scenes)))),
                Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[])))),
            ])
            db_mock.commit = AsyncMock()
            db_mock.add = Mock()

            async def mock_api_call(*args, **kwargs):
                return Mock(content=[Mock(text="**Action:** Summary")])

            service.client.messages.create = mock_api_call

            await service.batch_generate_scene_summaries(script_id)

            # Should have exactly 1 commit (batch commit)
            assert db_mock.commit.call_count == 1

    @pytest.mark.asyncio
    async def test_batch_generate_handles_partial_failures(self):
        """Test graceful handling of partial failures during parallel generation"""
        with patch('app.services.ingestion_service.AsyncAnthropic') as mock_anthropic:
            from app.services.ingestion_service import IngestionService

            db_mock = AsyncMock()
            service = IngestionService(db_mock)

            script_id = uuid4()

            scenes = [
                Mock(scene_id=uuid4(), position=i, scene_heading=f"INT. SCENE {i}", content_blocks=[{"text": f"Content {i}"}], hash=None)
                for i in range(3)
            ]

            db_mock.execute = AsyncMock(side_effect=[
                Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=scenes)))),
                Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[])))),
            ])
            db_mock.commit = AsyncMock()
            db_mock.add = Mock()

            call_count = 0

            async def mock_api_with_failure(*args, **kwargs):
                nonlocal call_count
                call_count += 1
                if call_count == 2:
                    raise Exception("API error for scene 2")
                return Mock(content=[Mock(text="**Action:** Summary")])

            service.client.messages.create = mock_api_with_failure

            summaries = await service.batch_generate_scene_summaries(script_id)

            # Should have 2 successful summaries (1 failed)
            assert len(summaries) == 2


# =============================================================================
# OPTIMIZATION 2: Batch OpenAI Embeddings
# =============================================================================

class TestBatchEmbeddings:
    """Tests for Optimization 2: Batch OpenAI embeddings API"""

    @pytest.mark.asyncio
    async def test_generate_batch_embeddings_single_call(self):
        """Test that batch embeddings uses single API call for multiple texts"""
        from app.services.embedding_service import EmbeddingService

        db_mock = AsyncMock()
        service = EmbeddingService(db_mock)

        texts = ["Text 1", "Text 2", "Text 3"]

        # Mock httpx client
        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client_class.return_value.__aenter__.return_value = mock_client

            # Mock response with embeddings for all texts
            mock_client.post.return_value = Mock(
                status_code=200,
                json=Mock(return_value={
                    "data": [
                        {"index": 0, "embedding": [0.1] * 1536},
                        {"index": 1, "embedding": [0.2] * 1536},
                        {"index": 2, "embedding": [0.3] * 1536},
                    ]
                })
            )

            embeddings = await service.generate_batch_embeddings(texts)

        # Should return embeddings for all 3 texts
        assert len(embeddings) == 3

        # Should have made exactly 1 API call
        assert mock_client.post.call_count == 1

        # Verify the API was called with array of texts
        call_args = mock_client.post.call_args
        assert call_args[1]["json"]["input"] == texts

    @pytest.mark.asyncio
    async def test_generate_batch_embeddings_handles_empty_texts(self):
        """Test that empty texts are handled correctly"""
        from app.services.embedding_service import EmbeddingService

        db_mock = AsyncMock()
        service = EmbeddingService(db_mock)

        texts = ["Valid text", "", "Another valid", "   "]  # Mix of valid and empty

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client_class.return_value.__aenter__.return_value = mock_client

            mock_client.post.return_value = Mock(
                status_code=200,
                json=Mock(return_value={
                    "data": [
                        {"index": 0, "embedding": [0.1] * 1536},
                        {"index": 1, "embedding": [0.2] * 1536},
                    ]
                })
            )

            embeddings = await service.generate_batch_embeddings(texts)

        # Should return 4 items (matching input length)
        assert len(embeddings) == 4

        # Empty texts should have empty embeddings
        assert embeddings[1] == []
        assert embeddings[3] == []

        # Valid texts should have embeddings
        assert len(embeddings[0]) == 1536
        assert len(embeddings[2]) == 1536

    @pytest.mark.asyncio
    async def test_generate_batch_embeddings_respects_batch_size(self):
        """Test that large batches are split correctly"""
        from app.services.embedding_service import EmbeddingService

        db_mock = AsyncMock()
        service = EmbeddingService(db_mock)

        # Create 150 texts (should be split into 2 batches with batch_size=100)
        texts = [f"Text {i}" for i in range(150)]

        call_count = 0

        def create_mock_response(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            batch_texts = kwargs["json"]["input"]
            return Mock(
                status_code=200,
                json=Mock(return_value={
                    "data": [
                        {"index": i, "embedding": [0.1] * 1536}
                        for i in range(len(batch_texts))
                    ]
                })
            )

        with patch('httpx.AsyncClient') as mock_client_class:
            mock_client = AsyncMock()
            mock_client_class.return_value.__aenter__.return_value = mock_client
            mock_client.post.side_effect = create_mock_response

            embeddings = await service.generate_batch_embeddings(texts, batch_size=100)

        # Should have made 2 API calls (100 + 50)
        assert call_count == 2

        # Should return all 150 embeddings
        assert len(embeddings) == 150

    @pytest.mark.asyncio
    async def test_batch_embed_scene_summaries_prefetches(self):
        """Test that batch embedding pre-fetches existing embeddings"""
        from app.services.embedding_service import EmbeddingService

        db_mock = AsyncMock()
        service = EmbeddingService(db_mock)

        script_id = uuid4()
        scene_id_1 = uuid4()
        scene_id_2 = uuid4()

        # Mock summaries
        summary_1 = Mock(scene_id=scene_id_1, summary_text="Summary 1")
        summary_2 = Mock(scene_id=scene_id_2, summary_text="Summary 2")
        scene_1 = Mock(scene_id=scene_id_1, script_id=script_id)
        scene_2 = Mock(scene_id=scene_id_2, script_id=script_id)

        # Existing embedding for scene 1
        existing_embedding = Mock(scene_id=scene_id_1)

        call_count = 0

        async def mock_execute(query):
            nonlocal call_count
            call_count += 1

            if call_count == 1:
                # First call: get summaries with scenes
                return Mock(all=Mock(return_value=[(summary_1, scene_1), (summary_2, scene_2)]))
            elif call_count == 2:
                # Second call: get existing embeddings (pre-fetch)
                return Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[existing_embedding]))))
            return Mock()

        db_mock.execute = mock_execute
        db_mock.commit = AsyncMock()
        db_mock.add = Mock()

        with patch.object(service, 'generate_batch_embeddings', new_callable=AsyncMock) as mock_batch:
            mock_batch.return_value = [[0.1] * 1536]  # Only 1 embedding needed

            await service.batch_embed_scene_summaries(script_id)

        # Should have called batch embedding with only 1 text (scene 2)
        # Scene 1 already has an embedding
        assert mock_batch.call_count == 1
        call_args = mock_batch.call_args[0][0]  # Get texts argument
        assert len(call_args) == 1


# =============================================================================
# OPTIMIZATION 3: Parallel Phase 2 Execution
# =============================================================================

class TestParallelPhase2:
    """Tests for Optimization 3: Parallel Phase 2 (outline + sheets + embeddings)"""

    @pytest.mark.asyncio
    async def test_trigger_full_analysis_runs_phase2_in_parallel(self):
        """Test that Phase 2 tasks run concurrently"""
        # Patch Anthropic client before importing ScriptStateService
        with patch('app.services.ingestion_service.AsyncAnthropic'):
            from app.services.script_state_service import ScriptStateService

            db_mock = AsyncMock()
            service = ScriptStateService(db_mock)

            script_id = uuid4()

            # Track execution order and timing
            execution_log = []

            # Mock Phase 1 (scene summaries)
            async def mock_summaries(*args, **kwargs):
                execution_log.append(("summaries_start", asyncio.get_event_loop().time()))
                await asyncio.sleep(0.01)
                execution_log.append(("summaries_end", asyncio.get_event_loop().time()))
                return [Mock()]

            # Mock Phase 2 tasks
            async def mock_outline(*args, **kwargs):
                execution_log.append(("outline_start", asyncio.get_event_loop().time()))
                await asyncio.sleep(0.02)
                execution_log.append(("outline_end", asyncio.get_event_loop().time()))
                return Mock(tokens_estimate=100)

            async def mock_sheets(*args, **kwargs):
                execution_log.append(("sheets_start", asyncio.get_event_loop().time()))
                await asyncio.sleep(0.02)
                execution_log.append(("sheets_end", asyncio.get_event_loop().time()))
                return [Mock()]

            async def mock_embeddings(*args, **kwargs):
                execution_log.append(("embeddings_start", asyncio.get_event_loop().time()))
                await asyncio.sleep(0.02)
                execution_log.append(("embeddings_end", asyncio.get_event_loop().time()))
                return [Mock()]

            with patch.object(service.ingestion_service, 'batch_generate_scene_summaries', side_effect=mock_summaries):
                with patch.object(service.ingestion_service, 'generate_script_outline', side_effect=mock_outline):
                    with patch.object(service.ingestion_service, 'batch_generate_character_sheets', side_effect=mock_sheets):
                        with patch.object(service.embedding_service, 'batch_embed_scene_summaries', side_effect=mock_embeddings):
                            await service.trigger_full_analysis(script_id)

            # Verify Phase 1 completes before Phase 2 starts
            summaries_end = next(t for name, t in execution_log if name == "summaries_end")
            phase2_starts = [t for name, t in execution_log if name.endswith("_start") and name != "summaries_start"]

            for start_time in phase2_starts:
                assert start_time >= summaries_end, "Phase 2 should start after Phase 1 completes"

            # Verify Phase 2 tasks start at approximately the same time (parallel)
            outline_start = next(t for name, t in execution_log if name == "outline_start")
            sheets_start = next(t for name, t in execution_log if name == "sheets_start")
            embeddings_start = next(t for name, t in execution_log if name == "embeddings_start")

            # All Phase 2 tasks should start within 0.005s of each other (parallel execution)
            start_times = [outline_start, sheets_start, embeddings_start]
            assert max(start_times) - min(start_times) < 0.005, "Phase 2 tasks should start in parallel"

    @pytest.mark.asyncio
    async def test_trigger_full_analysis_handles_partial_failures(self):
        """Test that Phase 2 continues despite individual task failures"""
        # Patch Anthropic client before importing ScriptStateService
        with patch('app.services.ingestion_service.AsyncAnthropic'):
            from app.services.script_state_service import ScriptStateService

            db_mock = AsyncMock()
            service = ScriptStateService(db_mock)

            script_id = uuid4()

            # Mock Phase 1
            async def mock_summaries(*args, **kwargs):
                return [Mock()]

            # Mock Phase 2 with one failure
            async def mock_outline(*args, **kwargs):
                raise Exception("Outline generation failed")

            async def mock_sheets(*args, **kwargs):
                return [Mock()]  # Success

            async def mock_embeddings(*args, **kwargs):
                return [Mock()]  # Success

            with patch.object(service.ingestion_service, 'batch_generate_scene_summaries', side_effect=mock_summaries):
                with patch.object(service.ingestion_service, 'generate_script_outline', side_effect=mock_outline):
                    with patch.object(service.ingestion_service, 'batch_generate_character_sheets', side_effect=mock_sheets):
                        with patch.object(service.embedding_service, 'batch_embed_scene_summaries', side_effect=mock_embeddings):
                            # Should not raise - graceful degradation
                            await service.trigger_full_analysis(script_id)

            # Test passes if no exception is raised


# =============================================================================
# OPTIMIZATION 4: Parallel Character Sheet Generation
# =============================================================================

class TestParallelCharacterSheets:
    """Tests for Optimization 4: Parallel character sheet generation"""

    @pytest.mark.asyncio
    async def test_batch_generate_character_sheets_uses_semaphore(self):
        """Test that parallel generation respects semaphore concurrency limit"""
        # Patch Anthropic client before importing IngestionService
        with patch('app.services.ingestion_service.AsyncAnthropic') as mock_anthropic:
            from app.services.ingestion_service import IngestionService

            db_mock = AsyncMock()
            service = IngestionService(db_mock)

            script_id = uuid4()

            # Track concurrent calls
            max_concurrent = 0
            current_concurrent = 0
            lock = asyncio.Lock()

            async def mock_api_call(*args, **kwargs):
                nonlocal current_concurrent, max_concurrent
                async with lock:
                    current_concurrent += 1
                    max_concurrent = max(max_concurrent, current_concurrent)

                await asyncio.sleep(0.01)

                async with lock:
                    current_concurrent -= 1

                return Mock(content=[Mock(text="**WANT:** Test character sheet")])

            call_count = 0

            async def mock_execute(query):
                nonlocal call_count
                call_count += 1

                if call_count == 1:
                    # Get character names
                    return Mock(__iter__=Mock(return_value=iter([("JOHN",), ("MARY",), ("BOB",), ("ALICE",), ("EVE",)])))
                elif call_count == 2:
                    # Get existing sheets (empty)
                    return Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[]))))
                elif call_count == 3:
                    # Get scene data for characters
                    return Mock(__iter__=Mock(return_value=iter([
                        ("JOHN", Mock(position=1), Mock(summary_text="Scene 1")),
                        ("MARY", Mock(position=1), Mock(summary_text="Scene 1")),
                        ("BOB", Mock(position=2), Mock(summary_text="Scene 2")),
                        ("ALICE", Mock(position=2), Mock(summary_text="Scene 2")),
                        ("EVE", Mock(position=3), Mock(summary_text="Scene 3")),
                    ])))
                return Mock()

            db_mock.execute = mock_execute
            db_mock.commit = AsyncMock()
            db_mock.add = Mock()

            service.client.messages.create = mock_api_call

            await service.batch_generate_character_sheets(
                script_id,
                max_concurrent=2  # Limit to 2 concurrent
            )

            # Semaphore should have limited concurrency to 2
            assert max_concurrent <= 2

    @pytest.mark.asyncio
    async def test_batch_generate_character_sheets_prefetches_all_data(self):
        """Test that batch generation pre-fetches existing sheets AND scene data"""
        # Patch Anthropic client before importing IngestionService
        with patch('app.services.ingestion_service.AsyncAnthropic') as mock_anthropic:
            from app.services.ingestion_service import IngestionService

            db_mock = AsyncMock()
            service = IngestionService(db_mock)

            script_id = uuid4()

            query_types = []
            call_count = 0

            async def mock_execute(query):
                nonlocal call_count
                call_count += 1

                # Use call order instead of query string parsing (more reliable)
                if call_count == 1:
                    # First call: get character names
                    query_types.append("get_characters")
                    return Mock(__iter__=Mock(return_value=iter([("JOHN",), ("MARY",)])))
                elif call_count == 2:
                    # Second call: prefetch existing sheets
                    query_types.append("prefetch_sheets")
                    return Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[]))))
                elif call_count == 3:
                    # Third call: prefetch scene data
                    query_types.append("prefetch_scene_data")
                    return Mock(__iter__=Mock(return_value=iter([
                        ("JOHN", Mock(position=1), Mock(summary_text="Summary 1")),
                        ("MARY", Mock(position=1), Mock(summary_text="Summary 1")),
                    ])))
                return Mock()

            db_mock.execute = mock_execute
            db_mock.commit = AsyncMock()
            db_mock.add = Mock()

            async def mock_create(*args, **kwargs):
                return Mock(content=[Mock(text="**WANT:** Sheet content")])

            service.client.messages.create = mock_create

            await service.batch_generate_character_sheets(script_id)

            # Should have exactly 3 pre-fetch queries (not N+1)
            assert query_types == ["get_characters", "prefetch_sheets", "prefetch_scene_data"]

    @pytest.mark.asyncio
    async def test_batch_generate_character_sheets_batch_commits(self):
        """Test that batch generation uses single batch commit"""
        # Patch Anthropic client before importing IngestionService
        with patch('app.services.ingestion_service.AsyncAnthropic') as mock_anthropic:
            from app.services.ingestion_service import IngestionService

            db_mock = AsyncMock()
            service = IngestionService(db_mock)

            script_id = uuid4()

            call_count = 0

            async def mock_execute(query):
                nonlocal call_count
                call_count += 1

                if call_count == 1:
                    return Mock(__iter__=Mock(return_value=iter([("JOHN",), ("MARY",), ("BOB",)])))
                elif call_count == 2:
                    return Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[]))))
                elif call_count == 3:
                    return Mock(__iter__=Mock(return_value=iter([
                        ("JOHN", Mock(position=1), Mock(summary_text="S1")),
                        ("MARY", Mock(position=1), Mock(summary_text="S1")),
                        ("BOB", Mock(position=2), Mock(summary_text="S2")),
                    ])))
                return Mock()

            db_mock.execute = mock_execute
            db_mock.commit = AsyncMock()
            db_mock.add = Mock()

            async def mock_create(*args, **kwargs):
                return Mock(content=[Mock(text="**WANT:** Sheet")])

            service.client.messages.create = mock_create

            await service.batch_generate_character_sheets(script_id)

            # Should have exactly 1 commit (batch commit)
            assert db_mock.commit.call_count == 1


# =============================================================================
# Integration Tests
# =============================================================================

class TestOptimizationIntegration:
    """Integration tests verifying optimizations work together"""

    @pytest.mark.asyncio
    async def test_full_pipeline_uses_all_optimizations(self):
        """Test that full analysis pipeline uses all optimizations"""
        # Patch Anthropic client before importing ScriptStateService
        with patch('app.services.ingestion_service.AsyncAnthropic'):
            from app.services.script_state_service import ScriptStateService

            db_mock = AsyncMock()
            service = ScriptStateService(db_mock)

            script_id = uuid4()

            # Track that optimized methods are called
            methods_called = set()

            async def track_summaries(*args, **kwargs):
                methods_called.add("batch_generate_scene_summaries")
                return [Mock()]

            async def track_outline(*args, **kwargs):
                methods_called.add("generate_script_outline")
                return Mock(tokens_estimate=100)

            async def track_sheets(*args, **kwargs):
                methods_called.add("batch_generate_character_sheets")
                return [Mock()]

            async def track_embeddings(*args, **kwargs):
                methods_called.add("batch_embed_scene_summaries")
                return [Mock()]

            with patch.object(service.ingestion_service, 'batch_generate_scene_summaries', side_effect=track_summaries):
                with patch.object(service.ingestion_service, 'generate_script_outline', side_effect=track_outline):
                    with patch.object(service.ingestion_service, 'batch_generate_character_sheets', side_effect=track_sheets):
                        with patch.object(service.embedding_service, 'batch_embed_scene_summaries', side_effect=track_embeddings):
                            await service.trigger_full_analysis(script_id)

            # All optimized batch methods should have been called
            assert methods_called == {
                "batch_generate_scene_summaries",
                "generate_script_outline",
                "batch_generate_character_sheets",
                "batch_embed_scene_summaries",
            }


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
