"""
Test script to verify JSONB mutation tracking with flag_modified
"""
import asyncio
from sqlalchemy import select
from sqlalchemy.orm import attributes
from app.db.base import async_session_maker
from app.models.script import Script

async def test_jsonb_mutation():
    """Test that scene_summaries JSONB mutations persist correctly"""

    async with async_session_maker() as session:
        # Get a script
        result = await session.execute(
            select(Script).limit(1)
        )
        script = result.scalar_one_or_none()

        if not script:
            print("❌ No scripts found in database")
            return

        print(f"✅ Found script: {script.script_id}")
        print(f"   Current scene_summaries: {script.scene_summaries}")

        # Test 1: Without flag_modified (old broken behavior)
        print("\n🔬 Test 1: WITHOUT flag_modified")
        if script.scene_summaries is None:
            script.scene_summaries = {}
        script.scene_summaries["TEST_WITHOUT_FLAG"] = "This should not persist"

        # Check if SQLAlchemy marked it as modified
        is_modified = attributes.instance_state(script).modified
        print(f"   Is object modified? {is_modified}")
        print(f"   Modified attributes: {attributes.instance_state(script).attrs.scene_summaries.history.has_changes()}")

        await session.rollback()  # Don't actually save this

        # Test 2: With flag_modified (new fixed behavior)
        print("\n🔬 Test 2: WITH flag_modified")
        if script.scene_summaries is None:
            script.scene_summaries = {}
        script.scene_summaries["TEST_WITH_FLAG"] = "This SHOULD persist"
        attributes.flag_modified(script, 'scene_summaries')

        is_modified = attributes.instance_state(script).modified
        print(f"   Is object modified? {is_modified}")
        print(f"   Modified attributes: {attributes.instance_state(script).attrs.scene_summaries.history.has_changes()}")

        await session.commit()
        print("   ✅ Committed to database")

        # Verify persistence
        await session.refresh(script)
        print(f"   After refresh: {script.scene_summaries}")

        if "TEST_WITH_FLAG" in (script.scene_summaries or {}):
            print("\n✅ SUCCESS: JSONB mutation persisted correctly!")
        else:
            print("\n❌ FAILURE: JSONB mutation did not persist")

        # Cleanup
        if script.scene_summaries:
            script.scene_summaries.pop("TEST_WITH_FLAG", None)
            attributes.flag_modified(script, 'scene_summaries')
            await session.commit()

if __name__ == "__main__":
    asyncio.run(test_jsonb_mutation())
