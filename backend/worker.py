#!/usr/bin/env python
"""
RQ Worker for WritersRoom AI Ingestion Tasks

Starts an RQ worker to process background jobs for AI script analysis.
Requires OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES on macOS to work around
fork() safety issues with multithreaded libraries.
"""

import os
import sys
from redis import Redis
from rq import Worker, Queue, Connection

# Ensure backend directory is on Python path
ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# Verify we can import the tasks
try:
    from app.tasks.ai_ingestion_worker import analyze_script_partial
    print(f"✓ Tasks module loaded successfully")
except ImportError as e:
    print(f"✗ Failed to import tasks: {e}")
    sys.exit(1)

redis_conn = Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))

print(f"\n✓ Connecting to Redis: {os.getenv('REDIS_URL', 'redis://localhost:6379/0')}")
print("✓ Starting RQ worker for 'ai_ingestion' queue...")
print("  Press Ctrl+C to stop\n")

with Connection(redis_conn):
    q = Queue("ai_ingestion")
    w = Worker([q])
    w.work()
