"""
Divergence Detector Service

Monitors consistency between Yjs and REST representations for Yjs-primary architecture.
Provides:
- Consistency validation between Yjs state and REST snapshots
- Automatic divergence repair with configurable strategies
- Severity assessment for detected divergences
- Detailed diff reporting for debugging

Architecture:
- Yjs updates are PRIMARY SOURCE OF TRUTH
- REST snapshots are DERIVED and may lag behind
- Temporary divergence is acceptable (5-10 minutes)
- Persistent divergence indicates system issues requiring investigation

Repair Strategies:
- PREFER_YJS: Reconstruct snapshot from Yjs state (default, safest)
- PREFER_REST: Use REST snapshot as source of truth (manual override only)
- NO_REPAIR: Report only, don't fix (monitoring mode)
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional, Dict, Any, List
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scene import Scene
from app.services.yjs_persistence import YjsPersistence
from app.services.yjs_to_slate_converter import converter
from app.services.yjs_snapshot_service import YjsSnapshotService, SnapshotSource

logger = logging.getLogger(__name__)


class DivergenceSeverity(str, Enum):
    """Severity level for detected divergences."""
    NONE = "none"         # No divergence detected
    MINOR = "minor"       # Small differences, likely timing issue
    MODERATE = "moderate" # Noticeable differences, investigate
    CRITICAL = "critical" # Major differences, requires immediate attention


class RepairStrategy(str, Enum):
    """Strategy for repairing divergences."""
    PREFER_YJS = "prefer_yjs"     # Use Yjs as source of truth (default)
    PREFER_REST = "prefer_rest"   # Use REST as source of truth (manual only)
    NO_REPAIR = "no_repair"       # Report only, don't fix


@dataclass
class DivergenceReport:
    """
    Report of divergence between Yjs and REST representations.

    Attributes:
        diverged: Whether divergence was detected
        scene_id: Scene UUID
        yjs_block_count: Number of blocks in Yjs state
        rest_block_count: Number of blocks in REST snapshot
        yjs_checksum: SHA256 checksum of Yjs state
        rest_checksum: SHA256 checksum of REST snapshot
        diff: Detailed differences if diverged
        severity: Severity level of divergence
        recommended_action: Suggested action to resolve
        checked_at: Timestamp of check
        snapshot_age_seconds: Age of REST snapshot in seconds
    """
    diverged: bool
    scene_id: UUID
    yjs_block_count: int
    rest_block_count: int
    yjs_checksum: str
    rest_checksum: str
    diff: Optional[Dict[str, Any]]
    severity: DivergenceSeverity
    recommended_action: str
    checked_at: datetime
    snapshot_age_seconds: Optional[float]

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        return {
            'diverged': self.diverged,
            'scene_id': str(self.scene_id),
            'yjs_block_count': self.yjs_block_count,
            'rest_block_count': self.rest_block_count,
            'yjs_checksum': self.yjs_checksum,
            'rest_checksum': self.rest_checksum,
            'diff': self.diff,
            'severity': self.severity.value,
            'recommended_action': self.recommended_action,
            'checked_at': self.checked_at.isoformat(),
            'snapshot_age_seconds': self.snapshot_age_seconds
        }


class DivergenceDetector:
    """
    Service to detect and repair divergence between Yjs and REST.

    Implements consistency monitoring for Yjs-primary architecture:
    - Compare Yjs state vs REST snapshot
    - Assess severity of divergences
    - Provide repair recommendations
    - Automatic repair with configurable strategies
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.persistence = YjsPersistence(db)
        self.snapshot_service = YjsSnapshotService(db)

    async def check_scene_consistency(
        self,
        scene_id: UUID
    ) -> DivergenceReport:
        """
        Compare Yjs state vs REST snapshot.

        Args:
            scene_id: Scene UUID

        Returns:
            DivergenceReport with detailed comparison

        Process:
            1. Reconstruct Yjs state and convert to Slate
            2. Get current REST snapshot from scenes table
            3. Compute checksums for both
            4. Compare and assess differences
            5. Determine severity and recommendation
        """
        checked_at = datetime.utcnow()

        # Check if scene exists
        stmt = select(Scene).where(Scene.scene_id == scene_id)
        result = await self.db.execute(stmt)
        scene = result.scalar_one_or_none()

        if not scene:
            raise ValueError(f"Scene {scene_id} not found")

        # Check if Yjs updates exist
        has_yjs_updates = await self.persistence.has_updates(scene_id)

        if not has_yjs_updates:
            # No Yjs updates - scene hasn't been migrated yet
            # This is not a divergence, just pre-migration state
            return DivergenceReport(
                diverged=False,
                scene_id=scene_id,
                yjs_block_count=0,
                rest_block_count=len(scene.content_blocks.get('blocks', [])),
                yjs_checksum="",
                rest_checksum=converter.compute_checksum(scene.content_blocks),
                diff=None,
                severity=DivergenceSeverity.NONE,
                recommended_action="No action needed - scene has no Yjs updates yet",
                checked_at=checked_at,
                snapshot_age_seconds=None
            )

        # Get Yjs state
        yjs_slate = await self.persistence.get_scene_snapshot(scene_id)
        yjs_checksum = converter.compute_checksum(yjs_slate)
        yjs_block_count = len(yjs_slate.get('blocks', []))

        # Get REST snapshot
        rest_slate = scene.content_blocks
        rest_checksum = scene.yjs_checksum or converter.compute_checksum(rest_slate)
        rest_block_count = len(rest_slate.get('blocks', []))

        # Calculate snapshot age
        snapshot_age_seconds = None
        if scene.snapshot_at:
            snapshot_age_seconds = (checked_at - scene.snapshot_at).total_seconds()

        # Compare checksums
        checksums_match = (yjs_checksum == rest_checksum)

        if checksums_match:
            # No divergence
            return DivergenceReport(
                diverged=False,
                scene_id=scene_id,
                yjs_block_count=yjs_block_count,
                rest_block_count=rest_block_count,
                yjs_checksum=yjs_checksum,
                rest_checksum=rest_checksum,
                diff=None,
                severity=DivergenceSeverity.NONE,
                recommended_action="No action needed - Yjs and REST are consistent",
                checked_at=checked_at,
                snapshot_age_seconds=snapshot_age_seconds
            )

        # Divergence detected - compute detailed diff
        diff = self._compute_diff(yjs_slate, rest_slate)

        # Assess severity
        severity = self._assess_severity(
            yjs_block_count=yjs_block_count,
            rest_block_count=rest_block_count,
            diff=diff,
            snapshot_age_seconds=snapshot_age_seconds
        )

        # Generate recommendation
        recommendation = self._generate_recommendation(severity, snapshot_age_seconds)

        logger.warning(
            "Divergence detected for scene %s: severity=%s, yjs_blocks=%d, rest_blocks=%d",
            scene_id, severity.value, yjs_block_count, rest_block_count
        )

        return DivergenceReport(
            diverged=True,
            scene_id=scene_id,
            yjs_block_count=yjs_block_count,
            rest_block_count=rest_block_count,
            yjs_checksum=yjs_checksum,
            rest_checksum=rest_checksum,
            diff=diff,
            severity=severity,
            recommended_action=recommendation,
            checked_at=checked_at,
            snapshot_age_seconds=snapshot_age_seconds
        )

    async def auto_repair_divergence(
        self,
        scene_id: UUID,
        strategy: RepairStrategy = RepairStrategy.PREFER_YJS
    ) -> bool:
        """
        Attempt to fix divergence automatically.

        Args:
            scene_id: Scene UUID
            strategy: Repair strategy to use

        Returns:
            True if repair succeeded, False otherwise

        Repair Strategies:
            - PREFER_YJS: Recreate REST snapshot from Yjs state (safe, default)
            - PREFER_REST: Not implemented (requires manual intervention)
            - NO_REPAIR: No-op, returns False

        Process (PREFER_YJS):
            1. Check current consistency
            2. If diverged, create fresh snapshot from Yjs
            3. Verify repair by re-checking consistency
        """
        if strategy == RepairStrategy.NO_REPAIR:
            logger.debug("Repair strategy is NO_REPAIR, skipping")
            return False

        if strategy == RepairStrategy.PREFER_REST:
            logger.error(
                "PREFER_REST strategy not supported - would overwrite Yjs with REST"
            )
            raise ValueError("PREFER_REST strategy requires manual intervention")

        # Check current state
        report = await self.check_scene_consistency(scene_id)

        if not report.diverged:
            logger.debug("Scene %s: No divergence detected, no repair needed", scene_id)
            return True

        logger.info(
            "Repairing divergence for scene %s: severity=%s, strategy=%s",
            scene_id, report.severity.value, strategy.value
        )

        # PREFER_YJS: Recreate snapshot from Yjs state
        try:
            await self.snapshot_service.create_snapshot(
                scene_id=scene_id,
                source=SnapshotSource.YJS
            )
            await self.db.commit()

            # Verify repair
            verification = await self.check_scene_consistency(scene_id)

            if verification.diverged:
                logger.error(
                    "Repair failed for scene %s: still diverged after snapshot creation",
                    scene_id
                )
                return False

            logger.info("Successfully repaired divergence for scene %s", scene_id)
            return True

        except Exception as e:
            logger.error("Failed to repair divergence for scene %s: %s", scene_id, e)
            await self.db.rollback()
            return False

    async def scan_all_scenes(
        self,
        batch_size: int = 50,
        max_scenes: Optional[int] = None
    ) -> List[DivergenceReport]:
        """
        Scan all scenes for divergences.

        Args:
            batch_size: Number of scenes to process per batch
            max_scenes: Maximum number of scenes to scan (None = all)

        Returns:
            List of divergence reports (only diverged scenes)

        Use case: Health monitoring, scheduled divergence detection
        """
        # Get all scenes with Yjs updates
        stmt = select(Scene.scene_id).order_by(Scene.scene_id)

        if max_scenes:
            stmt = stmt.limit(max_scenes)

        result = await self.db.execute(stmt)
        scene_ids = [row[0] for row in result.all()]

        diverged_reports = []

        for scene_id in scene_ids:
            try:
                # Check if scene has Yjs updates
                has_updates = await self.persistence.has_updates(scene_id)
                if not has_updates:
                    continue

                # Check consistency
                report = await self.check_scene_consistency(scene_id)

                if report.diverged:
                    diverged_reports.append(report)

            except Exception as e:
                logger.error("Failed to check scene %s: %s", scene_id, e)
                continue

        logger.info(
            "Divergence scan complete: checked %d scenes, found %d diverged",
            len(scene_ids), len(diverged_reports)
        )

        return diverged_reports

    async def repair_all_divergences(
        self,
        strategy: RepairStrategy = RepairStrategy.PREFER_YJS,
        max_repairs: int = 10
    ) -> Dict[str, Any]:
        """
        Repair all detected divergences.

        Args:
            strategy: Repair strategy to use
            max_repairs: Maximum number of scenes to repair

        Returns:
            Summary of repair operation

        Use case: Scheduled maintenance, post-migration cleanup
        """
        # Scan for divergences
        diverged = await self.scan_all_scenes(max_scenes=max_repairs)

        if not diverged:
            logger.info("No divergences found, no repairs needed")
            return {
                'scanned': 0,
                'diverged': 0,
                'repaired': 0,
                'failed': 0
            }

        # Repair each divergence
        repaired = 0
        failed = 0

        for report in diverged[:max_repairs]:
            try:
                success = await self.auto_repair_divergence(
                    scene_id=report.scene_id,
                    strategy=strategy
                )

                if success:
                    repaired += 1
                else:
                    failed += 1

            except Exception as e:
                logger.error(
                    "Failed to repair scene %s: %s",
                    report.scene_id, e
                )
                failed += 1

        logger.info(
            "Repair operation complete: diverged=%d, repaired=%d, failed=%d",
            len(diverged), repaired, failed
        )

        return {
            'scanned': len(diverged),
            'diverged': len(diverged),
            'repaired': repaired,
            'failed': failed
        }

    # -------------------------------------------------------------------------
    # Private Helper Methods
    # -------------------------------------------------------------------------

    def _compute_diff(
        self,
        yjs_slate: Dict[str, Any],
        rest_slate: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Compute detailed differences between Yjs and REST.

        Args:
            yjs_slate: Slate JSON from Yjs state
            rest_slate: Slate JSON from REST snapshot

        Returns:
            Dictionary with difference details
        """
        yjs_blocks = yjs_slate.get('blocks', [])
        rest_blocks = rest_slate.get('blocks', [])

        # Block count difference
        block_count_diff = len(yjs_blocks) - len(rest_blocks)

        # Find mismatched blocks
        mismatched_indices = []
        max_len = max(len(yjs_blocks), len(rest_blocks))

        for i in range(max_len):
            yjs_block = yjs_blocks[i] if i < len(yjs_blocks) else None
            rest_block = rest_blocks[i] if i < len(rest_blocks) else None

            if yjs_block != rest_block:
                mismatched_indices.append(i)

        # Sample of mismatched blocks (first 3)
        sample_diffs = []
        for i in mismatched_indices[:3]:
            yjs_block = yjs_blocks[i] if i < len(yjs_blocks) else None
            rest_block = rest_blocks[i] if i < len(rest_blocks) else None

            sample_diffs.append({
                'index': i,
                'yjs_block': yjs_block,
                'rest_block': rest_block
            })

        return {
            'block_count_diff': block_count_diff,
            'yjs_block_count': len(yjs_blocks),
            'rest_block_count': len(rest_blocks),
            'mismatched_count': len(mismatched_indices),
            'mismatched_indices': mismatched_indices[:10],  # First 10
            'sample_diffs': sample_diffs
        }

    def _assess_severity(
        self,
        yjs_block_count: int,
        rest_block_count: int,
        diff: Dict[str, Any],
        snapshot_age_seconds: Optional[float]
    ) -> DivergenceSeverity:
        """
        Assess severity of divergence.

        Args:
            yjs_block_count: Number of blocks in Yjs
            rest_block_count: Number of blocks in REST
            diff: Detailed diff dictionary
            snapshot_age_seconds: Age of snapshot in seconds

        Returns:
            Severity level

        Severity Criteria:
            - MINOR: Small differences (1-3 blocks), recent snapshot (< 10 min)
            - MODERATE: Moderate differences (4-10 blocks) or stale snapshot (10-30 min)
            - CRITICAL: Large differences (>10 blocks) or very stale (> 30 min)
        """
        block_count_diff = abs(yjs_block_count - rest_block_count)
        mismatched_count = diff.get('mismatched_count', 0)

        # Calculate difference percentage
        max_count = max(yjs_block_count, rest_block_count)
        if max_count == 0:
            return DivergenceSeverity.NONE

        diff_percentage = (mismatched_count / max_count) * 100

        # Check snapshot age
        is_stale = False
        is_very_stale = False

        if snapshot_age_seconds:
            if snapshot_age_seconds > 1800:  # 30 minutes
                is_very_stale = True
            elif snapshot_age_seconds > 600:  # 10 minutes
                is_stale = True

        # Assess severity
        if is_very_stale or diff_percentage > 30 or block_count_diff > 10:
            return DivergenceSeverity.CRITICAL

        if is_stale or diff_percentage > 10 or block_count_diff > 3:
            return DivergenceSeverity.MODERATE

        return DivergenceSeverity.MINOR

    def _generate_recommendation(
        self,
        severity: DivergenceSeverity,
        snapshot_age_seconds: Optional[float]
    ) -> str:
        """
        Generate recommendation based on severity.

        Args:
            severity: Divergence severity level
            snapshot_age_seconds: Age of snapshot in seconds

        Returns:
            Recommended action string
        """
        if severity == DivergenceSeverity.CRITICAL:
            return (
                "CRITICAL divergence detected. "
                "Immediate action required: recreate snapshot from Yjs state. "
                "Investigate cause of divergence to prevent recurrence."
            )

        if severity == DivergenceSeverity.MODERATE:
            return (
                "Moderate divergence detected. "
                "Recommend refreshing snapshot from Yjs state. "
                "Monitor for recurring divergence."
            )

        # MINOR
        age_str = f" (snapshot age: {int(snapshot_age_seconds)}s)" if snapshot_age_seconds else ""
        return (
            f"Minor divergence detected{age_str}. "
            "Likely timing issue - next scheduled snapshot should resolve. "
            "No immediate action required."
        )
