"""
AI Analytics Router - Endpoints for AI cost and usage analytics

Provides detailed breakdowns of:
- Chat message costs (tool calls vs synthesis)
- Script ingestion costs (per-scene tracking)
- User usage summaries
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime

from app.models.user import User
from app.auth.dependencies import get_current_user
from app.db.base import get_db
from app.services.metrics_service import MetricsService
from app.routers.script_router import get_script_if_user_has_access

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai/analytics", tags=["AI Analytics"])


# ============================================================
# Response Schemas
# ============================================================

class TokenBreakdown(BaseModel):
    """Token usage breakdown."""
    input: int
    output: int


class ToolCallIteration(BaseModel):
    """Single tool call iteration details."""
    iteration: int
    tool: Optional[str]
    cost: float
    input_tokens: int
    output_tokens: int


class MessageCostBreakdown(BaseModel):
    """Cost breakdown for a single chat message."""
    message_id: str
    tool_call_cost: float
    tool_call_tokens: TokenBreakdown
    synthesis_cost: float
    synthesis_tokens: TokenBreakdown
    total_cost: float
    iterations: List[ToolCallIteration]
    tool_call_percentage: float
    synthesis_percentage: float


class ConversationCostBreakdown(BaseModel):
    """Aggregated cost breakdown for a conversation."""
    conversation_id: str
    total_cost: float
    breakdown: dict


class SceneCost(BaseModel):
    """Cost for a single scene."""
    summary_cost: float
    embedding_cost: float
    total: float


class ScriptIngestionCosts(BaseModel):
    """Full ingestion cost breakdown for a script."""
    script_id: str
    total_ingestion_cost: float
    by_operation_type: dict
    per_scene: dict
    scene_count: int
    avg_cost_per_scene: float
    min_scene_cost: float
    max_scene_cost: float


class OperationTypeCost(BaseModel):
    """Cost for a specific operation type."""
    cost: float
    input_tokens: int
    output_tokens: int
    operation_count: int


class UserUsageSummary(BaseModel):
    """User usage summary over a period."""
    user_id: str
    period_days: int
    total_cost: float
    total_input_tokens: int
    total_output_tokens: int
    breakdown: dict


# ============================================================
# Endpoints
# ============================================================

@router.get("/message/{message_id}/breakdown", response_model=MessageCostBreakdown)
async def get_message_cost_breakdown(
    message_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed cost breakdown for a specific chat message.

    Returns:
    - Tool call costs vs synthesis costs
    - Per-iteration breakdown showing which tools were called
    - Percentage breakdown for tool calls vs final synthesis

    Use this to understand the cost composition of multi-turn tool use.
    """
    try:
        metrics_service = MetricsService(db)
        breakdown = await metrics_service.get_chat_message_breakdown(message_id)

        # Transform iterations to match schema
        iterations = [
            ToolCallIteration(
                iteration=it.get('iteration', 0),
                tool=it.get('tool'),
                cost=it.get('cost', 0),
                input_tokens=it.get('input_tokens', 0),
                output_tokens=it.get('output_tokens', 0)
            )
            for it in breakdown.get('iterations', [])
        ]

        return MessageCostBreakdown(
            message_id=breakdown['message_id'],
            tool_call_cost=breakdown['tool_call_cost'],
            tool_call_tokens=TokenBreakdown(
                input=breakdown['tool_call_tokens']['input'],
                output=breakdown['tool_call_tokens']['output']
            ),
            synthesis_cost=breakdown['synthesis_cost'],
            synthesis_tokens=TokenBreakdown(
                input=breakdown['synthesis_tokens']['input'],
                output=breakdown['synthesis_tokens']['output']
            ),
            total_cost=breakdown['total_cost'],
            iterations=iterations,
            tool_call_percentage=breakdown['tool_call_percentage'],
            synthesis_percentage=breakdown['synthesis_percentage']
        )

    except Exception as e:
        logger.error(f"Error getting message cost breakdown: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error getting message cost breakdown: {str(e)}"
        )


@router.get("/conversation/{conversation_id}/breakdown", response_model=ConversationCostBreakdown)
async def get_conversation_cost_breakdown(
    conversation_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get aggregated cost breakdown for an entire conversation.

    Aggregates all messages in the conversation by operation type.
    """
    try:
        metrics_service = MetricsService(db)
        breakdown = await metrics_service.get_conversation_breakdown(conversation_id)

        return ConversationCostBreakdown(
            conversation_id=breakdown['conversation_id'],
            total_cost=breakdown['total_cost'],
            breakdown=breakdown['breakdown']
        )

    except Exception as e:
        logger.error(f"Error getting conversation cost breakdown: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error getting conversation cost breakdown: {str(e)}"
        )


@router.get("/script/{script_id}/ingestion-costs", response_model=ScriptIngestionCosts)
async def get_script_ingestion_costs(
    script_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed ingestion cost breakdown for a script.

    Returns:
    - Total ingestion cost
    - Breakdown by operation type (scene summaries, outline, character sheets, embeddings)
    - Per-scene cost breakdown
    - Statistics: scene count, average/min/max cost per scene

    Use this to understand the cost of initial script ingestion jobs.
    """
    try:
        # Verify user has access to the script
        await get_script_if_user_has_access(script_id, user, db, allow_viewer=True)

        metrics_service = MetricsService(db)
        costs = await metrics_service.get_script_ingestion_costs(script_id)

        return ScriptIngestionCosts(
            script_id=costs['script_id'],
            total_ingestion_cost=costs['total_ingestion_cost'],
            by_operation_type=costs['by_operation_type'],
            per_scene=costs['per_scene'],
            scene_count=costs['scene_count'],
            avg_cost_per_scene=costs['avg_cost_per_scene'],
            min_scene_cost=costs['min_scene_cost'],
            max_scene_cost=costs['max_scene_cost']
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting script ingestion costs: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error getting script ingestion costs: {str(e)}"
        )


@router.get("/user/summary", response_model=UserUsageSummary)
async def get_user_usage_summary(
    days: int = Query(default=30, ge=1, le=365, description="Number of days to summarize"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get usage summary for the current user over the specified period.

    Returns:
    - Total cost over the period
    - Total tokens used (input and output)
    - Breakdown by operation type
    """
    try:
        metrics_service = MetricsService(db)
        summary = await metrics_service.get_user_usage_summary(user.user_id, days=days)

        return UserUsageSummary(
            user_id=summary['user_id'],
            period_days=summary['period_days'],
            total_cost=summary['total_cost'],
            total_input_tokens=summary['total_input_tokens'],
            total_output_tokens=summary['total_output_tokens'],
            breakdown=summary['breakdown']
        )

    except Exception as e:
        logger.error(f"Error getting user usage summary: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error getting user usage summary: {str(e)}"
        )


@router.get("/script/{script_id}/chat-costs")
async def get_script_chat_costs(
    script_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get chat cost summary for a specific script.

    Aggregates all chat conversations for the script and shows:
    - Total chat costs
    - Tool call vs synthesis breakdown
    - Average cost per message
    """
    try:
        # Verify user has access to the script
        await get_script_if_user_has_access(script_id, user, db, allow_viewer=True)

        from sqlalchemy import select, func
        from app.models.ai_operation_metrics import AIOperationMetrics, OperationType

        # Query aggregated metrics for chat operations on this script
        result = await db.execute(
            select(
                AIOperationMetrics.operation_type,
                func.sum(AIOperationMetrics.total_cost).label('total_cost'),
                func.sum(AIOperationMetrics.input_tokens).label('input_tokens'),
                func.sum(AIOperationMetrics.output_tokens).label('output_tokens'),
                func.count(AIOperationMetrics.metric_id).label('operation_count'),
                func.avg(AIOperationMetrics.latency_ms).label('avg_latency_ms')
            )
            .where(AIOperationMetrics.script_id == script_id)
            .where(AIOperationMetrics.operation_type.in_([
                OperationType.CHAT_TOOL_CALL,
                OperationType.CHAT_SYNTHESIS,
                OperationType.CHAT_RAG_ONLY
            ]))
            .group_by(AIOperationMetrics.operation_type)
        )
        rows = result.all()

        breakdown = {}
        total_cost = 0.0
        total_messages = 0

        for row in rows:
            op_type = row.operation_type.value
            cost = float(row.total_cost or 0)
            breakdown[op_type] = {
                'cost': cost,
                'input_tokens': row.input_tokens or 0,
                'output_tokens': row.output_tokens or 0,
                'operation_count': row.operation_count or 0,
                'avg_latency_ms': int(row.avg_latency_ms or 0)
            }
            total_cost += cost
            if op_type in ['chat_synthesis', 'chat_rag_only']:
                total_messages += row.operation_count or 0

        # Calculate percentages
        for key in breakdown:
            breakdown[key]['percentage'] = (
                breakdown[key]['cost'] / total_cost * 100 if total_cost > 0 else 0
            )

        return {
            'script_id': str(script_id),
            'total_chat_cost': total_cost,
            'total_messages': total_messages,
            'avg_cost_per_message': total_cost / total_messages if total_messages > 0 else 0,
            'breakdown': breakdown
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting script chat costs: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error getting script chat costs: {str(e)}"
        )
