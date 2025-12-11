"""
Pydantic schemas for AI endpoints
"""

from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from enum import Enum


class ChatMessage(BaseModel):
    """Schema for a chat message."""
    role: str = Field(..., description="Role of the message sender (user or assistant)")
    content: str = Field(..., description="Content of the message")
    timestamp: Optional[str] = Field(None, description="Timestamp of the message")


class SceneSummaryRequest(BaseModel):
    """Request schema for scene summary generation."""
    script_id: UUID = Field(..., description="ID of the script")
    scene_index: int = Field(..., description="Index of the scene within the script")
    slugline: str = Field(..., description="Scene heading/slugline")
    scene_text: str = Field(..., description="Full text content of the scene")


class SceneSummaryResponse(BaseModel):
    """Response schema for scene summary generation."""
    success: bool = Field(..., description="Whether the request was successful")
    summary: Optional[str] = Field(None, description="Generated scene summary")
    error: Optional[str] = Field(None, description="Error message if failed")


class ChatRequest(BaseModel):
    """Request schema for AI chat."""
    script_id: UUID = Field(..., description="ID of the script for context")
    messages: List[ChatMessage] = Field(..., description="Chat message history")
    include_scenes: bool = Field(True, description="Whether to include scene context")


class ChatResponse(BaseModel):
    """Response schema for AI chat."""
    success: bool = Field(..., description="Whether the request was successful")
    message: Optional[ChatMessage] = Field(None, description="AI response message")
    error: Optional[str] = Field(None, description="Error message if failed")


class AIErrorResponse(BaseModel):
    """Error response schema for AI endpoints."""
    success: bool = Field(False, description="Always false for errors")
    error: str = Field(..., description="Error message")
    details: Optional[str] = Field(None, description="Additional error details")


# ============================================================================
# Phase 0: AI System Schemas
# ============================================================================

class ScriptState(str, Enum):
    """Script analysis state lifecycle."""
    EMPTY = "empty"
    PARTIAL = "partial"
    ANALYZED = "analyzed"


class IntentType(str, Enum):
    """User intent classification for context assembly."""
    LOCAL_EDIT = "local_edit"
    SCENE_FEEDBACK = "scene_feedback"
    GLOBAL_QUESTION = "global_question"
    BRAINSTORM = "brainstorm"


class BudgetTier(str, Enum):
    """Token budget tiers."""
    QUICK = "quick"          # 1200 tokens
    STANDARD = "standard"    # 5000 tokens
    DEEP = "deep"            # 20000 tokens


# Scene Summary Schemas
class SceneSummarySchema(BaseModel):
    """Scene summary (scene card) schema."""
    id: UUID
    scene_id: UUID
    summary_text: str
    tokens_estimate: int
    version: int
    last_generated_at: datetime
    created_at: datetime

    class Config:
        from_attributes = True


# Script Outline Schemas
class ScriptOutlineSchema(BaseModel):
    """Script outline schema."""
    id: UUID
    script_id: UUID
    version: int
    summary_text: str
    tokens_estimate: int
    is_stale: bool
    dirty_scene_count: int
    last_generated_at: datetime
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# Character Sheet Schemas
class CharacterSheetSchema(BaseModel):
    """Character sheet schema."""
    id: UUID
    script_id: UUID
    character_name: str
    summary_text: str
    tokens_estimate: int
    is_stale: bool
    dirty_scene_count: int
    last_generated_at: datetime
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# Plot Thread Schemas
class PlotThreadSchema(BaseModel):
    """Plot thread schema."""
    id: UUID
    script_id: UUID
    name: str
    scenes: List[int]
    thread_type: Literal["character_arc", "plot", "subplot", "theme"]
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# Scene Relationship Schemas
class SceneRelationshipSchema(BaseModel):
    """Scene relationship schema."""
    id: UUID
    script_id: UUID
    setup_scene_id: UUID
    payoff_scene_id: UUID
    relationship_type: Literal["setup_payoff", "callback", "parallel", "echo"]
    description: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# Conversation Summary Schemas
class ConversationSummarySchema(BaseModel):
    """Conversation summary schema."""
    id: UUID
    conversation_id: UUID
    summary_text: str
    tokens_estimate: int
    messages_covered: int
    last_message_id: Optional[UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True


# Chat Message Request/Response Schemas
class ChatMessageRequest(BaseModel):
    """
    Request schema for AI chat message with optional tool support.

    Unified hybrid approach: supports both RAG context and MCP tools.
    Backwards compatible: existing clients work unchanged (enable_tools defaults to True).
    """
    script_id: UUID = Field(..., description="Script to discuss")
    conversation_id: Optional[UUID] = Field(None, description="Existing conversation (optional)")
    current_scene_id: Optional[UUID] = Field(None, description="Current scene context (optional)")
    message: str = Field(..., description="User's message")
    intent_hint: Optional[IntentType] = Field(None, description="Optional intent classification hint")
    max_tokens: Optional[int] = Field(600, le=4000, description="Maximum output tokens")
    budget_tier: Optional[BudgetTier] = Field(BudgetTier.STANDARD, description="Token budget tier")

    # Phase 6: Hybrid mode support
    enable_tools: bool = Field(True, description="Enable MCP tool calling (default: True)")
    max_iterations: int = Field(5, ge=1, le=10, description="Maximum tool calling iterations")


class TokenUsage(BaseModel):
    """Token usage statistics."""
    input_tokens: int
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    output_tokens: int


class ContextUsed(BaseModel):
    """Context information used in response generation."""
    intent: IntentType
    budget_tier: str
    tokens_breakdown: Dict[str, int]
    cache_hit: bool
    cache_savings_pct: int


class ToolCallMetadata(BaseModel):
    """Metadata about tool usage in the response."""
    tool_calls_made: int = Field(..., description="Number of tool calling iterations")
    tools_used: List[str] = Field(..., description="Names of tools called (e.g., ['get_scene', 'analyze_pacing'])")
    stop_reason: str = Field(..., description="'end_turn' (natural) or 'max_iterations' (limit reached)")


class ChatMessageResponse(BaseModel):
    """
    Response schema for AI chat message with optional tool metadata.

    Unified hybrid response: includes both RAG context and tool usage information.
    Provides full transparency into what happened during request processing.
    """
    message: str = Field(..., description="AI's response")
    conversation_id: UUID = Field(..., description="Conversation ID")
    usage: TokenUsage = Field(..., description="Token usage statistics")
    context_used: ContextUsed = Field(..., description="Context information")

    # Phase 6: Tool usage metadata (optional - only present if tools were used)
    tool_metadata: Optional[ToolCallMetadata] = Field(None, description="Tool usage metadata")


# Analysis Request/Response Schemas
class AnalyzeScriptRequest(BaseModel):
    """Request to trigger script analysis."""
    script_id: UUID
    force_full_analysis: bool = Field(False, description="Force full analysis even if already analyzed")


class AnalyzeScriptResponse(BaseModel):
    """Response from script analysis."""
    script_id: UUID
    state: ScriptState
    scenes_analyzed: int
    outline_generated: bool
    character_sheets_generated: int
    tokens_used: int


class RefreshArtifactRequest(BaseModel):
    """Request to refresh stale artifacts."""
    script_id: UUID
    artifact_type: Literal["outline", "character_sheet", "all"]
    character_name: Optional[str] = Field(None, description="Required if artifact_type is character_sheet")


class RefreshArtifactResponse(BaseModel):
    """Response from artifact refresh."""
    script_id: UUID
    artifacts_refreshed: List[str]
    tokens_used: int


# ============================================================================
# Phase 5: Tool Calling Schemas
# ============================================================================

class ToolCallMessageRequest(BaseModel):
    """Request schema for tool-enabled AI chat."""
    script_id: UUID = Field(..., description="Script to discuss")
    conversation_id: Optional[UUID] = Field(None, description="Existing conversation (optional)")
    current_scene_id: Optional[UUID] = Field(None, description="Current scene context (optional)")
    message: str = Field(..., description="User's message")
    max_tokens: Optional[int] = Field(1000, le=4000, description="Maximum output tokens")
    max_iterations: Optional[int] = Field(5, ge=1, le=10, description="Maximum tool calling iterations")


class ToolCallMessageResponse(BaseModel):
    """Response schema for tool-enabled AI chat."""
    message: str = Field(..., description="AI's final response")
    conversation_id: UUID = Field(..., description="Conversation ID")
    usage: TokenUsage = Field(..., description="Token usage statistics")
    tool_calls: int = Field(..., description="Number of tool calling iterations used")
    stop_reason: str = Field(..., description="Why the conversation ended")
