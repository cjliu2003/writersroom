"use client"

import type React from "react"

import { useState, useRef, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Send, Sparkles, X, MessageSquare, Lightbulb, Zap, RefreshCw } from "lucide-react"


interface Scene {
  id: string
  heading: string
  content: string
}


interface Script {
  id: string
  title: string
  scenes: Scene[]
  content: string
  createdAt: string
}


interface AIAssistantProps {
  script: Script
  onClose: () => void
}

const PRESET_PROMPTS = [
  {
    icon: MessageSquare,
    title: "Punch up this scene's dialogue",
    prompt:
      "Please analyze the current scene and suggest ways to make the dialogue more engaging, natural, and character-specific. Focus on subtext, conflict, and authentic voice.",
  },
  {
    icon: Zap,
    title: "Add a suspenseful twist",
    prompt:
      "Based on the current story context, suggest a suspenseful plot twist that would fit naturally into the narrative and raise the stakes for the characters.",
  },
  {
    icon: Lightbulb,
    title: "Make this character more likable",
    prompt:
      "Analyze the main characters in the script and suggest specific ways to make them more relatable and likable to the audience without losing their complexity.",
  },
  {
    icon: RefreshCw,
    title: "Give me 3 alternate endings",
    prompt:
      "Based on the story so far, provide three different possible endings that would satisfy the narrative arc and character development established in the script.",
  },
  {
    icon: Sparkles,
    title: "Continue the next few lines",
    prompt:
      "Based on where the script currently ends, suggest the next 3-5 lines of dialogue or action that would naturally follow and advance the story.",
  },
]

export function AIAssistant({ script, onClose }: AIAssistantProps) {
  const messages = useMemo(
    () => [
      {
        id: "1",
        role: "assistant",
        content:
          "Hi! I'm your AI screenwriting assistant. I can help you develop characters, improve dialogue, suggest plot twists, and more. I'm familiar with your script and can provide context-aware suggestions. What would you like to work on?",
        timestamp: new Date(),
      },
    ],
    []
  )
  const [input, setInput] = useState("")
  const isLoading = false
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [messages])

  const extractCharacters = (content: string): string[] => {
    const lines = content.split("\n")
    const characters = new Set<string>()

    for (const line of lines) {
      const trimmed = line.trim()
      // Look for character names (lines that are mostly uppercase and centered)
      if (trimmed.match(/^\s+[A-Z][A-Z\s]{2,}$/) && trimmed.length < 50) {
        const characterName = trimmed.trim()
        if (characterName && !characterName.match(/^(INT\.|EXT\.|FADE|CUT|THE END)/)) {
          characters.add(characterName)
        }
      }
    }

    return Array.from(characters).slice(0, 10) // Limit to 10 characters
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    console.log("User input submitted:", input)
  }

  const handlePresetClick = (prompt: string) => {
    console.log("Preset clicked:", prompt)
  }

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col bg-gray-50">
      {/* Header */}
      <div className="border-b bg-white p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          <h3 className="font-semibold">AI Assistant</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Preset Prompts */}
      <div className="p-4 border-b bg-white">
        <h4 className="text-sm font-medium mb-3 text-gray-700">Quick Actions</h4>
        <div className="grid grid-cols-1 gap-2">
          {PRESET_PROMPTS.map((preset, index) => (
            <Button
              key={index}
              variant="outline"
              size="sm"
              className="justify-start text-left h-auto p-2 bg-transparent"
              onClick={() => handlePresetClick(preset.prompt)}
              disabled={isLoading}
            >
              <preset.icon className="w-4 h-4 mr-2 flex-shrink-0" />
              <span className="text-xs">{preset.title}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
        <div className="space-y-4">
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-lg p-3 ${
                  message.role === "user" ? "bg-blue-600 text-white" : "bg-white border shadow-sm"
                }`}
              >
                <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                <div className={`text-xs mt-1 ${message.role === "user" ? "text-blue-100" : "text-gray-500"}`}>
                  {message.timestamp.toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white border shadow-sm rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
                  <span className="text-sm text-gray-500">AI is thinking...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t bg-white p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your script, characters, plot..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button type="submit" disabled={isLoading || !input.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        </form>

        {script.scenes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge variant="secondary" className="text-xs">
              {script.scenes.length} scenes
            </Badge>
            {extractCharacters(script.content)
              .slice(0, 3)
              .map((character) => (
                <Badge key={character} variant="outline" className="text-xs">
                  {character}
                </Badge>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
