"""
WebSocket Connection Manager for Real-time Collaboration

Manages WebSocket connections, room-based broadcasting, and participant tracking.
"""

from typing import Dict, Set, Optional, List
from uuid import UUID
import logging
from fastapi import WebSocket
from datetime import datetime
import json

logger = logging.getLogger(__name__)


class ConnectionInfo:
    """Information about an active WebSocket connection."""
    
    def __init__(self, websocket: WebSocket, user_id: UUID, user_name: str):
        self.websocket = websocket
        self.user_id = user_id
        self.user_name = user_name
        self.connected_at = datetime.utcnow()
        self.last_activity = datetime.utcnow()
        # Track awareness client clocks observed from this connection
        # key: yjs clientId (int), value: last observed clock (int)
        self.awareness_meta: dict[int, int] = {}
    
    def update_activity(self):
        """Update the last activity timestamp."""
        self.last_activity = datetime.utcnow()
    
    def to_dict(self) -> dict:
        """Convert connection info to dictionary."""
        return {
            "user_id": str(self.user_id),
            "user_name": self.user_name,
            "connected_at": self.connected_at.isoformat(),
            "last_activity": self.last_activity.isoformat()
        }


class WebSocketManager:
    """
    Manages WebSocket connections for real-time collaboration.
    
    Responsibilities:
    - Track active connections per scene (rooms)
    - Broadcast messages to room participants
    - Handle connection/disconnection lifecycle
    - Provide room participant information
    """
    
    def __init__(self):
        # Map of scene_id -> set of ConnectionInfo
        self.active_connections: Dict[UUID, Set[ConnectionInfo]] = {}
        # Map of websocket -> ConnectionInfo for quick lookup
        self.connection_lookup: Dict[WebSocket, ConnectionInfo] = {}
        logger.info("WebSocketManager initialized")
    
    async def connect(
        self,
        websocket: WebSocket,
        scene_id: UUID,
        user_id: UUID,
        user_name: str,
        notify_participants: bool = False
    ) -> ConnectionInfo:
        """
        Register a new WebSocket connection to a scene room.

        Args:
            websocket: The WebSocket connection
            scene_id: UUID of the scene being edited
            user_id: UUID of the user
            user_name: Display name of the user
            notify_participants: If True, broadcast user_joined/left JSON messages.
                               Set to False for y-websocket connections (binary only).

        Returns:
            ConnectionInfo object for the connection
        """
        await websocket.accept()
        
        connection_info = ConnectionInfo(websocket, user_id, user_name)
        
        # Add to room
        if scene_id not in self.active_connections:
            self.active_connections[scene_id] = set()
        self.active_connections[scene_id].add(connection_info)
        
        # Add to lookup
        self.connection_lookup[websocket] = connection_info
        
        logger.info(
            f"User {user_name} ({user_id}) connected to scene {scene_id}. "
            f"Room now has {len(self.active_connections[scene_id])} participant(s)"
        )
        
        # Notify other participants (disabled for y-websocket binary protocol)
        if notify_participants:
            await self._broadcast_user_joined(scene_id, connection_info)
        
        return connection_info
    
    async def disconnect(self, websocket: WebSocket, scene_id: UUID, notify_participants: bool = False):
        """
        Remove a WebSocket connection from a scene room.
        
        Args:
            websocket: The WebSocket connection to remove
            scene_id: UUID of the scene
            notify_participants: If True, broadcast user_left JSON messages.
                               Set to False for y-websocket connections (binary only).
        """
        connection_info = self.connection_lookup.get(websocket)
        
        if connection_info and scene_id in self.active_connections:
            self.active_connections[scene_id].discard(connection_info)
            
            # Clean up empty rooms
            if not self.active_connections[scene_id]:
                del self.active_connections[scene_id]
            
            # Remove from lookup
            if websocket in self.connection_lookup:
                del self.connection_lookup[websocket]
            
            logger.info(
                f"User {connection_info.user_name} ({connection_info.user_id}) "
                f"disconnected from scene {scene_id}"
            )
            
            # Notify other participants (disabled for y-websocket binary protocol)
            if notify_participants:
                await self._broadcast_user_left(scene_id, connection_info)
    
    async def broadcast_to_room(
        self,
        scene_id: UUID,
        message: bytes,
        exclude: Optional[UUID] = None,
        *,
        exclude_websocket: Optional[WebSocket] = None,
    ):
        """
        Broadcast a message to all connections in a room.
        
        Args:
            scene_id: UUID of the scene room
            message: Binary message to broadcast
            exclude: Optional user_id to exclude from broadcast (e.g., sender)
        """
        if scene_id not in self.active_connections:
            return
        
        disconnected = []
        
        for connection_info in self.active_connections[scene_id]:
            # Skip excluded websocket (precisely the sender connection)
            if exclude_websocket and connection_info.websocket is exclude_websocket:
                continue
            # Backwards-compat: optionally skip all connections of a user
            if exclude and connection_info.user_id == exclude:
                continue
            
            try:
                await connection_info.websocket.send_bytes(message)
                connection_info.update_activity()
            except Exception as e:
                logger.error(
                    f"Error broadcasting to user {connection_info.user_id}: {e}"
                )
                disconnected.append((connection_info.websocket, scene_id))
        
        # Clean up disconnected connections
        for websocket, scene in disconnected:
            await self.disconnect(websocket, scene, notify_participants=False)
    
    async def send_json_to_room(
        self,
        scene_id: UUID,
        message: dict,
        exclude: Optional[UUID] = None
    ):
        """
        Broadcast a JSON message to all connections in a room.
        
        Args:
            scene_id: UUID of the scene room
            message: Dictionary to send as JSON
            exclude: Optional user_id to exclude from broadcast
        """
        if scene_id not in self.active_connections:
            return
        
        disconnected = []
        
        for connection_info in self.active_connections[scene_id]:
            if exclude and connection_info.user_id == exclude:
                continue
            
            try:
                await connection_info.websocket.send_json(message)
                connection_info.update_activity()
            except Exception as e:
                logger.error(
                    f"Error sending JSON to user {connection_info.user_id}: {e}"
                )
                disconnected.append((connection_info.websocket, scene_id))
        
        # Clean up disconnected connections
        for websocket, scene in disconnected:
            await self.disconnect(websocket, scene, notify_participants=False)
    
    def get_room_participants(self, scene_id: UUID) -> List[dict]:
        """
        Get information about all participants in a scene room.
        
        Args:
            scene_id: UUID of the scene
            
        Returns:
            List of participant information dictionaries
        """
        if scene_id not in self.active_connections:
            return []
        
        return [
            connection_info.to_dict() 
            for connection_info in self.active_connections[scene_id]
        ]
    
    def get_room_count(self, scene_id: UUID) -> int:
        """
        Get the number of active connections in a scene room.
        
        Args:
            scene_id: UUID of the scene
            
        Returns:
            Number of active connections
        """
        if scene_id not in self.active_connections:
            return 0
        return len(self.active_connections[scene_id])
    
    def get_total_connections(self) -> int:
        """Get the total number of active connections across all rooms."""
        return len(self.connection_lookup)
    
    def get_active_rooms(self) -> List[UUID]:
        """Get list of scene IDs with active connections."""
        return list(self.active_connections.keys())
    
    async def _broadcast_user_joined(self, scene_id: UUID, connection_info: ConnectionInfo):
        """Broadcast a user-joined event to other participants."""
        message = {
            "type": "user_joined",
            "user": connection_info.to_dict(),
            "timestamp": datetime.utcnow().isoformat()
        }
        await self.send_json_to_room(
            scene_id, 
            message, 
            exclude=connection_info.user_id
        )
    
    async def _broadcast_user_left(self, scene_id: UUID, connection_info: ConnectionInfo):
        """Broadcast a user-left event to remaining participants."""
        message = {
            "type": "user_left",
            "user_id": str(connection_info.user_id),
            "user_name": connection_info.user_name,
            "timestamp": datetime.utcnow().isoformat()
        }
        await self.send_json_to_room(scene_id, message)


# Global singleton instance
websocket_manager = WebSocketManager()
