#!/usr/bin/env python3
"""
Complete worker test with Anthropic API key.

Tests:
1. Worker startup
2. Job enqueueing
3. Scene summary generation
4. Database verification
"""

import asyncio
import time
from redis import Redis
from rq import Queue
from rq.job import Job
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.scene_summary import SceneSummary
from app.models.scene import Scene

# Job ID from previous tests
SCRIPT_ID = "05006f9d-2c40-4ffc-a041-f0c3ac62a4ed"


def enqueue_job():
    """Enqueue analyze_script_partial job."""
    print("=" * 60)
    print("STEP 1: Enqueueing Job")
    print("=" * 60)

    redis_conn = Redis(host='localhost', port=6379, db=0)
    queue = Queue('ai_ingestion', connection=redis_conn)

    job = queue.enqueue(
        'app.tasks.ai_ingestion_worker.analyze_script_partial',
        SCRIPT_ID,
        job_timeout='10m'
    )

    print(f"✓ Job enqueued: {job.id}")
    print(f"  Status: {job.get_status()}")
    print(f"  Script ID: {SCRIPT_ID}")

    return job.id


def monitor_job(job_id: str, timeout: int = 300):
    """Monitor job progress."""
    print("\n" + "=" * 60)
    print("STEP 2: Monitoring Job Progress")
    print("=" * 60)

    redis_conn = Redis(host='localhost', port=6379, db=0)
    start_time = time.time()

    while time.time() - start_time < timeout:
        try:
            job = Job.fetch(job_id, connection=redis_conn)
            status = job.get_status()

            print(f"[{int(time.time() - start_time)}s] Job status: {status}")

            if status == 'finished':
                print("\n✅ Job completed successfully!")
                print(f"Result: {job.result}")
                return True
            elif status == 'failed':
                print("\n❌ Job failed!")
                print(f"Exception: {job.exc_info}")
                return False

            time.sleep(5)

        except Exception as e:
            print(f"Error checking job: {str(e)}")
            time.sleep(5)

    print(f"\n⏱️ Timeout after {timeout}s")
    return False


async def verify_database():
    """Verify scene summaries were created in database."""
    print("\n" + "=" * 60)
    print("STEP 3: Verifying Database")
    print("=" * 60)

    # Create async engine
    engine = create_async_engine(
        settings.DB_URL_ASYNC,
        echo=False
    )

    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with async_session() as session:
        # Count total scenes
        scenes_result = await session.execute(
            select(Scene).where(Scene.script_id == SCRIPT_ID)
        )
        scenes = scenes_result.scalars().all()
        print(f"Total scenes in script: {len(scenes)}")

        # Count scene summaries
        summaries_result = await session.execute(
            select(SceneSummary)
            .join(Scene, SceneSummary.scene_id == Scene.scene_id)
            .where(Scene.script_id == SCRIPT_ID)
        )
        summaries = summaries_result.scalars().all()
        print(f"Scene summaries generated: {len(summaries)}")

        if summaries:
            print(f"\n✅ Success! Generated {len(summaries)} scene summaries")

            # Show first summary as example
            first = summaries[0]
            print(f"\nExample summary (Scene {first.scene_id}):")
            print(f"Tokens: {first.tokens_estimate}")
            print(f"Version: {first.version}")
            print(f"Text preview: {first.summary_text[:200]}...")

            return True
        else:
            print("\n❌ No scene summaries found in database")
            return False

    await engine.dispose()


def main():
    """Run complete test."""
    print("\n" + "=" * 60)
    print("COMPLETE WORKER TEST WITH ANTHROPIC API")
    print("=" * 60)
    print(f"Script ID: {SCRIPT_ID}")
    print(f"Expected scenes: 20")
    print()

    # Step 1: Enqueue job
    job_id = enqueue_job()

    # Step 2: Monitor job
    success = monitor_job(job_id, timeout=300)

    if not success:
        print("\n❌ Test failed: Job did not complete successfully")
        return False

    # Step 3: Verify database
    db_success = asyncio.run(verify_database())

    if db_success:
        print("\n" + "=" * 60)
        print("✅ ALL TESTS PASSED!")
        print("=" * 60)
        print("Worker pipeline is functioning correctly with Anthropic API")
        return True
    else:
        print("\n❌ Test failed: Database verification failed")
        return False


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
    except Exception as e:
        print(f"\n❌ Test failed with error: {str(e)}")
        import traceback
        traceback.print_exc()
