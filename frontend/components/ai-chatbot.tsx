"use client"

import React, { useState, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Send, Loader2, ChevronDown, ChevronLeft, ChevronRight, Sparkles, PanelLeft, PanelRight, PanelBottom } from "lucide-react"
import { sendChatMessage, type ChatMessage } from "@/lib/api"
import { type ChatPosition } from "@/utils/layoutPrefs"

interface AIChatbotProps {
  projectId?: string
  scriptTitle?: string
  isVisible?: boolean
  isCollapsed?: boolean
  onCollapseToggle?: () => void
  position?: ChatPosition
  onPositionChange?: (position: ChatPosition) => void
  // Toolbar states for collision avoidance when collapsed on left/right
  isTopBarCollapsed?: boolean
  isSceneNavCollapsed?: boolean
}

export function AIChatbot({
  projectId,
  scriptTitle,
  isVisible = true,
  isCollapsed = false,
  onCollapseToggle,
  position = 'bottom',
  onPositionChange,
  isTopBarCollapsed = false,
  isSceneNavCollapsed = false
}: AIChatbotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
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
    inputRef.current?.focus()

    // Scroll immediately when user sends message
    scrollToBottom()

    try {
      const response = await sendChatMessage({
        script_id: projectId,
        messages: [...messages, userMessage],
        include_scenes: true
      })

      if (response.success && response.message) {
        setMessages(prev => [...prev, response.message!])
      } else {
        throw new Error(response.error || 'Failed to get response')
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
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Generate personalized placeholder
  const getPlaceholder = () => {
    if (!projectId) return "Select a project to start..."
    if (scriptTitle) return `Let's talk about ${scriptTitle.toUpperCase()}...`
    return "Let's talk about your screenplay..."
  }

  if (!isVisible) return null

  // Collapsed state - subtle tab that matches the expanded header
  if (isCollapsed) {
    // Position-specific styling for collapsed tab
    const collapsedStyles = {
      bottom: {
        container: "flex justify-start",
        button: "flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-700 border border-gray-200 border-b-0 rounded-t-lg px-5 py-2 transition-all duration-200 shadow-sm hover:shadow-md",
      },
      left: {
        container: "flex flex-col justify-end h-full pb-4",
        button: "flex items-center gap-1.5 bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-700 border border-gray-200 border-l-0 rounded-r-md px-1.5 py-3 transition-all duration-200 shadow-sm hover:shadow-md",
      },
      right: {
        container: "flex flex-col justify-end h-full pb-4",
        button: "flex items-center gap-1.5 bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-700 border border-gray-200 border-r-0 rounded-l-md px-1.5 py-3 transition-all duration-200 shadow-sm hover:shadow-md",
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
          title="Open AI Assistant"
        >
          <Sparkles className="w-3 h-3 text-purple-400" />
          <span className="text-[10px] uppercase tracking-wide">AI</span>
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
      className={`h-full flex flex-col bg-white border border-gray-200 shadow-xl overflow-hidden ${panelStyles.container}`}
      style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}
      onClick={handlePanelClick}
    >
      {/* Header - Compact */}
      <div className={`h-7 min-h-[28px] border-b border-gray-100 bg-gray-50/80 px-3 flex items-center justify-between ${panelStyles.header}`}>
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-purple-500" />
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">AI</span>
        </div>

        <div className="flex items-center gap-0.5">
          {/* Position toggle button - cycles through positions */}
          {onPositionChange && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const positions: ChatPosition[] = ['bottom', 'right', 'left'];
                const currentIndex = positions.indexOf(position);
                const nextIndex = (currentIndex + 1) % positions.length;
                onPositionChange(positions[nextIndex]);
              }}
              className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded p-0.5"
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
          <Button
            variant="ghost"
            size="sm"
            onClick={onCollapseToggle}
            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded p-0.5 -mr-1"
            title="Minimize"
          >
            <CollapseIcon className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full" ref={scrollAreaRef}>
          <div className="p-3 space-y-3">
            {messages.length === 0 ? (
              <div className="py-6 text-center">
                <Sparkles className="w-6 h-6 text-purple-200 mx-auto mb-2" />
                <p className="text-[12pt] text-gray-500 leading-relaxed">
                  {scriptTitle ? (
                    <>Let&apos;s talk about {scriptTitle.toUpperCase()}...</>
                  ) : (
                    <>Let&apos;s talk about your screenplay...</>
                  )}
                </p>
                <p className="text-[10pt] text-gray-400 mt-1">
                  Ask about characters, plot, structure, or anything else!
                </p>
              </div>
            ) : (
              messages.map((message, index) => (
                <div
                  key={index}
                  className={`text-[12pt] leading-[16pt] rounded px-2 py-1.5 ${
                    message.role === 'user'
                      ? 'text-black'
                      : 'text-black bg-purple-50/70 border-l-2 border-purple-300'
                  }`}
                >
                  {message.role === 'user' && (
                    <span className="text-purple-500 font-medium mr-1.5">&gt;</span>
                  )}
                  <span className="whitespace-pre-wrap">{message.content}</span>
                </div>
              ))
            )}

            {isLoading && (
              <div className="text-[12pt] leading-[16pt] text-gray-600 bg-purple-50/70 border-l-2 border-purple-300 rounded px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-500" />
                  <span>Thinking...</span>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 bg-gray-100 p-2 px-3">
        <div className="flex items-start gap-2">
          <span className="text-purple-500 text-[12pt] font-medium leading-[20px]">&gt;</span>
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={getPlaceholder()}
            disabled={!projectId}
            rows={1}
            className="flex-1 bg-transparent text-[12pt] text-black placeholder-gray-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed resize-none leading-[20px]"
            style={{ fontFamily: "inherit", fieldSizing: "content" } as React.CSSProperties}
          />
          <Button
            onClick={sendMessage}
            disabled={!inputValue.trim() || !projectId || isLoading}
            size="sm"
            variant="ghost"
            className="text-gray-500 hover:text-purple-600 hover:bg-purple-50 p-1.5"
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
