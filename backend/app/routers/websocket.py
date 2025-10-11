"""
WebSocket Router for Real-time Collaboration

Handles WebSocket connections for collaborative editing of screenplay scenes.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
import logging
import json
from typing import Optional
import y_py as Y
from y_py import YDoc

from app.db.base import get_db
from app.auth.dependencies import verify_token_websocket
from app.services.websocket_manager import websocket_manager
from app.services.redis_pubsub import get_redis_manager
from app.services.yjs_persistence import YjsPersistence
from app.models.scene import Scene
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()


async def get_scene_and_verify_access(
    scene_id: UUID,
    user_id: UUID,
    db: AsyncSession
) -> Scene:
    """
    Verify that the scene exists and the user has access to it.
    
    Args:
        scene_id: UUID of the scene
        user_id: UUID of the user
        db: Database session
        
    Returns:
        Scene object if access is granted
        
    Raises:
        HTTPException: If scene not found or access denied
    """
    from sqlalchemy import select
    
    # Get the scene
    stmt = select(Scene).where(Scene.scene_id == scene_id)
    result = await db.execute(stmt)
    scene = result.scalar_one_or_none()
    
    if not scene:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Scene not found"
        )
    
    # Get the script to check ownership
    from app.models.script import Script
    stmt = select(Script).where(Script.script_id == scene.script_id)
    result = await db.execute(stmt)
    script = result.scalar_one_or_none()
    
    if not script:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Script not found"
        )
    
    # Check if user owns the script or is a collaborator
    if script.owner_id != user_id:
        # Check collaborators
        from app.models.script_collaborator import ScriptCollaborator
        stmt = select(ScriptCollaborator).where(
            ScriptCollaborator.script_id == scene.script_id,
            ScriptCollaborator.user_id == user_id
        )
        result = await db.execute(stmt)
        collaborator = result.scalar_one_or_none()
        
        if not collaborator:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this scene"
            )
    
    return scene


@router.websocket("/ws/scenes/{scene_id}")
async def scene_collaboration_websocket(
    websocket: WebSocket,
    scene_id: UUID,
    token: str = Query(..., description="JWT authentication token"),
    db: AsyncSession = Depends(get_db)
):
    """
    WebSocket endpoint for real-time collaborative editing of a scene.
    
    Protocol:
    1. Client connects with JWT token
    2. Server validates and sends initial state
    3. Client/Server exchange Yjs updates and awareness data
    
    Message Format:
    {
        "type": "update" | "awareness" | "sync" | "query",
        "payload": "<base64-encoded-binary-data>",
        "timestamp": "2025-09-30T20:00:00Z"
    }
    """
    # CRITICAL: Log at the very start to confirm endpoint is called
    print(f"\n>>> WEBSOCKET ENDPOINT CALLED for scene {scene_id} <<<")
    logger.info(f">>> WEBSOCKET ENDPOINT CALLED for scene {scene_id} <<<")
    
    user_info = None
    connection_info = None
    
    try:
        # Verify JWT token
        logger.info(f"Attempting to verify token for WebSocket connection to scene {scene_id}")
        logger.debug(f"Token (first 20 chars): {token[:20]}...")
        
        try:
            user_info = await verify_token_websocket(token)
            print(f">>> TOKEN VERIFIED, user_info type: {type(user_info)}")
            logger.info(f"Token verified successfully. User info: {user_info.get('email', 'no email')}")
        except HTTPException as auth_error:
            print(f">>> HTTP EXCEPTION during auth: {auth_error.detail}")
            logger.error(f"Token verification failed: {auth_error.detail}")
            await websocket.close(code=4001, reason=f"Authentication failed: {auth_error.detail}")
            return
        except Exception as auth_error:
            print(f">>> GENERAL EXCEPTION during auth: {type(auth_error)} - {str(auth_error)}")
            logger.error(f"Unexpected error during token verification: {str(auth_error)}")
            await websocket.close(code=4001, reason="Authentication error")
            return
        
        print(f">>> EXTRACTING FIREBASE UID...")
        # Firebase tokens have 'uid' or 'user_id'
        firebase_uid = user_info.get("uid") or user_info.get("user_id")
        print(f">>> FIREBASE UID: {firebase_uid}")
        if not firebase_uid:
            print(f">>> NO FIREBASE UID FOUND")
            await websocket.close(code=4001, reason="Invalid token: missing user ID")
            return
        
        # user_id here is the Firebase UID (string), not the database UUID
        # We'll look up the user in the database to get the UUID
        print(f">>> LOOKING UP USER IN DATABASE...")
        from app.models.user import User
        from sqlalchemy import select
        
        stmt = select(User).where(User.firebase_uid == firebase_uid)
        result = await db.execute(stmt)
        print(f">>> DATABASE QUERY EXECUTED")
        user = result.scalar_one_or_none()
        print(f">>> USER FOUND: {user is not None}")
        
        if not user:
            print(f">>> USER NOT FOUND IN DATABASE")
            await websocket.close(code=4001, reason="User not found")
            return
        
        user_id = user.user_id  # This is the UUID from the database
        user_name = user_info.get("name", user_info.get("email", "Anonymous"))
        print(f">>> USER ID: {user_id}, NAME: {user_name}")
        
        logger.info(f"WebSocket connection attempt by user {user_name} to scene {scene_id}")
        
        # Verify scene access
        try:
            scene = await get_scene_and_verify_access(scene_id, user_id, db)
        except HTTPException as e:
            logger.error(f"Scene access denied: {e.detail}")
            await websocket.close(code=4003, reason=e.detail)
            return
        
        print(f">>> ABOUT TO CONNECT WEBSOCKET")
        logger.info(f"Connecting WebSocket for user {user_name} to scene {scene_id}")
        
        # Connect to WebSocket manager (this accepts the connection internally)
        # notify_participants=False to prevent JSON messages - y-websocket uses binary protocol only
        print(f">>> CALLING websocket_manager.connect()")
        connection_info = await websocket_manager.connect(
            websocket=websocket,
            scene_id=scene_id,
            user_id=user_id,
            user_name=user_name,
            notify_participants=False
        )
        print(f">>> WEBSOCKET CONNECTED! connection_info: {connection_info}")
        
        logger.info(f"WebSocket connection established, waiting for messages from user {user_name}...")
        
        # Create the Yjs document and load persisted state before handling sync.
        # The client will send SyncStep1; our reply will include the persisted state.
        ydoc = YDoc()
        print(f">>> YJS DOCUMENT CREATED")
        persistence = YjsPersistence(db)
        try:
            applied_count = await persistence.load_persisted_updates(scene_id, ydoc)
            print(f">>> LOADED {applied_count} PERSISTED UPDATE(S)")
            logger.info(f"Loaded {applied_count} persisted update(s) for scene {scene_id}")
        except Exception as e:
            logger.error(f"Failed to load persisted Yjs state for scene {scene_id}: {e}")
        
        # Get Redis manager for cross-server communication
        print(f">>> SETTING UP REDIS...")
        redis_manager = None
        try:
            redis_manager = get_redis_manager()
            print(f">>> REDIS MANAGER OBTAINED")
            
            # Define callback for Redis messages
            async def handle_redis_message(channel: str, message: bytes):
                """Forward messages from Redis to this WebSocket."""
                try:
                    data = json.loads(message)
                    sender_id = UUID(data.get("sender_id"))
                    
                    # Don't echo back to sender
                    if sender_id != user_id:
                        await websocket.send_json(data)
                except Exception as e:
                    logger.error(f"Error handling Redis message: {e}")
            
            # Subscribe to scene updates via Redis
            await redis_manager.subscribe_to_scene(scene_id, handle_redis_message)
            print(f">>> SUBSCRIBED TO REDIS")
            logger.info(f"Subscribed to Redis for scene {scene_id}")
            
        except RuntimeError as e:
            # Redis not configured - single server mode
            print(f">>> REDIS ERROR (RuntimeError): {e}")
            logger.warning(f"Redis not configured, running in single-server mode: {e}")
            redis_manager = None
        except Exception as e:
            # Any other Redis error - log it but continue in single-server mode
            print(f">>> REDIS ERROR (Exception): {e}")
            logger.error(f"Failed to connect to Redis, running in single-server mode: {e}")
            redis_manager = None
        
        # --- Yjs/Y-websocket encoding helpers (varUint + varByteArray) ---
        def _read_var_uint(buf: bytes, offset: int = 0):
            res = 0
            shift = 0
            while True:
                b = buf[offset]
                offset += 1
                res |= (b & 0x7F) << shift
                if b < 0x80:
                    break
                shift += 7
            return res, offset

        def _write_var_uint(value: int) -> bytes:
            out = bytearray()
            while value > 0x7F:
                out.append((value & 0x7F) | 0x80)
                value >>= 7
            out.append(value & 0x7F)
            return bytes(out)

        def _read_var_uint8array(buf: bytes, offset: int):
            length, offset = _read_var_uint(buf, offset)
            end = offset + length
            return buf[offset:end], end

        def _write_var_uint8array(b: bytes) -> bytes:
            return _write_var_uint(len(b)) + b

        def _read_var_string(buf: bytes, offset: int):
            length, offset = _read_var_uint(buf, offset)
            end = offset + length
            try:
                s = buf[offset:end].decode('utf-8')
            except Exception:
                s = ''
            return s, end

        def _write_var_string(s: str) -> bytes:
            b = s.encode('utf-8')
            return _write_var_uint(len(b)) + b

        MESSAGE_SYNC = 0
        MESSAGE_AWARENESS = 1
        MESSAGE_AUTH = 2
        MESSAGE_QUERY_AWARENESS = 3

        SYNC_STEP1 = 0
        SYNC_STEP2 = 1
        SYNC_UPDATE = 2

        # Main message loop
        print(f">>> ENTERING MESSAGE LOOP")
        logger.info(f"Entering message loop for user {user_name}")
        while True:
            # Receive message from client
            try:
                # Can receive either text (JSON) or binary (Yjs updates)
                message = await websocket.receive()
                
                # Check for disconnect message
                if message.get("type") == "websocket.disconnect":
                    logger.info(f"Client disconnected: {user_id}")
                    break
                
                if "text" in message:
                    # JSON message
                    data = json.loads(message["text"])
                    message_type = data.get("type")
                    
                    if message_type == "awareness":
                        # Presence/cursor update
                        awareness_data = data.get("payload", {})
                        
                        # Broadcast to other clients in room
                        await websocket_manager.send_json_to_room(
                            scene_id,
                            {
                                "type": "awareness",
                                "user_id": str(user_id),
                                "user_name": user_name,
                                "payload": awareness_data
                            },
                            exclude=user_id
                        )
                        
                        # Publish to Redis for other servers
                        if redis_manager:
                            await redis_manager.publish_awareness(
                                scene_id,
                                awareness_data,
                                user_id
                            )
                    
                    elif message_type == "ping":
                        # Heartbeat
                        await websocket.send_json({"type": "pong"})
                    
                elif "bytes" in message:
                    # Binary y-websocket framed message
                    msg = message["bytes"]
                    logger.debug(f"Received binary message ({len(msg)} bytes) from user {user_id}")
                    
                    if len(msg) == 0:
                        continue
                    
                    try:
                        # Decode top-level y-websocket message (varUint)
                        offset = 0
                        top_type, offset = _read_var_uint(msg, offset)
                        if top_type == MESSAGE_SYNC:
                            # One or more sync submessages may be concatenated
                            while offset < len(msg):
                                sub_type, offset = _read_var_uint(msg, offset)
                                if sub_type == SYNC_STEP1:
                                    # Read state vector from client
                                    sv, offset = _read_var_uint8array(msg, offset)
                                    update = Y.encode_state_as_update(ydoc, sv)
                                    # Build SyncStep2 reply: [messageSync][syncStep2][update]
                                    payload = _write_var_uint(SYNC_STEP2) + _write_var_uint8array(update)
                                    reply = _write_var_uint(MESSAGE_SYNC) + payload
                                    await websocket.send_bytes(reply)
                                    print(f">>> REPLIED SYNCSTEP2 ({len(reply)} bytes)")
                                    logger.info(f"Replied with SyncStep2 ({len(update)} bytes)")
                                    
                                    # Now prompt the client to send its missing updates to server
                                    # This completes the symmetric handshake so server learns client state
                                    sv_server = Y.encode_state_vector(ydoc)
                                    step1_payload = _write_var_uint(SYNC_STEP1) + _write_var_uint8array(sv_server)
                                    step1_msg = _write_var_uint(MESSAGE_SYNC) + step1_payload
                                    await websocket.send_bytes(step1_msg)
                                    print(f">>> SENT SYNCSTEP1 to client ({len(step1_msg)} bytes)")
                                    logger.info(f"Sent SyncStep1 to client to request its state ({len(sv_server)} bytes state vector)")
                                elif sub_type == SYNC_STEP2 or sub_type == SYNC_UPDATE:
                                    upd, offset = _read_var_uint8array(msg, offset)
                                    # Apply update to server doc
                                    Y.apply_update(ydoc, upd)
                                    print(f">>> APPLIED UPDATE (type {sub_type}) size={len(upd)}")
                                    # Persist the applied update for recovery/history
                                    try:
                                        await persistence.store_update(scene_id, upd)
                                        # Commit to ensure durability during long-lived WS sessions
                                        await db.commit()
                                    except Exception as e:
                                        logger.error(f"Error persisting Yjs update for scene {scene_id}: {e}")
                                    
                                    # Broadcast update to other clients
                                    # For SYNC_STEP2 (initial state), repackage as SYNC_UPDATE for peers
                                    # For SYNC_UPDATE (incremental), forward as-is
                                    if sub_type == SYNC_STEP2:
                                        # Repackage as SYNC_UPDATE so other clients apply it incrementally
                                        bcast_payload = _write_var_uint(SYNC_UPDATE) + _write_var_uint8array(upd)
                                        bcast_msg = _write_var_uint(MESSAGE_SYNC) + bcast_payload
                                        await websocket_manager.broadcast_to_room(scene_id, bcast_msg, exclude_websocket=websocket)
                                        if redis_manager:
                                            await redis_manager.publish_update(scene_id, bcast_msg, user_id)
                                        print(f">>> BROADCASTED SYNC_STEP2 as SYNC_UPDATE to peers ({len(bcast_msg)} bytes)")
                                        logger.info(f"Broadcasted SYNC_STEP2 update to {websocket_manager.get_room_count(scene_id) - 1} peer(s)")
                                    elif sub_type == SYNC_UPDATE:
                                        # Forward incremental update as-is
                                        await websocket_manager.broadcast_to_room(scene_id, msg, exclude_websocket=websocket)
                                        if redis_manager:
                                            await redis_manager.publish_update(scene_id, msg, user_id)
                                        print(f">>> BROADCASTED SYNC_UPDATE to peers")
                                        logger.info(f"Broadcasted SYNC_UPDATE to {websocket_manager.get_room_count(scene_id) - 1} peer(s)")
                                else:
                                    logger.warning(f"Unknown sync submessage type: {sub_type}")
                                    break
                        elif top_type == MESSAGE_AWARENESS:
                            # Parse awareness update to track clientIds and clocks for this connection
                            try:
                                aw_update, _ = _read_var_uint8array(msg, offset)
                                # awareness update payload format:
                                # [nClients][clientId][clock][stateString] ...
                                o = 0
                                n_clients, o = _read_var_uint(aw_update, o)
                                for _i in range(n_clients):
                                    c_id, o = _read_var_uint(aw_update, o)
                                    c_clock, o = _read_var_uint(aw_update, o)
                                    _state, o = _read_var_string(aw_update, o)  # not used for tracking
                                    if connection_info:
                                        # Track last observed clock for this clientId from this connection
                                        connection_info.awareness_meta[int(c_id)] = int(c_clock)
                            except Exception as e:
                                logger.debug(f"Failed to parse awareness update: {e}")

                            # Forward awareness messages as-is to other clients and Redis
                            await websocket_manager.broadcast_to_room(scene_id, msg, exclude_websocket=websocket)
                            if redis_manager:
                                await redis_manager.publish_update(scene_id, msg, user_id)
                        elif top_type == MESSAGE_QUERY_AWARENESS:
                            # Relay awareness query so other clients respond with their current state
                            await websocket_manager.broadcast_to_room(scene_id, msg, exclude_websocket=websocket)
                            if redis_manager:
                                try:
                                    await redis_manager.publish_update(scene_id, msg, user_id)
                                except Exception as e:
                                    logger.error(f"Failed to publish awareness query via Redis: {e}")
                        elif top_type == MESSAGE_AUTH:
                            # Ignore - auth is handled at connection
                            pass
                        else:
                            logger.warning(f"Unknown top-level message type: {top_type}")
                    except Exception as e:
                        logger.error(f"Error processing binary message: {e}")
                        print(f">>> ERROR PROCESSING BINARY: {e}")
                
                else:
                    # Unknown message type
                    logger.warning(f"Received unknown message type: {message}")
                
            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected for user {user_id}")
                break
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON from client: {e}")
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON format"
                })
            except Exception as e:
                logger.error(f"Error processing message: {e}")
                await websocket.send_json({
                    "type": "error",
                    "message": "Error processing message"
                })
    
    except HTTPException as e:
        logger.error(f"WebSocket HTTPException: {e.status_code}: {e.detail}")
        try:
            await websocket.close(code=4001, reason=e.detail)
        except:
            pass  # Connection might already be closed
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except:
            pass
    
    finally:
        # Cleanup on disconnect
        if connection_info:
            # Broadcast awareness removals for any clientIds observed from this connection
            try:
                if connection_info.awareness_meta:
                    # Build encoded awareness removal update for all clientIds
                    removal_payload = bytearray()
                    removal_payload += _write_var_uint(len(connection_info.awareness_meta))
                    for c_id, c_clock in connection_info.awareness_meta.items():
                        removal_payload += _write_var_uint(int(c_id))
                        # increment clock to ensure receivers accept the removal
                        removal_payload += _write_var_uint(int(c_clock) + 1)
                        # JSON 'null' indicates removal of state
                        removal_payload += _write_var_string('null')

                    top = _write_var_uint(MESSAGE_AWARENESS) + _write_var_uint8array(bytes(removal_payload))
                    await websocket_manager.broadcast_to_room(scene_id, top)
                    try:
                        rm = get_redis_manager()
                        await rm.publish_update(scene_id, top, connection_info.user_id)
                    except RuntimeError:
                        pass
            except Exception as e:
                logger.error(f"Failed to broadcast awareness removals on disconnect: {e}")

            await websocket_manager.disconnect(websocket, scene_id, notify_participants=False)
            
            # Unsubscribe from Redis
            try:
                redis_manager = get_redis_manager()
                await redis_manager.unsubscribe_from_scene(scene_id)
            except RuntimeError:
                pass  # Redis not configured
        
        logger.info(f"WebSocket connection closed for scene {scene_id}")


@router.get("/ws/scenes/{scene_id}/participants")
async def get_scene_participants(
    scene_id: UUID,
    current_user: dict = Depends(verify_token_websocket)
):
    """
    Get list of active participants in a scene.
    
    Useful for showing who's currently editing before connecting.
    """
    participants = websocket_manager.get_room_participants(scene_id)
    return {
        "scene_id": str(scene_id),
        "participant_count": len(participants),
        "participants": participants
    }
