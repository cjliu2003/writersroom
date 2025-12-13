"""
WebSocket Router for Script-Level Real-time Collaboration

Handles WebSocket connections for collaborative editing of full screenplay scripts.
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
from app.services.redis_pubsub import get_redis_manager, RedisMessage
from app.services.script_yjs_persistence import ScriptYjsPersistence
from app.models.script import Script
from app.models.script_version import ScriptVersion
from app.models.user import User
from sqlalchemy import select, desc

logger = logging.getLogger(__name__)

router = APIRouter()


async def get_script_and_verify_access(
    script_id: UUID,
    user_id: UUID,
    db: AsyncSession
) -> Script:
    """
    Verify that the script exists and the user has access to it.

    Args:
        script_id: UUID of the script
        user_id: UUID of the user
        db: Database session

    Returns:
        Script object if access is granted

    Raises:
        HTTPException: If script not found or access denied
    """
    print(f"[get_script_and_verify_access] Checking access for user {user_id} to script {script_id}")

    # Get the script - OPTIMIZATION: Select only needed columns to prevent loading relationships
    # This prevents 8 additional relationship queries via lazy='selectin'
    # Need: script_id, owner_id, title (access checks)
    #       updated_at, content_blocks (Yjs initialization logic)
    print(f"[get_script_and_verify_access] Querying database for script...")
    stmt = select(
        Script.script_id,
        Script.owner_id,
        Script.title,
        Script.updated_at,
        Script.content_blocks
    ).where(Script.script_id == script_id)
    result = await db.execute(stmt)
    row = result.one_or_none()
    print(f"[get_script_and_verify_access] Script found: {row is not None}")

    if not row:
        print(f"[get_script_and_verify_access] ERROR: Script not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Script not found"
        )

    # Check if user owns the script or is a collaborator
    print(f"[get_script_and_verify_access] Script owner: {row.owner_id}, User: {user_id}")
    if row.owner_id != user_id:
        # Check collaborators
        print(f"[get_script_and_verify_access] User is not owner, checking collaborators...")
        from app.models.script_collaborator import ScriptCollaborator
        stmt = select(ScriptCollaborator).where(
            ScriptCollaborator.script_id == script_id,
            ScriptCollaborator.user_id == user_id
        )
        result = await db.execute(stmt)
        collaborator = result.scalar_one_or_none()
        print(f"[get_script_and_verify_access] Collaborator found: {collaborator is not None}")

        if not collaborator:
            print(f"[get_script_and_verify_access] ERROR: Access denied")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this script"
            )
    else:
        print(f"[get_script_and_verify_access] User is the owner")

    print(f"[get_script_and_verify_access] Access verified successfully")

    # Reconstruct a minimal Script object for compatibility
    # Needs: script_id, owner_id, title (access checks)
    #        updated_at, content_blocks (Yjs initialization logic)
    class ScriptAccessInfo:
        def __init__(self, script_id, owner_id, title, updated_at, content_blocks):
            self.script_id = script_id
            self.owner_id = owner_id
            self.title = title
            self.updated_at = updated_at
            self.content_blocks = content_blocks

    return ScriptAccessInfo(
        row.script_id,
        row.owner_id,
        row.title,
        row.updated_at,
        row.content_blocks
    )


@router.websocket("/ws/scripts/{script_id}")
async def script_collaboration_websocket(
    websocket: WebSocket,
    script_id: UUID,
    token: str = Query(..., description="JWT authentication token"),
    db: AsyncSession = Depends(get_db),
):
    """
    WebSocket endpoint for real-time collaborative editing of entire script.

    Protocol:
    1. Client connects with JWT token
    2. Server validates and sends initial state
    3. Client/Server exchange Yjs updates and awareness data

    Uses y-websocket binary message framing:
    - MESSAGE_SYNC (0): SyncStep1, SyncStep2, SyncUpdate
    - MESSAGE_AWARENESS (1): Cursor/presence updates
    - MESSAGE_QUERY_AWARENESS (3): Request awareness state
    """
    # CRITICAL: Log at the very start to confirm endpoint is called
    print(f"\n>>> SCRIPT WEBSOCKET ENDPOINT CALLED for script {script_id} <<<")
    logger.info(f">>> SCRIPT WEBSOCKET ENDPOINT CALLED for script {script_id} <<<")

    user_info = None
    connection_info = None
    ydoc: Optional[YDoc] = None

    try:
        # IMPORTANT: Accept the WebSocket connection FIRST to prevent timeout
        # during slow authentication/database queries (especially with high latency)
        print(f"[SCRIPT WS] Step 1: Accepting WebSocket connection...")
        await websocket.accept()
        print(f"[SCRIPT WS] Step 2: WebSocket accepted successfully")
        logger.info(f"WebSocket connection accepted for script {script_id}")

        # Verify JWT token
        print(f"[SCRIPT WS] Step 3: Starting token verification for script {script_id}")
        logger.info(f"Verifying token for WebSocket connection to script {script_id}")

        try:
            print(f"[SCRIPT WS] Step 4: Calling verify_token_websocket()...")
            user_info = await verify_token_websocket(token)
            print(f"[SCRIPT WS] Step 5: Token verification succeeded!")
            logger.info(f"Token verified successfully for script {script_id}")
        except HTTPException as auth_error:
            print(f"[SCRIPT WS] ERROR: HTTPException during token verification: {auth_error.detail}")
            logger.error(f"Token verification failed: {auth_error.detail}")
            await websocket.close(code=4001, reason=f"Authentication failed: {auth_error.detail}")
            return
        except Exception as auth_error:
            print(f"[SCRIPT WS] ERROR: Exception during token verification: {str(auth_error)}")
            logger.error(f"Unexpected error during token verification: {str(auth_error)}")
            await websocket.close(code=4001, reason="Authentication error")
            return

        # Firebase tokens have 'uid' or 'user_id'
        print(f"[SCRIPT WS] Step 6: Extracting firebase_uid from user_info...")
        firebase_uid = user_info.get("uid") or user_info.get("user_id")
        if not firebase_uid:
            print(f"[SCRIPT WS] ERROR: No firebase_uid found in token")
            await websocket.close(code=4001, reason="Invalid token: missing user ID")
            return
        print(f"[SCRIPT WS] Step 7: firebase_uid = {firebase_uid}")

        # Look up the user in the database
        print(f"[SCRIPT WS] Step 8: Looking up user in database...")
        stmt = select(User).where(User.firebase_uid == firebase_uid)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()
        print(f"[SCRIPT WS] Step 9: Database lookup complete, user found = {user is not None}")

        if not user:
            print(f"[SCRIPT WS] ERROR: User not found in database")
            await websocket.close(code=4001, reason="User not found")
            return

        user_id = user.user_id  # This is the UUID from the database
        user_name = user_info.get("name", user_info.get("email", "Anonymous"))
        print(f"[SCRIPT WS] Step 10: User identified - {user_name} ({user_id})")

        logger.info(f"WebSocket connection attempt by user {user_name} to script {script_id}")

        # Verify script access
        print(f"[SCRIPT WS] Step 11: Verifying script access...")
        try:
            script = await get_script_and_verify_access(script_id, user_id, db)
            print(f"[SCRIPT WS] Step 12: Script access verified! Script title: {script.title}")
        except HTTPException as e:
            print(f"[SCRIPT WS] ERROR: Script access denied - {e.status_code}: {e.detail}")
            logger.error(f"Script access denied: {e.detail}")
            await websocket.close(code=4003, reason=e.detail)
            return
        except Exception as e:
            print(f"[SCRIPT WS] ERROR: Unexpected error verifying script access: {type(e).__name__}: {str(e)}")
            logger.error(f"Unexpected error verifying script access: {str(e)}")
            await websocket.close(code=1011, reason="Internal server error")
            return

        print(f"[SCRIPT WS] Step 13: Registering with WebSocket manager (connection already accepted)...")
        logger.info(f"Registering WebSocket for user {user_name} to script {script_id}")

        # Register with WebSocket manager WITHOUT calling accept again
        # (we already accepted at the start to prevent timeout)
        from app.services.websocket_manager import ConnectionInfo
        connection_info = ConnectionInfo(websocket, user_id, user_name)

        # Add to room
        if script_id not in websocket_manager.active_connections:
            websocket_manager.active_connections[script_id] = set()
        websocket_manager.active_connections[script_id].add(connection_info)

        # Add to lookup
        websocket_manager.connection_lookup[websocket] = connection_info

        logger.info(
            f"User {user_name} ({user_id}) connected to script {script_id}. "
            f"Room now has {len(websocket_manager.active_connections[script_id])} participant(s)"
        )
        print(f"[SCRIPT WS] Step 14: WebSocket registered successfully")

        logger.info(f"WebSocket connection established for script {script_id}")

        # Create the Yjs document and load persisted state
        ydoc = YDoc()
        persistence = ScriptYjsPersistence(db)

        # Load or initialize Yjs document with content
        try:
            # Get latest Yjs update timestamp
            yjs_stmt = (
                select(ScriptVersion.created_at)
                .where(ScriptVersion.script_id == script_id)
                .order_by(desc(ScriptVersion.created_at))
                .limit(1)
            )
            yjs_result = await db.execute(yjs_stmt)
            latest_yjs_update = yjs_result.scalar_one_or_none()

            rest_updated_at = script.updated_at

            if latest_yjs_update and rest_updated_at > latest_yjs_update:
                # REST is newer - skip stale Yjs history
                logger.info(f"REST newer than Yjs for script {script_id}, skipping persisted updates")
                applied_count = 0
            else:
                # Load persisted Yjs updates from script_versions table
                applied_count = await persistence.load_persisted_updates(script_id, ydoc)
                logger.info(f"Loaded {applied_count} persisted update(s) for script {script_id}")

            # Check if Yjs document is actually empty (even if updates were applied)
            shared_root = ydoc.get_array('content')
            yjs_content_length = len(shared_root)

            logger.info(f"After loading {applied_count} updates, Yjs content length: {yjs_content_length}")

            # If Yjs document is empty, populate from appropriate source
            if yjs_content_length == 0:
                content_blocks = []

                # CRITICAL FIX: If REST is newer than Yjs, use scripts.content_blocks
                # This prevents offline edits saved via REST from being overwritten by stale scenes
                if latest_yjs_update and rest_updated_at > latest_yjs_update:
                    # REST autosave is newer - use scripts.content_blocks as source of truth
                    logger.info(f"Yjs document empty for script {script_id}, rebuilding from scripts.content_blocks (REST is newer)")
                    content_blocks = script.content_blocks or []
                    logger.info(f"Loaded {len(content_blocks)} blocks from scripts.content_blocks")
                else:
                    # Yjs is current or no REST updates - rebuild from scenes
                    from app.models.scene import Scene

                    logger.info(f"Yjs document empty for script {script_id}, rebuilding from scenes")
                    scenes_result = await db.execute(
                        select(Scene)
                        .where(Scene.script_id == script_id)
                        .order_by(Scene.position)
                    )
                    scenes = scenes_result.scalars().all()

                    if scenes:
                        for scene in scenes:
                            if scene.content_blocks:
                                content_blocks.extend(scene.content_blocks)
                        logger.info(f"Rebuilt {len(content_blocks)} blocks from {len(scenes)} scenes")
                    else:
                        logger.warning(f"No scenes found for script {script_id}")

                # Populate Yjs document with content_blocks
                if content_blocks:
                    # TEMPORARILY DISABLED: Backend seeding causes format issues
                    # Let frontend seed the document from REST API instead
                    logger.info(f"Backend seeding disabled - frontend will seed from REST API ({len(content_blocks)} blocks available)")
                else:
                    logger.warning(f"No content available to populate Yjs doc for script {script_id}")
        except Exception as e:
            logger.error(f"Failed to load/initialize Yjs state for script {script_id}: {e}", exc_info=True)
            await websocket.close(code=1011, reason=f"Failed to initialize: {str(e)[:100]}")
            return

        # Get Redis manager for cross-server communication
        redis_manager = None
        try:
            redis_manager = get_redis_manager()

            # Define callback for Redis messages
            async def handle_redis_message(message: RedisMessage):
                """Forward parsed Redis messages to this WebSocket connection."""
                try:
                    if message.sender_id and message.sender_id == user_id:
                        return  # Skip echo

                    if message.channel_type == "updates":
                        if not isinstance(message.payload, (bytes, bytearray)):
                            logger.error(
                                "Invalid update payload type from Redis for script %s", script_id
                            )
                            return
                        await websocket.send_bytes(bytes(message.payload))
                    elif message.channel_type == "awareness":
                        payload = message.payload if isinstance(message.payload, dict) else {}
                        await websocket.send_json(
                            {
                                "type": "awareness",
                                "user_id": str(message.sender_id) if message.sender_id else None,
                                "payload": payload,
                            }
                        )
                    else:
                        logger.debug(
                            "Skipping Redis channel type %s for script %s",
                            message.channel_type,
                            script_id,
                        )
                except Exception as exc:
                    logger.error("Error handling Redis message for script %s: %s", script_id, exc)

            # Subscribe to script updates via Redis
            await redis_manager.subscribe_to_script(script_id, handle_redis_message)
            logger.info(f"Subscribed to Redis for script {script_id}")

        except RuntimeError as e:
            # Redis not configured - single server mode
            logger.warning(f"Redis not configured, running in single-server mode: {e}")
            redis_manager = None
        except Exception as e:
            # Any other Redis error - log it but continue in single-server mode
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
        logger.info(f"Entering message loop for user {user_name} on script {script_id}")
        while True:
            # Receive message from client
            try:
                message = await websocket.receive()

                # Check for disconnect message
                if message.get("type") == "websocket.disconnect":
                    logger.info(f"Client disconnected from script {script_id}: {user_id}")
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
                            script_id,
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
                            await redis_manager.publish_script_awareness(
                                script_id,
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
                                    logger.info(f"Replied with SyncStep2 ({len(update)} bytes)")

                                    # Now prompt the client to send its missing updates to server
                                    sv_server = Y.encode_state_vector(ydoc)
                                    step1_payload = _write_var_uint(SYNC_STEP1) + _write_var_uint8array(sv_server)
                                    step1_msg = _write_var_uint(MESSAGE_SYNC) + step1_payload
                                    await websocket.send_bytes(step1_msg)
                                    logger.info(f"Sent SyncStep1 to client ({len(sv_server)} bytes state vector)")
                                elif sub_type == SYNC_STEP2 or sub_type == SYNC_UPDATE:
                                    upd, offset = _read_var_uint8array(msg, offset)
                                    # Apply update to server doc
                                    Y.apply_update(ydoc, upd)
                                    logger.debug(f"Applied UPDATE (type {sub_type}) size={len(upd)}")
                                    # Persist the applied update for recovery/history
                                    try:
                                        await persistence.store_update(script_id, upd, user_id)
                                        # Commit to ensure durability during long-lived WS sessions
                                        await db.commit()
                                    except Exception as e:
                                        logger.error(f"Error persisting Yjs update for script {script_id}: {e}")

                                    # Broadcast update to other clients
                                    # For SYNC_STEP2 (initial state), repackage as SYNC_UPDATE for peers
                                    # For SYNC_UPDATE (incremental), forward as-is
                                    if sub_type == SYNC_STEP2:
                                        # Repackage as SYNC_UPDATE so other clients apply it incrementally
                                        bcast_payload = _write_var_uint(SYNC_UPDATE) + _write_var_uint8array(upd)
                                        bcast_msg = _write_var_uint(MESSAGE_SYNC) + bcast_payload
                                        await websocket_manager.broadcast_to_room(script_id, bcast_msg, exclude_websocket=websocket)
                                        if redis_manager:
                                            await redis_manager.publish_script_update(script_id, bcast_msg, user_id)
                                        logger.info(f"Broadcasted SYNC_STEP2 as SYNC_UPDATE to peers")
                                    elif sub_type == SYNC_UPDATE:
                                        # Forward incremental update as-is
                                        await websocket_manager.broadcast_to_room(script_id, msg, exclude_websocket=websocket)
                                        if redis_manager:
                                            await redis_manager.publish_script_update(script_id, msg, user_id)
                                        logger.info(f"Broadcasted SYNC_UPDATE to peers")
                                else:
                                    logger.warning(f"Unknown sync submessage type: {sub_type}")
                                    break
                        elif top_type == MESSAGE_AWARENESS:
                            # Parse awareness update to track clientIds and clocks
                            try:
                                aw_update, _ = _read_var_uint8array(msg, offset)
                                # awareness update payload format:
                                # [nClients][clientId][clock][stateString] ...
                                o = 0
                                n_clients, o = _read_var_uint(aw_update, o)
                                for _i in range(n_clients):
                                    c_id, o = _read_var_uint(aw_update, o)
                                    c_clock, o = _read_var_uint(aw_update, o)
                                    _state, o = _read_var_string(aw_update, o)
                                    if connection_info:
                                        # Track last observed clock for this clientId
                                        connection_info.awareness_meta[int(c_id)] = int(c_clock)
                            except Exception as e:
                                logger.debug(f"Failed to parse awareness update: {e}")

                            # Forward awareness messages as-is to other clients and Redis
                            await websocket_manager.broadcast_to_room(script_id, msg, exclude_websocket=websocket)
                            if redis_manager:
                                await redis_manager.publish_script_update(script_id, msg, user_id)
                        elif top_type == MESSAGE_QUERY_AWARENESS:
                            # Relay awareness query so other clients respond with their current state
                            await websocket_manager.broadcast_to_room(script_id, msg, exclude_websocket=websocket)
                            if redis_manager:
                                try:
                                    await redis_manager.publish_script_update(script_id, msg, user_id)
                                except Exception as e:
                                    logger.error(f"Failed to publish awareness query via Redis: {e}")
                        elif top_type == MESSAGE_AUTH:
                            # Ignore - auth is handled at connection
                            pass
                        else:
                            logger.warning(f"Unknown top-level message type: {top_type}")
                    except Exception as e:
                        logger.error(f"Error processing binary message: {e}")

                else:
                    # Unknown message type
                    logger.warning(f"Received unknown message type: {message}")

            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected for user {user_id} from script {script_id}")
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
        logger.error(f"WebSocket error for script {script_id}: {e}")
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except:
            pass

    finally:
        # Release native resources held by y-py
        if ydoc is not None:
            try:
                ydoc.destroy()
            except Exception as destroy_err:
                logger.debug(f"YDoc destroy failed for script {script_id}: {destroy_err}")

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
                    await websocket_manager.broadcast_to_room(script_id, top)
                    try:
                        rm = get_redis_manager()
                        await rm.publish_script_update(script_id, top, user_id)
                    except RuntimeError:
                        pass
            except Exception as e:
                logger.error(f"Failed to broadcast awareness removals on disconnect: {e}")

            await websocket_manager.disconnect(websocket, script_id, notify_participants=False)

            # Unsubscribe from Redis
            try:
                redis_manager = get_redis_manager()
                await redis_manager.unsubscribe_from_script(script_id)
            except RuntimeError:
                pass  # Redis not configured

        logger.info(f"WebSocket connection closed for script {script_id}")
