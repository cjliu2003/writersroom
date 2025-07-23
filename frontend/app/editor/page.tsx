"use client"

import { useState, useEffect, useRef } from "react"
import { ScreenplayEditor } from "@/components/screenplay-editor"
import { AIAssistant } from "@/components/ai-assistant"
import { Button } from "@/components/ui/button"
import { Save, Home } from "lucide-react"
import { useRouter } from "next/navigation"

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

export default function EditorPage() {
  const [script, setScript] = useState<Script | null>(null)
  const [isAssistantOpen, setIsAssistantOpen] = useState(true)
  const [lastSaved, setLastSaved] = useState<Date>(new Date())
  const router = useRouter()
const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const savedScript = localStorage.getItem("current-script")
    if (savedScript) {
      const parsedScript = JSON.parse(savedScript)
      setScript(parsedScript)
    } else {
      router.push("/")
    }
  }, [router])

  const saveScript = (updatedScript: Script) => {
    localStorage.setItem("current-script", JSON.stringify(updatedScript))
    setLastSaved(new Date())
  }

  const handleContentChange = (content: string) => {
    if (!script) return

    const updatedScript = { ...script, content }

    // Parse scenes from content
    const scenes = parseScenes(content)
    updatedScript.scenes = scenes

    setScript(updatedScript)

    // Auto-save with debounce
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveScript(updatedScript)
    }, 1000)
  }

  const parseScenes = (content: string): Scene[] => {
    const lines = content.split("\n")
    const scenes: Scene[] = []
    let currentSceneContent = ""
    let currentSceneHeading = ""
    let sceneId = 1

    for (const line of lines) {
      const trimmedLine = line.trim()

      // Check if line is a scene heading (starts with INT. or EXT.)
      if (trimmedLine.match(/^(INT\.|EXT\.)/i)) {
        // Save previous scene if it exists
        if (currentSceneHeading) {
          scenes.push({
            id: sceneId.toString(),
            heading: currentSceneHeading,
            content: currentSceneContent.trim(),
          })
          sceneId++
        }

        // Start new scene
        currentSceneHeading = trimmedLine
        currentSceneContent = line + "\n"
      } else {
        currentSceneContent += line + "\n"
      }
    }

    // Add the last scene
    if (currentSceneHeading) {
      scenes.push({
        id: sceneId.toString(),
        heading: currentSceneHeading,
        content: currentSceneContent.trim(),
      })
    }

    return scenes
  }

  if (!script) {
    return <div>Loading...</div>
  }

  return (
    <div className="flex h-screen bg-white">
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b bg-white px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
              <Home className="w-4 h-4 mr-2" />
              Home
            </Button>
            <h1 className="font-semibold">{script.title}</h1>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">Last saved: {lastSaved.toLocaleTimeString()}</span>
            <Button variant="ghost" size="sm" onClick={() => saveScript(script)}>
              <Save className="w-4 h-4 mr-2" />
              Save
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsAssistantOpen(!isAssistantOpen)}>
              {isAssistantOpen ? "Hide" : "Show"} AI Assistant
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex">
          <div className={`${isAssistantOpen ? "w-2/3" : "w-full"} transition-all duration-300`}>
            <ScreenplayEditor content={script.content} onChange={handleContentChange} />
          </div>

          {isAssistantOpen && (
            <div className="w-1/3 border-l">
              <AIAssistant script={script} onClose={() => setIsAssistantOpen(false)} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}