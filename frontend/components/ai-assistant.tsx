"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Send, Sparkles, X } from "lucide-react"

import { Scene, Script } from "@/types/screenplay"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

interface AIAssistantProps {
  script: Script
  onClose: () => void
}


const STARTER_PROMPTS = [
  "Summarize the last scene",
  "What's the central conflict here?",
  "Help me write better dialogue"
]

export function AIAssistant({ script }: AIAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [showWelcomeMessage, setShowWelcomeMessage] = useState(false)
  const [showStarterPrompts, setShowStarterPrompts] = useState(true)
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Show welcome message with delay on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowWelcomeMessage(true)
      const welcomeMessage: Message = {
        id: "welcome",
        role: "assistant",
        content: "Hi! I'm your screenwriting assistant. You can ask me anything about your scene, structure, characters, or style.",
        timestamp: new Date(),
      }
      setMessages([welcomeMessage])
    }, 300)

    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    // Auto-scroll to bottom when new messages are added
    const scrollContainer = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight
    }
  }, [messages])

  const sendMessage = async (messageContent: string) => {
    if (!messageContent.trim() || isLoading) return

    // Hide starter prompts after first message
    setShowStarterPrompts(false)

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageContent,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    // Simulate a brief delay then show "working on it" response
    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "I'm working on understanding your screenplay better. Full AI responses coming soon!",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMessage])
      setIsLoading(false)
    }, 800)
  }

  const handleStarterPromptClick = (prompt: string) => {
    sendMessage(prompt)
  }

  const dismissStarterPrompts = () => {
    setShowStarterPrompts(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  return (
    <div className="h-[calc(100vh-112px)] flex flex-col bg-gradient-to-br from-purple-50/40 to-slate-50 shadow-2xl drop-shadow-lg border-l border-slate-200/50 overflow-hidden rounded-lg backdrop-blur-sm">
      {/* Header */}
      <div className="border-b border-slate-200/80 bg-white/95 backdrop-blur-md p-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-blue-600" />
          </div>
          <h3 className="font-semibold text-slate-700">AI Assistant</h3>
        </div>
      </div>


      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full p-4" ref={scrollAreaRef}>
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div 
                key={message.id} 
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"} ${
                  index === 0 && message.role === "assistant" ? "animate-in slide-in-from-left-2 duration-300" : ""
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                    message.role === "user" 
                      ? "bg-blue-600 text-white ml-8" 
                      : "bg-white border border-gray-200 mr-8"
                  }`}
                >
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</div>
                  <div className={`text-xs mt-2 ${
                    message.role === "user" ? "text-blue-100" : "text-gray-400"
                  }`}>
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 shadow-sm rounded-2xl px-4 py-3 mr-8">
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    <span className="text-sm text-gray-500">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Starter Prompts */}
      {showStarterPrompts && messages.length === 1 && (
        <div className="border-t border-slate-200/80 bg-gradient-to-r from-blue-50/50 to-purple-50/50 backdrop-blur-md p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-slate-700">Try asking me:</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={dismissStarterPrompts}
              className="h-6 w-6 p-0 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
          <div className="space-y-2">
            {STARTER_PROMPTS.map((prompt, index) => (
              <Button
                key={index}
                variant="outline"
                size="sm"
                onClick={() => handleStarterPromptClick(prompt)}
                className="w-full justify-start text-left h-auto py-2 px-3 bg-white/70 border-slate-200 text-slate-700 hover:bg-white hover:border-blue-300 hover:text-blue-700 transition-all duration-200"
              >
                <span className="text-xs">{prompt}</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-slate-200/80 bg-white/95 backdrop-blur-md p-4 shadow-sm">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your screenplay..."
            disabled={isLoading}
            className="flex-1 bg-white/90 border-gray-200 focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
          />
          <Button 
            type="submit" 
            disabled={isLoading || !input.trim()} 
            className="bg-blue-600 hover:bg-blue-700 shadow-sm"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}

