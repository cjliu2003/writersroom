"""
AI Service

Unified AI service supporting Claude 3.5 Sonnet with streaming and prompt caching.
Integrates with Phase 2 RAG components for intelligent context assembly.
"""

from anthropic import AsyncAnthropic
import tiktoken
import logging
from typing import Dict, Optional, AsyncGenerator, List, Any
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings

logger = logging.getLogger(__name__)


class AIService:
    """
    Unified AI service supporting Claude 3.5 Sonnet.

    Features:
    - Prompt caching for 90% cost reduction
    - Streaming response generation
    - Token usage tracking with cache metrics
    - Integrated with Phase 2 context building
    """

    def __init__(self, db: Optional[AsyncSession] = None):
        """Initialize AI service with Anthropic client."""
        self.anthropic_client = AsyncAnthropic(
            api_key=settings.ANTHROPIC_API_KEY
        )
        self.tokenizer = tiktoken.get_encoding("cl100k_base")
        self.db = db

    async def generate_response(
        self,
        prompt: dict,
        max_tokens: int = 600,
        stream: bool = False
    ) -> Dict:
        """
        Generate AI response using Claude 3.5 Sonnet.

        Args:
            prompt: Prompt structure from ContextBuilder with system, messages, model
            max_tokens: Maximum output tokens
            stream: Whether to stream the response

        Returns:
            Dict with content, usage statistics including cache metrics, and stop_reason

        Raises:
            Exception: If Claude API call fails
        """
        if stream:
            return await self._generate_streaming(prompt, max_tokens)

        try:
            response = await self.anthropic_client.messages.create(
                model=prompt.get("model", "claude-haiku-4-5"),
                max_tokens=max_tokens,
                system=prompt.get("system", []),
                messages=prompt["messages"]
            )

            return {
                "content": response.content[0].text,
                "usage": {
                    "input_tokens": response.usage.input_tokens,
                    "cache_creation_input_tokens": getattr(
                        response.usage, 'cache_creation_input_tokens', 0
                    ),
                    "cache_read_input_tokens": getattr(
                        response.usage, 'cache_read_input_tokens', 0
                    ),
                    "output_tokens": response.usage.output_tokens
                },
                "stop_reason": response.stop_reason
            }

        except Exception as e:
            logger.error(f"Error generating Claude response: {str(e)}")
            raise

    async def _generate_streaming(
        self,
        prompt: dict,
        max_tokens: int
    ) -> AsyncGenerator[Dict, None]:
        """
        Generate streaming response for real-time UI updates.

        Args:
            prompt: Prompt structure from ContextBuilder
            max_tokens: Maximum output tokens

        Yields:
            Dict with type and data (content_delta or message_complete)

        Raises:
            Exception: If Claude API call fails
        """
        try:
            async with self.anthropic_client.messages.stream(
                model=prompt.get("model", "claude-haiku-4-5"),
                max_tokens=max_tokens,
                system=prompt.get("system", []),
                messages=prompt["messages"]
            ) as stream:
                async for text in stream.text_stream:
                    yield {
                        "type": "content_delta",
                        "text": text
                    }

                # Get final usage stats
                message = await stream.get_final_message()
                yield {
                    "type": "message_complete",
                    "usage": {
                        "input_tokens": message.usage.input_tokens,
                        "cache_creation_input_tokens": getattr(
                            message.usage, 'cache_creation_input_tokens', 0
                        ),
                        "cache_read_input_tokens": getattr(
                            message.usage, 'cache_read_input_tokens', 0
                        ),
                        "output_tokens": message.usage.output_tokens
                    }
                }

        except Exception as e:
            logger.error(f"Error generating streaming Claude response: {str(e)}")
            raise

    async def chat_with_tools(
        self,
        prompt: dict,
        tools: List[Dict[str, Any]],
        max_tokens: int = 1000,
        max_iterations: int = 5
    ) -> Dict[str, Any]:
        """
        Chat with tool calling support for multi-turn tool use loops.

        Implements agentic loop: LLM → tool calls → LLM → ... until final answer.

        Args:
            prompt: Prompt structure with system and messages
            tools: List of MCP tool definitions (from mcp_tools.SCREENPLAY_TOOLS)
            max_tokens: Maximum output tokens per LLM call
            max_iterations: Maximum tool use iterations (prevents infinite loops)

        Returns:
            Dict with:
                - content: Final text response
                - usage: Token usage statistics
                - tool_calls: Number of tool call iterations used
                - stop_reason: Why the loop ended

        Example:
            prompt = {
                "system": [{"type": "text", "text": "You are a screenplay analyst..."}],
                "messages": [{"role": "user", "content": "What happens in scene 5?"}]
            }
            result = await ai_service.chat_with_tools(
                prompt=prompt,
                tools=SCREENPLAY_TOOLS,
                max_tokens=1000
            )
        """
        from app.services.mcp_tools import MCPToolExecutor

        if not self.db:
            raise ValueError("AIService requires database session for tool calling")

        messages = list(prompt["messages"])  # Copy to avoid mutating original
        system = prompt.get("system", [])

        logger.info(f"Starting tool-enabled chat with max {max_iterations} iterations")

        for iteration in range(max_iterations):
            logger.debug(f"Tool calling iteration {iteration + 1}/{max_iterations}")

            # Call LLM with tools
            response = await self.anthropic_client.messages.create(
                model=prompt.get("model", "claude-haiku-4-5"),
                max_tokens=max_tokens,
                system=system,
                messages=messages,
                tools=tools
            )

            # Check if LLM wants to use tools
            if response.stop_reason != "tool_use":
                # LLM provided final answer without needing tools
                logger.info(f"Chat completed after {iteration} tool call iterations")
                return {
                    "content": response.content[0].text if response.content else "",
                    "usage": {
                        "input_tokens": response.usage.input_tokens,
                        "cache_creation_input_tokens": getattr(
                            response.usage, 'cache_creation_input_tokens', 0
                        ),
                        "cache_read_input_tokens": getattr(
                            response.usage, 'cache_read_input_tokens', 0
                        ),
                        "output_tokens": response.usage.output_tokens
                    },
                    "tool_calls": iteration,
                    "stop_reason": response.stop_reason
                }

            # Extract and execute tool calls
            tool_results = []
            tool_executor = MCPToolExecutor(db=self.db)

            for content_block in response.content:
                if content_block.type == "tool_use":
                    logger.info(
                        f"Executing tool: {content_block.name} "
                        f"with input: {content_block.input}"
                    )

                    try:
                        result = await tool_executor.execute_tool(
                            tool_name=content_block.name,
                            tool_input=content_block.input
                        )

                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": content_block.id,
                            "content": result
                        })

                        logger.debug(
                            f"Tool {content_block.name} returned: "
                            f"{result[:200]}..." if len(result) > 200 else result
                        )

                    except Exception as e:
                        logger.error(
                            f"Error executing tool {content_block.name}: {str(e)}"
                        )
                        # Return error to LLM so it can handle gracefully
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": content_block.id,
                            "content": f"Error executing tool: {str(e)}",
                            "is_error": True
                        })

            # Add assistant response and tool results to conversation
            messages.append({
                "role": "assistant",
                "content": response.content
            })
            messages.append({
                "role": "user",
                "content": tool_results
            })

        # Max iterations reached - return graceful message
        logger.warning(f"Reached maximum tool calling iterations ({max_iterations})")
        return {
            "content": (
                "I've reached the maximum number of tool calls for this request. "
                "The question might be too complex or require breaking down into "
                "smaller parts. Please try rephrasing or asking about specific scenes."
            ),
            "usage": {
                "input_tokens": response.usage.input_tokens,
                "cache_creation_input_tokens": getattr(
                    response.usage, 'cache_creation_input_tokens', 0
                ),
                "cache_read_input_tokens": getattr(
                    response.usage, 'cache_read_input_tokens', 0
                ),
                "output_tokens": response.usage.output_tokens
            },
            "tool_calls": max_iterations,
            "stop_reason": "max_iterations"
        }
