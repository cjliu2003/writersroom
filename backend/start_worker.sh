#!/bin/bash
# RQ Worker startup script for WritersRoom AI ingestion tasks
#
# This script starts the RQ worker with the necessary environment variable
# to work around macOS fork() safety issues.
#
# Usage:
#   ./start_worker.sh

# Ensure script fails on error
set -e

# Activate virtual environment (adjust path if needed)
cd "$(dirname "$0")"
source ../writersRoom/bin/activate

# Set macOS fork() safety environment variable
# This is required on macOS to prevent crashes when RQ forks worker processes
# See: https://github.com/rq/rq/issues/1700
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES

# Start RQ worker
echo "Starting RQ worker for ai_ingestion queue..."
echo "Python: $(which python)"
echo "Working directory: $(pwd)"

python worker.py
