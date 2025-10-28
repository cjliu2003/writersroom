from datetime import datetime
from typing import Dict, Any, Optional, List
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.script import Script
from app.models.script_collaborator import ScriptCollaborator, CollaboratorRole
from app.models.script_version import ScriptVersion
from app.models.scene import Scene


class ScriptAutosaveService:
    """Service for script-level autosave operations with compare-and-swap semantics."""

    class VersionConflictError(Exception):
        """Raised when a compare-and-swap operation fails due to version mismatch."""
        def __init__(self, latest_version: Dict[str, Any], message: str = "Version conflict"):
            self.latest_version = latest_version
            self.message = message
            super().__init__(self.message)

    def __init__(self, db: AsyncSession):
        self.db = db

    async def validate_script_access(self, script_id: UUID, user_id: UUID) -> bool:
        """
        Validate that the user has edit access to the script.
        Raises HTTPException if access is not allowed.
        """
        # Find the script
        stmt = select(Script).where(Script.script_id == script_id)
        result = await self.db.execute(stmt)
        script = result.scalar_one_or_none()

        if not script:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Script {script_id} not found"
            )

        # Check if user is script owner
        if script.owner_id == user_id:
            return True

        # Check if user is a collaborator with edit rights
        stmt = select(ScriptCollaborator).where(
            and_(
                ScriptCollaborator.script_id == script_id,
                ScriptCollaborator.user_id == user_id,
                ScriptCollaborator.role.in_([CollaboratorRole.EDITOR, CollaboratorRole.OWNER])
            )
        )
        result = await self.db.execute(stmt)
        collaborator = result.scalar_one_or_none()

        if not collaborator:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have edit permission for this script"
            )

        return True

    async def update_script_with_cas(
        self,
        script_id: UUID,
        user_id: UUID,
        base_version: int,
        content_blocks: List[Dict[str, Any]],
        scene_deltas: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Update a script with compare-and-swap semantics.

        Args:
            script_id: The ID of the script to update
            user_id: The ID of the user making the update
            base_version: The expected current version
            content_blocks: The new content blocks for the script
            scene_deltas: Optional list of scene-level updates to apply

        Returns:
            Dict with update result including new version and updated_at

        Raises:
            VersionConflictError: If the current version doesn't match base_version
        """
        # Start a nested transaction
        async with self.db.begin_nested():
            # SELECT FOR UPDATE to lock the row
            stmt = (
                select(Script)
                .where(Script.script_id == script_id)
                .with_for_update()
            )
            result = await self.db.execute(stmt)
            script = result.scalar_one_or_none()

            if not script:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Script {script_id} not found"
                )

            # Check version matches
            if script.version != base_version:
                # Version mismatch - return current state to client
                raise self.VersionConflictError(
                    latest_version={
                        "version": script.version,
                        "content_blocks": script.content_blocks,
                        "updated_at": script.updated_at.isoformat() if script.updated_at else None,
                        "updated_by": str(script.updated_by) if script.updated_by else None
                    },
                    message=f"Version conflict: expected {base_version}, found {script.version}"
                )

            # Version matches, proceed with update
            new_version = script.version + 1
            current_time = datetime.utcnow()

            # Update script fields
            script.content_blocks = content_blocks
            script.version = new_version
            script.updated_at = current_time
            script.updated_by = user_id

            # Create version history entry
            version_entry = ScriptVersion(
                script_id=script_id,
                version=new_version,
                content_blocks=content_blocks,
                created_by=user_id,
                created_at=current_time
            )
            self.db.add(version_entry)

            # Process scene deltas if provided
            if scene_deltas:
                await self._apply_scene_deltas(script_id, scene_deltas)

            # Flush to ensure all changes are persisted
            await self.db.flush()

            return {
                "version": new_version,
                "updated_at": current_time.isoformat(),
                "updated_by": str(user_id)
            }

    async def _apply_scene_deltas(
        self,
        script_id: UUID,
        scene_deltas: List[Dict[str, Any]]
    ) -> None:
        """
        Apply scene-level updates from script-level autosave.

        Args:
            script_id: The ID of the parent script
            scene_deltas: List of scene updates with scene_id and changes
        """
        for delta in scene_deltas:
            scene_id = delta.get("scene_id")
            if not scene_id:
                continue

            # Fetch scene with lock
            stmt = (
                select(Scene)
                .where(
                    and_(
                        Scene.scene_id == UUID(scene_id),
                        Scene.script_id == script_id
                    )
                )
                .with_for_update()
            )
            result = await self.db.execute(stmt)
            scene = result.scalar_one_or_none()

            if not scene:
                continue

            # Apply updates to scene
            if "scene_heading" in delta:
                scene.scene_heading = delta["scene_heading"]
            if "position" in delta:
                scene.position = delta["position"]
            if "content_blocks" in delta:
                scene.content_blocks = delta["content_blocks"]

    async def get_script_with_version(
        self,
        script_id: UUID
    ) -> Dict[str, Any]:
        """
        Get script with current version information.

        Args:
            script_id: The ID of the script

        Returns:
            Dict with script data and version info
        """
        stmt = select(Script).where(Script.script_id == script_id)
        result = await self.db.execute(stmt)
        script = result.scalar_one_or_none()

        if not script:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Script {script_id} not found"
            )

        return {
            "script_id": str(script.script_id),
            "title": script.title,
            "content_blocks": script.content_blocks,
            "version": script.version,
            "updated_at": script.updated_at.isoformat() if script.updated_at else None,
            "updated_by": str(script.updated_by) if script.updated_by else None,
            "created_at": script.created_at.isoformat() if script.created_at else None
        }
