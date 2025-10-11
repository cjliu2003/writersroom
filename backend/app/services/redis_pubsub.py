"""
Redis PubSub Manager for Multi-Server WebSocket Coordination

Enables WebSocket messages to be broadcasted across multiple server instances
using Redis pub/sub channels.
"""

from typing import Callable, Dict, Optional, Set
from uuid import UUID
import asyncio
import logging
import json
from redis import asyncio as aioredis

logger = logging.getLogger(__name__)


class RedisPubSubManager:
    """
    Coordinates WebSocket messages across multiple server instances using Redis.
    
    Each scene has dedicated channels:
    - scene:{scene_id}:updates - Yjs document updates
    - scene:{scene_id}:awareness - Presence/cursor updates
    - scene:{scene_id}:join - User joined notifications
    - scene:{scene_id}:leave - User left notifications
    """
    
    def __init__(self, redis_url: str):
        """
        Initialize Redis PubSub manager.
        
        Args:
            redis_url: Redis connection URL (e.g., redis://localhost:6379)
        """
        self.redis_url = redis_url
        self.redis_client: Optional[aioredis.Redis] = None
        self.pubsub: Optional[aioredis.client.PubSub] = None
        
        # Track active subscriptions and their callbacks
        self.subscriptions: Dict[str, Set[Callable]] = {}
        
        # Background task for listening to messages
        self.listen_task: Optional[asyncio.Task] = None
        
        logger.info(f"RedisPubSubManager initialized with URL: {redis_url}")
    
    async def connect(self):
        """Establish connection to Redis."""
        if self.redis_client is None:
            self.redis_client = await aioredis.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=False  # We'll handle binary data
            )
            self.pubsub = self.redis_client.pubsub()
            logger.info("Connected to Redis")
    
    async def disconnect(self):
        """Close Redis connection and cleanup."""
        if self.listen_task:
            self.listen_task.cancel()
            try:
                await self.listen_task
            except asyncio.CancelledError:
                pass
        
        if self.pubsub:
            await self.pubsub.close()
        
        if self.redis_client:
            await self.redis_client.close()
        
        logger.info("Disconnected from Redis")
    
    def _get_channel_name(self, scene_id: UUID, channel_type: str) -> str:
        """
        Generate Redis channel name for a scene.
        
        Args:
            scene_id: UUID of the scene
            channel_type: Type of channel (updates, awareness, join, leave)
            
        Returns:
            Channel name string
        """
        return f"scene:{scene_id}:{channel_type}"
    
    async def publish_update(
        self, 
        scene_id: UUID, 
        update: bytes, 
        sender_id: UUID
    ):
        """
        Publish a Yjs update to the scene's updates channel.
        
        Args:
            scene_id: UUID of the scene
            update: Binary Yjs update data
            sender_id: UUID of the user who sent the update
        """
        if not self.redis_client:
            await self.connect()
        
        channel = self._get_channel_name(scene_id, "updates")
        
        # Wrap update with metadata
        message = {
            "sender_id": str(sender_id),
            "update": update.hex()  # Convert bytes to hex string for JSON
        }
        
        await self.redis_client.publish(
            channel,
            json.dumps(message)
        )
        
        logger.debug(f"Published update to {channel} from user {sender_id}")
    
    async def publish_awareness(
        self,
        scene_id: UUID,
        awareness_data: dict,
        sender_id: UUID
    ):
        """
        Publish presence/awareness data to the scene's awareness channel.
        
        Args:
            scene_id: UUID of the scene
            awareness_data: Dictionary containing cursor position, selection, etc.
            sender_id: UUID of the user
        """
        if not self.redis_client:
            await self.connect()
        
        channel = self._get_channel_name(scene_id, "awareness")
        
        message = {
            "sender_id": str(sender_id),
            "awareness": awareness_data
        }
        
        await self.redis_client.publish(
            channel,
            json.dumps(message)
        )
        
        logger.debug(f"Published awareness to {channel} from user {sender_id}")
    
    async def publish_user_event(
        self,
        scene_id: UUID,
        event_type: str,  # "join" or "leave"
        user_data: dict
    ):
        """
        Publish user join/leave events.
        
        Args:
            scene_id: UUID of the scene
            event_type: "join" or "leave"
            user_data: Dictionary with user information
        """
        if not self.redis_client:
            await self.connect()
        
        channel = self._get_channel_name(scene_id, event_type)
        
        await self.redis_client.publish(
            channel,
            json.dumps(user_data)
        )
        
        logger.debug(f"Published {event_type} event to {channel}")
    
    async def subscribe_to_scene(
        self,
        scene_id: UUID,
        callback: Callable[[str, bytes], None]
    ):
        """
        Subscribe to all channels for a scene.
        
        Args:
            scene_id: UUID of the scene to subscribe to
            callback: Async function to call when messages arrive
                     Signature: async def callback(channel: str, message: bytes)
        """
        if not self.redis_client:
            await self.connect()
        
        channels = [
            self._get_channel_name(scene_id, "updates"),
            self._get_channel_name(scene_id, "awareness"),
            self._get_channel_name(scene_id, "join"),
            self._get_channel_name(scene_id, "leave")
        ]
        
        # Subscribe to all channels
        await self.pubsub.subscribe(*channels)
        
        # Register callback
        for channel in channels:
            if channel not in self.subscriptions:
                self.subscriptions[channel] = set()
            self.subscriptions[channel].add(callback)
        
        logger.info(f"Subscribed to scene {scene_id} channels")
        
        # Start listening task if not already running
        if not self.listen_task or self.listen_task.done():
            self.listen_task = asyncio.create_task(self._listen_to_messages())
    
    async def unsubscribe_from_scene(
        self,
        scene_id: UUID,
        callback: Optional[Callable] = None
    ):
        """
        Unsubscribe from scene channels.
        
        Args:
            scene_id: UUID of the scene
            callback: Optional specific callback to remove
        """
        if not self.pubsub:
            return
        
        channels = [
            self._get_channel_name(scene_id, "updates"),
            self._get_channel_name(scene_id, "awareness"),
            self._get_channel_name(scene_id, "join"),
            self._get_channel_name(scene_id, "leave")
        ]
        
        # Remove callback(s)
        for channel in channels:
            if channel in self.subscriptions:
                if callback:
                    self.subscriptions[channel].discard(callback)
                else:
                    self.subscriptions[channel].clear()
                
                # Unsubscribe if no more callbacks
                if not self.subscriptions[channel]:
                    await self.pubsub.unsubscribe(channel)
                    del self.subscriptions[channel]
        
        logger.info(f"Unsubscribed from scene {scene_id}")
    
    async def _listen_to_messages(self):
        """
        Background task that listens for messages on subscribed channels
        and dispatches them to registered callbacks.
        """
        logger.info("Started listening to Redis pub/sub messages")
        
        try:
            async for message in self.pubsub.listen():
                if message["type"] == "message":
                    channel = message["channel"]
                    data = message["data"]
                    
                    # Dispatch to all callbacks for this channel
                    if channel in self.subscriptions:
                        for callback in self.subscriptions[channel]:
                            try:
                                if asyncio.iscoroutinefunction(callback):
                                    await callback(channel, data)
                                else:
                                    callback(channel, data)
                            except Exception as e:
                                logger.error(
                                    f"Error in callback for channel {channel}: {e}"
                                )
        
        except asyncio.CancelledError:
            logger.info("Redis listener task cancelled")
            raise
        except Exception as e:
            logger.error(f"Error in Redis listener: {e}")


# Global singleton instance (initialized in main app)
redis_pubsub_manager: Optional[RedisPubSubManager] = None


def get_redis_manager() -> RedisPubSubManager:
    """Get the global Redis PubSub manager instance."""
    if redis_pubsub_manager is None:
        raise RuntimeError(
            "Redis PubSub manager not initialized. "
            "Call initialize_redis_manager() first."
        )
    return redis_pubsub_manager


def initialize_redis_manager(redis_url: str) -> RedisPubSubManager:
    """
    Initialize the global Redis PubSub manager.
    
    Args:
        redis_url: Redis connection URL
        
    Returns:
        Initialized RedisPubSubManager instance
    """
    global redis_pubsub_manager
    redis_pubsub_manager = RedisPubSubManager(redis_url)
    return redis_pubsub_manager
