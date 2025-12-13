"""
Performance Timing Middleware and Decorator

Provides detailed timing diagnostics for API endpoints and database operations.
"""

import time
import logging
import functools
from typing import Callable, Any
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)


class TimingContext:
    """Context manager for timing code blocks with detailed breakdown."""

    def __init__(self, label: str, log_level: int = logging.INFO):
        self.label = label
        self.log_level = log_level
        self.start_time = None
        self.end_time = None
        self.duration = None

    def __enter__(self):
        self.start_time = time.perf_counter()
        logger.log(self.log_level, f"⏱️  [TIMING] {self.label} - START")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.end_time = time.perf_counter()
        self.duration = (self.end_time - self.start_time) * 1000  # Convert to ms

        if exc_type:
            logger.log(self.log_level, f"❌ [TIMING] {self.label} - FAILED after {self.duration:.2f}ms")
        else:
            # Color coding based on duration
            if self.duration < 100:
                emoji = "✅"
            elif self.duration < 1000:
                emoji = "⚠️ "
            else:
                emoji = "🔴"

            logger.log(self.log_level, f"{emoji} [TIMING] {self.label} - COMPLETED in {self.duration:.2f}ms")


@asynccontextmanager
async def async_timing_context(label: str, log_level: int = logging.INFO):
    """Async context manager for timing async code blocks."""
    start_time = time.perf_counter()
    logger.log(log_level, f"⏱️  [TIMING] {label} - START")

    try:
        yield
    finally:
        end_time = time.perf_counter()
        duration = (end_time - start_time) * 1000  # Convert to ms

        # Color coding based on duration
        if duration < 100:
            emoji = "✅"
        elif duration < 1000:
            emoji = "⚠️ "
        else:
            emoji = "🔴"

        logger.log(log_level, f"{emoji} [TIMING] {label} - COMPLETED in {duration:.2f}ms")


def time_function(label: str = None):
    """
    Decorator for timing function execution.

    Usage:
        @time_function("My slow function")
        async def my_function():
            ...
    """
    def decorator(func: Callable) -> Callable:
        func_label = label or f"{func.__module__}.{func.__name__}"

        if asyncio.iscoroutinefunction(func):
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs) -> Any:
                async with async_timing_context(func_label):
                    return await func(*args, **kwargs)
            return async_wrapper
        else:
            @functools.wraps(func)
            def sync_wrapper(*args, **kwargs) -> Any:
                with TimingContext(func_label):
                    return func(*args, **kwargs)
            return sync_wrapper

    return decorator


# Import asyncio here to avoid circular imports
import asyncio
