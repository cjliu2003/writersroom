"""
Tests for script-level WebSocket collaboration and Yjs persistence.

NOTE ON SHARED TYPES:
=====================
These tests use Y.Array('content') for testing Yjs persistence mechanics.
In production, TipTap uses Y.XmlFragment('default') which y_py doesn't expose
via get_xml_fragment(). The persistence layer stores binary updates agnostically,
so these tests remain valid for verifying store/load/compact operations.

The actual TipTap integration is tested via end-to-end browser tests.

See: backend/YJS_COLLABORATION_FIX_SPEC.md for full technical details.
"""

import pytest
from uuid import uuid4
import y_py as Y

from app.models.script_version import ScriptVersion
from app.services.script_yjs_persistence import ScriptYjsPersistence


@pytest.mark.asyncio
async def test_script_yjs_persistence_store_and_load(db_session, test_script):
    """Test storing and loading script Yjs updates."""
    persistence = ScriptYjsPersistence(db_session)

    # Create a Yjs document with some content
    doc = Y.YDoc()
    txn = doc.begin_transaction()
    content = doc.get_array('content')
    content.append(txn, {
        'type': 'scene_heading',
        'children': [{'text': 'INT. TEST LOCATION - DAY'}]
    })
    content.append(txn, {
        'type': 'action',
        'children': [{'text': 'A test scene for script-level collaboration.'}]
    })
    del txn

    # Encode the state as an update
    update = Y.encode_state_as_update(doc)

    # Store the update
    version = await persistence.store_update(test_script.script_id, update)
    await db_session.commit()

    # Verify the version was created
    assert version.script_id == test_script.script_id
    assert version.update == update
    assert len(version.update) > 0

    # Load updates into a new document
    new_doc = Y.YDoc()
    count = await persistence.load_persisted_updates(test_script.script_id, new_doc)

    # Verify the update was loaded
    assert count == 1

    # Verify the content matches
    new_content = new_doc.get_array('content')
    assert len(new_content) == 2
    assert new_content[0]['type'] == 'scene_heading'
    assert new_content[1]['type'] == 'action'


@pytest.mark.asyncio
async def test_script_yjs_persistence_multiple_updates(db_session, test_script):
    """Test storing and loading multiple Yjs updates sequentially."""
    persistence = ScriptYjsPersistence(db_session)

    # Create initial document
    doc = Y.YDoc()

    # First update: Add scene heading
    txn1 = doc.begin_transaction()
    content = doc.get_array('content')
    content.append(txn1, {
        'type': 'scene_heading',
        'children': [{'text': 'INT. OFFICE - DAY'}]
    })
    del txn1
    update1 = Y.encode_state_as_update(doc)
    await persistence.store_update(test_script.script_id, update1)

    # Second update: Add action
    txn2 = doc.begin_transaction()
    content.append(txn2, {
        'type': 'action',
        'children': [{'text': 'John enters the office.'}]
    })
    del txn2
    update2 = Y.encode_state_as_update(doc)
    await persistence.store_update(test_script.script_id, update2)

    # Third update: Add dialogue
    txn3 = doc.begin_transaction()
    content.append(txn3, {
        'type': 'character',
        'children': [{'text': 'JOHN'}]
    })
    del txn3
    update3 = Y.encode_state_as_update(doc)
    await persistence.store_update(test_script.script_id, update3)

    await db_session.commit()

    # Load all updates into a new document
    new_doc = Y.YDoc()
    count = await persistence.load_persisted_updates(test_script.script_id, new_doc)

    # Verify all updates were loaded
    assert count == 3

    # Verify the final state
    new_content = new_doc.get_array('content')
    assert len(new_content) == 3
    assert new_content[0]['type'] == 'scene_heading'
    assert new_content[1]['type'] == 'action'
    assert new_content[2]['type'] == 'character'


@pytest.mark.asyncio
async def test_script_yjs_persistence_empty_script(db_session, test_script):
    """Test loading updates from a script with no versions."""
    persistence = ScriptYjsPersistence(db_session)

    new_doc = Y.YDoc()
    count = await persistence.load_persisted_updates(test_script.script_id, new_doc)

    # Should load zero updates
    assert count == 0

    # Document should be empty
    content = new_doc.get_array('content')
    assert len(content) == 0


@pytest.mark.asyncio
async def test_script_yjs_persistence_update_count(db_session, test_script):
    """Test getting update count for a script."""
    persistence = ScriptYjsPersistence(db_session)

    # Initially should be zero
    count = await persistence.get_update_count(test_script.script_id)
    assert count == 0

    # Add some updates
    doc = Y.YDoc()
    content = doc.get_array('content')

    txn = doc.begin_transaction()
    content.append(txn, {'type': 'scene_heading', 'children': [{'text': 'Test'}]})
    del txn

    for i in range(5):
        update = Y.encode_state_as_update(doc)
        await persistence.store_update(test_script.script_id, update)
        txn = doc.begin_transaction()
        content.append(txn, {'type': 'action', 'children': [{'text': f'Action {i}'}]})
        del txn

    await db_session.commit()

    # Should now be 5
    count = await persistence.get_update_count(test_script.script_id)
    assert count == 5


@pytest.mark.asyncio
async def test_script_yjs_persistence_has_updates(db_session, test_script):
    """Test checking if a script has any updates."""
    persistence = ScriptYjsPersistence(db_session)

    # Initially should be False
    has_updates = await persistence.has_updates(test_script.script_id)
    assert has_updates is False

    # Add an update
    doc = Y.YDoc()
    txn = doc.begin_transaction()
    content = doc.get_array('content')
    content.append(txn, {'type': 'scene_heading', 'children': [{'text': 'Test'}]})
    del txn
    update = Y.encode_state_as_update(doc)
    await persistence.store_update(test_script.script_id, update)
    await db_session.commit()

    # Should now be True
    has_updates = await persistence.has_updates(test_script.script_id)
    assert has_updates is True


@pytest.mark.asyncio
async def test_script_version_model_get_latest(db_session, test_script):
    """Test ScriptVersion.get_latest_version() method."""
    persistence = ScriptYjsPersistence(db_session)

    # Create multiple versions
    doc = Y.YDoc()
    content = doc.get_array('content')

    for i in range(3):
        txn = doc.begin_transaction()
        content.append(txn, {'type': 'action', 'children': [{'text': f'Version {i}'}]})
        del txn
        update = Y.encode_state_as_update(doc)
        await persistence.store_update(test_script.script_id, update)

    await db_session.commit()

    # Get latest version
    latest = await ScriptVersion.get_latest_version(db_session, test_script.script_id)

    assert latest is not None
    assert latest.script_id == test_script.script_id
    # Latest should be the most recent (has all 3 items when decoded)


@pytest.mark.asyncio
async def test_script_version_model_get_history(db_session, test_script):
    """Test ScriptVersion.get_version_history() method."""
    persistence = ScriptYjsPersistence(db_session)

    # Create 5 versions
    doc = Y.YDoc()
    content = doc.get_array('content')

    for i in range(5):
        txn = doc.begin_transaction()
        content.append(txn, {'type': 'action', 'children': [{'text': f'Version {i}'}]})
        del txn
        update = Y.encode_state_as_update(doc)
        await persistence.store_update(test_script.script_id, update)

    await db_session.commit()

    # Get history (default limit 10)
    history = await ScriptVersion.get_version_history(db_session, test_script.script_id)

    assert len(history) == 5
    assert all(v.script_id == test_script.script_id for v in history)
    # Should be ordered by created_at descending (most recent first)

    # Get limited history
    history_limited = await ScriptVersion.get_version_history(
        db_session,
        test_script.script_id,
        limit=3
    )

    assert len(history_limited) == 3


# WebSocket tests require test client setup
# These are placeholder tests that would need proper async HTTP client
# and WebSocket support in the test fixtures

# @pytest.mark.asyncio
# async def test_script_websocket_auth(test_client, test_user, test_script, auth_token):
#     """Test WebSocket authentication."""
#     # This would require an async test client with WebSocket support
#     # Example with httpx or FastAPI's TestClient:
#     # async with test_client.websocket_connect(
#     #     f"/api/ws/scripts/{test_test_script.script_id}?token={auth_token}"
#     # ) as websocket:
#     #     # Should connect successfully
#     #     # Could test sync protocol here
#     #     pass
#     pass


# @pytest.mark.asyncio
# async def test_script_websocket_sync_protocol(test_client, test_user, test_script, auth_token):
#     """Test Yjs sync protocol over WebSocket."""
#     # This would test the actual MESSAGE_SYNC protocol
#     # with SYNC_STEP1, SYNC_STEP2, SYNC_UPDATE
#     pass
