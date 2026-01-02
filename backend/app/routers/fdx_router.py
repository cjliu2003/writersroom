"""
FDX Router

Handles FDX file upload, parsing, and integration with the database.
"""

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Dict, Any
from uuid import UUID

from app.models.user import User
from app.models.script import Script
from app.models.scene import Scene
from app.models.scene_character import SceneCharacter
from app.schemas.fdx import (
    FDXUploadResponse,
    FDXParseRequest,
    FDXParseResponse,
    SceneDataSchema,
    ScreenplayElementSchema,
    ErrorResponse
)
from app.auth.dependencies import get_current_user
from app.db.base import get_db
from app.services.fdx_parser import FDXParser, ParsedFDXResult
from app.services.fdx_exporter import FDXExporter
from app.services.supabase_storage import storage_service
from app.services.scene_service import SceneService
from app.core.config import settings
from app.utils.character_normalization import normalize_character_name
import logging
import tempfile
import os
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/fdx", tags=["FDX"])


@router.post("/upload", response_model=FDXUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_fdx_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload and parse an FDX file, creating a new script and scenes in the database.
    """
    try:
        # Validate file type
        if not file.filename or not file.filename.lower().endswith(('.fdx', '.xml')):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File must be an FDX or XML file"
            )

        # Read file content
        file_content = await file.read()

        # Decode with encoding fallback for robustness
        file_content_str = None
        for encoding in ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252']:
            try:
                file_content_str = file_content.decode(encoding)
                if encoding != 'utf-8':
                    print(f"Successfully decoded file using {encoding} encoding")
                break
            except (UnicodeDecodeError, AttributeError):
                continue

        if file_content_str is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File encoding not supported. Please ensure file is properly encoded."
            )

        # Verify it's actually XML/FDX content
        file_content_str_stripped = file_content_str.strip()
        if not file_content_str_stripped:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File appears to be empty"
            )

        # Check for XML structure (Final Draft files start with XML declaration)
        is_xml = file_content_str_stripped.startswith('<?xml')
        has_fdx_content = '<FinalDraft' in file_content_str_stripped or '<finalDraft' in file_content_str_stripped

        if not (is_xml or has_fdx_content):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File does not appear to be a valid FDX file. Please check the file format."
            )
        
        # Parse FDX content
        print(f"Parsing FDX file: {file.filename}")
        parsed_result = FDXParser.parse_fdx_content(file_content_str, file.filename)
        # Removed verbose parsed content logging to reduce console noise
        # Convert all parsed elements to content_blocks format for script-level storage
        script_content_blocks = [
            {
                "type": element.type.value,
                "text": element.text,
                "metadata": element.metadata
            }
            for element in parsed_result.elements
        ]

        print(f"Converted {len(parsed_result.elements)} elements to script content_blocks")

        # Create new script in database with content_blocks populated
        new_script = Script(
            title=parsed_result.title,
            description=None,  # Let frontend display user's profile name as author
            owner_id=current_user.user_id,
            content_blocks=script_content_blocks  # Populate Script.content_blocks for script-level editor
        )

        db.add(new_script)
        await db.flush()  # Get the script_id
        
        # Upload file to Supabase storage
        print(f"Uploading file to Supabase storage")
        # Reset file position for upload
        await file.seek(0)
        file_info = await storage_service.upload_fdx_file(
            file, 
            str(current_user.user_id), 
            str(new_script.script_id)
        )
        
        # Update script with file path
        new_script.imported_fdx_path = file_info["file_path"]
        
        # Create scenes in database
        print(f"Creating {len(parsed_result.scenes)} scenes in database")
        db_scenes = []

        for position, scene_data in enumerate(parsed_result.scenes):
            # DIAGNOSTIC: Log first scene data before processing
            if position == 0:
                print(f"[DIAGNOSTIC] Scene 0 BEFORE processing:")
                print(f"  slugline: {scene_data.slugline}")
                print(f"  summary: {scene_data.summary[:100] if scene_data.summary else 'None'}")
                print(f"  content_blocks count: {len(scene_data.content_blocks)}")
                print(f"  full_content length: {len(scene_data.full_content) if scene_data.full_content else 0}")

            # Convert content blocks to JSON format for storage
            content_blocks_json = [
                {
                    "type": block.type.value,
                    "text": block.text,
                    "metadata": block.metadata
                }
                for block in scene_data.content_blocks
            ]

            # DIAGNOSTIC: Log first scene after JSON conversion
            if position == 0:
                print(f"[DIAGNOSTIC] Scene 0 AFTER JSON conversion:")
                print(f"  content_blocks_json count: {len(content_blocks_json)}")
                if content_blocks_json:
                    print(f"  First block: {content_blocks_json[0]}")

            db_scene = Scene(
                script_id=new_script.script_id,
                position=position,
                scene_heading=scene_data.slugline,
                content_blocks=content_blocks_json,
                summary=scene_data.summary,
                characters=scene_data.characters,
                themes=scene_data.themes,
                tokens=scene_data.tokens,
                word_count=scene_data.word_count,
                full_content=scene_data.full_content
            )

            # Optionally compute initial hash (for efficiency)
            # Will be updated when first analyzed anyway
            scene_text = SceneService._construct_scene_text(db_scene)
            db_scene.hash = SceneService.compute_scene_hash(scene_text)

            # DIAGNOSTIC: Log first scene DB object before adding to session
            if position == 0:
                print(f"[DIAGNOSTIC] Scene 0 DB object BEFORE db.add:")
                print(f"  scene_heading: {db_scene.scene_heading}")
                print(f"  content_blocks: {db_scene.content_blocks}")
                print(f"  summary: {db_scene.summary[:100] if db_scene.summary else 'None'}")

            db.add(db_scene)
            db_scenes.append(db_scene)

        # Flush to generate scene IDs before creating SceneCharacter records
        await db.flush()

        # Populate scene_characters junction table from parsed character data
        print(f"Populating scene_characters junction table...")
        character_records_created = 0
        for db_scene in db_scenes:
            if db_scene.characters:  # Scene.characters is a JSONB array
                for character_name in db_scene.characters:
                    # Normalize as safety check (should already be normalized from parser)
                    normalized_name = normalize_character_name(character_name)
                    scene_char = SceneCharacter(
                        scene_id=db_scene.scene_id,
                        character_name=normalized_name
                    )
                    db.add(scene_char)
                    character_records_created += 1

        print(f"Created {character_records_created} scene_character records")

        # Commit all changes
        await db.commit()
        await db.refresh(new_script)

        # DIAGNOSTIC: Verify Script.content_blocks was populated
        print(f"[DIAGNOSTIC] Script AFTER db.commit and refresh:")
        print(f"  script_id: {new_script.script_id}")
        print(f"  title: {new_script.title}")
        print(f"  content_blocks: {'None' if new_script.content_blocks is None else f'{len(new_script.content_blocks)} blocks'}")
        if new_script.content_blocks:
            print(f"  First block: type={new_script.content_blocks[0].get('type')}, text={new_script.content_blocks[0].get('text')[:50]}...")

        # DIAGNOSTIC: Check first scene after commit
        if db_scenes:
            await db.refresh(db_scenes[0])
            print(f"[DIAGNOSTIC] Scene 0 AFTER db.commit and refresh:")
            print(f"  scene_heading: {db_scenes[0].scene_heading}")
            print(f"  content_blocks: {db_scenes[0].content_blocks}")
            print(f"  summary: {db_scenes[0].summary[:100] if db_scenes[0].summary else 'None'}")

        # Enqueue background analysis job
        job_id = None
        analysis_status = None
        try:
            from redis import Redis
            from rq import Queue
            from app.tasks.ai_ingestion_worker import analyze_script_full

            redis_conn = Redis.from_url(settings.REDIS_URL)
            queue = Queue('ai_ingestion', connection=redis_conn)

            job = queue.enqueue(
                analyze_script_full,
                str(new_script.script_id),
                str(current_user.user_id),  # Pass user_id for analytics cost tracking
                job_timeout='30m'
            )

            job_id = job.id
            analysis_status = "queued"
            logger.info(f"Enqueued analysis job {job_id} for script {new_script.script_id}")
            print(f"✅ Analysis job queued: {job_id}")

        except Exception as e:
            logger.warning(f"Failed to enqueue analysis job: {str(e)}")
            print(f"⚠️  Analysis job not queued (worker unavailable): {str(e)}")
            analysis_status = "manual_trigger_required"
            # Upload still succeeded, analysis can be triggered manually

        # Convert scenes to response format
        scene_schemas = []
        for scene_data in parsed_result.scenes:
            content_blocks_schemas = [
                ScreenplayElementSchema(
                    type=block.type.value,
                    text=block.text,
                    metadata=block.metadata
                )
                for block in scene_data.content_blocks
            ]
            
            scene_schema = SceneDataSchema(
                slugline=scene_data.slugline,
                summary=scene_data.summary,
                tokens=scene_data.tokens,
                characters=scene_data.characters,
                themes=scene_data.themes,
                word_count=scene_data.word_count,
                full_content=scene_data.full_content,
                content_blocks=content_blocks_schemas
            )
            scene_schemas.append(scene_schema)
        
        print(f"\n{'='*80}")
        print(f"✅ FDX UPLOAD COMPLETE: {file.filename}")
        print(f"   Script ID: {new_script.script_id}")
        print(f"   Scenes created: {len(parsed_result.scenes)}")
        print(f"   First scene: {parsed_result.scenes[0].slugline if parsed_result.scenes else 'N/A'}")
        print(f"{'='*80}\n")

        return FDXUploadResponse(
            success=True,
            script_id=new_script.script_id,
            title=parsed_result.title,
            scene_count=len(parsed_result.scenes),
            scenes=scene_schemas,
            file_info=file_info,
            job_id=job_id,
            analysis_status=analysis_status
        )
        
    except ValueError as e:
        print(f"FDX parsing error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid FDX file: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Unexpected error during FDX upload: {str(e)}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process FDX file: {str(e)}"
        )


@router.post("/parse", response_model=FDXParseResponse)
async def parse_fdx_content(
    request: FDXParseRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Parse FDX content without creating a script (for preview/validation).
    """
    try:
        print("Parsing FDX content for preview")
        parsed_result = FDXParser.parse_fdx_content(request.content, request.filename)
        
        # Convert to response schemas
        element_schemas = [
            ScreenplayElementSchema(
                type=element.type.value,
                text=element.text,
                metadata=element.metadata
            )
            for element in parsed_result.elements
        ]
        
        scene_schemas = []
        for scene_data in parsed_result.scenes:
            content_blocks_schemas = [
                ScreenplayElementSchema(
                    type=block.type.value,
                    text=block.text,
                    metadata=block.metadata
                )
                for block in scene_data.content_blocks
            ]
            
            scene_schema = SceneDataSchema(
                slugline=scene_data.slugline,
                summary=scene_data.summary,
                tokens=scene_data.tokens,
                characters=scene_data.characters,
                themes=scene_data.themes,
                word_count=scene_data.word_count,
                full_content=scene_data.full_content,
                content_blocks=content_blocks_schemas
            )
            scene_schemas.append(scene_schema)
        
        return FDXParseResponse(
            success=True,
            title=parsed_result.title,
            elements=element_schemas,
            scenes=scene_schemas,
            scene_count=len(parsed_result.scenes)
        )
        
    except ValueError as e:
        print(f"FDX parsing error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid FDX content: {str(e)}"
        )
    except Exception as e:
        print(f"Unexpected error during FDX parsing: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to parse FDX content: {str(e)}"
        )


@router.get("/export/{script_id}")
async def export_fdx(
    script_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Export a script as a Final Draft (.fdx) file.

    Generates a valid Final Draft XML file from the script's scenes and returns it
    as a downloadable file. The exported file can be opened in Final Draft or
    re-imported into WritersRoom.

    Args:
        script_id: UUID of the script to export
        current_user: Authenticated user (must be script owner)
        db: Database session

    Returns:
        FileResponse with the generated .fdx file

    Raises:
        404: Script not found
        403: User does not own the script
        500: Export generation failed
    """
    try:
        # Fetch the script
        result = await db.execute(
            select(Script).where(Script.script_id == script_id)
        )
        script = result.scalar_one_or_none()

        if not script:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Script with ID {script_id} not found"
            )

        # Verify ownership
        if script.owner_id != current_user.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to export this script"
            )

        # Fetch all scenes for the script, ordered by position
        scenes_result = await db.execute(
            select(Scene)
            .where(Scene.script_id == script_id)
            .order_by(Scene.position)
        )
        scenes = scenes_result.scalars().all()

        if not scenes or len(scenes) == 0:
            logger.warning(f"Script {script_id} has no scenes, generating empty FDX")

        logger.info(f"Exporting script '{script.title}' with {len(scenes)} scenes")

        # Generate FDX XML content
        fdx_content = FDXExporter.generate_fdx(script, list(scenes))

        # Create a temporary file for the FDX content
        # Using delete=False so we can return it before deletion
        temp_file = tempfile.NamedTemporaryFile(
            mode='w',
            suffix='.fdx',
            delete=False,
            encoding='utf-8'
        )

        try:
            # Write the FDX content
            temp_file.write(fdx_content)
            temp_file.flush()
            temp_file.close()

            # Sanitize filename (remove special characters)
            safe_title = "".join(
                c for c in script.title
                if c.isalnum() or c in (' ', '-', '_')
            ).strip()
            safe_title = safe_title or "script"
            filename = f"{safe_title}.fdx"

            # Optional: Upload to Supabase and save the path
            # This would require modifying storage_service to support FDX upload
            # For now, we'll skip this and just return the file

            # Return the file as a download
            return FileResponse(
                path=temp_file.name,
                filename=filename,
                media_type="application/xml",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"'
                },
                background=None  # File will be cleaned up by OS temp cleaner
            )

        except Exception as write_error:
            # Clean up temp file on error
            if os.path.exists(temp_file.name):
                os.unlink(temp_file.name)
            raise write_error

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(f"Unexpected error during FDX export: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export FDX file: {str(e)}"
        )


