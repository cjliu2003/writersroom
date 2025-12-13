#!/usr/bin/env python3
"""
Quick script to check the status of the most recent job
"""
from redis import Redis
from rq import Queue
from rq.job import Job
from rq.registry import StartedJobRegistry, FinishedJobRegistry, FailedJobRegistry
import os
import sys

redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
redis_conn = Redis.from_url(redis_url)
queue = Queue('ai_ingestion', connection=redis_conn)

# Get specific job if provided
if len(sys.argv) > 1:
    job_id = sys.argv[1]
    try:
        job = Job.fetch(job_id, connection=redis_conn)
        print(f"Job ID: {job_id}")
        print(f"Status: {job.get_status()}")
        print(f"Created: {job.created_at}")
        print(f"Started: {job.started_at}")
        print(f"Ended: {job.ended_at}")
        print(f"Function: {job.func_name}")
        print(f"Args: {job.args}")

        if job.result:
            print(f"\n✅ Result: {job.result}")
        if job.exc_info:
            print(f"\n❌ Error:\n{job.exc_info}")
    except Exception as e:
        print(f"Error: {e}")
    sys.exit(0)

# Otherwise show overview
started_reg = StartedJobRegistry(queue=queue)
finished_reg = FinishedJobRegistry(queue=queue)
failed_reg = FailedJobRegistry(queue=queue)

print("=" * 70)
print("RQ WORKER QUEUE STATUS")
print("=" * 70)
print(f"Queued: {len(queue)}")
print(f"Started: {len(started_reg)}")
print(f"Finished: {len(finished_reg)}")
print(f"Failed: {len(failed_reg)}")

# Show started jobs
if len(started_reg) > 0:
    print("\n=== CURRENTLY RUNNING ===")
    for job_id in started_reg.get_job_ids():
        job = Job.fetch(job_id, connection=redis_conn)
        duration = (job.ended_at or job.started_at) - job.started_at if job.started_at else None
        print(f"Job: {job_id}")
        print(f"  Script: {job.args[0] if job.args else 'N/A'}")
        print(f"  Running for: {duration}")

# Show most recent finished
if len(finished_reg) > 0:
    print("\n=== MOST RECENT FINISHED ===")
    job_id = finished_reg.get_job_ids()[0]
    job = Job.fetch(job_id, connection=redis_conn)
    print(f"Job: {job_id}")
    print(f"  Script: {job.args[0] if job.args else 'N/A'}")
    print(f"  Ended: {job.ended_at}")
    print(f"  Result: {job.result}")

# Show most recent failed
if len(failed_reg) > 0:
    print("\n=== MOST RECENT FAILED ===")
    job_id = failed_reg.get_job_ids()[0]
    job = Job.fetch(job_id, connection=redis_conn)
    print(f"Job: {job_id}")
    print(f"  Script: {job.args[0] if job.args else 'N/A'}")
    print(f"  Error: {job.exc_info[:200]}..." if job.exc_info else "No error info")

print("\nUsage: python check_job.py [job_id]")
