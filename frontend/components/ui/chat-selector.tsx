"use client"

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, Plus, Check, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { type ConversationListItem } from '@/lib/api'

const MAX_TITLE_LENGTH = 60

interface ChatSelectorProps {
  conversations: ConversationListItem[]
  activeConversationId: string | undefined
  onSelect: (conversationId: string) => void
  onNewChat: () => void
  onRename: (conversationId: string, newTitle: string) => void  // Optimistic - no await needed
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

  // Inline rename state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Delete confirmation state
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const pendingDeleteConversation = pendingDeleteId
    ? conversations.find(c => c.conversation_id === pendingDeleteId)
    : null

  const activeConversation = conversations.find(c => c.conversation_id === activeConversationId)
  const displayTitle = activeConversation?.title || 'Untitled'

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

  // Start inline rename mode
  const startEditing = useCallback((conversationId: string, currentTitle: string) => {
    setMenuOpenFor(null)  // Close the actions menu
    setEditingId(conversationId)
    setEditValue(currentTitle)
  }, [])

  // Cancel editing
  const cancelEditing = useCallback(() => {
    setEditingId(null)
    setEditValue('')
  }, [])

  // Save the rename - optimistic update, no waiting
  const saveRename = useCallback((conversationId: string, originalTitle: string) => {
    const trimmedValue = editValue.trim()

    // If empty or unchanged, cancel
    if (!trimmedValue || trimmedValue === originalTitle) {
      cancelEditing()
      return
    }

    // Enforce character limit
    const finalTitle = trimmedValue.slice(0, MAX_TITLE_LENGTH)

    // Optimistic: immediately exit edit mode and trigger the rename
    // The parent will update the UI immediately and handle the API call in background
    setEditingId(null)
    setEditValue('')
    onRename(conversationId, finalTitle)
  }, [editValue, onRename, cancelEditing])

  // Handle keyboard events in the input
  const handleKeyDown = useCallback((e: React.KeyboardEvent, conversationId: string, originalTitle: string) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveRename(conversationId, originalTitle)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEditing()
    }
  }, [saveRename, cancelEditing])

  // Auto-focus and select all when entering edit mode
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

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
        className="w-64 p-0 bg-white border border-gray-200 shadow-lg"
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
              const isEditing = editingId === conv.conversation_id

              return (
                <div
                  key={conv.conversation_id}
                  className={`
                    group flex items-center justify-between px-3 py-2
                    hover:bg-gray-50 transition-colors
                    ${isEditing ? '' : 'cursor-pointer'}
                    ${isActive ? 'bg-purple-50' : ''}
                  `}
                  onClick={() => {
                    // Don't select if editing or if menu is open for this item
                    if (!isEditing && menuOpenFor !== conv.conversation_id) {
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

                    {/* Title and preview - or inline edit input */}
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, conv.conversation_id, conv.title)}
                          onBlur={() => {
                            // Small delay to allow Enter key to fire first
                            setTimeout(() => {
                              if (editingId === conv.conversation_id) {
                                cancelEditing()
                              }
                            }, 150)
                          }}
                          maxLength={MAX_TITLE_LENGTH}
                          className="w-full text-sm font-medium text-gray-700 px-1.5 py-0.5 -ml-1.5 border border-purple-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          onClick={(e) => e.stopPropagation()}
                          placeholder="Chat title..."
                        />
                      ) : (
                        <>
                          <div
                            className="text-sm font-medium text-gray-700 truncate"
                            title={conv.title.length > 30 ? conv.title : undefined}
                          >
                            {conv.title}
                          </div>
                          <div className="text-[10px] text-gray-400 truncate">
                            {conv.last_message_preview || formatRelativeTime(conv.updated_at)}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions menu - hidden when editing */}
                  {!isEditing && (
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
                      <PopoverContent className="w-32 p-1 bg-white border border-gray-200 shadow-lg" align="end" side="right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            startEditing(conv.conversation_id, conv.title)
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
                            setPendingDeleteId(conv.conversation_id)
                          }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              )
            })
          )}
        </div>
      </PopoverContent>

      {/* Delete Confirmation Dialog */}
      <Dialog open={pendingDeleteId !== null} onOpenChange={(isOpen) => !isOpen && setPendingDeleteId(null)}>
        <DialogContent className="sm:max-w-[400px]" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete chat?</DialogTitle>
            <DialogDescription>
              {pendingDeleteConversation && (
                <>
                  Are you sure you want to delete &ldquo;{pendingDeleteConversation.title}&rdquo;?
                  This action cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setPendingDeleteId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDeleteId) {
                  onDelete(pendingDeleteId)
                  setPendingDeleteId(null)
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Popover>
  )
}
