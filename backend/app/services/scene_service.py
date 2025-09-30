from datetime import datetime
from typing import Dict, Any, Optional, List, Union, cast
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, update, and_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.scene import Scene
from app.models.scene_snapshot import SceneSnapshot
from app.models.scene_write_op import SceneWriteOp
from app.models.script import Script
from app.models.script_collaborator import ScriptCollaborator, CollaboratorRole


class SceneService:
    """Service for scene operations including save, version history, and access control."""

    class VersionConflictError(Exception):
        """Raised when a compare-and-swap operation fails due to version mismatch."""
        def __init__(self, latest_version: Dict[str, Any], message: str = "Version conflict"):
            self.latest_version = latest_version
            self.message = message
            super().__init__(self.message)

    def __init__(self, db: AsyncSession):
        self.db = db

    async def validate_scene_access(self, scene_id: UUID, user_id: UUID) -> bool:
        """
        Validate that the user has edit access to the scene.
        Raises HTTPException if access is not allowed.
        """
        print(f"DEBUG: Validating access for scene {scene_id} and user {user_id}")
        
        # Find the scene and its parent script
        scene_with_script = await self._get_scene_with_script(scene_id)
        
        if not scene_with_script:
            print(f"DEBUG: Scene {scene_id} not found in validate_scene_access")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Scene {scene_id} not found"
            )
            
        print(f"DEBUG: Found scene with ID {scene_with_script.scene_id}")
        
        # Verify script relationship is loaded
        if not hasattr(scene_with_script, 'script') or scene_with_script.script is None:
            print(f"DEBUG: Script relationship not loaded for scene {scene_id}")
            
            # Attempt direct query for the script
            from app.models.script import Script
            stmt = select(Script).where(Script.script_id == scene_with_script.script_id)
            result = await self.db.execute(stmt)
            script = result.scalar_one_or_none()
            
            if not script:
                print(f"DEBUG: Script {scene_with_script.script_id} not found")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Script for scene {scene_id} not found"
                )
        else:
            script = scene_with_script.script
            print(f"DEBUG: Found script {script.script_id} owned by {script.owner_id}")
        
        # Check if user is script owner
        if script.owner_id == user_id:
            print(f"DEBUG: User {user_id} is script owner - access granted")
            return True
            
        # Check if user is a collaborator with edit rights
        stmt = select(ScriptCollaborator).where(
            and_(
                ScriptCollaborator.script_id == script.script_id,
                ScriptCollaborator.user_id == user_id,
                ScriptCollaborator.role.in_([CollaboratorRole.EDITOR, CollaboratorRole.OWNER])
            )
        )
        result = await self.db.execute(stmt)
        collaborator = result.scalar_one_or_none()
        
        if not collaborator:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have edit permission for this scene"
            )
            
        return True

    async def update_scene_with_cas(
        self, 
        scene_id: UUID, 
        user_id: UUID, 
        base_version: int,
        data: Dict[str, Any],
        op_id: UUID
    ) -> Dict[str, Any]:
        """
        Update a scene with compare-and-swap semantics.
        
        Args:
            scene_id: The ID of the scene to update
            user_id: The ID of the user making the update
            base_version: The expected current version
            data: The new data for the scene
            op_id: Operation ID for idempotency
            
        Returns:
            Dict with update result
            
        Raises:
            VersionConflictError: If the current version doesn't match base_version
        """
        print(f"DEBUG: Beginning update for scene {scene_id}, base_version={base_version}")
        
        # First, check if scene exists before even starting transaction
        check_stmt = select(Scene).where(Scene.scene_id == scene_id)
        check_result = await self.db.execute(check_stmt)
        check_scene = check_result.scalar_one_or_none()
        
        if not check_scene:
            print(f"DEBUG: Scene {scene_id} not found before transaction")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Scene {scene_id} not found"
            )
        else:
            print(f"DEBUG: Found scene {scene_id} with script_id {check_scene.script_id}")
        
        # Start a nested transaction
        async with self.db.begin_nested():
            # SELECT FOR UPDATE to lock the row
            stmt = (
                select(Scene)
                .where(Scene.scene_id == scene_id)
                .with_for_update()
            )
            result = await self.db.execute(stmt)
            scene = result.scalar_one_or_none()
            
            if not scene:
                print(f"DEBUG: Scene {scene_id} not found within transaction")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Scene {scene_id} not found"
                )
                
            # Check version matches
            if scene.version != base_version:
                # Version mismatch - return current state to client
                raise self.VersionConflictError(
                    latest_version={
                        "version": scene.version,
                        "blocks": scene.content_blocks,
                        "scene_heading": scene.scene_heading,
                        "position": scene.position,
                        "updated_at": scene.updated_at.isoformat() if scene.updated_at else None
                    }
                )
            
            # Version matches, save a snapshot
            new_version = scene.version + 1
            payload = {
                "content_blocks": data.get("content_blocks", data.get("blocks", [])),
                "scene_heading": data.get("scene_heading", ""),
                "position": data.get("position", 0),
                "version": new_version,
                "scene_id": str(scene_id),
                "saved_at": datetime.utcnow().isoformat(),
                "saved_by": str(user_id)
            }
            
            snapshot = SceneSnapshot(
                scene_id=scene_id,
                version=new_version,
                payload=payload,
                saved_by=user_id
            )
            self.db.add(snapshot)
            
            # Update the scene
            scene.content_blocks = data.get("content_blocks", data.get("blocks", []))
            scene.scene_heading = data.get("scene_heading", scene.scene_heading)
            scene.position = data.get("position", scene.position)
            scene.version = new_version
            scene.updated_by = user_id
            
            # Also update full_content with rich format if provided
            if "full_content" in data:
                scene.full_content = data["full_content"]
            
            # Prepare result to store for idempotency
            result = {
                "scene_id": str(scene_id),
                "new_version": new_version,
                "updated_at": datetime.utcnow().isoformat()
            }
            
            # Store operation result for idempotency
            write_op = SceneWriteOp(
                op_id=op_id,
                scene_id=scene_id,
                user_id=user_id,
                result=result
            )
            self.db.add(write_op)
            
            # Flush to ensure IDs are available
            await self.db.flush()
            
            return result

    async def get_scene_snapshots(
        self, 
        scene_id: UUID, 
        limit: int = 10
    ) -> List[SceneSnapshot]:
        """Get snapshots for a scene, most recent first."""
        return await SceneSnapshot.get_snapshot_history(self.db, scene_id, limit)

    async def get_snapshot_by_version(
        self, 
        scene_id: UUID, 
        version: int
    ) -> Optional[SceneSnapshot]:
        """Get a specific snapshot by version."""
        return await SceneSnapshot.get_snapshot_by_version(self.db, scene_id, version)

    async def restore_snapshot(
        self, 
        scene_id: UUID, 
        version: int, 
        user_id: UUID
    ) -> Dict[str, Any]:
        """Restore a scene to a previous version."""
        # Get the snapshot
        snapshot = await SceneSnapshot.get_snapshot_by_version(self.db, scene_id, version)
        if not snapshot:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Snapshot for scene {scene_id} version {version} not found"
            )
            
        # Start transaction
        async with self.db.begin_nested():
            # Lock the scene row
            stmt = (
                select(Scene)
                .where(Scene.scene_id == scene_id)
                .with_for_update()
            )
            result = await self.db.execute(stmt)
            scene = result.scalar_one_or_none()
            
            if not scene:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Scene {scene_id} not found"
                )
                
            # Create a new snapshot of the current state before restoring
            current_payload = {
                "content_blocks": scene.content_blocks,
                "scene_heading": scene.scene_heading,
                "position": scene.position,
                "version": scene.version,
                "scene_id": str(scene_id),
                "saved_at": datetime.utcnow().isoformat(),
                "saved_by": str(user_id),
                "is_pre_restore": True  # Mark that this was auto-saved before a restore
            }
            
            pre_restore_snapshot = SceneSnapshot(
                scene_id=scene_id,
                version=scene.version,
                payload=current_payload,
                saved_by=user_id
            )
            self.db.add(pre_restore_snapshot)
            
            # Restore from snapshot with a new version
            new_version = scene.version + 1
            
            # Update scene with snapshot data
            scene.content_blocks = snapshot.payload.get("content_blocks", [])
            scene.scene_heading = snapshot.payload.get("scene_heading", "")
            scene.position = snapshot.payload.get("position", 0)
            scene.version = new_version
            scene.updated_by = user_id
            
            # Create restoration snapshot
            restore_payload = {
                "content_blocks": scene.content_blocks,
                "scene_heading": scene.scene_heading,
                "position": scene.position,
                "version": new_version,
                "scene_id": str(scene_id),
                "saved_at": datetime.utcnow().isoformat(),
                "saved_by": str(user_id),
                "restored_from_version": version
            }
            
            restore_snapshot = SceneSnapshot(
                scene_id=scene_id,
                version=new_version,
                payload=restore_payload,
                saved_by=user_id
            )
            self.db.add(restore_snapshot)
            
            # Flush changes
            await self.db.flush()
            
            return {
                "scene_id": str(scene_id),
                "new_version": new_version,
                "restored_from_version": version,
                "updated_at": datetime.utcnow().isoformat()
            }

    async def _get_scene_with_script(self, scene_id: UUID) -> Optional[Scene]:
        """Get a scene with its parent script loaded."""
        try:
            # Debug the query execution
            print(f"DEBUG: Finding scene {scene_id} with script")
            
            # Use an explicit join to ensure script is loaded
            from app.models.script import Script
            stmt = (
                select(Scene)
                .join(Script, Scene.script_id == Script.script_id)
                .options(selectinload(Scene.script))
                .where(Scene.scene_id == scene_id)
            )
            result = await self.db.execute(stmt)
            scene = result.scalar_one_or_none()
            
            if scene:
                print(f"DEBUG: Found scene {scene_id} with script_id {scene.script_id}")
            else:
                print(f"DEBUG: Scene {scene_id} NOT FOUND")
                
            return scene
        except Exception as e:
            print(f"DEBUG: Error in _get_scene_with_script: {str(e)}")
            raise
