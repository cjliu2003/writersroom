"use client"

import React, { useState, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Send, Loader2, ChevronDown, Sparkles } from "lucide-react"
import { sendChatMessage, type ChatMessage } from "@/lib/api"

interface AIChatbotProps {
  projectId?: string
  scriptTitle?: string
  isVisible?: boolean
  isCollapsed?: boolean
  onCollapseToggle?: () => void
}

export function AIChatbot({
  projectId,
  scriptTitle,
  isVisible = true,
  isCollapsed = false,
  onCollapseToggle
}: AIChatbotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
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

  // Collapsed state - subtle tab that matches the expanded header, aligned left
  if (isCollapsed) {
    return (
      <div className="flex justify-start">
        <button
          onClick={onCollapseToggle}
          className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-700 border border-gray-200 border-b-0 rounded-t-lg px-5 py-2 transition-all duration-200 shadow-sm hover:shadow-md"
          style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}
          title="Open AI Assistant"
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-[11px] uppercase tracking-wide">AI</span>
        </button>
      </div>
    )
  }

  // Expanded state - popup chat interface
  return (
    <div
      className="h-full flex flex-col bg-white rounded-t-xl border border-gray-200 border-b-0 shadow-xl overflow-hidden"
      style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}
    >
      {/* Header - Compact */}
      <div className="h-7 min-h-[28px] border-b border-gray-100 bg-gray-50/80 px-3 flex items-center justify-between rounded-t-xl">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-purple-500" />
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">AI</span>
        </div>

        <div className="flex items-center">
          {/* Collapse button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onCollapseToggle}
            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded p-0.5 -mr-1"
            title="Minimize"
          >
            <ChevronDown className="w-3.5 h-3.5" />
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
                    <>Let's talk about {scriptTitle.toUpperCase()}...</>
                  ) : (
                    <>Let's talk about your screenplay...</>
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
        <div className="flex items-center gap-2">
          <span className="text-purple-500 text-[12pt] font-medium">&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={getPlaceholder()}
            disabled={!projectId || isLoading}
            className="flex-1 bg-transparent text-[12pt] text-black placeholder-gray-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontFamily: "inherit" }}
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
