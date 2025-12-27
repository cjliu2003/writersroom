"""
AI Conversation Logger

Provides structured, human-readable logging for AI chat interactions.
Logs are written to both console and dedicated log files for easy review.

Log files:
- logs/ai_conversations.log: All AI conversations with clear formatting
- logs/ai_tool_calls.log: Tool-specific logs for debugging tool behavior

Usage:
    from app.services.ai_logger import AIConversationLogger

    logger = AIConversationLogger(conversation_id, user_id, script_id)
    logger.log_user_message(message)
    logger.log_tool_call(tool_name, tool_input, tool_result)
    logger.log_assistant_response(response)
    logger.log_session_summary()
"""

import logging
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any
from uuid import UUID
import os


# Configure log directory
LOG_DIR = Path(__file__).parent.parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

# Main conversation log file
CONVERSATION_LOG_FILE = LOG_DIR / "ai_conversations.log"
TOOL_LOG_FILE = LOG_DIR / "ai_tool_calls.log"


def _setup_file_logger(name: str, log_file: Path, level=logging.DEBUG) -> logging.Logger:
    """Create a logger that writes to a specific file with formatting."""
    logger = logging.getLogger(name)
    logger.setLevel(level)

    # Avoid duplicate handlers
    if not logger.handlers:
        # File handler with detailed formatting
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(level)
        file_handler.setFormatter(logging.Formatter(
            '%(message)s'  # Raw message - we do our own formatting
        ))
        logger.addHandler(file_handler)

        # Also log to console at INFO level for quick visibility
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(logging.Formatter(
            '%(message)s'
        ))
        logger.addHandler(console_handler)

    return logger


# Initialize loggers
conversation_logger = _setup_file_logger('ai.conversation', CONVERSATION_LOG_FILE)
tool_logger = _setup_file_logger('ai.tools', TOOL_LOG_FILE)


class AIConversationLogger:
    """
    Structured logger for AI conversations.

    Provides clear, readable logs that show:
    - User messages
    - System prompts (summarized)
    - Tool calls with inputs and outputs
    - Assistant responses
    - Token usage and performance metrics
    """

    def __init__(
        self,
        conversation_id: Optional[UUID] = None,
        user_id: Optional[UUID] = None,
        script_id: Optional[UUID] = None
    ):
        self.conversation_id = str(conversation_id) if conversation_id else "new"
        self.user_id = str(user_id)[:8] if user_id else "unknown"
        self.script_id = str(script_id)[:8] if script_id else "unknown"
        self.session_start = datetime.now()
        self.tool_calls: List[Dict[str, Any]] = []
        self.token_usage = {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0
        }

    def _header(self, title: str) -> str:
        """Create a formatted section header."""
        width = 80
        return f"\n{'='*width}\n{title.center(width)}\n{'='*width}"

    def _subheader(self, title: str) -> str:
        """Create a formatted subsection header."""
        return f"\n--- {title} ---"

    def _format_timestamp(self) -> str:
        """Get formatted timestamp."""
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

    def log_session_start(self, intent: str, tools_enabled: bool, budget_tier: str = "standard"):
        """Log the start of a new AI chat session."""
        msg = self._header("AI CHAT SESSION START")
        msg += f"""
Timestamp: {self._format_timestamp()}
Conversation ID: {self.conversation_id}
User ID: {self.user_id}
Script ID: {self.script_id}
Intent: {intent}
Tools Enabled: {tools_enabled}
Budget Tier: {budget_tier}
"""
        conversation_logger.info(msg)

    def log_user_message(self, message: str):
        """Log the user's message."""
        msg = self._subheader("USER MESSAGE")
        msg += f"\n{message}\n"
        conversation_logger.info(msg)

    def log_system_prompt_summary(self, total_tokens: int, context_tokens: int, scene_count: int = 0):
        """Log a summary of the system prompt (not full content for brevity)."""
        msg = self._subheader("SYSTEM PROMPT SUMMARY")
        msg += f"""
Total Prompt Tokens: {total_tokens:,}
Context Tokens: {context_tokens:,}
Scenes Included: {scene_count}
"""
        conversation_logger.debug(msg)

    def log_tool_call(
        self,
        tool_name: str,
        tool_input: Dict[str, Any],
        tool_result: str,
        iteration: int,
        duration_ms: float = 0
    ):
        """Log a tool call with its input and result."""
        # Store for summary
        self.tool_calls.append({
            "tool": tool_name,
            "input": tool_input,
            "result_preview": tool_result[:200] if tool_result else "",
            "iteration": iteration,
            "duration_ms": duration_ms
        })

        # Format for conversation log
        msg = self._subheader(f"TOOL CALL #{len(self.tool_calls)}: {tool_name}")
        msg += f"""
Iteration: {iteration}
Input: {json.dumps(tool_input, indent=2)}
Duration: {duration_ms:.1f}ms

Result Preview (first 500 chars):
{tool_result[:500] if tool_result else '[empty]'}
{'...[truncated]' if len(tool_result) > 500 else ''}
"""
        conversation_logger.info(msg)

        # Also log full result to tool log file
        tool_msg = f"""
{'='*60}
[{self._format_timestamp()}] {tool_name}
Conversation: {self.conversation_id}
Input: {json.dumps(tool_input)}
{'='*60}
FULL RESULT:
{tool_result}
{'='*60}
"""
        tool_logger.debug(tool_msg)

    def log_tool_results_reordered(self, count: int):
        """Log when tool results are reordered to counteract recency bias."""
        msg = f"\n🔄 Reordered {count} tool results (recency bias mitigation)\n"
        conversation_logger.info(msg)

    def log_synthesis_instruction(self, user_question: str):
        """Log the synthesis instruction being sent."""
        msg = self._subheader("SYNTHESIS INSTRUCTION")
        msg += f"""
Re-anchored User Question: {user_question[:200]}{'...' if len(user_question) > 200 else ''}
Instruction: Synthesize ALL tool results with equal weight
"""
        conversation_logger.debug(msg)

    def log_assistant_response(self, response: str, stop_reason: str = "end_turn"):
        """Log the assistant's final response."""
        msg = self._subheader("ASSISTANT RESPONSE")
        msg += f"""
Stop Reason: {stop_reason}
Response Length: {len(response)} chars

{'-'*40}
{response}
{'-'*40}
"""
        conversation_logger.info(msg)

    def log_token_usage(self, usage: Dict[str, int]):
        """Log token usage statistics."""
        self.token_usage = usage

        msg = self._subheader("TOKEN USAGE")
        msg += f"""
Input Tokens: {usage.get('input_tokens', 0):,}
Output Tokens: {usage.get('output_tokens', 0):,}
Cache Creation: {usage.get('cache_creation_input_tokens', 0):,}
Cache Read: {usage.get('cache_read_input_tokens', 0):,}
"""

        # Calculate cache savings
        input_tokens = usage.get('input_tokens', 0)
        cache_read = usage.get('cache_read_input_tokens', 0)
        if input_tokens > 0:
            cache_pct = (cache_read / input_tokens) * 100
            msg += f"Cache Hit Rate: {cache_pct:.1f}%\n"

        conversation_logger.info(msg)

    def log_session_summary(self):
        """Log a summary of the entire session."""
        duration = (datetime.now() - self.session_start).total_seconds()

        msg = self._header("AI CHAT SESSION SUMMARY")
        msg += f"""
Conversation ID: {self.conversation_id}
Duration: {duration:.2f}s
Tool Calls Made: {len(self.tool_calls)}
"""

        if self.tool_calls:
            msg += "\nTools Used:\n"
            for tc in self.tool_calls:
                msg += f"  - {tc['tool']} (iter {tc['iteration']}, {tc['duration_ms']:.0f}ms)\n"

        msg += f"""
Token Usage:
  Input: {self.token_usage.get('input_tokens', 0):,}
  Output: {self.token_usage.get('output_tokens', 0):,}
  Cache Read: {self.token_usage.get('cache_read_input_tokens', 0):,}
"""
        msg += "\n" + "="*80 + "\n"

        conversation_logger.info(msg)

    def log_error(self, error: str, context: str = ""):
        """Log an error that occurred during the session."""
        msg = self._subheader("ERROR")
        msg += f"""
Context: {context}
Error: {error}
"""
        conversation_logger.error(msg)


class QuickAILogger:
    """
    Simplified logger for quick one-off logging without session context.

    Usage:
        from app.services.ai_logger import ai_log

        ai_log.tool("get_scene", {"scene_index": 4}, "Scene content...")
        ai_log.response("Here is the analysis...")
        ai_log.error("Failed to execute tool")
    """

    def __init__(self):
        self.logger = conversation_logger

    def _timestamp(self) -> str:
        return datetime.now().strftime("%H:%M:%S.%f")[:-3]

    def message(self, user_message: str):
        """Log a user message."""
        self.logger.info(f"[{self._timestamp()}] 💬 USER: {user_message[:100]}...")

    def tool(self, tool_name: str, tool_input: dict, result_preview: str = ""):
        """Log a tool call."""
        input_str = json.dumps(tool_input)
        preview = result_preview[:100] + "..." if len(result_preview) > 100 else result_preview
        self.logger.info(f"[{self._timestamp()}] 🔧 TOOL: {tool_name}({input_str}) → {preview}")

    def response(self, response: str):
        """Log assistant response."""
        preview = response[:150] + "..." if len(response) > 150 else response
        self.logger.info(f"[{self._timestamp()}] 🤖 ASSISTANT: {preview}")

    def error(self, error: str):
        """Log an error."""
        self.logger.error(f"[{self._timestamp()}] ❌ ERROR: {error}")

    def info(self, message: str):
        """Log general info."""
        self.logger.info(f"[{self._timestamp()}] ℹ️  {message}")


# Singleton instance for quick logging
ai_log = QuickAILogger()


def get_log_file_paths() -> Dict[str, str]:
    """Return paths to log files for external access."""
    return {
        "conversations": str(CONVERSATION_LOG_FILE),
        "tool_calls": str(TOOL_LOG_FILE)
    }
