"""
Tests for NarrativeAnalysisService

Tests plot thread generation, scene relationship identification,
and validation of AI response parsing.
"""

import pytest
from unittest.mock import AsyncMock, Mock, patch, MagicMock
from uuid import uuid4
import json

from app.models.plot_thread import PlotThread, PlotThreadType
from app.models.scene_relationship import SceneRelationship, SceneRelationshipType
from app.models.scene import Scene
from app.models.scene_summary import SceneSummary


class TestNarrativeAnalysisService:
    """Test suite for NarrativeAnalysisService."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock async database session."""
        db = AsyncMock()
        return db

    @pytest.fixture
    def service(self, mock_db):
        """Create a NarrativeAnalysisService with mocked Anthropic client."""
        with patch('app.services.narrative_analysis_service.AsyncAnthropic'):
            from app.services.narrative_analysis_service import NarrativeAnalysisService
            svc = NarrativeAnalysisService(mock_db)
            return svc

    @pytest.fixture
    def mock_scenes(self):
        """Create mock scenes for testing."""
        script_id = uuid4()
        scenes = []
        for i in range(5):
            scene = Mock(spec=Scene)
            scene.scene_id = uuid4()
            scene.script_id = script_id
            scene.position = i + 1  # 1-based
            scene.scene_heading = f"INT. LOCATION {i + 1} - DAY"
            scenes.append(scene)
        return scenes

    @pytest.fixture
    def mock_summaries(self, mock_scenes):
        """Create mock summaries for scenes."""
        summaries = []
        for scene in mock_scenes:
            summary = Mock(spec=SceneSummary)
            summary.scene_id = scene.scene_id
            summary.summary_text = f"Scene {scene.position} summary text with plot details."
            summaries.append(summary)
        return summaries

    @pytest.mark.asyncio
    async def test_build_scene_context(self, service, mock_scenes, mock_summaries):
        """Test that scene context is built correctly for AI prompt."""
        context = service._build_scene_context(mock_scenes, mock_summaries)

        # Verify all scenes are included
        for i, scene in enumerate(mock_scenes):
            assert f"SCENE {scene.position}" in context
            assert scene.scene_heading in context
            assert mock_summaries[i].summary_text in context

    @pytest.mark.asyncio
    async def test_parse_combined_response_valid_json(self, service):
        """Test parsing valid JSON response."""

        response = json.dumps({
            "plot_threads": [
                {
                    "name": "Hero's Journey",
                    "type": "character_arc",
                    "scenes": [1, 3, 5],
                    "description": "Main character's transformation"
                }
            ],
            "scene_relationships": [
                {
                    "setup_scene": 1,
                    "payoff_scene": 5,
                    "type": "setup_payoff",
                    "description": "Gun introduced, later used"
                }
            ]
        })

        threads, relationships = service._parse_combined_response(response)

        assert len(threads) == 1
        assert threads[0]["name"] == "Hero's Journey"
        assert threads[0]["type"] == "character_arc"
        assert threads[0]["scenes"] == [1, 3, 5]

        assert len(relationships) == 1
        assert relationships[0]["setup_scene"] == 1
        assert relationships[0]["payoff_scene"] == 5
        assert relationships[0]["type"] == "setup_payoff"

    @pytest.mark.asyncio
    async def test_parse_combined_response_with_markdown_code_block(self, service):
        """Test parsing JSON wrapped in markdown code blocks."""

        response = """Here's the analysis:

```json
{
    "plot_threads": [{"name": "Test", "type": "plot", "scenes": [1, 2], "description": "Test"}],
    "scene_relationships": []
}
```

That's my analysis."""

        threads, relationships = service._parse_combined_response(response)

        assert len(threads) == 1
        assert threads[0]["name"] == "Test"

    @pytest.mark.asyncio
    async def test_parse_combined_response_invalid_json(self, service):
        """Test handling of invalid JSON response."""

        response = "This is not valid JSON at all"

        threads, relationships = service._parse_combined_response(response)

        assert threads == []
        assert relationships == []

    @pytest.mark.asyncio
    async def test_create_plot_thread_validates_name(self, service):
        """Test that empty thread names are rejected."""
        data = {
            "name": "",
            "type": "plot",
            "scenes": [1, 2, 3],
            "description": "Test"
        }

        thread = await service._create_plot_thread(uuid4(), data, total_scenes=5)

        assert thread is None

    @pytest.mark.asyncio
    async def test_create_plot_thread_validates_type(self, service):
        """Test that invalid thread types are rejected."""
        data = {
            "name": "Test Thread",
            "type": "invalid_type",
            "scenes": [1, 2, 3],
            "description": "Test"
        }

        thread = await service._create_plot_thread(uuid4(), data, total_scenes=5)

        assert thread is None

    @pytest.mark.asyncio
    async def test_create_plot_thread_validates_scene_count(self, service):
        """Test that threads with fewer than 2 valid scenes are rejected."""
        # Only 1 valid scene (scene 10 is out of range for total_scenes=5)
        data = {
            "name": "Test Thread",
            "type": "plot",
            "scenes": [1, 10],  # 10 is invalid
            "description": "Test"
        }

        thread = await service._create_plot_thread(uuid4(), data, total_scenes=5)

        assert thread is None

    @pytest.mark.asyncio
    async def test_create_plot_thread_filters_invalid_scenes(self, service):
        """Test that invalid scene numbers are filtered out."""
        data = {
            "name": "Test Thread",
            "type": "plot",
            "scenes": [1, 2, 100, -1, 3],  # 100 and -1 are invalid
            "description": "Test"
        }

        thread = await service._create_plot_thread(uuid4(), data, total_scenes=5)

        assert thread is not None
        assert thread.scenes == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_create_scene_relationship_validates_scene_order(self, service, mock_scenes):
        """Test that setup_scene must come before payoff_scene."""
        scene_map = {scene.position: scene for scene in mock_scenes}

        # setup_scene comes AFTER payoff_scene
        data = {
            "setup_scene": 5,
            "payoff_scene": 1,
            "type": "setup_payoff",
            "description": "Test"
        }

        relationship = await service._create_scene_relationship(uuid4(), data, scene_map)

        assert relationship is None

    @pytest.mark.asyncio
    async def test_create_scene_relationship_validates_type(self, service, mock_scenes):
        """Test that invalid relationship types are rejected."""
        scene_map = {scene.position: scene for scene in mock_scenes}

        data = {
            "setup_scene": 1,
            "payoff_scene": 5,
            "type": "invalid_type",
            "description": "Test"
        }

        relationship = await service._create_scene_relationship(uuid4(), data, scene_map)

        assert relationship is None

    @pytest.mark.asyncio
    async def test_create_scene_relationship_validates_scene_exists(self, service, mock_scenes):
        """Test that non-existent scenes are rejected."""
        scene_map = {scene.position: scene for scene in mock_scenes}

        # Scene 100 doesn't exist
        data = {
            "setup_scene": 1,
            "payoff_scene": 100,
            "type": "setup_payoff",
            "description": "Test"
        }

        relationship = await service._create_scene_relationship(uuid4(), data, scene_map)

        assert relationship is None

    @pytest.mark.asyncio
    async def test_create_scene_relationship_success(self, service, mock_scenes):
        """Test successful relationship creation."""
        scene_map = {scene.position: scene for scene in mock_scenes}

        data = {
            "setup_scene": 1,
            "payoff_scene": 5,
            "type": "setup_payoff",
            "description": "Gun introduced, later used"
        }

        relationship = await service._create_scene_relationship(uuid4(), data, scene_map)

        assert relationship is not None
        assert relationship.setup_scene_id == mock_scenes[0].scene_id
        assert relationship.payoff_scene_id == mock_scenes[4].scene_id
        assert relationship.relationship_type == "setup_payoff"
        assert relationship.description == "Gun introduced, later used"

    @pytest.mark.asyncio
    async def test_valid_thread_types(self, service):
        """Test all valid thread types are accepted."""
        valid_types = ["character_arc", "plot", "subplot", "theme"]

        for thread_type in valid_types:
            data = {
                "name": f"Test {thread_type}",
                "type": thread_type,
                "scenes": [1, 2, 3],
                "description": "Test"
            }

            thread = await service._create_plot_thread(uuid4(), data, total_scenes=5)
            assert thread is not None, f"Thread type '{thread_type}' should be valid"

    @pytest.mark.asyncio
    async def test_valid_relationship_types(self, service, mock_scenes):
        """Test all valid relationship types are accepted."""
        scene_map = {scene.position: scene for scene in mock_scenes}
        valid_types = ["setup_payoff", "callback", "parallel", "echo"]

        for rel_type in valid_types:
            data = {
                "setup_scene": 1,
                "payoff_scene": 5,
                "type": rel_type,
                "description": "Test"
            }

            relationship = await service._create_scene_relationship(uuid4(), data, scene_map)
            assert relationship is not None, f"Relationship type '{rel_type}' should be valid"


class TestNarrativeAnalysisIntegration:
    """Integration tests for narrative analysis."""

    @pytest.mark.asyncio
    async def test_batch_analyze_skips_if_data_exists(self):
        """Test that batch analysis skips if data already exists."""
        db = AsyncMock()

        # Mock existing threads count
        mock_count_result = Mock()
        mock_count_result.scalar.return_value = 3
        db.execute.return_value = mock_count_result

        with patch('app.services.narrative_analysis_service.AsyncAnthropic'):
            from app.services.narrative_analysis_service import NarrativeAnalysisService
            service = NarrativeAnalysisService(db)

            with patch.object(service, '_count_existing_threads', return_value=3), \
                 patch.object(service, '_count_existing_relationships', return_value=2):

                result = await service.batch_analyze_narrative(uuid4(), force_regenerate=False)

                assert result["regenerated"] == False
                assert result["threads_count"] == 3
                assert result["relationships_count"] == 2

    @pytest.mark.asyncio
    async def test_batch_analyze_regenerates_when_forced(self):
        """Test that batch analysis regenerates when force_regenerate=True."""
        db = AsyncMock()
        script_id = uuid4()

        # Create mock scenes and summaries
        mock_scenes = []
        mock_summaries = []
        for i in range(3):
            scene = Mock(spec=Scene)
            scene.scene_id = uuid4()
            scene.script_id = script_id
            scene.position = i + 1
            scene.scene_heading = f"INT. LOCATION {i + 1}"
            mock_scenes.append(scene)

            summary = Mock(spec=SceneSummary)
            summary.scene_id = scene.scene_id
            summary.summary_text = f"Summary {i + 1}"
            mock_summaries.append(summary)

        with patch('app.services.narrative_analysis_service.AsyncAnthropic'):
            from app.services.narrative_analysis_service import NarrativeAnalysisService
            service = NarrativeAnalysisService(db)

            # Mock all the internal methods
            with patch.object(service, '_count_existing_threads', return_value=3), \
                 patch.object(service, '_count_existing_relationships', return_value=2), \
                 patch.object(service, '_fetch_scene_summaries', return_value=(mock_scenes, mock_summaries)), \
                 patch.object(service, '_call_narrative_analysis', return_value='{"plot_threads": [], "scene_relationships": []}'), \
                 patch.object(service, '_clear_existing_data') as mock_clear, \
                 patch.object(service, '_insert_plot_threads', return_value=0), \
                 patch.object(service, '_insert_scene_relationships', return_value=0):

                result = await service.batch_analyze_narrative(script_id, force_regenerate=True)

                # Verify clear was called (regeneration happened)
                mock_clear.assert_called_once_with(script_id)
                assert result["regenerated"] == True
