"""
Supabase Storage Service

Handles file uploads and management with Supabase storage buckets.
"""

import os
import uuid
from typing import Optional, Dict, Any
from supabase import create_client, Client
from fastapi import UploadFile, HTTPException
import logging

logger = logging.getLogger(__name__)


class SupabaseStorageService:
    """Service for managing file uploads to Supabase storage."""
    
    def __init__(self):
        self.supabase_url = os.getenv("SUPABASE_URL")
        # Use service role key for server-side operations to bypass RLS
        self.supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        
        if not self.supabase_url or not self.supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) must be set in environment variables")
        
        self.client: Client = create_client(self.supabase_url, self.supabase_key)
        self.bucket_name = os.getenv("SUPABASE_BUCKET_NAME", "fdx-files")
    
    async def upload_fdx_file(
        self, 
        file: UploadFile, 
        user_id: str,
        script_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Upload an FDX file to Supabase storage.
        
        Args:
            file: The uploaded file
            user_id: ID of the user uploading the file
            script_id: Optional script ID for organization
            
        Returns:
            Dict containing file path, public URL, and metadata
        """
        try:
            # Generate unique filename
            file_extension = file.filename.split('.')[-1] if file.filename else 'fdx'
            unique_filename = f"{uuid.uuid4()}.{file_extension}"
            
            # Create file path with user organization
            if script_id:
                file_path = f"users/{user_id}/scripts/{script_id}/{unique_filename}"
            else:
                file_path = f"users/{user_id}/uploads/{unique_filename}"
            
            # Read file content
            file_content = await file.read()
            
            # Upload to Supabase storage
            response = self.client.storage.from_(self.bucket_name).upload(
                path=file_path,
                file=file_content,
                file_options={
                    "content-type": file.content_type or "application/xml",
                    "cache-control": "3600"
                }
            )
            
            # Check if upload was successful
            # Supabase upload response structure varies, check for error
            if hasattr(response, 'error') and response.error:
                logger.error(f"Failed to upload file: {response.error}")
                raise HTTPException(
                    status_code=500, 
                    detail=f"Failed to upload file: {response.error}"
                )
            elif isinstance(response, dict) and 'error' in response:
                logger.error(f"Failed to upload file: {response['error']}")
                raise HTTPException(
                    status_code=500, 
                    detail=f"Failed to upload file: {response['error']}"
                )
            
            # Get public URL
            public_url_response = self.client.storage.from_(self.bucket_name).get_public_url(file_path)
            public_url = public_url_response if isinstance(public_url_response, str) else public_url_response.get('publicURL')
            
            return {
                "file_path": file_path,
                "public_url": public_url,
                "original_filename": file.filename,
                "file_size": len(file_content),
                "content_type": file.content_type,
                "bucket": self.bucket_name
            }
            
        except Exception as e:
            logger.error(f"Error uploading file: {str(e)}")
            raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")
    
    async def download_file(self, file_path: str) -> bytes:
        """
        Download a file from Supabase storage.
        
        Args:
            file_path: Path to the file in storage
            
        Returns:
            File content as bytes
        """
        try:
            response = self.client.storage.from_(self.bucket_name).download(file_path)
            
            if not response:
                raise HTTPException(status_code=404, detail="File not found")
            
            return response
            
        except Exception as e:
            logger.error(f"Error downloading file: {str(e)}")
            raise HTTPException(status_code=500, detail=f"File download failed: {str(e)}")
    
    async def delete_file(self, file_path: str) -> bool:
        """
        Delete a file from Supabase storage.
        
        Args:
            file_path: Path to the file in storage
            
        Returns:
            True if successful, False otherwise
        """
        try:
            response = self.client.storage.from_(self.bucket_name).remove([file_path])
            
            return response.status_code == 200
            
        except Exception as e:
            logger.error(f"Error deleting file: {str(e)}")
            return False
    
    def get_public_url(self, file_path: str) -> str:
        """
        Get the public URL for a file.
        
        Args:
            file_path: Path to the file in storage
            
        Returns:
            Public URL string
        """
        try:
            response = self.client.storage.from_(self.bucket_name).get_public_url(file_path)
            return response if isinstance(response, str) else response.get('publicURL', '')
        except Exception as e:
            logger.error(f"Error getting public URL: {str(e)}")
            return ""


# Global instance
storage_service = SupabaseStorageService()
