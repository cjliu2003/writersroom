"""
AI Metrics Service

Centralized service for tracking AI operation costs and analytics.
Provides both detailed per-operation tracking and aggregation queries.
"""

import logging
import time
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_operation_metrics import (
    AIOperationMetrics,
    OperationType,
    calculate_cost
)

logger = logging.getLogger(__name__)


class MetricsService:
    """
    Service for tracking and querying AI operation metrics.

    Features:
    - Track individual AI operations with full context
    - Calculate costs based on model pricing
    - Query aggregated analytics by various dimensions
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def track_operation(
        self,
        operation_type: OperationType,
        user_id: UUID,
        script_id: UUID,
        input_tokens: int,
        output_tokens: int,
        cache_creation_tokens: int = 0,
        cache_read_tokens: int = 0,
        model: str = "claude-haiku-4-5",
        conversation_id: Optional[UUID] = None,
        message_id: Optional[UUID] = None,
        scene_id: Optional[UUID] = None,
        iteration_number: Optional[int] = None,
        tool_name: Optional[str] = None,
        latency_ms: Optional[int] = None,
        defer_add: bool = False,
    ) -> AIOperationMetrics:
        """
        Track a single AI operation with full context.

        Args:
            operation_type: Type of operation (CHAT_TOOL_CALL, CHAT_SYNTHESIS, etc.)
            user_id: User who initiated the operation
            script_id: Script context
            input_tokens: Number of input tokens
            output_tokens: Number of output tokens
            cache_creation_tokens: Tokens written to cache
            cache_read_tokens: Tokens read from cache
            model: Model identifier for pricing
            conversation_id: For chat operations
            message_id: For chat operations
            scene_id: For ingestion operations
            iteration_number: For tool call iterations
            tool_name: Tool used in this iteration
            latency_ms: Operation latency
            defer_add: If True, don't add to session - caller will batch-add later.
                       Use this for parallel batch operations to avoid session conflicts.

        Returns:
            Created AIOperationMetrics record (not added to session if defer_add=True)
        """
        total_cost = calculate_cost(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_creation_tokens=cache_creation_tokens,
            cache_read_tokens=cache_read_tokens,
            model=model
        )

        metric = AIOperationMetrics(
            operation_type=operation_type,
            model_used=model,
            user_id=user_id,
            script_id=script_id,
            conversation_id=conversation_id,
            message_id=message_id,
            scene_id=scene_id,
            iteration_number=iteration_number,
            tool_name=tool_name,
            input_tokens=input_tokens,
            cache_creation_tokens=cache_creation_tokens,
            cache_read_tokens=cache_read_tokens,
            output_tokens=output_tokens,
            total_cost=total_cost,
            latency_ms=latency_ms
        )

        if not defer_add:
            self.db.add(metric)
        # Don't flush or commit - let caller handle transaction
        # For batch operations with defer_add=True, caller must add metrics to session later

        logger.debug(
            f"Tracked {operation_type.value}: in={input_tokens} out={output_tokens} "
            f"cost=${total_cost:.6f} model={model}"
        )

        return metric

    async def get_chat_message_breakdown(
        self,
        message_id: UUID
    ) -> Dict[str, Any]:
        """
        Get cost breakdown for a single chat message.

        Returns:
            Dict with tool_call_cost, synthesis_cost, total_cost, iterations
        """
        result = await self.db.execute(
            select(AIOperationMetrics)
            .where(AIOperationMetrics.message_id == message_id)
            .order_by(AIOperationMetrics.created_at)
        )
        metrics = list(result.scalars().all())

        tool_call_cost = 0.0
        tool_call_tokens = {'input': 0, 'output': 0}
        synthesis_cost = 0.0
        synthesis_tokens = {'input': 0, 'output': 0}
        iterations = []

        for m in metrics:
            if m.operation_type == OperationType.CHAT_TOOL_CALL:
                tool_call_cost += float(m.total_cost)
                tool_call_tokens['input'] += m.input_tokens
                tool_call_tokens['output'] += m.output_tokens
                iterations.append({
                    'iteration': m.iteration_number,
                    'tool': m.tool_name,
                    'cost': float(m.total_cost),
                    'input_tokens': m.input_tokens,
                    'output_tokens': m.output_tokens
                })
            elif m.operation_type in (OperationType.CHAT_SYNTHESIS, OperationType.CHAT_RAG_ONLY):
                synthesis_cost += float(m.total_cost)
                synthesis_tokens['input'] += m.input_tokens
                synthesis_tokens['output'] += m.output_tokens

        total_cost = tool_call_cost + synthesis_cost

        return {
            'message_id': str(message_id),
            'tool_call_cost': tool_call_cost,
            'tool_call_tokens': tool_call_tokens,
            'synthesis_cost': synthesis_cost,
            'synthesis_tokens': synthesis_tokens,
            'total_cost': total_cost,
            'iterations': iterations,
            'tool_call_percentage': (tool_call_cost / total_cost * 100) if total_cost > 0 else 0,
            'synthesis_percentage': (synthesis_cost / total_cost * 100) if total_cost > 0 else 0
        }

    async def get_conversation_breakdown(
        self,
        conversation_id: UUID
    ) -> Dict[str, Any]:
        """
        Get aggregated cost breakdown for an entire conversation.
        """
        result = await self.db.execute(
            select(
                AIOperationMetrics.operation_type,
                func.sum(AIOperationMetrics.total_cost).label('total_cost'),
                func.sum(AIOperationMetrics.input_tokens).label('input_tokens'),
                func.sum(AIOperationMetrics.output_tokens).label('output_tokens'),
                func.count(AIOperationMetrics.metric_id).label('operation_count')
            )
            .where(AIOperationMetrics.conversation_id == conversation_id)
            .group_by(AIOperationMetrics.operation_type)
        )
        rows = result.all()

        breakdown = {}
        total_cost = 0.0

        for row in rows:
            op_type = row.operation_type.value
            cost = float(row.total_cost or 0)
            breakdown[op_type] = {
                'cost': cost,
                'input_tokens': row.input_tokens or 0,
                'output_tokens': row.output_tokens or 0,
                'operation_count': row.operation_count or 0
            }
            total_cost += cost

        # Calculate percentages
        for key in breakdown:
            breakdown[key]['percentage'] = (
                breakdown[key]['cost'] / total_cost * 100 if total_cost > 0 else 0
            )

        return {
            'conversation_id': str(conversation_id),
            'total_cost': total_cost,
            'breakdown': breakdown
        }

    async def get_script_ingestion_costs(
        self,
        script_id: UUID
    ) -> Dict[str, Any]:
        """
        Get ingestion costs for a script, broken down by scene and operation type.
        """
        # Per-scene costs
        scene_result = await self.db.execute(
            select(
                AIOperationMetrics.scene_id,
                AIOperationMetrics.operation_type,
                func.sum(AIOperationMetrics.total_cost).label('total_cost'),
                func.sum(AIOperationMetrics.input_tokens).label('input_tokens'),
                func.sum(AIOperationMetrics.output_tokens).label('output_tokens')
            )
            .where(AIOperationMetrics.script_id == script_id)
            .where(AIOperationMetrics.operation_type.in_([
                OperationType.INGESTION_SCENE_SUMMARY,
                OperationType.INGESTION_EMBEDDING
            ]))
            .group_by(AIOperationMetrics.scene_id, AIOperationMetrics.operation_type)
        )

        per_scene = {}
        for row in scene_result.all():
            scene_id = str(row.scene_id) if row.scene_id else 'script_level'
            if scene_id not in per_scene:
                per_scene[scene_id] = {'summary_cost': 0, 'embedding_cost': 0, 'total': 0}

            cost = float(row.total_cost or 0)
            if row.operation_type == OperationType.INGESTION_SCENE_SUMMARY:
                per_scene[scene_id]['summary_cost'] = cost
            elif row.operation_type == OperationType.INGESTION_EMBEDDING:
                per_scene[scene_id]['embedding_cost'] = cost
            per_scene[scene_id]['total'] += cost

        # Script-level aggregates
        agg_result = await self.db.execute(
            select(
                AIOperationMetrics.operation_type,
                func.sum(AIOperationMetrics.total_cost).label('total_cost'),
                func.sum(AIOperationMetrics.input_tokens).label('input_tokens'),
                func.sum(AIOperationMetrics.output_tokens).label('output_tokens'),
                func.count(AIOperationMetrics.metric_id).label('count')
            )
            .where(AIOperationMetrics.script_id == script_id)
            .where(AIOperationMetrics.operation_type.like('ingestion_%'))
            .group_by(AIOperationMetrics.operation_type)
        )

        by_type = {}
        total_ingestion_cost = 0.0
        for row in agg_result.all():
            cost = float(row.total_cost or 0)
            by_type[row.operation_type.value] = {
                'cost': cost,
                'input_tokens': row.input_tokens or 0,
                'output_tokens': row.output_tokens or 0,
                'count': row.count or 0
            }
            total_ingestion_cost += cost

        # Stats
        scene_costs = [v['total'] for v in per_scene.values() if v['total'] > 0]

        return {
            'script_id': str(script_id),
            'total_ingestion_cost': total_ingestion_cost,
            'by_operation_type': by_type,
            'per_scene': per_scene,
            'scene_count': len(scene_costs),
            'avg_cost_per_scene': sum(scene_costs) / len(scene_costs) if scene_costs else 0,
            'min_scene_cost': min(scene_costs) if scene_costs else 0,
            'max_scene_cost': max(scene_costs) if scene_costs else 0
        }

    async def get_user_usage_summary(
        self,
        user_id: UUID,
        days: int = 30
    ) -> Dict[str, Any]:
        """
        Get usage summary for a user over the last N days.
        """
        from datetime import timedelta

        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        result = await self.db.execute(
            select(
                AIOperationMetrics.operation_type,
                func.sum(AIOperationMetrics.total_cost).label('total_cost'),
                func.sum(AIOperationMetrics.input_tokens).label('input_tokens'),
                func.sum(AIOperationMetrics.output_tokens).label('output_tokens'),
                func.count(AIOperationMetrics.metric_id).label('operation_count')
            )
            .where(AIOperationMetrics.user_id == user_id)
            .where(AIOperationMetrics.created_at >= cutoff)
            .group_by(AIOperationMetrics.operation_type)
        )

        breakdown = {}
        total_cost = 0.0
        total_input = 0
        total_output = 0

        for row in result.all():
            cost = float(row.total_cost or 0)
            breakdown[row.operation_type.value] = {
                'cost': cost,
                'input_tokens': row.input_tokens or 0,
                'output_tokens': row.output_tokens or 0,
                'operation_count': row.operation_count or 0
            }
            total_cost += cost
            total_input += row.input_tokens or 0
            total_output += row.output_tokens or 0

        return {
            'user_id': str(user_id),
            'period_days': days,
            'total_cost': total_cost,
            'total_input_tokens': total_input,
            'total_output_tokens': total_output,
            'breakdown': breakdown
        }


class OperationTimer:
    """Context manager for timing AI operations."""

    def __init__(self):
        self.start_time: Optional[float] = None
        self.end_time: Optional[float] = None

    def __enter__(self):
        self.start_time = time.time()
        return self

    def __exit__(self, *args):
        self.end_time = time.time()

    @property
    def elapsed_ms(self) -> int:
        if self.start_time and self.end_time:
            return int((self.end_time - self.start_time) * 1000)
        return 0
