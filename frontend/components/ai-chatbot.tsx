"use client"

import React, { useState, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MessageCircle, Send, Loader2, Sparkles } from "lucide-react"
import { sendChatMessage, type ChatMessage } from "@/lib/api"

interface AIChatbotProps {
  projectId?: string
  isVisible?: boolean
  compact?: boolean
  floating?: boolean
  terminal?: boolean
  light?: boolean
}

export function AIChatbot({ projectId, isVisible = true, compact = false, floating = false, terminal = false, light = false }: AIChatbotProps) {
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
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
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

  if (!isVisible) return null

  // Light theme styling for semi-floating sheet
  if (light) {
    return (
      <>
        <style jsx>{`
          .light-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .light-scrollbar::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.03);
          }
          .light-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(0, 0, 0, 0.12);
            border-radius: 3px;
          }
          .light-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(0, 0, 0, 0.18);
          }
        `}</style>
        <div className="h-full flex flex-col">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto light-scrollbar px-6 py-5" style={{
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0,0,0,0.12) rgba(0,0,0,0.03)'
          }}>
            <div className="space-y-4">
              {messages.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="w-14 h-14 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                    <Sparkles className="w-7 h-7 text-gray-500" />
                  </div>
                  <p className="text-base text-gray-600" style={{ fontFamily: "'Courier New', 'Courier', monospace" }}>
                    Your AI assistant
                  </p>
                </div>
              ) : (
                messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-5 py-3 ${
                        message.role === 'user'
                          ? 'text-white'
                          : 'bg-white border border-gray-200 text-gray-900'
                      }`}
                      style={{
                        background: message.role === 'user' ? '#A276FF' : undefined,
                        boxShadow: message.role === 'assistant' ? '0 1px 4px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.12)'
                      }}
                    >
                      <p
                        className="leading-relaxed whitespace-pre-wrap"
                        style={{
                          fontFamily: "'Courier New', 'Courier', monospace",
                          fontSize: '15px',
                          lineHeight: '1.6'
                        }}
                      >
                        {message.content}
                      </p>
                    </div>
                  </div>
                ))
              )}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-200 rounded-lg px-5 py-3" style={{
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
                  }}>
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 text-gray-600 animate-spin" />
                      <span style={{ fontFamily: "'Courier New', 'Courier', monospace", fontSize: '15px', color: '#555' }}>
                        Thinking...
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Input Bar */}
          <div className="px-6 pb-4">
            <div
              className="flex items-center gap-3 rounded-lg px-4 py-2 transition-all border"
              style={{
                background: '#f8f8f8',
                borderColor: 'rgba(0, 0, 0, 0.1)',
                boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.05)',
              }}
            >
              <textarea
                ref={inputRef as any}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask anything..."
                disabled={!projectId || isLoading}
                rows={1}
                className="flex-1 bg-transparent placeholder-gray-400 placeholder-italic resize-none focus:outline-none disabled:opacity-50 max-h-[90px] overflow-y-auto light-scrollbar"
                style={{
                  fontFamily: "'Courier New', 'Courier', monospace",
                  fontSize: '15px',
                  color: '#222',
                  lineHeight: '1.5',
                  minHeight: '24px',
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(0,0,0,0.12) transparent'
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 90) + 'px';
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!inputValue.trim() || !projectId || isLoading}
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                style={{
                  background: '#A276FF',
                  ':hover': { background: '#9166EE' }
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#9166EE'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#A276FF'}
              >
                <Send className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  // Terminal mode styling
  if (terminal) {
    return (
      <>
        <style jsx>{`
          .terminal-scrollbar::-webkit-scrollbar {
            width: 4px;
          }
          .terminal-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .terminal-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 2px;
          }
          .terminal-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.15);
          }
        `}</style>
        <div className="h-full flex flex-col">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto terminal-scrollbar px-4 py-3" style={{
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.1) transparent'
          }}>
            <div className="space-y-3">
              {messages.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="w-12 h-12 bg-white/5 rounded-lg flex items-center justify-center mx-auto mb-3">
                    <Sparkles className="w-6 h-6 text-[#A276FF]" />
                  </div>
                  <p className="text-sm text-white/70 mb-1" style={{ fontFamily: "'IBM Plex Mono', 'Inter', monospace" }}>
                    Ask about this scene
                  </p>
                  <p className="text-xs text-white/40" style={{ fontFamily: "'IBM Plex Mono', 'Inter', monospace" }}>
                    Get AI help with your screenplay
                  </p>
                </div>
              ) : (
                messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-4 py-2.5 ${
                        message.role === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white/5 border border-white/10 text-gray-300'
                      }`}
                    >
                      <p
                        className="text-sm leading-relaxed whitespace-pre-wrap"
                        style={{ fontFamily: "'Inter', 'IBM Plex Mono', system-ui" }}
                      >
                        {message.content}
                      </p>
                    </div>
                  </div>
                ))
              )}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 text-[#A276FF] animate-spin" />
                      <span className="text-sm text-white/60" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                        Thinking...
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Input Bar */}
          <div className="px-3 pb-3">
            <div
              className="flex items-center gap-3 rounded-full px-4 py-3 transition-colors"
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <textarea
                ref={inputRef as any}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={projectId ? "Ask about this scene..." : "Select a project"}
                disabled={!projectId || isLoading}
                rows={1}
                className="flex-1 bg-transparent text-sm text-white placeholder-white/40 placeholder-italic resize-none focus:outline-none disabled:opacity-50 max-h-[72px] overflow-y-auto terminal-scrollbar"
                style={{
                  fontFamily: "'Inter', 'IBM Plex Mono', system-ui",
                  minHeight: '24px',
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(255,255,255,0.1) transparent'
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 72) + 'px';
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!inputValue.trim() || !projectId || isLoading}
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  const containerClass = floating
    ? "h-full flex flex-col overflow-hidden"
    : compact
    ? "h-full flex flex-col bg-white overflow-hidden"
    : "h-[calc(100vh-112px)] flex flex-col bg-gradient-to-br from-purple-50/40 to-pink-50 shadow-2xl drop-shadow-lg border-l border-slate-200/50 overflow-hidden rounded-lg backdrop-blur-sm"

  const messagesClass = floating ? "flex-1 overflow-y-auto py-1" : compact ? "h-full p-1.5" : "h-full p-4"
  const inputContainerClass = floating ? "mt-2" : compact
    ? "border-t border-gray-200 bg-white p-1.5"
    : "border-t border-slate-200/80 bg-white/95 backdrop-blur-md p-4"

  return (
    <>
      {floating && (
        <style jsx>{`
          .floating-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .floating-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .floating-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
          }
          .floating-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.2);
          }
        `}</style>
      )}
      <div className={containerClass}>
      {/* Header - only show for non-floating mode */}
      {!floating && (
        <div className={compact ? "border-b border-gray-200 bg-white p-1.5 flex items-center gap-2" : "border-b border-slate-200/80 bg-white/95 backdrop-blur-md p-4 flex items-center gap-2 shadow-sm"}>
          <div className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} bg-blue-100 rounded flex items-center justify-center`}>
            <Sparkles className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} text-blue-600`} />
          </div>
          <h3 className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-slate-700`}>AI Assistant</h3>
        </div>
      )}

      {/* Messages */}
      {floating ? (
        <div ref={scrollAreaRef} className={`${messagesClass} floating-scrollbar`} style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.1) transparent'
        }}>
          <div className="space-y-2">
            {messages.length === 0 ? (
              <div className="p-3 text-center">
                <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center mx-auto mb-2">
                  <Sparkles className="w-5 h-5 text-blue-400" />
                </div>
                <p className="text-sm text-white/60 mb-1">Ask about this scene</p>
                <p className="text-xs text-white/40">
                  Get AI help with your screenplay
                </p>
              </div>
            ) : (
              messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white/5 border border-white/10 text-white/90'
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
                <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                    <span className="text-sm text-white/60">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <ScrollArea className={messagesClass} ref={scrollAreaRef}>
            <div className={compact ? "space-y-1" : "space-y-4"}>
              {messages.length === 0 ? (
                <div className={compact ? "p-2 text-center" : "p-6 text-center"}>
                  <div className={`${compact ? 'w-8 h-8' : 'w-12 h-12'} bg-blue-50 rounded-lg flex items-center justify-center mx-auto mb-2`}>
                    <MessageCircle className={`${compact ? 'w-4 h-4' : 'w-6 h-6'} text-blue-500`} />
                  </div>
                  <p className="text-xs text-gray-600 mb-1 font-medium">Start a conversation</p>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Ask about your screenplay
                  </p>
                </div>
              ) : (
                messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg ${compact ? 'px-2 py-1' : 'px-4 py-2'} ${
                        message.role === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'border border-gray-200 text-slate-700'
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
                  <div className={`border border-gray-200 rounded-lg ${compact ? 'px-2 py-1' : 'px-4 py-2'}`}>
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
                      <span className="text-xs text-slate-600">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Input */}
      <div className={inputContainerClass}>
        {floating ? (
          <div className="flex items-end gap-2 px-3 py-2 rounded-full bg-white/3 border border-white/10">
            <textarea
              ref={inputRef as any}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={projectId ? "Ask about this scene..." : "Select a project"}
              disabled={!projectId || isLoading}
              rows={1}
              className="flex-1 bg-transparent text-sm text-white placeholder-white/40 resize-none focus:outline-none disabled:opacity-50 max-h-[72px] overflow-y-auto floating-scrollbar"
              style={{
                minHeight: '24px',
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255,255,255,0.1) transparent'
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = Math.min(target.scrollHeight, 72) + 'px';
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!inputValue.trim() || !projectId || isLoading}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={projectId ? "Ask about your screenplay..." : "Select a project"}
              disabled={!projectId || isLoading}
              className={`flex-1 ${compact ? 'px-2 py-1' : 'px-3 py-2'} text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed`}
            />
            <Button
              onClick={sendMessage}
              disabled={!inputValue.trim() || !projectId || isLoading}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white px-2"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
    </>
  )
}