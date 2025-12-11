"""
Integration tests for scene staleness detection workflow.

Tests the complete workflow: import → analyze → edit → detect stale.
"""

import pytest
from uuid import uuid4
from app.models.scene import Scene
from app.services.ingestion_service import IngestionService
from app.services.staleness_service import StalenessService


@pytest.mark.asyncio
async def test_staleness_detection_workflow(db_session):
    """Test complete workflow: import → analyze → edit → detect stale."""

    script_id = uuid4()

    # 1. Import scene (hash = NULL)
    scene = Scene(
        script_id=script_id,
        scene_heading="INT. HOUSE - DAY",
        content_blocks=[{"type": "action", "text": "John walks in."}],
        hash=None
    )
    db_session.add(scene)
    await db_session.commit()
    await db_session.refresh(scene)

    # 2. Run initial analysis
    ingestion_service = IngestionService(db=db_session)
    summary = await ingestion_service.generate_scene_summary(scene)

    # Refresh scene to get updated hash
    await db_session.refresh(scene)

    assert scene.hash is not None  # Hash set after analysis
    original_hash = scene.hash

    # 3. No edits - staleness check should pass
    staleness_service = StalenessService(db=db_session)
    is_stale = await staleness_service.check_scene_staleness(scene.scene_id)

    assert is_stale is False  # Not stale
    await db_session.refresh(scene)
    assert scene.hash == original_hash  # Hash unchanged

    # 4. Edit scene content
    scene.content_blocks = [{"type": "action", "text": "John runs in."}]
    await db_session.commit()

    # 5. Staleness check should detect change
    is_stale = await staleness_service.check_scene_staleness(scene.scene_id)

    assert is_stale is True  # Stale detected!
    await db_session.refresh(scene)
    assert scene.hash != original_hash  # Hash updated
