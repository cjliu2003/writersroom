"""
AI-powered features endpoints for the WritersRoom API
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import attributes, noload
from typing import List
from uuid import UUID
from datetime import datetime, timezone
import json
import logging
from anthropic import AsyncAnthropic

from app.models.user import User
from app.models.script import Script
from app.models.scene import Scene
from app.models.chat_conversation import ChatConversation
from app.models.chat_message import ChatMessage as ChatMessageModel, MessageRole
from app.models.token_usage import TokenUsage
from app.schemas.ai import (
    SceneSummaryRequest,
    SceneSummaryResponse,
    ChatRequest,
    ChatResponse,
    ChatMessage,
    AIErrorResponse,
    ChatMessageRequest,
    ChatMessageResponse,
    ToolCallMessageRequest,
    ToolCallMessageResponse,
    ToolCallMetadata,
    IntentType,
    DomainType,
    RequestType,
    ReferenceType,
    RouterResult,
    ConversationListItem,
    ConversationListResponse,
    CreateConversationRequest,
    CreateConversationResponse,
    UpdateConversationRequest,
    UpdateConversationResponse
)
from app.services.openai_service import openai_service
from app.services.ai_service import AIService
from app.services.intent_classifier import IntentClassifier
from app.services.message_router import MessageRouter
from app.services.script_probe import ScriptProbe
from app.services.state_manager import StateManager
from app.services.context_builder import ContextBuilder
from app.services.conversation_service import ConversationService
from app.services.ai_logger import AIConversationLogger, ai_log
from app.services.evidence_builder import EvidenceBuilder
from app.auth.dependencies import get_current_user
from app.db.base import get_db
from app.routers.script_router import get_script_if_user_has_access, validate_script_access

router = APIRouter(prefix="/ai", tags=["AI"])
logger = logging.getLogger(__name__)

# ============================================================================
# Constants for Tool Loop Configuration
# ============================================================================

# Final synthesis gets more tokens to produce complete, well-structured answers
# after gathering information from multiple tool calls
FINAL_SYNTHESIS_MAX_TOKENS = 4000  # Increased for deep analysis (~3000 words)

# Standard max tokens for tool loop iterations
# Now higher since we use tool_choice to control output (no text generation in loop)
TOOL_LOOP_MAX_TOKENS = 1500  # Enough for tool calls + minimal planning text

# P0.2 fix: RAG-only mode default (increased from 600)
RAG_ONLY_DEFAULT_MAX_TOKENS = 1200

# Signal tool name - used to detect when Claude is ready for synthesis
SIGNAL_TOOL_NAME = "signal_ready_for_response"


def _extract_all_text(content_blocks) -> str:
    """
    Extract and concatenate all text blocks from Claude response.

    P0.1 fix: Anthropic responses can contain multiple content blocks.
    Previously we only returned the first text block, which dropped any
    additional text. This function extracts ALL text content.

    Args:
        content_blocks: List of content blocks from response.content

    Returns:
        Concatenated text from all text-type blocks, joined by newlines
    """
    text_parts = []
    for block in content_blocks:
        if hasattr(block, 'type') and block.type == "text":
            text_parts.append(block.text)
    return "\n".join(text_parts) if text_parts else ""


@router.post("/scene-summary", response_model=SceneSummaryResponse)
async def generate_scene_summary(
    request: SceneSummaryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Generate an AI-powered summary for a specific scene.
    """
    try:
        # Verify user has access to the script
        script = await get_script_if_user_has_access(
            request.script_id, 
            user, 
            db, 
            allow_viewer=True
        )
        
        # Generate summary using OpenAI
        summary = await openai_service.generate_scene_summary(
            slugline=request.slugline,
            scene_content=request.scene_text
        )
        print(f"\n🔍 [AI Summary Debug] Generated summary for '{request.slugline}'")
        print(f"   Summary length: {len(summary)} chars")
        print(f"   Script ID: {script.script_id}")
        print(f"   Script has content_blocks: {script.content_blocks is not None}")

        # Determine editor mode based on content_blocks (same logic as GET /content)
        # If script.content_blocks exists → script-level editor (save to script.scene_summaries)
        # If script.content_blocks is null → scene-level editor (save to scene.summary)
        if script.content_blocks is not None:
            # Script-level editor: save to script.scene_summaries
            print(f"   Path: Script-level editor (content_blocks exists)")
            print(f"   Before: scene_summaries = {script.scene_summaries}")

            if script.scene_summaries is None:
                script.scene_summaries = {}
                print(f"   Initialized empty dict")

            script.scene_summaries[request.slugline] = summary
            print(f"   After mutation: scene_summaries has {len(script.scene_summaries)} entries")

            # Mark the JSONB column as modified so SQLAlchemy detects the change
            attributes.flag_modified(script, 'scene_summaries')
            print(f"   Called flag_modified on scene_summaries")

            script.updated_at = datetime.now(timezone.utc)
        else:
            # Scene-level editor: save to scene.summary
            print(f"   Path: Scene-level editor (content_blocks is null)")

            # Get the specific scene record
            scene_query = select(Scene).where(
                Scene.script_id == request.script_id,
                Scene.position == request.scene_index
            )
            result = await db.execute(scene_query)
            scene = result.scalar_one_or_none()

            if not scene:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Scene at index {request.scene_index} not found"
                )

            scene.summary = summary
            scene.updated_at = datetime.now(timezone.utc)
            print(f"   Saved to scene.summary for Scene position {scene.position}")

        print(f"   Committing to database...")
        await db.commit()
        print(f"   ✅ Commit successful!")
        
        return SceneSummaryResponse(
            success=True,
            summary=summary
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate scene summary: {str(e)}"
        )


@router.post("/chat", response_model=ChatResponse)
async def ai_chat(
    request: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Generate AI chat responses with screenplay context.
    """
    try:
        # Verify user has access to the script
        script = await get_script_if_user_has_access(
            request.script_id, 
            user, 
            db, 
            allow_viewer=True
        )
        
        scene_context = None
        
        # Load recent scenes for context if requested
        if request.include_scenes:
            scenes_query = select(Scene).where(
                Scene.script_id == request.script_id
            ).order_by(Scene.position.desc()).limit(10)
            
            result = await db.execute(scenes_query)
            recent_scenes = result.scalars().all()
            
            if recent_scenes:
                scene_summaries = []
                for scene in reversed(recent_scenes):  # Reverse to get chronological order
                    summary_text = scene.summary or "No summary available"
                    scene_summaries.append(f"Scene: {scene.scene_heading}\nSummary: {summary_text}")
                
                scene_context = "\n\n".join(scene_summaries)
        
        # Generate AI response
        assistant_content = await openai_service.generate_chat_response(
            messages=request.messages,
            scene_context=scene_context
        )
        
        # Create response message
        response_message = ChatMessage(
            role="assistant",
            content=assistant_content,
            timestamp=datetime.now(timezone.utc).isoformat()
        )
        
        return ChatResponse(
            success=True,
            message=response_message
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate chat response: {str(e)}"
        )


# ============================================================================
# Phase 3: Chat Integration with RAG Context Assembly
# ============================================================================

async def track_token_usage(
    user_id: UUID,
    script_id: UUID,
    conversation_id: UUID,
    usage: dict,
    db: AsyncSession
):
    """
    Track token usage for analytics and billing.

    Calculates cost based on Claude 3.5 Sonnet pricing:
    - Input: $0.003/1K tokens
    - Cache creation (write): $0.00375/1K tokens (25% premium)
    - Cache read: $0.0003/1K tokens (90% discount)
    - Output: $0.015/1K tokens
    """
    # Calculate cost
    input_cost = (
        usage["input_tokens"] * 0.003 / 1000 +  # Full price input
        usage["cache_creation_input_tokens"] * 0.00375 / 1000 +  # Cache write (25% more)
        usage["cache_read_input_tokens"] * 0.0003 / 1000  # Cache read (90% discount)
    )
    output_cost = usage["output_tokens"] * 0.015 / 1000
    total_cost = input_cost + output_cost

    # Store usage record
    usage_record = TokenUsage(
        user_id=user_id,
        script_id=script_id,
        conversation_id=conversation_id,
        input_tokens=usage["input_tokens"],
        cache_creation_tokens=usage["cache_creation_input_tokens"],
        cache_read_tokens=usage["cache_read_input_tokens"],
        output_tokens=usage["output_tokens"],
        total_cost=total_cost
    )

    db.add(usage_record)
    await db.commit()
    # OPTIMIZATION: Removed db.refresh() - it was triggering cascade loading of
    # TokenUsage relationships (user → User, script → Script → ALL scenes,
    # conversation → ALL messages). The return value is never used by callers.

    logger.info(
        f"Token usage tracked: user={user_id}, script={script_id}, "
        f"in={usage['input_tokens']}, out={usage['output_tokens']}, "
        f"cache_read={usage['cache_read_input_tokens']}, cost=${total_cost:.4f}"
    )

    return usage_record


# ============================================================================
# Phase 6: Unified Hybrid Chat Helper Functions
# ============================================================================

def should_enable_tools(
    request: ChatMessageRequest,
    intent: IntentType,
    domain: DomainType = DomainType.SCRIPT
) -> bool:
    """
    Intelligently decide whether to enable tools based on request context and domain.

    Strategy:
    - GENERAL domain: Never use tools (expert knowledge only)
    - SCRIPT domain: Use tools for analytical queries
    - HYBRID domain: Use tools (need script grounding)

    Args:
        request: Chat message request
        intent: Classified intent
        domain: Classified domain (GENERAL/SCRIPT/HYBRID)

    Returns:
        True if tools should be enabled, False otherwise
    """
    # Phase 1: Domain-based decision takes priority
    if domain == DomainType.GENERAL:
        logger.info(f"Disabling tools: GENERAL domain detected")
        return False

    # Explicit user override takes precedence
    if hasattr(request, 'enable_tools') and request.enable_tools is not None:
        return request.enable_tools

    # Analytical keywords suggest tool usage
    analytical_keywords = [
        "analyze", "pacing", "track", "find all", "search for",
        "character appears", "plot threads", "quantitative",
        "how many", "which scenes", "compare scenes", "show me all"
    ]
    message_lower = request.message.lower()
    uses_analytical = any(kw in message_lower for kw in analytical_keywords)

    if uses_analytical:
        logger.info(f"Enabling tools: analytical keywords detected in '{request.message[:50]}...'")
        return True

    # Intent-based defaults
    if intent in [IntentType.LOCAL_EDIT, IntentType.SCENE_FEEDBACK]:
        # For local edits with scene_id provided, RAG context is sufficient
        if request.current_scene_id:
            logger.info(f"Disabling tools: LOCAL_EDIT/SCENE_FEEDBACK with scene_id provided")
            return False

    if intent == IntentType.GLOBAL_QUESTION:
        # Global questions may benefit from precise retrieval
        logger.info(f"Enabling tools: GLOBAL_QUESTION intent")
        return True

    # Conservative default: enable tools (let Claude decide)
    logger.info(f"Enabling tools: default behavior for intent={intent}, domain={domain}")
    return True


async def _trigger_synthesis(
    client: AsyncAnthropic,
    system: List[dict],
    messages: List[dict],
    all_tool_results: List[dict],
    evidence_builder,
    context_builder,
    user_question: str,
    initial_messages: List[dict],
    intent,
    total_usage: dict,
    ai_conv_logger = None
) -> str:
    """
    Trigger final synthesis phase after tool gathering is complete.

    This is called when:
    1. Claude calls signal_ready_for_response
    2. Tool loop exits with tool results that need synthesis

    Args:
        client: Anthropic client
        system: System prompt blocks
        messages: Current message history (already includes all tool results)
        all_tool_results: Collected tool results for evidence building
        evidence_builder: EvidenceBuilder instance
        context_builder: ContextBuilder instance
        user_question: Original user question
        initial_messages: Initial message history
        intent: Intent type for format customization
        total_usage: Token usage dict to update
        ai_conv_logger: Optional conversation logger

    Returns:
        Final synthesized response text
    """
    # Extract user's original question for synthesis
    question_for_synthesis = user_question
    if not question_for_synthesis:
        for msg in reversed(initial_messages):
            if msg.get("role") == "user":
                content = msg.get("content", "")
                if isinstance(content, str):
                    question_for_synthesis = content
                elif isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            question_for_synthesis = block.get("text", "")
                            break
                break
        question_for_synthesis = question_for_synthesis or "the user's question"

    # Build structured evidence from all tool results
    evidence = await evidence_builder.build_evidence(
        tool_results=all_tool_results,
        user_question=question_for_synthesis
    )

    logger.info(
        f"Evidence built for synthesis: {len(evidence.items)} items, "
        f"{evidence.total_chars} chars, truncated={evidence.was_truncated}"
    )

    # Create synthesis prompt using context_builder
    synthesis_content = context_builder.build_synthesis_prompt(
        evidence_text=evidence.to_prompt_text(),
        user_question=question_for_synthesis,
        intent=intent
    )

    # Build synthesis messages
    synthesis_messages = messages.copy()
    synthesis_messages.append({"role": "user", "content": synthesis_content})

    # Make final synthesis call with full token budget
    synthesis_response = await client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=FINAL_SYNTHESIS_MAX_TOKENS,
        system=system,
        messages=synthesis_messages
    )

    # Aggregate synthesis tokens
    total_usage["input_tokens"] += synthesis_response.usage.input_tokens
    total_usage["cache_creation_input_tokens"] += synthesis_response.usage.cache_creation_input_tokens
    total_usage["cache_read_input_tokens"] += synthesis_response.usage.cache_read_input_tokens
    total_usage["output_tokens"] += synthesis_response.usage.output_tokens

    final_text = _extract_all_text(synthesis_response.content)

    if ai_conv_logger:
        ai_conv_logger.log_assistant_response(final_text, "synthesis")
        ai_conv_logger.log_token_usage(total_usage)
        ai_conv_logger.log_session_summary()

    return final_text


async def _handle_tool_loop(
    client: AsyncAnthropic,
    system: List[dict],
    initial_messages: List[dict],
    tools: List[dict],
    max_iterations: int,
    script_id: UUID,
    db: AsyncSession,
    ai_conv_logger: AIConversationLogger = None,
    user_question: str = None,
    intent: IntentType = None
) -> tuple[str, dict, ToolCallMetadata]:
    """
    Handle multi-turn tool calling loop with evidence-based synthesis.

    ARCHITECTURE (tool_choice strategy):
    - First iteration: tool_choice="auto" - Claude can respond directly if no tools needed
      (handles general questions that don't require script data)
    - After first tool call: tool_choice="any" - Claude MUST call a tool
      (prevents Claude from generating text responses that get truncated)
    - When Claude calls signal_ready_for_response: exit loop and trigger synthesis
      (ensures clean handoff to synthesis phase with full token budget)

    This approach eliminates the truncation issues where Claude would try to
    generate a full response in the tool loop with limited tokens.

    Args:
        client: Anthropic client
        system: System prompt blocks
        initial_messages: Initial message history
        tools: Available MCP tools
        max_iterations: Maximum tool calling iterations
        script_id: Script ID for tool execution context
        db: Database session
        ai_conv_logger: Optional conversation logger for detailed logging
        user_question: Original user question for evidence ranking
        intent: Intent type for format customization

    Returns:
        Tuple of (final_message, aggregated_usage, tool_metadata)
    """
    from app.services.mcp_tools import MCPToolExecutor
    import time

    messages = initial_messages.copy()
    total_usage = {
        "input_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "output_tokens": 0
    }
    tools_used = []
    tool_executor = MCPToolExecutor(db=db, script_id=script_id)

    # Track whether any tools have been called (controls tool_choice strategy)
    has_called_tools = False

    # Collect structured tool results for evidence building
    all_tool_results = []
    evidence_builder = EvidenceBuilder()
    context_builder = ContextBuilder(db=db)

    for iteration in range(max_iterations):
        logger.info(f"Tool loop iteration {iteration + 1}/{max_iterations}")

        # TOOL_CHOICE STRATEGY:
        # - First iteration OR no tools called yet: "auto" (Claude decides if tools needed)
        # - After any tool call: "any" (Claude MUST call a tool, cannot output text)
        # This prevents truncation by ensuring Claude uses signal_ready_for_response
        # when done gathering info, rather than trying to generate a response directly.
        if has_called_tools:
            tool_choice = {"type": "any"}
            logger.info("Using tool_choice='any' (forcing tool use after previous tool call)")
        else:
            tool_choice = {"type": "auto"}
            logger.info("Using tool_choice='auto' (first iteration, Claude decides)")

        # Call Claude
        response = await client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=TOOL_LOOP_MAX_TOKENS,
            system=system,
            messages=messages,
            tools=tools,
            tool_choice=tool_choice
        )

        # Aggregate token usage
        total_usage["input_tokens"] += response.usage.input_tokens
        total_usage["cache_creation_input_tokens"] += response.usage.cache_creation_input_tokens
        total_usage["cache_read_input_tokens"] += response.usage.cache_read_input_tokens
        total_usage["output_tokens"] += response.usage.output_tokens

        # Check stop reason
        if response.stop_reason != "tool_use":
            # No tool use - this should only happen on first iteration with tool_choice="auto"
            # when Claude determines no tools are needed (general question)
            final_text = _extract_all_text(response.content)
            logger.info(f"Tool loop ended with stop_reason='{response.stop_reason}' after {iteration + 1} iteration(s)")

            # If we have tool results, always synthesize for consistent quality
            if all_tool_results:
                logger.info(f"Triggering synthesis for {len(all_tool_results)} tool results")
                final_text = await _trigger_synthesis(
                    client=client,
                    system=system,
                    messages=messages,
                    all_tool_results=all_tool_results,
                    evidence_builder=evidence_builder,
                    context_builder=context_builder,
                    user_question=user_question,
                    initial_messages=initial_messages,
                    intent=intent,
                    total_usage=total_usage,
                    ai_conv_logger=ai_conv_logger
                )

            return final_text, total_usage, ToolCallMetadata(
                tool_calls_made=iteration + 1,
                tools_used=list(set(tools_used)),
                stop_reason=response.stop_reason,
                recovery_attempts=0
            )

        # Extract and execute tool uses (stop_reason == "tool_use")
        tool_results = []
        signal_tool_called = False
        signal_summary = ""

        for block in response.content:
            if block.type == "tool_use":
                tools_used.append(block.name)
                logger.info(f"Executing tool: {block.name} with input: {block.input}")

                # Check for signal tool - triggers synthesis
                if block.name == SIGNAL_TOOL_NAME:
                    signal_tool_called = True
                    signal_summary = block.input.get("gathered_info_summary", "")
                    logger.info(f"Signal tool called: {signal_summary}")

                    # Still execute to get acknowledgment for conversation history
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": f"SIGNAL_READY: {signal_summary}"
                    })

                    if ai_conv_logger:
                        ai_conv_logger.log_tool_call(
                            tool_name=block.name,
                            tool_input=block.input,
                            tool_result=f"SIGNAL_READY: {signal_summary}",
                            iteration=iteration + 1,
                            duration_ms=0
                        )
                    continue  # Don't add to all_tool_results

                try:
                    # Execute tool with timing
                    tool_start = time.perf_counter()
                    result = await tool_executor.execute_tool(
                        tool_name=block.name,
                        tool_input=block.input
                    )
                    tool_duration_ms = (time.perf_counter() - tool_start) * 1000

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result
                    })
                    logger.info(f"Tool {block.name} executed successfully in {tool_duration_ms:.1f}ms")

                    # Collect structured result for evidence building
                    all_tool_results.append({
                        "tool_name": block.name,
                        "tool_input": block.input,
                        "result": result
                    })

                    # Mark that we've called tools (switch to tool_choice="any" next iteration)
                    has_called_tools = True

                    # Log to AI conversation logger if available
                    if ai_conv_logger:
                        ai_conv_logger.log_tool_call(
                            tool_name=block.name,
                            tool_input=block.input,
                            tool_result=result,
                            iteration=iteration + 1,
                            duration_ms=tool_duration_ms
                        )

                except Exception as e:
                    # Return error to Claude (graceful degradation)
                    logger.error(f"Tool execution failed: {e}", exc_info=True)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": f"Error executing tool: {str(e)}",
                        "is_error": True
                    })
                    if ai_conv_logger:
                        ai_conv_logger.log_error(str(e), f"Tool {block.name} execution")

        # Append assistant message and tool results to conversation
        messages.append({"role": "assistant", "content": response.content})

        # Reverse tool results order to counteract LLM recency bias
        if tool_results and len(tool_results) > 1:
            tool_results = list(reversed(tool_results))
            logger.info(f"Reversed {len(tool_results)} tool results to counteract recency bias")
            if ai_conv_logger:
                ai_conv_logger.log_tool_results_reordered(len(tool_results))

        # Only append tool results if there are any
        if tool_results:
            messages.append({"role": "user", "content": tool_results})

        # If signal tool was called, trigger synthesis now
        if signal_tool_called:
            logger.info(f"Signal tool triggered synthesis with {len(all_tool_results)} tool results")
            final_text = await _trigger_synthesis(
                client=client,
                system=system,
                messages=messages,
                all_tool_results=all_tool_results,
                evidence_builder=evidence_builder,
                context_builder=context_builder,
                user_question=user_question,
                initial_messages=initial_messages,
                intent=intent,
                total_usage=total_usage,
                ai_conv_logger=ai_conv_logger
            )

            return final_text, total_usage, ToolCallMetadata(
                tool_calls_made=iteration + 1,
                tools_used=list(set(tools_used)),
                stop_reason="signal_ready",
                recovery_attempts=0
            )

    # Max iterations reached - trigger synthesis with whatever we have
    logger.warning(f"Tool loop reached max_iterations ({max_iterations})")

    if all_tool_results:
        final_text = await _trigger_synthesis(
            client=client,
            system=system,
            messages=messages,
            all_tool_results=all_tool_results,
            evidence_builder=evidence_builder,
            context_builder=context_builder,
            user_question=user_question,
            initial_messages=initial_messages,
            intent=intent,
            total_usage=total_usage,
            ai_conv_logger=ai_conv_logger
        )
    else:
        # No tools called, return empty (shouldn't happen with proper tool_choice)
        final_text = "I was unable to gather sufficient information to respond."

    return final_text, total_usage, ToolCallMetadata(
        tool_calls_made=max_iterations,
        tools_used=list(set(tools_used)),
        stop_reason="max_iterations",
        recovery_attempts=0
    )


async def _trigger_synthesis_inline(
    client: AsyncAnthropic,
    system: List[dict],
    messages: List[dict],
    all_tool_results: List[dict],
    evidence_builder,
    context_builder,
    user_question: str,
    initial_messages: List[dict],
    intent,
    total_usage: dict,
    ai_conv_logger = None
) -> str:
    """
    Trigger synthesis for the streaming version (inline, can't be used with async generators).

    This is a duplicate of _trigger_synthesis for use in async generators where
    we can't easily compose async functions.
    """
    # Extract user's original question for synthesis
    question_for_synthesis = user_question
    if not question_for_synthesis:
        for msg in reversed(initial_messages):
            if msg.get("role") == "user":
                content = msg.get("content", "")
                if isinstance(content, str):
                    question_for_synthesis = content
                elif isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            question_for_synthesis = block.get("text", "")
                            break
                break
        question_for_synthesis = question_for_synthesis or "the user's question"

    # Build structured evidence from all tool results
    evidence = await evidence_builder.build_evidence(
        tool_results=all_tool_results,
        user_question=question_for_synthesis
    )

    logger.info(
        f"Evidence built for synthesis: {len(evidence.items)} items, "
        f"{evidence.total_chars} chars, truncated={evidence.was_truncated}"
    )

    # Create synthesis prompt using context_builder
    synthesis_content = context_builder.build_synthesis_prompt(
        evidence_text=evidence.to_prompt_text(),
        user_question=question_for_synthesis,
        intent=intent
    )

    # Build synthesis messages
    synthesis_messages = messages.copy()
    synthesis_messages.append({"role": "user", "content": synthesis_content})

    # Make final synthesis call with full token budget
    synthesis_response = await client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=FINAL_SYNTHESIS_MAX_TOKENS,
        system=system,
        messages=synthesis_messages
    )

    # Aggregate synthesis tokens
    total_usage["input_tokens"] += synthesis_response.usage.input_tokens
    total_usage["cache_creation_input_tokens"] += synthesis_response.usage.cache_creation_input_tokens
    total_usage["cache_read_input_tokens"] += synthesis_response.usage.cache_read_input_tokens
    total_usage["output_tokens"] += synthesis_response.usage.output_tokens

    final_text = _extract_all_text(synthesis_response.content)

    if ai_conv_logger:
        ai_conv_logger.log_assistant_response(final_text, "synthesis")
        ai_conv_logger.log_token_usage(total_usage)
        ai_conv_logger.log_session_summary()

    return final_text


async def _handle_tool_loop_with_status(
    client: AsyncAnthropic,
    system: List[dict],
    initial_messages: List[dict],
    tools: List[dict],
    max_iterations: int,
    script_id: UUID,
    db: AsyncSession,
    ai_conv_logger: AIConversationLogger = None,
    user_question: str = None,
    intent: IntentType = None
):
    """
    Handle multi-turn tool calling loop with status event yielding and evidence-based synthesis.

    ARCHITECTURE (tool_choice strategy):
    - First iteration: tool_choice="auto" - Claude can respond directly if no tools needed
      (handles general questions that don't require script data)
    - After first tool call: tool_choice="any" - Claude MUST call a tool
      (prevents Claude from generating text responses that get truncated)
    - When Claude calls signal_ready_for_response: exit loop and trigger synthesis
      (ensures clean handoff to synthesis phase with full token budget)

    This is an async generator that yields status events for each tool execution,
    allowing the frontend to show progress to users.

    Yields:
        Dict events with types:
        - "status": Tool execution status for user feedback
        - "thinking": AI is processing
        - "complete": Final response with message and metadata
        - "error": Error occurred

    Args:
        client: Anthropic client
        system: System prompt blocks
        initial_messages: Initial message history
        tools: Available MCP tools
        max_iterations: Maximum tool calling iterations
        script_id: Script ID for tool execution context
        db: Database session
        ai_conv_logger: Optional conversation logger for detailed logging
        user_question: Original user question for evidence ranking
        intent: Intent type for format customization
    """
    from app.services.mcp_tools import MCPToolExecutor, get_tool_status_message
    import time

    messages = initial_messages.copy()
    total_usage = {
        "input_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "output_tokens": 0
    }
    tools_used = []
    tool_executor = MCPToolExecutor(db=db, script_id=script_id)

    # Track whether any tools have been called (controls tool_choice strategy)
    has_called_tools = False

    # Collect structured tool results for evidence building
    all_tool_results = []
    evidence_builder = EvidenceBuilder()
    context_builder = ContextBuilder(db=db)

    # Initial thinking status
    yield {"type": "thinking", "message": "Thinking..."}

    for iteration in range(max_iterations):
        logger.info(f"Tool loop iteration {iteration + 1}/{max_iterations}")

        # TOOL_CHOICE STRATEGY:
        # - First iteration OR no tools called yet: "auto" (Claude decides if tools needed)
        # - After any tool call: "any" (Claude MUST call a tool, cannot output text)
        if has_called_tools:
            tool_choice = {"type": "any"}
            logger.info("Using tool_choice='any' (forcing tool use after previous tool call)")
        else:
            tool_choice = {"type": "auto"}
            logger.info("Using tool_choice='auto' (first iteration, Claude decides)")

        # Call Claude
        response = await client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=TOOL_LOOP_MAX_TOKENS,
            system=system,
            messages=messages,
            tools=tools,
            tool_choice=tool_choice
        )

        # Aggregate token usage
        total_usage["input_tokens"] += response.usage.input_tokens
        total_usage["cache_creation_input_tokens"] += response.usage.cache_creation_input_tokens
        total_usage["cache_read_input_tokens"] += response.usage.cache_read_input_tokens
        total_usage["output_tokens"] += response.usage.output_tokens

        # Check stop reason
        if response.stop_reason != "tool_use":
            # No tool use - this should only happen on first iteration with tool_choice="auto"
            # when Claude determines no tools are needed (general question)
            final_text = _extract_all_text(response.content)
            logger.info(f"Tool loop ended with stop_reason='{response.stop_reason}' after {iteration + 1} iteration(s)")

            # If we have tool results, always synthesize for consistent quality
            if all_tool_results:
                logger.info(f"Triggering synthesis for {len(all_tool_results)} tool results")
                yield {"type": "thinking", "message": "Synthesizing findings..."}
                final_text = await _trigger_synthesis_inline(
                    client=client,
                    system=system,
                    messages=messages,
                    all_tool_results=all_tool_results,
                    evidence_builder=evidence_builder,
                    context_builder=context_builder,
                    user_question=user_question,
                    initial_messages=initial_messages,
                    intent=intent,
                    total_usage=total_usage,
                    ai_conv_logger=ai_conv_logger
                )

            yield {
                "type": "complete",
                "message": final_text,
                "usage": total_usage,
                "tool_metadata": {
                    "tool_calls_made": iteration + 1,
                    "tools_used": list(set(tools_used)),
                    "stop_reason": response.stop_reason,
                    "recovery_attempts": 0
                }
            }
            return

        # Extract and execute tool uses (stop_reason == "tool_use")
        tool_results = []
        signal_tool_called = False
        signal_summary = ""

        for block in response.content:
            if block.type == "tool_use":
                tools_used.append(block.name)

                # Check for signal tool - triggers synthesis
                if block.name == SIGNAL_TOOL_NAME:
                    signal_tool_called = True
                    signal_summary = block.input.get("gathered_info_summary", "")
                    logger.info(f"Signal tool called: {signal_summary}")

                    # Yield status for signal tool
                    yield {"type": "status", "message": "Preparing response...", "tool": block.name}

                    # Still add result to maintain conversation flow
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": f"SIGNAL_READY: {signal_summary}"
                    })

                    if ai_conv_logger:
                        ai_conv_logger.log_tool_call(
                            tool_name=block.name,
                            tool_input=block.input,
                            tool_result=f"SIGNAL_READY: {signal_summary}",
                            iteration=iteration + 1,
                            duration_ms=0
                        )
                    continue  # Don't add to all_tool_results

                # Yield user-friendly status message
                status_message = get_tool_status_message(block.name, block.input, "active")
                yield {"type": "status", "message": status_message, "tool": block.name}

                logger.info(f"Executing tool: {block.name} with input: {block.input}")

                try:
                    # Execute tool with timing
                    tool_start = time.perf_counter()
                    result = await tool_executor.execute_tool(
                        tool_name=block.name,
                        tool_input=block.input
                    )
                    tool_duration_ms = (time.perf_counter() - tool_start) * 1000

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result
                    })
                    logger.info(f"Tool {block.name} executed successfully in {tool_duration_ms:.1f}ms")

                    # Collect structured result for evidence building
                    all_tool_results.append({
                        "tool_name": block.name,
                        "tool_input": block.input,
                        "result": result
                    })

                    # Mark that we've called tools (switch to tool_choice="any" next iteration)
                    has_called_tools = True

                    # Log to AI conversation logger if available
                    if ai_conv_logger:
                        ai_conv_logger.log_tool_call(
                            tool_name=block.name,
                            tool_input=block.input,
                            tool_result=result,
                            iteration=iteration + 1,
                            duration_ms=tool_duration_ms
                        )

                except Exception as e:
                    # Return error to Claude (graceful degradation)
                    logger.error(f"Tool execution failed: {e}", exc_info=True)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": f"Error executing tool: {str(e)}",
                        "is_error": True
                    })
                    if ai_conv_logger:
                        ai_conv_logger.log_error(str(e), f"Tool {block.name} execution")

        # Append assistant message and tool results to conversation
        messages.append({"role": "assistant", "content": response.content})

        # Reverse tool results order to counteract LLM recency bias
        if tool_results and len(tool_results) > 1:
            tool_results = list(reversed(tool_results))
            logger.info(f"Reversed {len(tool_results)} tool results to counteract recency bias")
            if ai_conv_logger:
                ai_conv_logger.log_tool_results_reordered(len(tool_results))

        # Only append tool results if there are any
        if tool_results:
            messages.append({"role": "user", "content": tool_results})

        # If signal tool was called, trigger synthesis now
        if signal_tool_called:
            logger.info(f"Signal tool triggered synthesis with {len(all_tool_results)} tool results")
            yield {"type": "thinking", "message": "Synthesizing findings..."}
            final_text = await _trigger_synthesis_inline(
                client=client,
                system=system,
                messages=messages,
                all_tool_results=all_tool_results,
                evidence_builder=evidence_builder,
                context_builder=context_builder,
                user_question=user_question,
                initial_messages=initial_messages,
                intent=intent,
                total_usage=total_usage,
                ai_conv_logger=ai_conv_logger
            )

            yield {
                "type": "complete",
                "message": final_text,
                "usage": total_usage,
                "tool_metadata": {
                    "tool_calls_made": iteration + 1,
                    "tools_used": list(set(tools_used)),
                    "stop_reason": "signal_ready",
                    "recovery_attempts": 0
                }
            }
            return

        # After tools complete, show thinking again
        yield {"type": "thinking", "message": "Analyzing results..."}

    # Max iterations reached - trigger synthesis with whatever we have
    logger.warning(f"Tool loop reached max_iterations ({max_iterations})")
    yield {"type": "thinking", "message": "Synthesizing findings..."}

    if all_tool_results:
        # Use the helper function to trigger synthesis
        final_text = await _trigger_synthesis_inline(
            client=client,
            system=system,
            messages=messages,
            initial_messages=initial_messages,
            user_question=user_question,
            intent=intent,
            evidence_builder=evidence_builder,
            context_builder=context_builder,
            all_tool_results=all_tool_results,
            total_usage=total_usage,
            ai_conv_logger=ai_conv_logger
        )
    else:
        # No tools were successfully called
        final_text = "I was unable to gather sufficient information to respond to your request. Please try rephrasing your question."
        if ai_conv_logger:
            ai_conv_logger.log_assistant_response(final_text, "max_iterations_no_results")
            ai_conv_logger.log_token_usage(total_usage)
            ai_conv_logger.log_session_summary()

    yield {
        "type": "complete",
        "message": final_text,
        "usage": total_usage,
        "tool_metadata": {
            "tool_calls_made": max_iterations,
            "tools_used": list(set(tools_used)),
            "stop_reason": "max_iterations",
            "recovery_attempts": 0
        }
    }


@router.post("/chat/message", response_model=ChatMessageResponse)
async def chat_message(
    request: ChatMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Send message to AI assistant and get response.

    Phase 3: Full integration with Phase 2 RAG components:
    - Intent classification (heuristic + LLM fallback)
    - Intelligent context retrieval (positional, semantic, hybrid, minimal)
    - Conversation context management (sliding window + summaries)
    - Prompt caching for 90% cost reduction
    - Token budget management (quick/standard/deep tiers)

    Request includes:
    - script_id: Which script to discuss
    - conversation_id: Existing conversation (optional)
    - current_scene_id: Current scene context (optional)
    - message: User's message
    - intent_hint: Optional intent classification hint
    - budget_tier: Token budget tier (quick/standard/deep)

    Response includes:
    - message: AI's response
    - conversation_id: Conversation ID (created if new)
    - usage: Token usage statistics with cache metrics
    - context_used: What context was included
    """
    import time
    endpoint_start = time.perf_counter()
    print(f"🔵 DEBUG: chat_message endpoint entered - user: {current_user.user_id}, script: {request.script_id}")
    logger.info(f"[CHAT] ⏱️  ENDPOINT START - user: {current_user.user_id}, script: {request.script_id}")

    try:
        # Validate script access
        step_start = time.perf_counter()
        await validate_script_access(
            request.script_id,
            current_user,
            db,
            allow_viewer=True
        )
        step_duration = (time.perf_counter() - step_start) * 1000
        logger.info(f"[CHAT] ✅ Access validation took {step_duration:.2f}ms")

        # Initialize services
        step_start = time.perf_counter()
        intent_classifier = IntentClassifier()
        context_builder = ContextBuilder(db=db)
        ai_service = AIService()
        step_duration = (time.perf_counter() - step_start) * 1000
        logger.info(f"[CHAT] ✅ Service initialization took {step_duration:.2f}ms")

        # 1. Classify intent
        step_start = time.perf_counter()
        intent = await intent_classifier.classify(
            message=request.message,
            hint=request.intent_hint
        )
        step_duration = (time.perf_counter() - step_start) * 1000
        logger.info(f"[CHAT] ✅ Intent classification took {step_duration:.2f}ms - Intent: {intent}")

        logger.info(f"Classified intent: {intent} for message: {request.message[:50]}...")

        # 2. Get or create conversation
        # OPTIMIZATION: Use noload('*') to prevent eager loading of relationships
        # ChatConversation has selectin relationships that cascade to Script->scenes (148 scenes!)
        # This was causing 25+ seconds of unnecessary queries
        step_start = time.perf_counter()
        if request.conversation_id:
            conversation_result = await db.execute(
                select(ChatConversation)
                .options(noload('*'))  # Prevent loading user, script, messages, summaries
                .where(ChatConversation.conversation_id == request.conversation_id)
            )
            conversation = conversation_result.scalar_one_or_none()

            if not conversation:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Conversation not found"
                )

            if conversation.user_id != current_user.user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied to this conversation"
                )
        else:
            # Create new conversation
            conversation = ChatConversation(
                user_id=current_user.user_id,
                script_id=request.script_id,
                current_scene_id=request.current_scene_id,
                title=request.message[:100]  # First message as title
            )
            db.add(conversation)
            await db.commit()
            await db.refresh(conversation)

            logger.info(f"Created new conversation: {conversation.conversation_id}")

        step_duration = (time.perf_counter() - step_start) * 1000
        logger.info(f"[CHAT] ✅ Conversation handling took {step_duration:.2f}ms (conversation_id: {conversation.conversation_id})")

        # 3. Determine if tools should be enabled BEFORE building context
        # This allows us to optimize context (skip scene retrieval when tools enabled)
        tools_enabled = should_enable_tools(request, intent)
        tool_metadata = None
        logger.info(f"[CHAT] 🔧 Tools enabled: {tools_enabled}")

        # Initialize AI conversation logger for detailed logging
        ai_conv_logger = AIConversationLogger(
            conversation_id=conversation.conversation_id,
            user_id=current_user.user_id,
            script_id=request.script_id
        )
        ai_conv_logger.log_session_start(
            intent=str(intent),
            tools_enabled=tools_enabled,
            budget_tier=request.budget_tier or "standard"
        )
        ai_conv_logger.log_user_message(request.message)

        # 4. Build context-aware prompt (optimized based on tools_enabled)
        # Phase B: Pass topic_mode override for user-controlled continuity
        step_start = time.perf_counter()
        prompt = await context_builder.build_prompt(
            script_id=request.script_id,
            message=request.message,
            intent=intent,
            conversation_id=conversation.conversation_id,
            current_scene_id=request.current_scene_id,
            budget_tier=request.budget_tier or "standard",
            skip_scene_retrieval=tools_enabled,  # Skip scene cards when tools enabled
            tools_enabled=tools_enabled,  # Adjust system prompt for tool mode
            topic_mode_override=request.topic_mode  # Phase B: User override for continuity
        )
        step_duration = (time.perf_counter() - step_start) * 1000
        logger.info(f"[CHAT] ✅ Context building took {step_duration:.2f}ms - {prompt['metadata']['tokens_used']['total']} tokens (skip_scenes={tools_enabled})")

        logger.info(
            f"Built prompt: {prompt['metadata']['tokens_used']['total']} tokens, "
            f"budget_tier={request.budget_tier or 'standard'}, intent={intent}, tools_enabled={tools_enabled}"
        )

        # 5. Generate AI response (Phase 6: Hybrid RAG + Tools)
        if tools_enabled:
            # Hybrid mode: RAG context (thin) + MCP tools
            logger.info("Hybrid mode: Enabling MCP tools with thin RAG context")
            step_start = time.perf_counter()

            # Import tools and create client
            from app.services.mcp_tools import SCREENPLAY_TOOLS
            from app.core.config import settings

            client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
            setup_duration = (time.perf_counter() - step_start) * 1000
            logger.info(f"[CHAT] ✅ Tool setup took {setup_duration:.2f}ms")

            # NOTE: Tool instructions are now included in system prompt via
            # context_builder.build_prompt(tools_enabled=True)
            # No need to append inline instructions here

            # Call tool loop with AI conversation logger
            # P1.3: Pass user_question and intent for evidence-based synthesis
            step_start = time.perf_counter()
            logger.info("[CHAT] 🤖 Starting tool loop (this includes AI generation)...")
            final_message, usage, tool_metadata = await _handle_tool_loop(
                client=client,
                system=prompt["system"],
                initial_messages=prompt["messages"],
                tools=SCREENPLAY_TOOLS,
                max_iterations=request.max_iterations,
                script_id=request.script_id,
                db=db,
                ai_conv_logger=ai_conv_logger,
                user_question=request.message,
                intent=intent
            )
            step_duration = (time.perf_counter() - step_start) * 1000
            logger.info(f"[CHAT] ✅ Tool loop completed in {step_duration:.2f}ms")

            response = {
                "content": final_message,
                "usage": usage
            }

            logger.info(
                f"Hybrid response: {usage['output_tokens']} output tokens, "
                f"tools_used={tool_metadata.tools_used}, "
                f"tool_calls={tool_metadata.tool_calls_made}, "
                f"cache_read={usage['cache_read_input_tokens']}"
            )
        else:
            # RAG-only mode: Use existing AIService
            logger.info("RAG-only mode: Using cached context without tools")

            step_start = time.perf_counter()
            logger.info("[CHAT] 🤖 Generating AI response...")
            # P0.2 fix: Use higher default for RAG-only mode (was 600)
            response = await ai_service.generate_response(
                prompt=prompt,
                max_tokens=request.max_tokens or RAG_ONLY_DEFAULT_MAX_TOKENS
            )
            step_duration = (time.perf_counter() - step_start) * 1000
            logger.info(f"[CHAT] ✅ AI generation completed in {step_duration:.2f}ms")

            logger.info(
                f"RAG response: {response['usage']['output_tokens']} output tokens, "
                f"cache_read={response['usage']['cache_read_input_tokens']} (cache hit={response['usage']['cache_read_input_tokens'] > 0})"
            )

            # Log to AI conversation logger
            ai_conv_logger.log_assistant_response(response["content"], "end_turn")
            ai_conv_logger.log_token_usage(response["usage"])

        # 5. Save conversation messages
        step_start = time.perf_counter()
        user_message = ChatMessageModel(
            conversation_id=conversation.conversation_id,
            sender="user",
            role=MessageRole.USER,
            content=request.message
        )
        db.add(user_message)

        assistant_message = ChatMessageModel(
            conversation_id=conversation.conversation_id,
            sender="assistant",
            role=MessageRole.ASSISTANT,
            content=response["content"]
        )
        db.add(assistant_message)

        await db.commit()
        step_duration = (time.perf_counter() - step_start) * 1000
        logger.info(f"[CHAT] ✅ Message saving took {step_duration:.2f}ms")

        # 6. Track token usage
        step_start = time.perf_counter()
        await track_token_usage(
            user_id=current_user.user_id,
            script_id=request.script_id,
            conversation_id=conversation.conversation_id,
            usage=response["usage"],
            db=db
        )
        step_duration = (time.perf_counter() - step_start) * 1000
        logger.info(f"[CHAT] ✅ Token tracking took {step_duration:.2f}ms")

        # 7. Check if conversation needs summary
        step_start = time.perf_counter()
        conversation_service = ConversationService(db=db)
        if await conversation_service.should_generate_summary(conversation.conversation_id):
            # Trigger background summary generation
            # TODO: Implement background job queue (RQ) for summary generation
            logger.info(f"Conversation {conversation.conversation_id} needs summary generation")
        step_duration = (time.perf_counter() - step_start) * 1000
        logger.info(f"[CHAT] ✅ Summary check took {step_duration:.2f}ms")

        # Calculate cache savings percentage
        cache_savings_pct = 0
        if response["usage"]["input_tokens"] > 0:
            cache_savings_pct = round(
                100 * response["usage"]["cache_read_input_tokens"] /
                response["usage"]["input_tokens"]
            )

        endpoint_duration = (time.perf_counter() - endpoint_start) * 1000
        logger.info(f"[CHAT] 🏁 ENDPOINT COMPLETE - Total: {endpoint_duration:.2f}ms")

        # Log session summary to file
        ai_conv_logger.log_session_summary()

        return ChatMessageResponse(
            message=response["content"],
            conversation_id=conversation.conversation_id,
            usage={
                "input_tokens": response["usage"]["input_tokens"],
                "cache_creation_input_tokens": response["usage"]["cache_creation_input_tokens"],
                "cache_read_input_tokens": response["usage"]["cache_read_input_tokens"],
                "output_tokens": response["usage"]["output_tokens"]
            },
            context_used={
                "intent": intent,
                "budget_tier": request.budget_tier or "standard",
                "tokens_breakdown": prompt["metadata"]["tokens_used"],
                "cache_hit": response["usage"]["cache_read_input_tokens"] > 0,
                "cache_savings_pct": cache_savings_pct
            },
            tool_metadata=tool_metadata  # Phase 6: Include tool usage metadata (optional)
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in chat_message endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate chat response: {str(e)}"
        )


@router.post("/chat/message/stream")
async def chat_message_stream(
    request: ChatMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Streaming endpoint for real-time response generation.

    Same functionality as POST /chat/message but streams the response
    token-by-token for better UX in the frontend.

    Returns Server-Sent Events (SSE) stream with:
    - content_delta events: Text chunks as they're generated
    - message_complete event: Final usage statistics
    """
    try:
        # Validate script access
        script = await get_script_if_user_has_access(
            request.script_id,
            current_user,
            db,
            allow_viewer=True
        )

        # Initialize services
        intent_classifier = IntentClassifier()
        context_builder = ContextBuilder(db=db)
        ai_service = AIService()

        # 1. Classify intent
        intent = await intent_classifier.classify(
            message=request.message,
            hint=request.intent_hint
        )

        # 2. Get or create conversation
        # OPTIMIZATION: Use noload('*') to prevent eager loading of relationships
        if request.conversation_id:
            conversation_result = await db.execute(
                select(ChatConversation)
                .options(noload('*'))
                .where(ChatConversation.conversation_id == request.conversation_id)
            )
            conversation = conversation_result.scalar_one_or_none()

            if not conversation or conversation.user_id != current_user.user_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Conversation not found"
                )
        else:
            conversation = ChatConversation(
                user_id=current_user.user_id,
                script_id=request.script_id,
                current_scene_id=request.current_scene_id,
                title=request.message[:100]
            )
            db.add(conversation)
            await db.commit()
            await db.refresh(conversation)

        # 3. Build context-aware prompt
        # Phase B: Pass topic_mode override for user-controlled continuity
        prompt = await context_builder.build_prompt(
            script_id=request.script_id,
            message=request.message,
            intent=intent,
            conversation_id=conversation.conversation_id,
            current_scene_id=request.current_scene_id,
            budget_tier=request.budget_tier or "standard",
            topic_mode_override=request.topic_mode  # Phase B: User override for continuity
        )

        # 4. Generate streaming response
        async def generate_stream():
            """Generator for SSE stream."""
            full_content = ""
            final_usage = None

            # P0.2 fix: Use higher default for RAG-only mode (was 600)
            async for chunk in ai_service.generate_response(
                prompt=prompt,
                max_tokens=request.max_tokens or RAG_ONLY_DEFAULT_MAX_TOKENS,
                stream=True
            ):
                if chunk["type"] == "content_delta":
                    full_content += chunk["text"]
                    yield f"data: {json.dumps(chunk)}\n\n"
                elif chunk["type"] == "message_complete":
                    final_usage = chunk["usage"]
                    yield f"data: {json.dumps(chunk)}\n\n"

            # 5. Save messages after streaming completes
            user_message = ChatMessageModel(
                conversation_id=conversation.conversation_id,
                sender="user",
                role=MessageRole.USER,
                content=request.message
            )
            db.add(user_message)

            assistant_message = ChatMessageModel(
                conversation_id=conversation.conversation_id,
                sender="assistant",
                role=MessageRole.ASSISTANT,
                content=full_content
            )
            db.add(assistant_message)

            await db.commit()

            # 6. Track token usage
            if final_usage:
                await track_token_usage(
                    user_id=current_user.user_id,
                    script_id=request.script_id,
                    conversation_id=conversation.conversation_id,
                    usage=final_usage,
                    db=db
                )

            # Send final event
            yield f"data: {json.dumps({'type': 'stream_end', 'conversation_id': str(conversation.conversation_id)})}\n\n"

        return StreamingResponse(
            generate_stream(),
            media_type="text/event-stream"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in chat_message_stream endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate streaming response: {str(e)}"
        )


@router.post("/chat/message/stream-with-status")
async def chat_message_stream_with_status(
    request: ChatMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Streaming endpoint with real-time status updates for tool execution.

    Returns Server-Sent Events (SSE) stream with:
    - status events: User-friendly progress messages (e.g., "Reading scene 5...")
    - thinking events: AI processing indicators
    - complete event: Final response with message and usage statistics

    This endpoint is designed for the hybrid RAG + Tools mode, providing
    real-time feedback as the AI analyzes the screenplay.
    """
    try:
        # Validate script access
        await validate_script_access(
            request.script_id,
            current_user,
            db,
            allow_viewer=True
        )

        # Initialize services
        message_router = MessageRouter()
        script_probe = ScriptProbe(db)
        state_manager = StateManager(db)
        context_builder = ContextBuilder(db=db)

        # Phase 2: Load conversation state for continuity (if conversation exists)
        conversation_state = None
        last_assistant_commitment = None
        active_characters = None
        active_scene_ids = None

        if request.conversation_id:
            conversation_state = await state_manager.get_state(request.conversation_id)
            if conversation_state:
                last_assistant_commitment = conversation_state.last_assistant_commitment
                active_characters = conversation_state.active_characters
                active_scene_ids = conversation_state.active_scene_ids
                logger.info(
                    f"[STREAM] Loaded state: scenes={active_scene_ids}, "
                    f"characters={active_characters[:3] if active_characters else []}, "
                    f"commitment={'yes' if last_assistant_commitment else 'no'}"
                )

        # 1. Unified routing: classify domain, request_type, intent, and continuity
        route_result = await message_router.route(
            message=request.message,
            last_assistant_commitment=last_assistant_commitment,
            active_characters=active_characters,
            active_scene_ids=[str(s) for s in active_scene_ids] if active_scene_ids else None,
            has_active_scene=request.current_scene_id is not None
        )

        # If domain uncertain (HYBRID or needs_probe), verify with script probe
        if route_result.needs_probe or route_result.domain == DomainType.HYBRID:
            is_relevant, matches = await script_probe.probe_relevance(
                script_id=request.script_id,
                query=request.message
            )
            if not is_relevant and route_result.domain != DomainType.HYBRID:
                # Override to GENERAL if probe finds no relevant content
                route_result = RouterResult(
                    domain=DomainType.GENERAL,
                    request_type=route_result.request_type,
                    intent=route_result.intent,
                    continuity=route_result.continuity,
                    refers_to=route_result.refers_to,
                    confidence=route_result.confidence,
                    needs_probe=False
                )
                logger.info(f"[STREAM] Domain overridden to GENERAL after probe (no relevant matches)")

        # Use hint if provided
        intent = request.intent_hint if request.intent_hint else route_result.intent
        domain = route_result.domain
        request_type = route_result.request_type

        logger.info(
            f"[STREAM] Routing result: domain={domain.value}, "
            f"request_type={request_type.value}, intent={intent.value}, "
            f"continuity={route_result.continuity.value}, "
            f"refers_to={route_result.refers_to.value}"
        )

        # 2. Get or create conversation
        if request.conversation_id:
            conversation_result = await db.execute(
                select(ChatConversation)
                .options(noload('*'))
                .where(ChatConversation.conversation_id == request.conversation_id)
            )
            conversation = conversation_result.scalar_one_or_none()

            if not conversation:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Conversation not found"
                )

            if conversation.user_id != current_user.user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied to this conversation"
                )
        else:
            conversation = ChatConversation(
                user_id=current_user.user_id,
                script_id=request.script_id,
                current_scene_id=request.current_scene_id,
                title=request.message[:100]
            )
            db.add(conversation)
            await db.commit()
            await db.refresh(conversation)

            logger.info(f"[STREAM] Created new conversation: {conversation.conversation_id}")

        # 3. Determine if tools should be enabled BEFORE building context
        # Phase 1: Domain-based tool enablement
        tools_enabled = should_enable_tools(request, intent, domain)
        logger.info(f"[STREAM] Tools enabled: {tools_enabled} (domain={domain.value})")

        # Initialize AI conversation logger for detailed logging
        ai_conv_logger = AIConversationLogger(
            conversation_id=conversation.conversation_id,
            user_id=current_user.user_id,
            script_id=request.script_id
        )
        ai_conv_logger.log_session_start(
            intent=str(intent),
            tools_enabled=tools_enabled,
            budget_tier=request.budget_tier or "standard"
        )
        ai_conv_logger.log_user_message(request.message)

        # Store request_type for synthesis (Phase 4 will use this for response formatting)
        # For now, we log it for visibility
        logger.info(f"[STREAM] Request type: {request_type.value}")

        # Phase 3: Get reference context if user is referring to something specific
        reference_context = ""
        if route_result.refers_to != ReferenceType.NONE and conversation_state:
            reference_context = await context_builder.get_reference_context(
                refers_to=route_result.refers_to,
                state=conversation_state,
                script_id=request.script_id
            )
            if reference_context:
                logger.info(f"[STREAM] Reference context added: {route_result.refers_to.value}")

        # Prepend reference context to user message if available
        enriched_message = request.message
        if reference_context:
            enriched_message = f"{reference_context}\n\nUser question: {request.message}"

        # 4. Build context-aware prompt (optimized based on tools_enabled)
        # Phase 4: Pass domain and request_type for system prompt customization
        # Phase B: Pass topic_mode override for user-controlled continuity
        prompt = await context_builder.build_prompt(
            script_id=request.script_id,
            message=enriched_message,  # Use enriched message with reference context
            intent=intent,
            conversation_id=conversation.conversation_id,
            current_scene_id=request.current_scene_id,
            budget_tier=request.budget_tier or "standard",
            skip_scene_retrieval=tools_enabled,  # Skip scene cards when tools enabled
            tools_enabled=tools_enabled,  # Adjust system prompt for tool mode
            request_type=request_type,  # Phase 4: Request type awareness
            domain=domain,  # Phase 4: Domain awareness
            topic_mode_override=request.topic_mode  # Phase B: User override for continuity
        )

        logger.info(
            f"[STREAM] Built prompt: {prompt['metadata']['tokens_used']['total']} tokens (skip_scenes={tools_enabled})"
        )

        # Store these for use in the generator closure
        user_id = current_user.user_id
        script_id = request.script_id
        conversation_id = conversation.conversation_id
        user_message_content = request.message
        max_iterations = request.max_iterations

        async def generate_stream():
            """Generator for SSE stream with status events."""
            final_message = ""
            final_usage = None
            tool_metadata = None

            if tools_enabled:
                # Hybrid mode: RAG context (thin) + MCP tools with status events
                from app.services.mcp_tools import SCREENPLAY_TOOLS
                from app.core.config import settings

                client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

                # NOTE: Tool instructions are now included in system prompt via
                # context_builder.build_prompt(tools_enabled=True)
                # No need to append inline instructions here

                # Use the status-yielding tool loop
                # P1.3: Pass user_question and intent for evidence-based synthesis
                async for event in _handle_tool_loop_with_status(
                    client=client,
                    system=prompt["system"],
                    initial_messages=prompt["messages"],
                    tools=SCREENPLAY_TOOLS,
                    max_iterations=max_iterations,
                    script_id=script_id,
                    db=db,
                    ai_conv_logger=ai_conv_logger,
                    user_question=user_message_content,
                    intent=intent
                ):
                    if event["type"] == "complete":
                        final_message = event["message"]
                        final_usage = event["usage"]
                        tool_metadata = event["tool_metadata"]
                        # Send the complete event
                        yield f"data: {json.dumps(event)}\n\n"
                    else:
                        # Send status/thinking events
                        yield f"data: {json.dumps(event)}\n\n"

            else:
                # RAG-only mode: Use AIService without tools
                ai_service = AIService()

                # Send initial thinking status
                yield f"data: {json.dumps({'type': 'thinking', 'message': 'Thinking...'})}\n\n"

                # P0.2 fix: Use higher default for RAG-only mode (was 600)
                response = await ai_service.generate_response(
                    prompt=prompt,
                    max_tokens=request.max_tokens or RAG_ONLY_DEFAULT_MAX_TOKENS
                )

                final_message = response["content"]
                final_usage = response["usage"]

                # Log to AI conversation logger
                ai_conv_logger.log_assistant_response(final_message, "end_turn")
                ai_conv_logger.log_token_usage(final_usage)
                ai_conv_logger.log_session_summary()

                # Send complete event
                yield f"data: {json.dumps({'type': 'complete', 'message': final_message, 'usage': final_usage})}\n\n"

            # Save conversation messages after streaming completes
            user_msg = ChatMessageModel(
                conversation_id=conversation_id,
                sender="user",
                role=MessageRole.USER,
                content=user_message_content
            )
            db.add(user_msg)

            assistant_msg = ChatMessageModel(
                conversation_id=conversation_id,
                sender="assistant",
                role=MessageRole.ASSISTANT,
                content=final_message
            )
            db.add(assistant_msg)

            await db.commit()

            # Phase 2: Update conversation state with assistant response
            try:
                await state_manager.update_state(
                    conversation_id=conversation_id,
                    assistant_response=final_message,
                    user_intent=intent
                )
            except Exception as state_err:
                logger.warning(f"Failed to update conversation state: {state_err}")

            # Track token usage
            if final_usage:
                await track_token_usage(
                    user_id=user_id,
                    script_id=script_id,
                    conversation_id=conversation_id,
                    usage=final_usage,
                    db=db
                )

            # Send final stream_end event with conversation_id
            yield f"data: {json.dumps({'type': 'stream_end', 'conversation_id': str(conversation_id)})}\n\n"

        return StreamingResponse(
            generate_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"  # Disable nginx buffering
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in chat_message_stream_with_status endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate streaming response: {str(e)}"
        )


@router.get("/chat/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get conversation history with all messages.

    Returns:
    - conversation: Conversation metadata (id, title, script_id, timestamps)
    - messages: List of all messages in chronological order
    """
    try:
        # Get conversation - use noload to prevent eager loading of messages/summaries
        # We fetch messages explicitly below, so no need to load them twice
        conversation_result = await db.execute(
            select(ChatConversation)
            .options(noload('*'))
            .where(ChatConversation.conversation_id == conversation_id)
        )
        conversation = conversation_result.scalar_one_or_none()

        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )

        # Verify access
        if conversation.user_id != current_user.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this conversation"
            )

        # Get all messages explicitly with noload to prevent conversation relationship loading
        # (ChatMessage.conversation has lazy='selectin' which would trigger N queries)
        messages_result = await db.execute(
            select(ChatMessageModel)
            .options(noload('*'))
            .where(ChatMessageModel.conversation_id == conversation_id)
            .order_by(ChatMessageModel.created_at)
        )
        messages = messages_result.scalars().all()

        # Build response dict manually since we used noload
        conv_dict = {
            'conversation_id': str(conversation.conversation_id),
            'user_id': str(conversation.user_id),
            'script_id': str(conversation.script_id),
            'current_scene_id': str(conversation.current_scene_id) if conversation.current_scene_id else None,
            'title': conversation.title,
            'created_at': conversation.created_at.isoformat() if conversation.created_at else None,
            'updated_at': conversation.updated_at.isoformat() if conversation.updated_at else None,
            'message_count': len(messages)
        }

        # Build lightweight message list - only include fields frontend actually uses
        # Avoids serializing embedding_vector (1536 floats × 8 bytes = ~12KB per message)
        messages_list = [
            {
                'message_id': str(msg.message_id),
                'role': msg.role.value if msg.role else msg.sender.value,
                'content': msg.content,
                'created_at': msg.created_at.isoformat() if msg.created_at else None
            }
            for msg in messages
        ]

        return {
            "conversation": conv_dict,
            "messages": messages_list
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_conversation endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get conversation: {str(e)}"
        )


# ============================================================================
# Multi-Chat Support Endpoints
# ============================================================================

@router.get("/chat/script/{script_id}/conversations", response_model=ConversationListResponse)
async def list_conversations_for_script(
    script_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    List all conversations for a user+script combination.

    Returns conversations ordered by most recently updated first.
    Each conversation includes metadata and a preview of the last message.

    Optimized: Uses subqueries to fetch message counts and last message previews
    in a single query instead of N+1 queries.
    """
    try:
        # Subquery for message count per conversation
        msg_count_subq = (
            select(
                ChatMessageModel.conversation_id,
                func.count(ChatMessageModel.message_id).label('msg_count')
            )
            .group_by(ChatMessageModel.conversation_id)
            .subquery()
        )

        # Subquery for last message per conversation using row_number window function
        # This gets the most recent message for each conversation
        last_msg_subq = (
            select(
                ChatMessageModel.conversation_id,
                ChatMessageModel.content,
                func.row_number().over(
                    partition_by=ChatMessageModel.conversation_id,
                    order_by=ChatMessageModel.created_at.desc()
                ).label('rn')
            )
            .subquery()
        )

        # Main query: join conversations with count and last message subqueries
        result = await db.execute(
            select(
                ChatConversation.conversation_id,
                ChatConversation.title,
                ChatConversation.created_at,
                ChatConversation.updated_at,
                func.coalesce(msg_count_subq.c.msg_count, 0).label('message_count'),
                last_msg_subq.c.content.label('last_message_content')
            )
            .outerjoin(
                msg_count_subq,
                ChatConversation.conversation_id == msg_count_subq.c.conversation_id
            )
            .outerjoin(
                last_msg_subq,
                (ChatConversation.conversation_id == last_msg_subq.c.conversation_id) &
                (last_msg_subq.c.rn == 1)
            )
            .where(
                ChatConversation.script_id == script_id,
                ChatConversation.user_id == current_user.user_id
            )
            .order_by(ChatConversation.updated_at.desc())
        )
        rows = result.all()

        # Build response from the joined result
        conversation_list = []
        for row in rows:
            # Build preview (truncate at 50 chars)
            last_message_preview = None
            if row.last_message_content:
                content = row.last_message_content
                last_message_preview = (content[:50] + "...") if len(content) > 50 else content

            conversation_list.append(ConversationListItem(
                conversation_id=str(row.conversation_id),
                title=row.title or "New Chat",
                created_at=row.created_at.isoformat() if row.created_at else "",
                updated_at=row.updated_at.isoformat() if row.updated_at else "",
                message_count=row.message_count,
                last_message_preview=last_message_preview
            ))

        return ConversationListResponse(conversations=conversation_list)

    except Exception as e:
        logger.error(f"Error in list_conversations_for_script endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list conversations: {str(e)}"
        )


@router.post("/chat/script/{script_id}/conversations", response_model=CreateConversationResponse)
async def create_conversation(
    script_id: UUID,
    request: CreateConversationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new conversation for a script.

    The title defaults to "New Chat" if not provided.
    """
    try:
        # Create new conversation
        conversation = ChatConversation(
            user_id=current_user.user_id,
            script_id=script_id,
            title=request.title or "New Chat"
        )
        db.add(conversation)
        await db.commit()
        await db.refresh(conversation)

        logger.info(
            f"User {current_user.user_id} created conversation {conversation.conversation_id} "
            f"for script {script_id}"
        )

        return CreateConversationResponse(
            conversation_id=str(conversation.conversation_id),
            title=conversation.title,
            created_at=conversation.created_at.isoformat() if conversation.created_at else "",
            updated_at=conversation.updated_at.isoformat() if conversation.updated_at else "",
            message_count=0
        )

    except Exception as e:
        await db.rollback()
        logger.error(f"Error in create_conversation endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create conversation: {str(e)}"
        )


@router.patch("/chat/conversations/{conversation_id}", response_model=UpdateConversationResponse)
async def update_conversation(
    conversation_id: UUID,
    request: UpdateConversationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Update a conversation (rename).

    Only the owner of the conversation can rename it.
    """
    try:
        # Get conversation - use noload to prevent eager loading of relationships
        # (messages, summaries, etc.) since we only need the basic fields
        result = await db.execute(
            select(ChatConversation)
            .options(noload('*'))
            .where(ChatConversation.conversation_id == conversation_id)
        )
        conversation = result.scalar_one_or_none()

        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )

        # Verify ownership
        if conversation.user_id != current_user.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )

        # Update title - use direct UPDATE to avoid refresh loading relationships
        now = datetime.now(timezone.utc)
        await db.execute(
            ChatConversation.__table__.update()
            .where(ChatConversation.conversation_id == conversation_id)
            .values(title=request.title, updated_at=now)
        )
        await db.commit()

        logger.info(
            f"User {current_user.user_id} renamed conversation {conversation_id} "
            f"to '{request.title}'"
        )

        return UpdateConversationResponse(
            conversation_id=str(conversation_id),
            title=request.title,
            updated_at=now.isoformat()
        )

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in update_conversation endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update conversation: {str(e)}"
        )


@router.delete("/chat/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a conversation and all associated messages.

    The cascade delete will automatically remove:
    - All ChatMessages in this conversation
    - All ConversationSummaries for this conversation

    Returns:
    - success: Boolean indicating successful deletion
    - message: Confirmation message
    """
    try:
        # Get conversation
        conversation_result = await db.execute(
            select(ChatConversation)
            .options(noload('*'))
            .where(ChatConversation.conversation_id == conversation_id)
        )
        conversation = conversation_result.scalar_one_or_none()

        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )

        # Verify ownership - user must own the conversation to delete it
        if conversation.user_id != current_user.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this conversation"
            )

        # Delete the conversation (cascade will handle messages and summaries)
        await db.delete(conversation)
        await db.commit()

        logger.info(
            f"User {current_user.user_id} deleted conversation {conversation_id}"
        )

        return {
            "success": True,
            "message": f"Conversation {conversation_id} deleted successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting conversation: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete conversation: {str(e)}"
        )


# ============================================================================
# Phase 5: Tool Calling Endpoint
# ============================================================================

@router.post("/chat/message/tools", response_model=ToolCallMessageResponse)
async def chat_message_with_tools(
    request: ToolCallMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Send message to AI assistant with tool calling support.

    Phase 5: MCP tool integration for screenplay analysis:
    - Enables Claude to use 6 screenplay tools dynamically
    - Multi-turn tool use loops (up to max_iterations)
    - Tools: get_scene, get_scene_context, get_character_scenes,
             search_script, analyze_pacing, get_plot_threads

    Example queries:
    - "What happens in scene 5?" → Uses get_scene tool
    - "Show me all scenes with SARAH" → Uses get_character_scenes tool
    - "Find scenes about the heist" → Uses search_script tool
    - "How's the pacing in Act 2?" → Uses analyze_pacing tool
    - "What are the main plot threads?" → Uses get_plot_threads tool
    - "Compare scenes 3, 5, and 7" → Uses multiple get_scene calls

    Response includes:
    - message: Final AI response after tool calls
    - conversation_id: Conversation ID (created if new)
    - usage: Token usage statistics
    - tool_calls: Number of tool calling iterations used
    - stop_reason: "end_turn" (natural end) or "max_iterations" (limit reached)
    """
    from app.services.mcp_tools import SCREENPLAY_TOOLS

    try:
        # Validate script access
        script = await get_script_if_user_has_access(
            request.script_id,
            current_user,
            db,
            allow_viewer=True
        )

        logger.info(
            f"Tool-enabled chat request from user {current_user.user_id} "
            f"for script {request.script_id}: {request.message[:100]}"
        )

        # Get or create conversation
        # OPTIMIZATION: Use noload('*') to prevent eager loading of relationships
        if request.conversation_id:
            conversation_result = await db.execute(
                select(ChatConversation)
                .options(noload('*'))
                .where(ChatConversation.conversation_id == request.conversation_id)
            )
            conversation = conversation_result.scalar_one_or_none()

            if not conversation:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Conversation not found"
                )

            if conversation.user_id != current_user.user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied to this conversation"
                )
        else:
            # Create new conversation
            conversation = ChatConversation(
                user_id=current_user.user_id,
                script_id=request.script_id,
                current_scene_id=request.current_scene_id,
                title=request.message[:100]
            )
            db.add(conversation)
            await db.commit()
            await db.refresh(conversation)

            logger.info(f"Created new tool conversation: {conversation.conversation_id}")

        # Build system prompt for screenplay analysis
        system_prompt = [
            {
                "type": "text",
                "text": (
                    "You are a professional screenplay analyst with deep expertise in "
                    "story structure, character development, and cinematic storytelling. "
                    "You have access to tools that allow you to retrieve and analyze "
                    "screenplay content dynamically.\n\n"
                    "When answering questions:\n"
                    "- Use tools to get accurate information from the screenplay\n"
                    "- Provide specific scene numbers and character names\n"
                    "- Reference actual dialogue and action when relevant\n"
                    "- Analyze story structure, pacing, and character arcs\n"
                    "- Give actionable feedback for improving the screenplay\n\n"
                    "Available tools:\n"
                    "- get_scene: Get full text of a specific scene\n"
                    "- get_scene_context: Get a scene plus neighboring scenes\n"
                    "- get_character_scenes: Track character appearances\n"
                    "- search_script: Search for scenes by keyword or theme\n"
                    "- analyze_pacing: Get quantitative pacing metrics\n"
                    "- get_plot_threads: Retrieve plot thread information"
                )
            }
        ]

        # Get recent conversation history for context
        messages_result = await db.execute(
            select(ChatMessageModel)
            .where(ChatMessageModel.conversation_id == conversation.conversation_id)
            .order_by(ChatMessageModel.created_at.desc())
            .limit(10)
        )
        recent_messages = list(reversed(messages_result.scalars().all()))

        # Build messages array with conversation history
        messages = []
        for msg in recent_messages:
            messages.append({
                "role": msg.role.value,
                "content": msg.content
            })

        # Add current user message
        messages.append({
            "role": "user",
            "content": request.message
        })

        # Build prompt structure
        prompt = {
            "system": system_prompt,
            "messages": messages,
            "model": "claude-3-7-sonnet-latest"
        }

        # Initialize AI service with database session
        ai_service = AIService(db=db)

        # Generate response with tools
        response = await ai_service.chat_with_tools(
            prompt=prompt,
            tools=SCREENPLAY_TOOLS,
            max_tokens=request.max_tokens or 1000,
            max_iterations=request.max_iterations or 5
        )

        logger.info(
            f"Tool chat completed: {response['tool_calls']} iterations, "
            f"{response['usage']['output_tokens']} output tokens, "
            f"stop_reason={response['stop_reason']}"
        )

        # Save conversation messages
        user_message = ChatMessageModel(
            conversation_id=conversation.conversation_id,
            sender="user",
            role=MessageRole.USER,
            content=request.message
        )
        db.add(user_message)

        assistant_message = ChatMessageModel(
            conversation_id=conversation.conversation_id,
            sender="assistant",
            role=MessageRole.ASSISTANT,
            content=response["content"]
        )
        db.add(assistant_message)

        await db.commit()

        # Track token usage
        await track_token_usage(
            user_id=current_user.user_id,
            script_id=request.script_id,
            conversation_id=conversation.conversation_id,
            usage=response["usage"],
            db=db
        )

        return ToolCallMessageResponse(
            message=response["content"],
            conversation_id=conversation.conversation_id,
            usage={
                "input_tokens": response["usage"]["input_tokens"],
                "cache_creation_input_tokens": response["usage"]["cache_creation_input_tokens"],
                "cache_read_input_tokens": response["usage"]["cache_read_input_tokens"],
                "output_tokens": response["usage"]["output_tokens"]
            },
            tool_calls=response["tool_calls"],
            stop_reason=response["stop_reason"]
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in chat_message_with_tools endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate tool-enabled chat response: {str(e)}"
        )
