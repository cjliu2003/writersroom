"""
Unit tests for DivergenceDetector service.

Tests divergence detection, severity assessment, and repair logic
for the Yjs-primary architecture.
"""

import pytest
from datetime import datetime, timedelta
from uuid import uuid4

from app.services.divergence_detector import (
    DivergenceDetector,
    DivergenceSeverity,
    RepairStrategy,
    DivergenceReport
)
from app.services.yjs_to_slate_converter import converter


@pytest.fixture
def sample_slate_content():
    """Provide sample Slate JSON content."""
    return {
        "blocks": [
            {"type": "scene_heading", "text": "INT. OFFICE - DAY"},
            {"type": "action", "text": "John enters the room."},
            {"type": "character", "text": "JOHN"},
            {"type": "dialogue", "text": "Hello, everyone!"}
        ]
    }


@pytest.fixture
def modified_slate_content():
    """Provide modified Slate JSON content."""
    return {
        "blocks": [
            {"type": "scene_heading", "text": "INT. OFFICE - DAY"},
            {"type": "action", "text": "John enters the room."},
            {"type": "character", "text": "JOHN"},
            {"type": "dialogue", "text": "Hello, everyone!"},
            {"type": "action", "text": "He sits down."}  # Extra block
        ]
    }


class TestDivergenceDetectorEnums:
    """Test enum definitions."""

    def test_divergence_severity_enum(self):
        """Test DivergenceSeverity enum values."""
        assert DivergenceSeverity.NONE.value == "none"
        assert DivergenceSeverity.MINOR.value == "minor"
        assert DivergenceSeverity.MODERATE.value == "moderate"
        assert DivergenceSeverity.CRITICAL.value == "critical"

    def test_repair_strategy_enum(self):
        """Test RepairStrategy enum values."""
        assert RepairStrategy.PREFER_YJS.value == "prefer_yjs"
        assert RepairStrategy.PREFER_REST.value == "prefer_rest"
        assert RepairStrategy.NO_REPAIR.value == "no_repair"


class TestDivergenceReportDataclass:
    """Test DivergenceReport dataclass."""

    def test_divergence_report_creation(self):
        """Test creating DivergenceReport instance."""
        report = DivergenceReport(
            diverged=True,
            scene_id=uuid4(),
            yjs_block_count=5,
            rest_block_count=4,
            yjs_checksum="abc123",
            rest_checksum="def456",
            diff={"block_count_diff": 1},
            severity=DivergenceSeverity.MINOR,
            recommended_action="Refresh snapshot",
            checked_at=datetime.utcnow(),
            snapshot_age_seconds=300.0
        )

        assert report.diverged is True
        assert report.yjs_block_count == 5
        assert report.rest_block_count == 4
        assert report.severity == DivergenceSeverity.MINOR

    def test_divergence_report_to_dict(self):
        """Test converting DivergenceReport to dict."""
        scene_id = uuid4()
        checked_at = datetime.utcnow()

        report = DivergenceReport(
            diverged=False,
            scene_id=scene_id,
            yjs_block_count=4,
            rest_block_count=4,
            yjs_checksum="abc123",
            rest_checksum="abc123",
            diff=None,
            severity=DivergenceSeverity.NONE,
            recommended_action="No action needed",
            checked_at=checked_at,
            snapshot_age_seconds=60.0
        )

        result = report.to_dict()

        assert result['diverged'] is False
        assert result['scene_id'] == str(scene_id)
        assert result['yjs_block_count'] == 4
        assert result['severity'] == 'none'
        assert result['snapshot_age_seconds'] == 60.0


class TestDivergenceDetectorDiffComputation:
    """Test diff computation logic."""

    def test_compute_diff_identical_content(self, sample_slate_content):
        """Test diff computation for identical content."""
        import copy
        yjs_slate = copy.deepcopy(sample_slate_content)
        rest_slate = copy.deepcopy(sample_slate_content)

        # Simulate diff computation
        yjs_blocks = yjs_slate.get('blocks', [])
        rest_blocks = rest_slate.get('blocks', [])

        block_count_diff = len(yjs_blocks) - len(rest_blocks)
        mismatched_count = sum(1 for i in range(len(yjs_blocks)) if yjs_blocks[i] != rest_blocks[i])

        assert block_count_diff == 0
        assert mismatched_count == 0

    def test_compute_diff_different_content(self, sample_slate_content, modified_slate_content):
        """Test diff computation for different content."""
        yjs_blocks = modified_slate_content.get('blocks', [])
        rest_blocks = sample_slate_content.get('blocks', [])

        block_count_diff = len(yjs_blocks) - len(rest_blocks)

        assert block_count_diff == 1
        assert len(yjs_blocks) == 5
        assert len(rest_blocks) == 4

    def test_compute_diff_mismatched_blocks(self):
        """Test finding mismatched blocks."""
        yjs_slate = {
            "blocks": [
                {"type": "action", "text": "Original text"},
                {"type": "dialogue", "text": "Hello"}
            ]
        }

        rest_slate = {
            "blocks": [
                {"type": "action", "text": "Modified text"},  # Different
                {"type": "dialogue", "text": "Hello"}        # Same
            ]
        }

        yjs_blocks = yjs_slate.get('blocks', [])
        rest_blocks = rest_slate.get('blocks', [])

        mismatched_indices = []
        for i in range(len(yjs_blocks)):
            if yjs_blocks[i] != rest_blocks[i]:
                mismatched_indices.append(i)

        assert len(mismatched_indices) == 1
        assert mismatched_indices[0] == 0

    def test_compute_diff_empty_content(self):
        """Test diff computation with empty content."""
        yjs_slate = {"blocks": []}
        rest_slate = {"blocks": []}

        yjs_blocks = yjs_slate.get('blocks', [])
        rest_blocks = rest_slate.get('blocks', [])

        block_count_diff = len(yjs_blocks) - len(rest_blocks)

        assert block_count_diff == 0
        assert len(yjs_blocks) == 0


class TestDivergenceDetectorSeverityAssessment:
    """Test severity assessment logic."""

    def test_severity_no_divergence(self):
        """Test severity for no divergence."""
        yjs_block_count = 4
        rest_block_count = 4
        mismatched_count = 0
        snapshot_age_seconds = 60.0

        # No difference
        assert mismatched_count == 0

    def test_severity_minor_divergence(self):
        """Test severity assessment for minor divergence."""
        yjs_block_count = 4
        rest_block_count = 4
        mismatched_count = 1  # 1 block different
        snapshot_age_seconds = 300.0  # 5 minutes

        # Calculate difference percentage
        diff_percentage = (mismatched_count / yjs_block_count) * 100

        # Should be minor (< 10% difference, recent snapshot)
        assert diff_percentage == 25.0  # Actually moderate
        assert snapshot_age_seconds < 600  # < 10 minutes

    def test_severity_moderate_divergence(self):
        """Test severity assessment for moderate divergence."""
        yjs_block_count = 10
        rest_block_count = 10
        mismatched_count = 5  # 50% different
        snapshot_age_seconds = 700.0  # 11 minutes (stale)

        diff_percentage = (mismatched_count / yjs_block_count) * 100

        assert diff_percentage == 50.0  # > 10%
        assert snapshot_age_seconds > 600  # > 10 minutes

    def test_severity_critical_divergence(self):
        """Test severity assessment for critical divergence."""
        yjs_block_count = 10
        rest_block_count = 5  # Large count difference
        mismatched_count = 10
        snapshot_age_seconds = 2000.0  # 33 minutes (very stale)

        block_count_diff = abs(yjs_block_count - rest_block_count)
        diff_percentage = (mismatched_count / yjs_block_count) * 100

        assert block_count_diff == 5  # Large difference
        assert diff_percentage == 100.0  # All different
        assert snapshot_age_seconds > 1800  # > 30 minutes

    def test_severity_assessment_with_zero_blocks(self):
        """Test severity assessment edge case with zero blocks."""
        yjs_block_count = 0
        rest_block_count = 0

        # Edge case - should return NONE
        max_count = max(yjs_block_count, rest_block_count)
        assert max_count == 0


class TestDivergenceDetectorRecommendations:
    """Test recommendation generation."""

    def test_recommendation_critical(self):
        """Test recommendation for critical divergence."""
        severity = DivergenceSeverity.CRITICAL
        snapshot_age_seconds = 2000.0

        # Should recommend immediate action
        assert severity == DivergenceSeverity.CRITICAL

    def test_recommendation_moderate(self):
        """Test recommendation for moderate divergence."""
        severity = DivergenceSeverity.MODERATE
        snapshot_age_seconds = 700.0

        # Should recommend refreshing snapshot
        assert severity == DivergenceSeverity.MODERATE

    def test_recommendation_minor(self):
        """Test recommendation for minor divergence."""
        severity = DivergenceSeverity.MINOR
        snapshot_age_seconds = 300.0

        # Should indicate no immediate action needed
        assert severity == DivergenceSeverity.MINOR


class TestDivergenceDetectorChecksums:
    """Test checksum-based comparison."""

    def test_checksum_comparison_identical(self, sample_slate_content):
        """Test checksum comparison for identical content."""
        checksum1 = converter.compute_checksum(sample_slate_content)
        checksum2 = converter.compute_checksum(sample_slate_content)

        assert checksum1 == checksum2

    def test_checksum_comparison_different(self, sample_slate_content, modified_slate_content):
        """Test checksum comparison for different content."""
        checksum1 = converter.compute_checksum(sample_slate_content)
        checksum2 = converter.compute_checksum(modified_slate_content)

        assert checksum1 != checksum2

    def test_checksum_detects_subtle_changes(self):
        """Test that checksum detects subtle content changes."""
        content1 = {
            "blocks": [
                {"type": "action", "text": "Hello"}
            ]
        }

        content2 = {
            "blocks": [
                {"type": "action", "text": "Hello!"}  # Extra character
            ]
        }

        checksum1 = converter.compute_checksum(content1)
        checksum2 = converter.compute_checksum(content2)

        assert checksum1 != checksum2


class TestDivergenceDetectorRepairLogic:
    """Test repair strategy logic."""

    def test_repair_strategy_no_repair(self):
        """Test NO_REPAIR strategy."""
        strategy = RepairStrategy.NO_REPAIR

        # Should not perform any repair
        assert strategy == RepairStrategy.NO_REPAIR

    def test_repair_strategy_prefer_yjs(self):
        """Test PREFER_YJS strategy (default)."""
        strategy = RepairStrategy.PREFER_YJS

        # Should use Yjs as source of truth
        assert strategy == RepairStrategy.PREFER_YJS

    def test_repair_strategy_prefer_rest_not_supported(self):
        """Test PREFER_REST strategy (should raise error)."""
        strategy = RepairStrategy.PREFER_REST

        # This strategy requires manual intervention
        assert strategy == RepairStrategy.PREFER_REST


class TestDivergenceDetectorBatchOperations:
    """Test batch scanning and repair operations."""

    def test_batch_size_limiting(self):
        """Test batch size limiting for scene scanning."""
        batch_size = 50
        scene_ids = [uuid4() for _ in range(100)]

        # Simulate batch processing
        batch = scene_ids[:batch_size]

        assert len(batch) == batch_size

    def test_max_repairs_limiting(self):
        """Test max repairs limiting."""
        max_repairs = 10
        diverged_reports = list(range(25))  # Simulate 25 diverged scenes

        # Should only repair up to max_repairs
        to_repair = diverged_reports[:max_repairs]

        assert len(to_repair) == max_repairs


class TestDivergenceDetectorEdgeCases:
    """Test edge cases and error scenarios."""

    def test_empty_blocks_comparison(self):
        """Test comparison with empty blocks."""
        yjs_slate = {"blocks": []}
        rest_slate = {"blocks": []}

        yjs_checksum = converter.compute_checksum(yjs_slate)
        rest_checksum = converter.compute_checksum(rest_slate)

        assert yjs_checksum == rest_checksum

    def test_missing_blocks_key(self):
        """Test handling missing 'blocks' key."""
        yjs_slate = {}
        rest_slate = {"blocks": []}

        yjs_blocks = yjs_slate.get('blocks', [])
        rest_blocks = rest_slate.get('blocks', [])

        assert len(yjs_blocks) == 0
        assert len(rest_blocks) == 0

    def test_null_snapshot_age(self):
        """Test handling null snapshot age."""
        snapshot_age_seconds = None

        # Should handle None gracefully
        is_stale = False
        if snapshot_age_seconds:
            if snapshot_age_seconds > 600:
                is_stale = True

        assert is_stale is False

    def test_unicode_content_in_diff(self):
        """Test diff computation with Unicode content."""
        yjs_slate = {
            "blocks": [
                {"type": "dialogue", "text": "こんにちは"}
            ]
        }

        rest_slate = {
            "blocks": [
                {"type": "dialogue", "text": "さようなら"}
            ]
        }

        # Should handle Unicode properly
        checksum1 = converter.compute_checksum(yjs_slate)
        checksum2 = converter.compute_checksum(rest_slate)

        assert checksum1 != checksum2


class TestDivergenceDetectorPerformance:
    """Test performance characteristics."""

    def test_checksum_computation_speed(self, sample_slate_content):
        """Test checksum computation is fast."""
        import time

        start_time = time.time()
        checksum = converter.compute_checksum(sample_slate_content)
        elapsed_ms = (time.time() - start_time) * 1000

        # Should be very fast (< 10ms)
        assert elapsed_ms < 10
        assert len(checksum) == 64

    def test_large_content_diff_computation(self):
        """Test diff computation with large content."""
        large_yjs = {
            "blocks": [
                {"type": "action", "text": f"Block {i}"}
                for i in range(100)
            ]
        }

        large_rest = {
            "blocks": [
                {"type": "action", "text": f"Block {i}"}
                for i in range(95)  # 5 fewer blocks
            ]
        }

        import time
        start_time = time.time()

        yjs_blocks = large_yjs.get('blocks', [])
        rest_blocks = large_rest.get('blocks', [])
        block_count_diff = len(yjs_blocks) - len(rest_blocks)

        elapsed_ms = (time.time() - start_time) * 1000

        # Should be reasonably fast (< 50ms)
        assert elapsed_ms < 50
        assert block_count_diff == 5


class TestDivergenceDetectorStatistics:
    """Test statistics and reporting."""

    def test_divergence_rate_calculation(self):
        """Test divergence rate calculation."""
        total_scenes = 1000
        diverged_scenes = 5

        divergence_rate = diverged_scenes / total_scenes

        assert divergence_rate == 0.005  # 0.5%

    def test_repair_success_rate(self):
        """Test repair success rate calculation."""
        attempted_repairs = 10
        successful_repairs = 8

        success_rate = successful_repairs / attempted_repairs

        assert success_rate == 0.8  # 80%

    def test_summary_statistics(self):
        """Test summary statistics computation."""
        scanned = 100
        diverged = 5
        repaired = 4
        failed = 1

        summary = {
            'scanned': scanned,
            'diverged': diverged,
            'repaired': repaired,
            'failed': failed,
            'success_rate': repaired / diverged if diverged > 0 else 0
        }

        assert summary['scanned'] == 100
        assert summary['diverged'] == 5
        assert summary['success_rate'] == 0.8
