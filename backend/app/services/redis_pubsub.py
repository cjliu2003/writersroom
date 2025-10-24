"""
Redis PubSub Manager for Multi-Server WebSocket Coordination

Enables WebSocket messages to be broadcast across multiple server instances
using Redis pub/sub channels.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Set
from uuid import UUID
import asyncio
import logging
import json
from redis import asyncio as aioredis

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RedisMessage:
    """Typed payload dispatched to websocket subscribers."""

    channel: str
    channel_type: str
    sender_id: Optional[UUID]
    payload: Any
    raw: Dict[str, Any]


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
        self.subscriptions: Dict[str, Set[Callable[[RedisMessage], Any]]] = {}
        
        # Background task for listening to messages
        self.listen_task: Optional[asyncio.Task] = None
        
        logger.info(f"RedisPubSubManager initialized with URL: {redis_url}")

    _CHANNEL_TYPES = {"updates", "awareness", "join", "leave"}

    @classmethod
    def _validate_channel_type(cls, channel_type: str) -> None:
        if channel_type not in cls._CHANNEL_TYPES:
            raise ValueError(f"Unsupported Redis channel type: {channel_type}")

    @staticmethod
    def _encode_bytes(data: bytes) -> str:
        if not isinstance(data, (bytes, bytearray)):
            raise TypeError("Expected bytes-like object for encoding.")
        return bytes(data).hex()

    @staticmethod
    def _decode_bytes(data: str) -> bytes:
        if not isinstance(data, str):
            raise TypeError("Expected hexadecimal string for decoding.")
        try:
            return bytes.fromhex(data)
        except ValueError as exc:  # pragma: no cover - defensive logging
            raise ValueError("Invalid hex payload.") from exc

    @staticmethod
    def _build_message(
        channel_type: str,
        payload: Any,
        sender_id: Optional[UUID] = None,
    ) -> str:
        body: Dict[str, Any] = {"type": channel_type, "payload": payload}
        if sender_id is not None:
            body["sender_id"] = str(sender_id)
        return json.dumps(body)

    @classmethod
    def decode_pubsub_message(
        cls,
        channel: str | bytes,
        message: str | bytes,
    ) -> Optional[RedisMessage]:
        """
        Decode a redis pub/sub payload into a structured RedisMessage instance.
        Returns None if the payload cannot be decoded.
        """
        channel_name = channel.decode("utf-8") if isinstance(channel, bytes) else str(channel)
        channel_type = channel_name.rsplit(":", 1)[-1]

        try:
            cls._validate_channel_type(channel_type)
        except ValueError as err:
            logger.error("Received message on unsupported channel '%s': %s", channel_name, err)
            return None

        raw_payload = message.decode("utf-8") if isinstance(message, bytes) else str(message)
        try:
            data = json.loads(raw_payload)
        except json.JSONDecodeError as err:
            logger.error("Failed to decode Redis payload on %s: %s", channel_name, err)
            return None

        message_type = data.get("type")
        if message_type and message_type != channel_type:
            logger.error(
                "Channel/type mismatch on %s: expected '%s' but payload declared '%s'",
                channel_name,
                channel_type,
                message_type,
            )
            return None

        sender_id: Optional[UUID] = None
        if sender_raw := data.get("sender_id"):
            try:
                sender_id = UUID(str(sender_raw))
            except (ValueError, TypeError):
                logger.error(
                    "Invalid sender_id '%s' in Redis payload on %s", sender_raw, channel_name
                )

        payload = data.get("payload")
        if channel_type == "updates":
            if payload is None:
                logger.error("Missing update payload on %s", channel_name)
                return None
            try:
                payload = cls._decode_bytes(payload)
            except (TypeError, ValueError) as err:
                logger.error("Failed to decode update payload on %s: %s", channel_name, err)
                return None
        elif channel_type == "awareness":
            if not isinstance(payload, dict):
                logger.error("Awareness payload on %s must be a JSON object", channel_name)
                return None

        return RedisMessage(
            channel=channel_name,
            channel_type=channel_type,
            sender_id=sender_id,
            payload=payload,
            raw=data,
        )
    
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
            close_coro = getattr(self.pubsub, "aclose", None)
            if callable(close_coro):
                await close_coro()
            else:  # pragma: no cover - legacy fallback
                await self.pubsub.close()
        
        if self.redis_client:
            close_coro = getattr(self.redis_client, "aclose", None)
            if callable(close_coro):
                await close_coro()
            else:  # pragma: no cover - legacy fallback
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
        self._validate_channel_type(channel_type)
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
        payload = self._build_message(
            channel_type="updates",
            payload=self._encode_bytes(update),
            sender_id=sender_id,
        )
        
        await self.redis_client.publish(channel, payload)
        
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
        payload = self._build_message(
            channel_type="awareness",
            payload=awareness_data,
            sender_id=sender_id,
        )
        
        await self.redis_client.publish(channel, payload)
        
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
        payload = self._build_message(
            channel_type=event_type,
            payload=user_data,
        )
        
        await self.redis_client.publish(channel, payload)
        
        logger.debug(f"Published {event_type} event to {channel}")
    
    async def subscribe_to_scene(
        self,
        scene_id: UUID,
        callback: Callable[[RedisMessage], Any]
    ):
        """
        Subscribe to all channels for a scene.
        
        Args:
            scene_id: UUID of the scene to subscribe to
            callback: Async function to call when messages arrive
                     Signature: async def callback(message: RedisMessage)
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
                    parsed = self.decode_pubsub_message(channel, data)
                    if not parsed:
                        continue
                    
                    channel_name = parsed.channel
                    
                    # Dispatch to all callbacks for this channel
                    callbacks = self.subscriptions.get(channel_name, set())
                    for callback in callbacks:
                        try:
                            result = callback(parsed)
                            if asyncio.iscoroutine(result):
                                await result
                        except Exception as cb_err:
                            logger.error(
                                "Error in Redis callback for channel %s: %s",
                                channel_name,
                                cb_err,
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
