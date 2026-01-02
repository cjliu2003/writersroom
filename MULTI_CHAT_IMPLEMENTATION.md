# Multi-Chat Implementation Design

## Overview

Enable users to have multiple chat conversations per script, with the ability to create new chats, switch between existing chats, and rename/delete chats.

## Database Schema

**No changes needed** - existing schema already supports multiple conversations per user+script.

```
ChatConversation
├── conversation_id (PK)
├── user_id (FK → users)
├── script_id (FK → scripts)
├── title (string, default: "New Chat")
├── created_at
├── updated_at
└── messages[] (1:many → ChatMessage)
```

## Backend API Design

### 1. List Conversations for Script

```
GET /api/ai/chat/script/{script_id}/conversations
```

**Response:**
```json
{
  "conversations": [
    {
      "conversation_id": "uuid",
      "title": "Character arc discussion",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T14:22:00Z",
      "message_count": 12,
      "last_message_preview": "What about the protagonist's..."
    }
  ]
}
```

**Implementation (ai_router.py):**
```python
@router.get("/chat/script/{script_id}/conversations")
async def list_conversations_for_script(
    script_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List all conversations for a user+script."""
    result = await db.execute(
        select(ChatConversation)
        .options(noload('*'))
        .where(
            ChatConversation.script_id == script_id,
            ChatConversation.user_id == current_user.user_id
        )
        .order_by(ChatConversation.updated_at.desc())
    )
    conversations = result.scalars().all()

    # Get message counts and previews
    conversation_list = []
    for conv in conversations:
        # Get message count and last message
        msg_result = await db.execute(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conv.conversation_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(1)
        )
        last_msg = msg_result.scalar_one_or_none()

        count_result = await db.execute(
            select(func.count(ChatMessage.message_id))
            .where(ChatMessage.conversation_id == conv.conversation_id)
        )
        msg_count = count_result.scalar() or 0

        conversation_list.append({
            "conversation_id": str(conv.conversation_id),
            "title": conv.title,
            "created_at": conv.created_at.isoformat(),
            "updated_at": conv.updated_at.isoformat(),
            "message_count": msg_count,
            "last_message_preview": (last_msg.content[:50] + "...") if last_msg and len(last_msg.content) > 50 else (last_msg.content if last_msg else None)
        })

    return {"conversations": conversation_list}
```

### 2. Create New Conversation

```
POST /api/ai/chat/script/{script_id}/conversations
```

**Request:**
```json
{
  "title": "New Chat"  // optional
}
```

**Response:**
```json
{
  "conversation_id": "uuid",
  "title": "New Chat",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z",
  "message_count": 0
}
```

**Implementation:**
```python
class CreateConversationRequest(BaseModel):
    title: Optional[str] = Field("New Chat", max_length=255)

@router.post("/chat/script/{script_id}/conversations")
async def create_conversation(
    script_id: UUID,
    request: CreateConversationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create a new conversation for a script."""
    conversation = ChatConversation(
        user_id=current_user.user_id,
        script_id=script_id,
        title=request.title or "New Chat"
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)

    return {
        "conversation_id": str(conversation.conversation_id),
        "title": conversation.title,
        "created_at": conversation.created_at.isoformat(),
        "updated_at": conversation.updated_at.isoformat(),
        "message_count": 0
    }
```

### 3. Update Conversation (Rename)

```
PATCH /api/ai/chat/conversations/{conversation_id}
```

**Request:**
```json
{
  "title": "Renamed conversation"
}
```

**Response:**
```json
{
  "conversation_id": "uuid",
  "title": "Renamed conversation",
  "updated_at": "2024-01-15T14:30:00Z"
}
```

**Implementation:**
```python
class UpdateConversationRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)

@router.patch("/chat/conversations/{conversation_id}")
async def update_conversation(
    conversation_id: UUID,
    request: UpdateConversationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update conversation (rename)."""
    result = await db.execute(
        select(ChatConversation)
        .where(ChatConversation.conversation_id == conversation_id)
    )
    conversation = result.scalar_one_or_none()

    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if conversation.user_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    conversation.title = request.title
    await db.commit()
    await db.refresh(conversation)

    return {
        "conversation_id": str(conversation.conversation_id),
        "title": conversation.title,
        "updated_at": conversation.updated_at.isoformat()
    }
```

### 4. Existing Endpoints (Keep As-Is)

- `DELETE /api/ai/chat/conversations/{conversation_id}` - Already works
- `GET /api/ai/chat/conversations/{conversation_id}` - Get single conversation with messages

### 5. Remove Legacy Endpoint

Delete `GET /api/ai/chat/script/{script_id}/conversation` (singular) - replaced by list endpoint.

---

## Frontend API Client

**File: `frontend/lib/api.ts`**

### New Types

```typescript
// Conversation list item (without messages)
export interface ConversationListItem {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_preview: string | null;
}

// Response for listing conversations
export interface ConversationListResponse {
  conversations: ConversationListItem[];
}
```

### New Functions

```typescript
// List all conversations for a script
export async function listConversations(scriptId: string): Promise<ConversationListResponse> {
  const response = await authenticatedFetch(`/ai/chat/script/${scriptId}/conversations`);
  if (!response.ok) {
    throw new Error('Failed to fetch conversations');
  }
  return response.json();
}

// Create a new conversation
export async function createConversation(
  scriptId: string,
  title?: string
): Promise<ConversationListItem> {
  const response = await authenticatedFetch(`/ai/chat/script/${scriptId}/conversations`, {
    method: 'POST',
    body: JSON.stringify({ title: title || 'New Chat' }),
  });
  if (!response.ok) {
    throw new Error('Failed to create conversation');
  }
  return response.json();
}

// Rename a conversation
export async function renameConversation(
  conversationId: string,
  title: string
): Promise<{ conversation_id: string; title: string; updated_at: string }> {
  const response = await authenticatedFetch(`/ai/chat/conversations/${conversationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw new Error('Failed to rename conversation');
  }
  return response.json();
}

// Get conversation with messages (for loading a specific chat)
export async function getConversation(conversationId: string): Promise<ConversationHistoryResponse> {
  const response = await authenticatedFetch(`/ai/chat/conversations/${conversationId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch conversation');
  }
  return response.json();
}
```

### Remove

- `getConversationForScript()` - replaced by `listConversations()` + `getConversation()`

---

## Frontend UI Component

### Chat Selector Popover

**File: `frontend/components/ui/chat-selector.tsx`**

```tsx
"use client"

import React, { useState } from 'react'
import { ChevronDown, Plus, Check, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { type ConversationListItem } from '@/lib/api'

interface ChatSelectorProps {
  conversations: ConversationListItem[]
  activeConversationId: string | undefined
  onSelect: (conversationId: string) => void
  onNewChat: () => void
  onRename: (conversationId: string, currentTitle: string) => void
  onDelete: (conversationId: string) => void
  disabled?: boolean
}

export function ChatSelector({
  conversations,
  activeConversationId,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  disabled = false
}: ChatSelectorProps) {
  const [open, setOpen] = useState(false)
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null)

  const activeConversation = conversations.find(c => c.conversation_id === activeConversationId)
  const displayTitle = activeConversation?.title || 'The Room'

  // Format relative time (e.g., "2h ago", "Yesterday")
  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          className="flex items-center gap-1 hover:opacity-80 transition-opacity disabled:opacity-50"
        >
          <span className="text-[10px] text-gray-600 uppercase tracking-widest font-medium truncate max-w-[120px]">
            {displayTitle}
          </span>
          <ChevronDown className="w-3 h-3 text-gray-400" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-64 p-0"
        align="start"
        sideOffset={8}
      >
        {/* New Chat Button */}
        <button
          onClick={() => {
            onNewChat()
            setOpen(false)
          }}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-purple-600 hover:bg-purple-50 transition-colors border-b border-gray-100"
        >
          <Plus className="w-4 h-4" />
          <span className="font-medium">New chat</span>
        </button>

        {/* Conversations List */}
        <div className="max-h-[280px] overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">
              No chats yet
            </div>
          ) : (
            conversations.map((conv) => {
              const isActive = conv.conversation_id === activeConversationId
              return (
                <div
                  key={conv.conversation_id}
                  className={`
                    group flex items-center justify-between px-3 py-2
                    hover:bg-gray-50 transition-colors cursor-pointer
                    ${isActive ? 'bg-purple-50' : ''}
                  `}
                  onClick={() => {
                    if (menuOpenFor !== conv.conversation_id) {
                      onSelect(conv.conversation_id)
                      setOpen(false)
                    }
                  }}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {/* Checkmark for active */}
                    <div className="w-4 flex-shrink-0">
                      {isActive && <Check className="w-4 h-4 text-purple-600" />}
                    </div>

                    {/* Title and preview */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-700 truncate">
                        {conv.title}
                      </div>
                      <div className="text-[10px] text-gray-400 truncate">
                        {conv.last_message_preview || formatRelativeTime(conv.updated_at)}
                      </div>
                    </div>
                  </div>

                  {/* Actions menu */}
                  <Popover
                    open={menuOpenFor === conv.conversation_id}
                    onOpenChange={(isOpen) => setMenuOpenFor(isOpen ? conv.conversation_id : null)}
                  >
                    <PopoverTrigger asChild>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setMenuOpenFor(menuOpenFor === conv.conversation_id ? null : conv.conversation_id)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded transition-all"
                      >
                        <MoreHorizontal className="w-4 h-4 text-gray-400" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-32 p-1" align="end" side="right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setMenuOpenFor(null)
                          setOpen(false)
                          onRename(conv.conversation_id, conv.title)
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Rename
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setMenuOpenFor(null)
                          setOpen(false)
                          onDelete(conv.conversation_id)
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </PopoverContent>
                  </Popover>
                </div>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

---

## AI Chatbot Integration

**File: `frontend/components/ai-chatbot.tsx`**

### State Changes

```tsx
// Replace single conversationId with multi-conversation state
const [conversations, setConversations] = useState<ConversationListItem[]>([])
const [activeConversationId, setActiveConversationId] = useState<string | undefined>()
const [messages, setMessages] = useState<ExtendedChatMessage[]>([])

// Draft preservation per conversation
const draftsRef = useRef<Map<string, string>>(new Map())
```

### Load Conversations on Mount

```tsx
useEffect(() => {
  if (!projectId) return

  const loadConversations = async () => {
    try {
      const response = await listConversations(projectId)
      setConversations(response.conversations)

      // Auto-select most recent conversation if exists
      if (response.conversations.length > 0) {
        const mostRecent = response.conversations[0]
        await switchToConversation(mostRecent.conversation_id)
      }
    } catch (error) {
      console.error('[AIChatbot] Failed to load conversations:', error)
    }
  }

  loadConversations()
}, [projectId])
```

### Switch Conversation

```tsx
const switchToConversation = async (conversationId: string) => {
  // Save current draft
  if (activeConversationId && inputValue.trim()) {
    draftsRef.current.set(activeConversationId, inputValue)
  }

  // Load conversation messages
  try {
    const response = await getConversation(conversationId)
    const loadedMessages: ExtendedChatMessage[] = response.messages
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        timestamp: msg.created_at
      }))

    setMessages(loadedMessages)
    setActiveConversationId(conversationId)

    // Restore draft if exists
    const savedDraft = draftsRef.current.get(conversationId) || ''
    setInputValue(savedDraft)
  } catch (error) {
    console.error('[AIChatbot] Failed to load conversation:', error)
  }
}
```

### Create New Chat

```tsx
const handleNewChat = async () => {
  if (!projectId) return

  // Save current draft
  if (activeConversationId && inputValue.trim()) {
    draftsRef.current.set(activeConversationId, inputValue)
  }

  try {
    const newConv = await createConversation(projectId)
    setConversations(prev => [newConv, ...prev])
    setActiveConversationId(newConv.conversation_id)
    setMessages([])
    setInputValue('')
  } catch (error) {
    console.error('[AIChatbot] Failed to create conversation:', error)
  }
}
```

### Rename Chat

```tsx
const handleRename = async (conversationId: string, currentTitle: string) => {
  const newTitle = window.prompt('Rename chat:', currentTitle)
  if (!newTitle || newTitle === currentTitle) return

  try {
    await renameConversation(conversationId, newTitle)
    setConversations(prev => prev.map(c =>
      c.conversation_id === conversationId
        ? { ...c, title: newTitle }
        : c
    ))
  } catch (error) {
    console.error('[AIChatbot] Failed to rename conversation:', error)
  }
}
```

### Delete Chat

```tsx
const handleDelete = async (conversationId: string) => {
  if (!confirm('Delete this chat?')) return

  try {
    await deleteConversation(conversationId)
    setConversations(prev => prev.filter(c => c.conversation_id !== conversationId))

    // If deleted active conversation, switch to another or clear
    if (conversationId === activeConversationId) {
      const remaining = conversations.filter(c => c.conversation_id !== conversationId)
      if (remaining.length > 0) {
        await switchToConversation(remaining[0].conversation_id)
      } else {
        setActiveConversationId(undefined)
        setMessages([])
      }
    }
  } catch (error) {
    console.error('[AIChatbot] Failed to delete conversation:', error)
  }
}
```

### Update Header

Replace static "The Room" title with ChatSelector:

```tsx
{/* Header */}
<div className="...">
  <div className="flex items-center gap-1.5">
    <Sparkles className="w-3 h-3 text-purple-500" />
    <ChatSelector
      conversations={conversations}
      activeConversationId={activeConversationId}
      onSelect={switchToConversation}
      onNewChat={handleNewChat}
      onRename={handleRename}
      onDelete={handleDelete}
      disabled={isLoading}
    />
  </div>
  {/* ... rest of header */}
</div>
```

### Update sendMessage

After successful response, update conversation list to reflect new message:

```tsx
// After adding assistant message to state
setConversations(prev => prev.map(c =>
  c.conversation_id === activeConversationId
    ? {
        ...c,
        updated_at: new Date().toISOString(),
        message_count: c.message_count + 2, // user + assistant
        last_message_preview: finalMessage.slice(0, 50) + (finalMessage.length > 50 ? '...' : '')
      }
    : c
))
```

---

## Implementation Order

1. **Backend endpoints** (ai_router.py)
   - [ ] `GET /chat/script/{script_id}/conversations`
   - [ ] `POST /chat/script/{script_id}/conversations`
   - [ ] `PATCH /chat/conversations/{conversation_id}`
   - [ ] Remove legacy `GET /chat/script/{script_id}/conversation`

2. **Frontend API client** (lib/api.ts)
   - [ ] Add `ConversationListItem` type
   - [ ] Add `listConversations()`
   - [ ] Add `createConversation()`
   - [ ] Add `renameConversation()`
   - [ ] Update `getConversation()` (already exists, may need tweaks)
   - [ ] Remove `getConversationForScript()`

3. **Frontend components**
   - [ ] Create `ChatSelector` component
   - [ ] Update `ai-chatbot.tsx` with multi-conversation state
   - [ ] Add draft preservation logic
   - [ ] Integrate ChatSelector into header

4. **Testing**
   - [ ] Test conversation CRUD operations
   - [ ] Test switching between conversations
   - [ ] Test draft preservation
   - [ ] Test empty state (no conversations)
