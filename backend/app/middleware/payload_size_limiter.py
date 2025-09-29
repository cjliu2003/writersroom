from fastapi import FastAPI, Request, HTTPException, status

class PayloadSizeLimiter:
    """
    Middleware to limit request payload size based on the path.
    
    This is particularly useful for autosave endpoints where we want to
    enforce a specific size limit for scene content.
    """
    def __init__(self, app: FastAPI, path_limits: dict):
        """
        Initialize with a dictionary mapping path prefixes to size limits in bytes.
        
        Example:
            path_limits = {
                "/api/scenes": 256 * 1024,  # 256KB limit for scene endpoints
            }
        """
        self.app = app
        self.path_limits = path_limits
    
    async def __call__(self, scope, receive, send):
        """ASGI callable."""
        if scope["type"] != "http":
            # Not an HTTP request, just pass it through
            await self.app(scope, receive, send)
            return
        
        # Create a request object to access path and headers
        request = Request(scope, receive)
        path = request.url.path
        
        # Check if path matches any of our limited paths
        limit = None
        for path_prefix, size_limit in self.path_limits.items():
            if path.startswith(path_prefix):
                limit = size_limit
                break
        
        if limit is not None:
            # Get content length from headers
            content_length = request.headers.get("content-length")
            
            if content_length and int(content_length) > limit:
                # Respond with 413 Payload Too Large
                response = {
                    "type": "http.response.start",
                    "status": status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    "headers": [
                        [b"content-type", b"application/json"],
                    ],
                }
                await send(response)
                
                # Send response body
                error_body = {
                    "detail": f"Request body too large. Maximum size is {limit} bytes.",
                    "max_size_bytes": limit,
                    "request_size_bytes": int(content_length)
                }
                import json
                body_bytes = json.dumps(error_body).encode("utf-8")
                
                await send({
                    "type": "http.response.body",
                    "body": body_bytes,
                })
                return
        
        # If no limit is exceeded, pass to the next middleware/app
        await self.app(scope, receive, send)
