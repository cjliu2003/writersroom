# Writersroom Backend API

Backend service for the Writersroom screenwriting app, handling scene memory management and prompt engineering.

## Quick Start

1. **Install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Run development server:**
   ```bash
   npm run dev
   ```

3. **Server will start on:** `http://localhost:3001`

## API Endpoints

### Memory Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/memory/update` | Add/update scene |
| `GET` | `/api/memory/recent?projectId=xxx&count=3` | Get recent scenes |
| `GET` | `/api/memory/by-slugline?projectId=xxx&slugline=xxx` | Get scene by slugline |
| `GET` | `/api/memory/by-character?projectId=xxx&name=xxx` | Get scenes by character |
| `GET` | `/api/memory/by-theme?projectId=xxx&theme=xxx` | Get scenes by theme |
| `GET` | `/api/memory/tokens?projectId=xxx&sceneCount=3` | Get token count |
| `GET` | `/api/memory/all?projectId=xxx` | Get all scenes |
| `GET` | `/api/memory/stats?projectId=xxx` | Get memory stats |
| `DELETE` | `/api/memory/clear?projectId=xxx` | Clear project memory |
| `DELETE` | `/api/memory/scene?projectId=xxx&slugline=xxx` | Delete scene |

### Example Usage

```bash
# Health check
curl http://localhost:3001/api/health

# Add a scene
curl -X POST http://localhost:3001/api/memory/update \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "script_123",
    "slugline": "INT. HOSPITAL - NIGHT", 
    "data": {
      "characters": ["ONDINE", "DR. GALLAGHER"],
      "summary": "Ondine undergoes seizure testing.",
      "tokens": 245,
      "wordCount": 180
    }
  }'

# Get recent scenes
curl http://localhost:3001/api/memory/recent?projectId=script_123&count=3
```

## Project Structure

```
backend/
├── services/
│   └── memoryService.ts    # Core memory logic
├── routes/
│   └── memory.ts          # Express routes
├── server.ts              # Main server file
├── package.json           # Dependencies
└── tsconfig.json          # TypeScript config
```

## Features

- ✅ **Project Namespacing** - Memory isolated by project ID
- ✅ **In-memory Storage** - Fast access (no persistence yet)
- ✅ **Type Safety** - Full TypeScript integration
- ✅ **RESTful API** - Standard HTTP methods
- ✅ **Error Handling** - Comprehensive error responses
- ✅ **CORS Enabled** - Frontend communication ready

## Future Enhancements

- [ ] Database persistence (PostgreSQL/MongoDB)
- [ ] Authentication/authorization
- [ ] Rate limiting
- [ ] WebSocket real-time updates
- [ ] Vector embeddings for AI context