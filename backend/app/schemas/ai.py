"""
Pydantic schemas for AI endpoints
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from uuid import UUID


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
