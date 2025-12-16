"use client"

import React, { useState, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Send, Loader2, ChevronDown, ChevronLeft, ChevronRight, Sparkles, PanelLeft, PanelRight, PanelBottom, Trash2 } from "lucide-react"
import { sendChatMessageWithStatusStream, type ChatMessage, type ToolCallMetadata, type ChatStreamEvent } from "@/lib/api"
import { type ChatPosition } from "@/utils/layoutPrefs"

interface AIChatbotProps {
  projectId?: string
  scriptTitle?: string
  isVisible?: boolean
  currentSceneId?: string
  isCollapsed?: boolean
  onCollapseToggle?: () => void
  position?: ChatPosition
  onPositionChange?: (position: ChatPosition) => void
  // Toolbar states for collision avoidance when collapsed on left/right
  isTopBarCollapsed?: boolean
  isSceneNavCollapsed?: boolean
}

// Extended message type to include tool metadata
interface ExtendedChatMessage extends ChatMessage {
  tool_metadata?: ToolCallMetadata
}

export function AIChatbot({
  projectId,
  scriptTitle,
  isVisible = true,
  currentSceneId,
  isCollapsed = false,
  onCollapseToggle,
  position = 'bottom',
  onPositionChange,
  isTopBarCollapsed = false,
  isSceneNavCollapsed = false
}: AIChatbotProps) {
  const [messages, setMessages] = useState<ExtendedChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string>('')  // Real-time status from AI
  const [conversationId, setConversationId] = useState<string | undefined>(undefined)
  const [showClearConfirm, setShowClearConfirm] = useState(false)  // Confirmation state for clear
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Helper to scroll chat to bottom
  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
    })
  }

  // Load conversation history from localStorage
  useEffect(() => {
    if (projectId) {
      const saved = localStorage.getItem(`chat-${projectId}`)
      if (saved) {
        try {
          const savedMessages = JSON.parse(saved)
          setMessages(savedMessages)
        } catch (error) {
          console.error('Failed to load chat history:', error)
        }
      }
    }
  }, [projectId])

  // Save conversation history to localStorage
  useEffect(() => {
    if (projectId && messages.length > 0) {
      localStorage.setItem(`chat-${projectId}`, JSON.stringify(messages))
    }
  }, [projectId, messages])

  // Auto-scroll to bottom when new messages arrive (e.g., AI response)
  useEffect(() => {
    if (scrollAreaRef.current && messages.length > 0) {
      scrollToBottom()
    }
  }, [messages])

  // Focus input when expanded
  useEffect(() => {
    if (!isCollapsed && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isCollapsed])

  const sendMessage = async () => {
    if (!inputValue.trim() || !projectId || isLoading) return

    const userMessage: ChatMessage = {
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)
    setStatusMessage('Thinking...')
    inputRef.current?.focus()

    // Scroll immediately when user sends message
    scrollToBottom()

    try {
      // Use streaming endpoint with real-time status updates
      const stream = sendChatMessageWithStatusStream({
        script_id: projectId,
        conversation_id: conversationId,
        current_scene_id: currentSceneId,
        message: userMessage.content,
        budget_tier: 'standard' // Can be 'quick', 'standard', or 'deep'
      })

      let finalMessage = ''
      let toolMetadata: ToolCallMetadata | undefined

      // Process SSE events as they arrive
      for await (const event of stream) {
        switch (event.type) {
          case 'thinking':
            setStatusMessage(event.message)
            break

          case 'status':
            // User-friendly status messages from tool execution
            setStatusMessage(event.message)
            break

          case 'complete':
            finalMessage = event.message
            toolMetadata = event.tool_metadata as ToolCallMetadata | undefined
            setStatusMessage('')

            // Log usage metrics for debugging
            console.log('AI Response Complete:', {
              output_tokens: event.usage.output_tokens,
              cache_read: event.usage.cache_read_input_tokens,
              tool_metadata: toolMetadata || null
            })
            break

          case 'stream_end':
            // Update conversation ID for future messages
            if (!conversationId && event.conversation_id) {
              setConversationId(event.conversation_id)
            }
            break
        }
      }

      // Create assistant message from final response
      if (finalMessage) {
        const assistantMessage: ExtendedChatMessage = {
          role: 'assistant',
          content: finalMessage,
          timestamp: new Date().toISOString(),
          tool_metadata: toolMetadata
        }
        setMessages(prev => [...prev, assistantMessage])
      }

    } catch (error) {
      console.error('Chat error:', error)
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
      setStatusMessage('')
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Clear chat history (both localStorage and state)
  const clearChat = () => {
    if (projectId) {
      localStorage.removeItem(`chat-${projectId}`)
    }
    setMessages([])
    setConversationId(undefined)
    setShowClearConfirm(false)
    inputRef.current?.focus()
  }

  // Generate personalized placeholder
  const getPlaceholder = () => {
    if (!projectId) return "Select a project to start..."
    if (scriptTitle) return `Ask about ${scriptTitle}...`
    return "Ask about your screenplay..."
  }

  if (!isVisible) return null

  // Collapsed state - subtle tab that matches the expanded header
  if (isCollapsed) {
    // Position-specific styling for collapsed tab
    const collapsedStyles = {
      bottom: {
        container: "flex justify-start",
        button: "flex items-center gap-2 bg-slate-50/95 hover:bg-slate-100 text-slate-500 hover:text-slate-700 border border-slate-200/80 border-b-0 rounded-t-lg px-4 py-2 transition-all duration-200 shadow-lg shadow-black/10 hover:shadow-xl backdrop-blur-sm",
      },
      left: {
        container: "flex flex-col justify-end h-full pb-4",
        button: "flex items-center gap-1.5 bg-slate-50/95 hover:bg-slate-100 text-slate-500 hover:text-slate-700 border border-slate-200/80 border-l-0 rounded-r-lg px-2 py-3 transition-all duration-200 shadow-lg shadow-black/10 hover:shadow-xl backdrop-blur-sm",
      },
      right: {
        container: "flex flex-col justify-end h-full pb-4",
        button: "flex items-center gap-1.5 bg-slate-50/95 hover:bg-slate-100 text-slate-500 hover:text-slate-700 border border-slate-200/80 border-r-0 rounded-l-lg px-2 py-3 transition-all duration-200 shadow-lg shadow-black/10 hover:shadow-xl backdrop-blur-sm",
      }
    }

    const styles = collapsedStyles[position]

    // Text faces outward toward screen edge:
    // LEFT: vertical-lr → characters face LEFT (outward), reads bottom-to-top
    // RIGHT: vertical-rl → characters face RIGHT (outward), reads top-to-bottom
    const getWritingMode = () => {
      if (position === 'left') return 'vertical-lr'
      if (position === 'right') return 'vertical-rl'
      return undefined
    }

    const isVertical = position === 'left' || position === 'right'

    return (
      <div className={styles.container}>
        <button
          onClick={onCollapseToggle}
          className={styles.button}
          style={{
            fontFamily: "var(--font-courier-prime), 'Courier New', monospace",
            writingMode: getWritingMode(),
            textOrientation: isVertical ? 'mixed' : undefined
          }}
          title="Open The Room"
        >
          <Sparkles className="w-3 h-3 text-purple-500" />
          <span className="text-[9px] uppercase tracking-widest font-medium">The Room</span>
        </button>
      </div>
    )
  }

  // Position-specific styling for expanded panel
  const expandedStyles = {
    bottom: {
      container: "rounded-t-xl border-b-0",
      header: "rounded-t-xl",
    },
    left: {
      container: "rounded-r-xl border-l-0",
      header: "rounded-tr-xl",
    },
    right: {
      container: "rounded-l-xl border-r-0",
      header: "rounded-tl-xl",
    }
  }

  const panelStyles = expandedStyles[position]

  // Get the appropriate collapse icon based on position
  const CollapseIcon = position === 'left' ? ChevronLeft : position === 'right' ? ChevronRight : ChevronDown

  // Focus input when clicking anywhere in chat panel (except buttons)
  const handlePanelClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest('button') && !target.closest('input')) {
      inputRef.current?.focus()
    }
  }

  // Expanded state - popup chat interface
  return (
    <div
      className={`h-full flex flex-col bg-slate-50/95 border border-slate-200/80 shadow-2xl shadow-black/15 backdrop-blur-sm overflow-hidden ${panelStyles.container}`}
      style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}
      onClick={handlePanelClick}
    >
      {/* Header - Compact */}
      <div className={`h-8 min-h-[32px] border-b border-slate-200/60 bg-gradient-to-r from-slate-100/90 to-purple-50/40 px-3 flex items-center justify-between ${panelStyles.header}`}>
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-purple-500" />
          <span className="text-[10px] text-slate-600 uppercase tracking-widest font-medium">The Room</span>
        </div>

        <div className="flex items-center gap-0.5">
          {/* Clear chat button - only show when there are messages */}
          {messages.length > 0 && !showClearConfirm && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowClearConfirm(true)}
              className="text-slate-400 hover:text-red-500 hover:bg-red-50/80 rounded p-0.5"
              title="Clear chat"
              disabled={isLoading}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
          {/* Clear confirmation */}
          {showClearConfirm && (
            <div className="flex items-center gap-1 text-[9px]">
              <span className="text-slate-500">Clear?</span>
              <button
                onClick={clearChat}
                className="text-red-500 hover:text-red-700 font-medium px-1"
              >
                Yes
              </button>
              <button
                onClick={() => setShowClearConfirm(false)}
                className="text-slate-500 hover:text-slate-700 px-1"
              >
                No
              </button>
            </div>
          )}
          {/* Position toggle button - cycles through positions */}
          {onPositionChange && !showClearConfirm && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const positions: ChatPosition[] = ['bottom', 'right', 'left'];
                const currentIndex = positions.indexOf(position);
                const nextIndex = (currentIndex + 1) % positions.length;
                onPositionChange(positions[nextIndex]);
              }}
              className="text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded p-0.5"
              title={`Move to ${position === 'bottom' ? 'right' : position === 'right' ? 'left' : 'bottom'}`}
            >
              {position === 'bottom' ? (
                <PanelRight className="w-3.5 h-3.5" />
              ) : position === 'right' ? (
                <PanelLeft className="w-3.5 h-3.5" />
              ) : (
                <PanelBottom className="w-3.5 h-3.5" />
              )}
            </Button>
          )}
          {/* Collapse button */}
          {!showClearConfirm && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCollapseToggle}
              className="text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded p-0.5 -mr-1"
              title="Minimize"
            >
              <CollapseIcon className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full" ref={scrollAreaRef}>
          <div className="p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="py-8 text-center">
                <Sparkles className="w-5 h-5 text-purple-300 mx-auto mb-3" />
                <p className="text-[11pt] text-slate-500 leading-relaxed">
                  {scriptTitle ? (
                    <>Let&apos;s talk about <span className="text-slate-600 font-medium">{scriptTitle.toUpperCase()}</span>...</>
                  ) : (
                    <>Let&apos;s talk about your screenplay...</>
                  )}
                </p>
                <p className="text-[9pt] text-slate-400 mt-2">
                  Ask about characters, plot, structure, or anything else
                </p>
              </div>
            ) : (
              messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in-0 slide-in-from-bottom-2 duration-200`}
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <div
                    className={`max-w-[85%] text-[11pt] leading-[16pt] px-3.5 py-2 ${
                      message.role === 'user'
                        ? 'bg-purple-600 text-white rounded-2xl rounded-br-md shadow-sm'
                        : 'bg-white text-slate-700 border border-slate-200/80 rounded-2xl rounded-bl-md shadow-sm'
                    }`}
                  >
                    <p className="whitespace-pre-wrap m-0">{message.content}</p>
                  </div>
                </div>
              ))
            )}

            {isLoading && (
              <div className="flex justify-start animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
                <div className="bg-white text-slate-500 border border-slate-200/80 rounded-2xl rounded-bl-md shadow-sm px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </div>
                    <span className="text-[10pt] text-slate-400">{statusMessage || 'Thinking...'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Input */}
      <div className="border-t border-slate-200/60 bg-slate-100/80 p-3">
        <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200/80 px-3 py-2.5 shadow-sm">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={getPlaceholder()}
            disabled={!projectId}
            rows={1}
            className="flex-1 bg-transparent text-[11pt] text-slate-700 placeholder-slate-400 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed resize-none leading-[20px] min-h-[20px] py-0"
            style={{ fontFamily: "inherit", fieldSizing: "content" } as React.CSSProperties}
          />
          <Button
            onClick={sendMessage}
            disabled={!inputValue.trim() || !projectId || isLoading}
            size="sm"
            className={`p-1.5 rounded-lg transition-all duration-150 flex-shrink-0 ${
              inputValue.trim() && projectId && !isLoading
                ? 'bg-purple-600 text-white hover:bg-purple-700 shadow-sm'
                : 'bg-slate-100 text-slate-400'
            }`}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
