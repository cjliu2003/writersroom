"use client"

import React, { useState, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MessageCircle, Send, Loader2, Sparkles } from "lucide-react"

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp?: string
}

interface AIChatbotProps {
  projectId?: string
  isVisible?: boolean
}

export function AIChatbot({ projectId, isVisible = true }: AIChatbotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const scrollViewportRef = useRef<HTMLDivElement>(null)
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
    if (scrollViewportRef.current) {
      scrollViewportRef.current.scrollTop = scrollViewportRef.current.scrollHeight
    }
  }, [messages])

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
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId,
          messages: [...messages, userMessage],
          includeScenes: true
        })
      })

      const data = await response.json()

      if (data.success && data.message) {
        setMessages(prev => [...prev, data.message])
      } else {
        throw new Error(data.error || 'Failed to get response')
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

  if (!isVisible) return null

  return (
    <div className="h-[calc(100vh-112px)] flex flex-col bg-gradient-to-br from-purple-50/40 to-pink-50 shadow-2xl drop-shadow-lg border-l border-slate-200/50 overflow-hidden rounded-lg backdrop-blur-sm">
      {/* Header */}
      <div className="border-b border-slate-200/80 bg-white/95 backdrop-blur-md p-4 flex items-center gap-2 shadow-sm">
        <div className="w-6 h-6 bg-purple-100 rounded flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-purple-600" />
        </div>
        <h3 className="font-semibold text-slate-700">AI Assistant</h3>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full p-4">
          <div className="space-y-4" ref={scrollViewportRef}>
            {messages.length === 0 ? (
              <div className="p-6 text-center">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-sm">
                  <MessageCircle className="w-6 h-6 text-purple-400" />
                </div>
                <p className="text-sm text-gray-500 mb-2 font-medium">Start a conversation</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Ask me about your screenplay, characters, plot structure, or get writing advice.
                </p>
              </div>
            ) : (
              messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                      message.role === 'user'
                        ? 'bg-purple-600 text-white'
                        : 'bg-white/70 border border-slate-200 text-slate-700'
                    }`}
                  >
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {message.content}
                    </p>
                  </div>
                </div>
              ))
            )}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white/70 border border-slate-200 rounded-2xl px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />
                    <span className="text-sm text-slate-600">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Input */}
      <div className="border-t border-slate-200/80 bg-white/95 backdrop-blur-md p-4">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={projectId ? "Ask about your screenplay..." : "Select a project to start chatting"}
            disabled={!projectId || isLoading}
            className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <Button
            onClick={sendMessage}
            disabled={!inputValue.trim() || !projectId || isLoading}
            size="sm"
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}