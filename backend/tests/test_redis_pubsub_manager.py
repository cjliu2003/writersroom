import asyncio
from types import SimpleNamespace
from uuid import uuid4

import fakeredis
import fakeredis.aioredis
import pytest
import pytest_asyncio

from app.services import redis_pubsub
from app.services.redis_pubsub import RedisPubSubManager, RedisMessage


@pytest_asyncio.fixture
async def fake_manager(monkeypatch):
    fake_server = fakeredis.FakeServer()
    fake_redis = fakeredis.aioredis.FakeRedis(
        server=fake_server,
        decode_responses=False,
    )

    async def fake_from_url(url: str, *, encoding: str = "utf-8", decode_responses: bool = False):
        return fake_redis

    monkeypatch.setattr(
        redis_pubsub,
        "aioredis",
        SimpleNamespace(from_url=fake_from_url),
    )

    manager = RedisPubSubManager("redis://fakeredis")
    await manager.connect()
    try:
        yield manager
    finally:
        await manager.disconnect()


async def _wait_for(condition, timeout: float = 1.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if condition():
            return
        await asyncio.sleep(0.05)
    raise TimeoutError("Condition not met before timeout")


@pytest.mark.asyncio
async def test_update_roundtrip(fake_manager: RedisPubSubManager):
    scene_id = uuid4()
    sender_id = uuid4()
    received: list[RedisMessage] = []

    async def callback(message: RedisMessage):
        received.append(message)

    await fake_manager.subscribe_to_scene(scene_id, callback)
    try:
        await fake_manager.publish_update(scene_id, b"\x00\x01\x02", sender_id)
        await _wait_for(lambda: any(msg.channel_type == "updates" for msg in received))

        update_messages = [msg for msg in received if msg.channel_type == "updates"]
        assert len(update_messages) == 1
        update_message = update_messages[0]
        assert update_message.sender_id == sender_id
        assert update_message.payload == b"\x00\x01\x02"
    finally:
        await fake_manager.unsubscribe_from_scene(scene_id, callback)


@pytest.mark.asyncio
async def test_awareness_roundtrip(fake_manager: RedisPubSubManager):
    scene_id = uuid4()
    sender_id = uuid4()
    received: list[RedisMessage] = []

    async def callback(message: RedisMessage):
        received.append(message)

    await fake_manager.subscribe_to_scene(scene_id, callback)
    try:
        payload = {"cursor": {"x": 100, "y": 50}}
        await fake_manager.publish_awareness(scene_id, payload, sender_id)
        await _wait_for(lambda: any(msg.channel_type == "awareness" for msg in received))

        awareness_messages = [msg for msg in received if msg.channel_type == "awareness"]
        assert len(awareness_messages) == 1
        awareness_message = awareness_messages[0]
        assert awareness_message.sender_id == sender_id
        assert awareness_message.payload == payload

        # Ensure update payloads in the same run, if any, remain bytes to avoid mixing message types.
        for msg in received:
            if msg.channel_type == "updates":
                assert isinstance(msg.payload, (bytes, bytearray))
    finally:
        await fake_manager.unsubscribe_from_scene(scene_id, callback)
