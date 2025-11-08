"""
Request and response schemas for script endpoints
"""
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field
from datetime import datetime


class ScriptCreate(BaseModel):
    """Schema for creating a new script"""
    title: str = Field(..., min_length=1, max_length=255, description="Title of the script")
    description: Optional[str] = Field(None, description="Optional description of the script")


class ScriptUpdate(BaseModel):
    """Schema for updating an existing script"""
    title: Optional[str] = Field(None, min_length=1, max_length=255, description="Title of the script")
    description: Optional[str] = Field(None, description="Description of the script")
    imported_fdx_path: Optional[str] = Field(None, description="Path to imported FDX file in storage")
    exported_fdx_path: Optional[str] = Field(None, description="Path to exported FDX file in storage")
    exported_pdf_path: Optional[str] = Field(None, description="Path to exported PDF file in storage")


class ScriptResponse(BaseModel):
    """Schema for script response"""
    script_id: UUID
    owner_id: UUID
    title: str
    description: Optional[str] = None
    current_version: int
    created_at: datetime
    updated_at: datetime
    imported_fdx_path: Optional[str] = None
    exported_fdx_path: Optional[str] = None
    exported_pdf_path: Optional[str] = None

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda dt: dt.isoformat()
        }


class ScriptWithContent(BaseModel):
    """
    Enhanced schema for script response with full content blocks.
    Used for script-level editing where entire script content is loaded.
    """
    script_id: UUID
    owner_id: UUID
    title: str
    description: Optional[str] = None
    current_version: int
    created_at: datetime
    updated_at: datetime
    imported_fdx_path: Optional[str] = None
    exported_fdx_path: Optional[str] = None
    exported_pdf_path: Optional[str] = None

    # Script-level content for collaborative editing
    content_blocks: Optional[List[Dict[str, Any]]] = Field(
        None,
        description="Full script content blocks (Slate format)"
    )
    version: int = Field(
        0,
        description="Optimistic locking version for compare-and-swap autosave"
    )
    updated_by: Optional[UUID] = Field(
        None,
        description="User who last updated the script content"
    )

    # AI-generated scene summaries for script-level editor
    scene_summaries: Optional[Dict[str, str]] = Field(
        None,
        description="AI-generated summaries keyed by scene heading (slugline)"
    )

    # Metadata for migration fallback
    content_source: str = Field(
        "script",
        description="Source of content: 'script' (native) or 'scenes' (rebuilt from scenes)"
    )

    # Yjs persistence metadata
    has_yjs_updates: bool = Field(
        False,
        description="Whether Yjs updates exist in script_versions table (indicates Yjs is source of truth)"
    )

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda dt: dt.isoformat()
        }
