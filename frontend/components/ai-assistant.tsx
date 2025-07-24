"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
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
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "Hi! I'm your AI screenwriting assistant. I can help you develop characters, improve dialogue, suggest plot twists, and more. I'm familiar with your script and can provide context-aware suggestions. What would you like to work on?",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [messages])

  const sendMessage = async (messageContent: string) => {
    if (!messageContent.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageContent,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      // Prepare context about the script
      const scriptContext = `
Current Screenplay Context:
Title: ${script.title}
Number of scenes: ${script.scenes.length}
Characters mentioned: ${extractCharacters(script.content).join(", ") || "None yet"}

Recent script content:
${script.content.slice(-1000)} // Last 1000 characters

Scene headings:
${script.scenes.map((scene) => scene.heading).join("\n")}
      `.trim()

      const { text } = await generateText({
        model: openai("gpt-4o"),
        system: `You are an expert screenwriting assistant. You help writers develop professional screenplays by providing creative suggestions, improving dialogue, developing characters, and offering plot ideas. 

Key guidelines:
- Always be encouraging and constructive
- Provide specific, actionable suggestions
- Reference the user's existing script content when relevant
- Maintain the writer's creative control - suggest, don't dictate
- Follow industry-standard screenplay formatting when providing examples
- Keep responses concise but helpful
- Focus on story, character, and dialogue improvement

You have access to the current screenplay context and should reference it in your responses when relevant.`,
        prompt: `${scriptContext}

User question: ${messageContent}

Please provide helpful, specific advice based on the screenplay context above.`,
      })

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: text,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error("Error generating AI response:", error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content:
          "I'm sorry, I encountered an error while processing your request. Please try again or rephrase your question.",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

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
    sendMessage(input)
  }

  const handlePresetClick = (prompt: string) => {
    sendMessage(prompt)
  }

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col bg-gray-50">
      {/* Header */}
      <div className="border-b bg-white p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-blue-600" />
          </div>
          <h3 className="font-semibold text-blue-600">AI Assistant</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Chat History Button */}
      <div className="p-4 border-b bg-white">
        <Button variant="outline" size="sm" className="w-full bg-transparent">
          <MessageSquare className="w-4 h-4 mr-2" />
          View chat history
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

      {/* Conversation Suggestions */}
      <div className="border-t bg-white p-4 space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Continue last conversation</span>
            <Button variant="ghost" size="sm">
              <X className="w-3 h-3" />
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-blue-600">Give me dialogue for scene 2</span>
            <Button variant="ghost" size="sm">
              <X className="w-3 h-3" />
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-blue-600">Help resolve the love triangle</span>
            <Button variant="ghost" size="sm">
              <X className="w-3 h-3" />
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-blue-600">Estimate how long it will take</span>
            <Button variant="ghost" size="sm">
              <X className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button type="submit" disabled={isLoading || !input.trim()} className="bg-blue-600 hover:bg-blue-700">
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}

// Placeholder for backend function
type GenerateTextParams = {
  model: string
  system: string
  prompt: string
}

async function generateText(_: GenerateTextParams): Promise<{ text: string }> {
  // Simulate a short delay and return a canned response
  console.log(_)
  return new Promise((resolve) =>
    setTimeout(() => resolve({ text: "This is a placeholder AI response. Connect your backend to enable real suggestions." }), 700)
  )
}

// Placeholder for OpenAI model function
function openai(model: string): string {
  // Return a placeholder model name
  console.log(`Using model: ${model}`)
  return "placeholder-model"
}
