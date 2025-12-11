"""
RQ Background Job Queue Setup

Provides job queues with priorities for background processing:
- urgent: High-priority tasks (scene summary refresh after edit)
- normal: Medium-priority tasks (character sheet refresh)
- low: Low-priority tasks (outline refresh, bulk operations)

Worker startup: rq worker urgent normal low
"""

from redis import Redis
from rq import Queue
from app.core.config import settings

# Connect to Redis
redis_conn = Redis.from_url(settings.REDIS_URL)

# Create job queues with priorities
queue_urgent = Queue('urgent', connection=redis_conn)
queue_normal = Queue('normal', connection=redis_conn)
queue_low = Queue('low', connection=redis_conn)

__all__ = ['redis_conn', 'queue_urgent', 'queue_normal', 'queue_low']
