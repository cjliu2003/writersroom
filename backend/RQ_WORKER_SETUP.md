# RQ Worker Setup for macOS

## Problem

RQ workers on macOS fail with a misleading error message:
```
ValueError: Invalid attribute name: app.tasks.ai_ingestion_worker.analyze_script_partial
```

This error is a **red herring**. The actual issue is macOS's Objective-C runtime crashing when RQ forks worker processes while certain libraries (OpenAI SDK, httpx, etc.) have threads running during module initialization.

### Actual Error (hidden by RQ)
```
objc[PID]: +[__NSCFConstantString initialize] may have been in progress in another thread when fork() was called.
objc[PID]: We cannot safely call it or ignore it in the fork() child process. Crashing instead.
```

## Root Cause

1. RQ uses `fork()` to create child processes for job execution
2. Python libraries (OpenAI, httpx, etc.) use multithreading during import
3. macOS 10.13+ has strict fork safety checks for Objective-C runtime
4. When fork happens with threads active, macOS crashes the process
5. RQ catches the crash and reports generic "Invalid attribute name" error

## Solution

Set the environment variable `OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES` to bypass macOS's strict fork safety checks.

### Quick Start

```bash
cd backend
./start_worker.sh
```

This starts the worker with the correct environment configuration.

### Manual Start (for debugging)

```bash
cd backend
source ../writersRoom/bin/activate
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
python worker.py
```

### Alternative: Use RQ CLI

```bash
cd backend
source ../writersRoom/bin/activate
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
rq worker ai_ingestion --url redis://localhost:6379/0
```

## Files

- **worker.py**: Custom RQ worker script with proper Python path setup
- **start_worker.sh**: Startup script that sets environment variables
- **app/tasks/ai_ingestion_worker.py**: Background task definitions
- **app/tasks/__init__.py**: Task module exports

## Testing

### Test Job Enqueue

```python
from redis import Redis
from rq import Queue
from app.tasks.ai_ingestion_worker import analyze_script_partial

redis_conn = Redis(host='localhost', port=6379, db=0)
queue = Queue('ai_ingestion', connection=redis_conn)

# Enqueue a test job
job = queue.enqueue(
    analyze_script_partial,
    'your-script-uuid-here',
    job_timeout='15m'
)

print(f"Job ID: {job.id}")
print(f"Status: {job.get_status()}")
```

### Monitor Jobs

```bash
# Check queue status
python -c "
from redis import Redis
from rq import Queue

redis_conn = Redis(host='localhost', port=6379, db=0)
queue = Queue('ai_ingestion', connection=redis_conn)

print(f'Queue length: {len(queue)}')
print(f'Jobs: {queue.job_ids}')
"
```

## Troubleshooting

### Worker starts but jobs fail
1. Check if `OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES` is set
2. Verify Python virtual environment is activated
3. Check Redis connection: `redis-cli ping`

### Import errors in worker
1. Ensure backend directory is in Python path
2. Verify all dependencies installed: `pip install -r requirements.txt`
3. Check worker output for actual error message

### Jobs stuck in queue
1. Verify worker is running: `ps aux | grep "rq worker"`
2. Kill existing workers: `pkill -f "rq worker"`
3. Restart with `./start_worker.sh`

## Production Deployment

For production on macOS, add to your process manager (supervisor, systemd, etc.):

```ini
[program:rq_worker]
command=/path/to/backend/start_worker.sh
directory=/path/to/backend
autostart=true
autorestart=true
stderr_logfile=/var/log/rq_worker.err.log
stdout_logfile=/var/log/rq_worker.out.log
environment=OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
```

For Linux/production environments, the environment variable is not needed.

## References

- [RQ Issue #1700](https://github.com/rq/rq/issues/1700) - macOS fork() safety issues
- [Apple Technical Note TN2239](https://developer.apple.com/library/archive/technotes/tn2239/_index.html) - Fork safety
- [RQ Documentation](https://python-rq.org/) - Official RQ docs
