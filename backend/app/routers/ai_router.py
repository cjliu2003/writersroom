"""
AI-powered features endpoints for the WritersRoom API
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
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
    IntentType
)
from app.services.openai_service import openai_service
from app.services.ai_service import AIService
from app.services.intent_classifier import IntentClassifier
from app.services.context_builder import ContextBuilder
from app.services.conversation_service import ConversationService
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
FINAL_SYNTHESIS_MAX_TOKENS = 1200  # Double the normal limit (was 600)

# Standard max tokens for intermediate tool loop iterations
TOOL_LOOP_MAX_TOKENS = 600


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
    intent: IntentType
) -> bool:
    """
    Intelligently decide whether to enable tools based on request context.

    Strategy: Enable tools for analytical queries, disable for simple chat.

    Args:
        request: Chat message request
        intent: Classified intent

    Returns:
        True if tools should be enabled, False otherwise
    """
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
    logger.info(f"Enabling tools: default behavior for intent={intent}")
    return True


async def _handle_tool_loop(
    client: AsyncAnthropic,
    system: List[dict],
    initial_messages: List[dict],
    tools: List[dict],
    max_iterations: int,
    script_id: UUID,
    db: AsyncSession
) -> tuple[str, dict, ToolCallMetadata]:
    """
    Handle multi-turn tool calling loop.

    Args:
        client: Anthropic client
        system: System prompt blocks
        initial_messages: Initial message history
        tools: Available MCP tools
        max_iterations: Maximum tool calling iterations
        script_id: Script ID for tool execution context
        db: Database session

    Returns:
        Tuple of (final_message, aggregated_usage, tool_metadata)
    """
    from app.services.mcp_tools import MCPToolExecutor

    messages = initial_messages.copy()
    total_usage = {
        "input_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "output_tokens": 0
    }
    tools_used = []
    tool_executor = MCPToolExecutor(db=db, script_id=script_id)

    for iteration in range(max_iterations):
        logger.info(f"Tool loop iteration {iteration + 1}/{max_iterations}")

        # Call Claude with standard token limit for intermediate iterations
        response = await client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=TOOL_LOOP_MAX_TOKENS,
            system=system,
            messages=messages,
            tools=tools
        )

        # Aggregate token usage
        total_usage["input_tokens"] += response.usage.input_tokens
        total_usage["cache_creation_input_tokens"] += response.usage.cache_creation_input_tokens
        total_usage["cache_read_input_tokens"] += response.usage.cache_read_input_tokens
        total_usage["output_tokens"] += response.usage.output_tokens

        # Check stop reason
        if response.stop_reason == "end_turn":
            # Natural end - extract final text
            final_text = next(
                (block.text for block in response.content if block.type == "text"),
                ""
            )
            logger.info(f"Tool loop ended naturally after {iteration + 1} iteration(s)")
            return final_text, total_usage, ToolCallMetadata(
                tool_calls_made=iteration + 1,
                tools_used=list(set(tools_used)),
                stop_reason="end_turn"
            )

        # Extract and execute tool uses
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                tools_used.append(block.name)
                logger.info(f"Executing tool: {block.name} with input: {block.input}")

                try:
                    # Execute tool
                    result = await tool_executor.execute_tool(
                        tool_name=block.name,
                        tool_input=block.input
                    )
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result
                    })
                    logger.info(f"Tool {block.name} executed successfully")
                except Exception as e:
                    # Return error to Claude (graceful degradation)
                    logger.error(f"Tool execution failed: {e}", exc_info=True)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": f"Error executing tool: {str(e)}",
                        "is_error": True
                    })

        # Append assistant message and tool results to conversation
        messages.append({"role": "assistant", "content": response.content})

        # Only append tool results if there are any (avoid empty content error)
        if tool_results:
            messages.append({"role": "user", "content": tool_results})

    # Max iterations reached - add synthesis instruction and make final call
    logger.warning(f"Tool loop reached max_iterations ({max_iterations})")

    # Add explicit synthesis instruction to guide final response
    # This ensures Claude produces a complete, well-organized answer instead of
    # intermediate thinking or incomplete synthesis
    synthesis_instruction = {
        "role": "user",
        "content": (
            "Based on all the information you've gathered from the tools above, "
            "please provide a complete, well-organized answer to the original question. "
            "Synthesize the key findings and be specific with scene numbers and details. "
            "Do not mention the tools you used - just provide the final answer."
        )
    }
    messages.append(synthesis_instruction)

    # Use increased token limit for final synthesis to allow complete responses
    final_response = await client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=FINAL_SYNTHESIS_MAX_TOKENS,
        system=system,
        messages=messages
    )

    # Aggregate final call tokens
    total_usage["input_tokens"] += final_response.usage.input_tokens
    total_usage["cache_creation_input_tokens"] += final_response.usage.cache_creation_input_tokens
    total_usage["cache_read_input_tokens"] += final_response.usage.cache_read_input_tokens
    total_usage["output_tokens"] += final_response.usage.output_tokens

    final_text = next(
        (block.text for block in final_response.content if block.type == "text"),
        ""
    )

    return final_text, total_usage, ToolCallMetadata(
        tool_calls_made=max_iterations,
        tools_used=list(set(tools_used)),
        stop_reason="max_iterations"
    )


async def _handle_tool_loop_with_status(
    client: AsyncAnthropic,
    system: List[dict],
    initial_messages: List[dict],
    tools: List[dict],
    max_iterations: int,
    script_id: UUID,
    db: AsyncSession
):
    """
    Handle multi-turn tool calling loop with status event yielding.

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
    """
    from app.services.mcp_tools import MCPToolExecutor, get_tool_status_message

    messages = initial_messages.copy()
    total_usage = {
        "input_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "output_tokens": 0
    }
    tools_used = []
    tool_executor = MCPToolExecutor(db=db, script_id=script_id)

    # Initial thinking status
    yield {"type": "thinking", "message": "Thinking..."}

    for iteration in range(max_iterations):
        logger.info(f"Tool loop iteration {iteration + 1}/{max_iterations}")

        # Call Claude with standard token limit for intermediate iterations
        response = await client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=TOOL_LOOP_MAX_TOKENS,
            system=system,
            messages=messages,
            tools=tools
        )

        # Aggregate token usage
        total_usage["input_tokens"] += response.usage.input_tokens
        total_usage["cache_creation_input_tokens"] += response.usage.cache_creation_input_tokens
        total_usage["cache_read_input_tokens"] += response.usage.cache_read_input_tokens
        total_usage["output_tokens"] += response.usage.output_tokens

        # Check stop reason
        if response.stop_reason == "end_turn":
            # Natural end - extract final text
            final_text = next(
                (block.text for block in response.content if block.type == "text"),
                ""
            )
            logger.info(f"Tool loop ended naturally after {iteration + 1} iteration(s)")

            yield {
                "type": "complete",
                "message": final_text,
                "usage": total_usage,
                "tool_metadata": {
                    "tool_calls_made": iteration + 1,
                    "tools_used": list(set(tools_used)),
                    "stop_reason": "end_turn"
                }
            }
            return

        # Extract and execute tool uses
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                tools_used.append(block.name)

                # Yield user-friendly status message
                status_message = get_tool_status_message(block.name, block.input, "active")
                yield {"type": "status", "message": status_message, "tool": block.name}

                logger.info(f"Executing tool: {block.name} with input: {block.input}")

                try:
                    # Execute tool
                    result = await tool_executor.execute_tool(
                        tool_name=block.name,
                        tool_input=block.input
                    )
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result
                    })
                    logger.info(f"Tool {block.name} executed successfully")
                except Exception as e:
                    # Return error to Claude (graceful degradation)
                    logger.error(f"Tool execution failed: {e}", exc_info=True)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": f"Error executing tool: {str(e)}",
                        "is_error": True
                    })

        # Append assistant message and tool results to conversation
        messages.append({"role": "assistant", "content": response.content})

        # Only append tool results if there are any (avoid empty content error)
        if tool_results:
            messages.append({"role": "user", "content": tool_results})

        # After tools complete, show thinking again
        yield {"type": "thinking", "message": "Analyzing results..."}

    # Max iterations reached - add synthesis instruction and make final call
    logger.warning(f"Tool loop reached max_iterations ({max_iterations})")
    yield {"type": "thinking", "message": "Synthesizing findings..."}

    # Add explicit synthesis instruction to guide final response
    # This ensures Claude produces a complete, well-organized answer instead of
    # intermediate thinking or incomplete synthesis
    synthesis_instruction = {
        "role": "user",
        "content": (
            "Based on all the information you've gathered from the tools above, "
            "please provide a complete, well-organized answer to the original question. "
            "Synthesize the key findings and be specific with scene numbers and details. "
            "Do not mention the tools you used - just provide the final answer."
        )
    }
    messages.append(synthesis_instruction)

    # Use increased token limit for final synthesis to allow complete responses
    final_response = await client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=FINAL_SYNTHESIS_MAX_TOKENS,
        system=system,
        messages=messages
    )

    # Aggregate final call tokens
    total_usage["input_tokens"] += final_response.usage.input_tokens
    total_usage["cache_creation_input_tokens"] += final_response.usage.cache_creation_input_tokens
    total_usage["cache_read_input_tokens"] += final_response.usage.cache_read_input_tokens
    total_usage["output_tokens"] += final_response.usage.output_tokens

    final_text = next(
        (block.text for block in final_response.content if block.type == "text"),
        ""
    )

    yield {
        "type": "complete",
        "message": final_text,
        "usage": total_usage,
        "tool_metadata": {
            "tool_calls_made": max_iterations,
            "tools_used": list(set(tools_used)),
            "stop_reason": "max_iterations"
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

        # 4. Build context-aware prompt (optimized based on tools_enabled)
        step_start = time.perf_counter()
        prompt = await context_builder.build_prompt(
            script_id=request.script_id,
            message=request.message,
            intent=intent,
            conversation_id=conversation.conversation_id,
            current_scene_id=request.current_scene_id,
            budget_tier=request.budget_tier or "standard",
            skip_scene_retrieval=tools_enabled,  # Skip scene cards when tools enabled
            tools_enabled=tools_enabled  # Adjust system prompt for tool mode
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

            # Call tool loop
            step_start = time.perf_counter()
            logger.info("[CHAT] 🤖 Starting tool loop (this includes AI generation)...")
            final_message, usage, tool_metadata = await _handle_tool_loop(
                client=client,
                system=prompt["system"],
                initial_messages=prompt["messages"],
                tools=SCREENPLAY_TOOLS,
                max_iterations=request.max_iterations,
                script_id=request.script_id,
                db=db
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
            response = await ai_service.generate_response(
                prompt=prompt,
                max_tokens=request.max_tokens or 600
            )
            step_duration = (time.perf_counter() - step_start) * 1000
            logger.info(f"[CHAT] ✅ AI generation completed in {step_duration:.2f}ms")

            logger.info(
                f"RAG response: {response['usage']['output_tokens']} output tokens, "
                f"cache_read={response['usage']['cache_read_input_tokens']} (cache hit={response['usage']['cache_read_input_tokens'] > 0})"
            )

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
        prompt = await context_builder.build_prompt(
            script_id=request.script_id,
            message=request.message,
            intent=intent,
            conversation_id=conversation.conversation_id,
            current_scene_id=request.current_scene_id,
            budget_tier=request.budget_tier or "standard"
        )

        # 4. Generate streaming response
        async def generate_stream():
            """Generator for SSE stream."""
            full_content = ""
            final_usage = None

            async for chunk in ai_service.generate_response(
                prompt=prompt,
                max_tokens=request.max_tokens or 600,
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
        intent_classifier = IntentClassifier()
        context_builder = ContextBuilder(db=db)

        # 1. Classify intent
        intent = await intent_classifier.classify(
            message=request.message,
            hint=request.intent_hint
        )

        logger.info(f"[STREAM] Classified intent: {intent} for message: {request.message[:50]}...")

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
        tools_enabled = should_enable_tools(request, intent)
        logger.info(f"[STREAM] Tools enabled: {tools_enabled}")

        # 4. Build context-aware prompt (optimized based on tools_enabled)
        prompt = await context_builder.build_prompt(
            script_id=request.script_id,
            message=request.message,
            intent=intent,
            conversation_id=conversation.conversation_id,
            current_scene_id=request.current_scene_id,
            budget_tier=request.budget_tier or "standard",
            skip_scene_retrieval=tools_enabled,  # Skip scene cards when tools enabled
            tools_enabled=tools_enabled  # Adjust system prompt for tool mode
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
                async for event in _handle_tool_loop_with_status(
                    client=client,
                    system=prompt["system"],
                    initial_messages=prompt["messages"],
                    tools=SCREENPLAY_TOOLS,
                    max_iterations=max_iterations,
                    script_id=script_id,
                    db=db
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

                response = await ai_service.generate_response(
                    prompt=prompt,
                    max_tokens=request.max_tokens or 600
                )

                final_message = response["content"]
                final_usage = response["usage"]

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

        # Get all messages explicitly (more efficient than eager loading)
        messages_result = await db.execute(
            select(ChatMessageModel)
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

        return {
            "conversation": conv_dict,
            "messages": [msg.to_dict() for msg in messages]
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
