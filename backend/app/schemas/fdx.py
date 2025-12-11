"""
Pydantic schemas for FDX file handling
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from uuid import UUID


class ScreenplayElementSchema(BaseModel):
    """Schema for a screenplay element."""
    type: str = Field(..., description="Type of screenplay element")
    text: str = Field(..., description="Text content of the element")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")


class SceneDataSchema(BaseModel):
    """Schema for scene data extracted from FDX."""
    slugline: str = Field(..., description="Scene heading/slugline")
    summary: str = Field(..., description="Generated summary of the scene")
    tokens: int = Field(..., description="Estimated token count")
    characters: List[str] = Field(default_factory=list, description="Characters in the scene")
    themes: List[str] = Field(default_factory=list, description="Extracted themes")
    word_count: int = Field(..., description="Word count of the scene")
    full_content: str = Field(..., description="Full text content of the scene")
    content_blocks: List[ScreenplayElementSchema] = Field(default_factory=list, description="Structured content blocks")


class FDXUploadResponse(BaseModel):
    """Response schema for FDX file upload."""
    success: bool = Field(..., description="Whether the upload was successful")
    script_id: UUID = Field(..., description="ID of the created script")
    title: str = Field(..., description="Title of the script")
    scene_count: int = Field(..., description="Number of scenes parsed")
    scenes: List[SceneDataSchema] = Field(..., description="Parsed scene data")
    file_info: Dict[str, Any] = Field(..., description="File storage information")
    message: str = Field(default="FDX file uploaded and parsed successfully", description="Success message")
    job_id: Optional[str] = Field(None, description="Background analysis job ID for tracking")
    analysis_status: Optional[str] = Field(None, description="Analysis job status: 'queued' or 'manual_trigger_required'")


class FDXParseRequest(BaseModel):
    """Request schema for parsing FDX content."""
    content: str = Field(..., description="FDX file content as string")
    filename: Optional[str] = Field(None, description="Original filename")
    script_id: Optional[UUID] = Field(None, description="Existing script ID to update")


class FDXParseResponse(BaseModel):
    """Response schema for FDX parsing."""
    success: bool = Field(..., description="Whether parsing was successful")
    title: str = Field(..., description="Extracted title")
    elements: List[ScreenplayElementSchema] = Field(..., description="Parsed screenplay elements")
    scenes: List[SceneDataSchema] = Field(..., description="Extracted scene data")
    scene_count: int = Field(..., description="Number of scenes")
    message: str = Field(default="FDX content parsed successfully", description="Success message")


class SceneMemoryResponse(BaseModel):
    """Response schema compatible with the Express.js memory API."""
    success: bool = Field(..., description="Whether the request was successful")
    data: List[Dict[str, Any]] = Field(..., description="Scene memory data")
    message: Optional[str] = Field(None, description="Optional message")


class SingleSceneResponse(BaseModel):
    """Response schema for single scene operations."""
    success: bool = Field(..., description="Whether the request was successful")
    data: Optional[Dict[str, Any]] = Field(None, description="Scene data")
    message: Optional[str] = Field(None, description="Optional message")


class ErrorResponse(BaseModel):
    """Error response schema."""
    success: bool = Field(False, description="Always false for errors")
    message: str = Field(..., description="Error message")
    error: Optional[str] = Field(None, description="Detailed error information")
