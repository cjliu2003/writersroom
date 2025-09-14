"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { ScreenplayEditor } from "@/components/screenplay-editor"
import { AIAssistant } from "@/components/ai-assistant"
import { SceneDescriptions } from "@/components/scene-descriptions"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Save, Home, FileText, Eye, HelpCircle } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"

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

interface MemoryScene {
  slugline: string
  characters: string[]
  summary: string
  tokens: number
  wordCount: number
  themes: string[]
  timestamp: string
  fullContent?: string // Full scene content from FDX import
}

function EditorPageContent() {
  const [script, setScript] = useState<Script | null>(null)
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  const [isOutlineOpen, setIsOutlineOpen] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date>(new Date())
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()
  const searchParams = useSearchParams()
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [currentSceneInView, setCurrentSceneInView] = useState<string>('')

  useEffect(() => {
    const loadScript = async () => {
      setIsLoading(true)
      
      // Check if we have a projectId from the URL
      const projectId = searchParams.get('projectId')
      
      if (projectId) {
        // Load from memory backend
        try {
          const BACKEND_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'
          const response = await fetch(`${BACKEND_API_URL}/memory/all?projectId=${projectId}`)
          
          if (response.ok) {
            const result = await response.json()
            if (result.success && result.data && result.data.length > 0) {
              // Convert memory scenes to script format
              const memoryScenes: MemoryScene[] = result.data
              const scriptContent = convertMemoryScenesToScript(memoryScenes)
              const scenes = parseScenes(scriptContent)
              
              const newScript: Script = {
                id: projectId,
                title: extractTitleFromScenes(memoryScenes) || 'Imported Script',
                scenes: scenes,
                content: scriptContent,
                createdAt: new Date().toISOString()
              }
              
              setScript(newScript)
              // Also save to localStorage for future editing
              localStorage.setItem("current-script", JSON.stringify(newScript))
              setIsLoading(false)
              return
            }
          }
        } catch (error) {
          console.error('Failed to load script from memory backend:', error)
        }
      }
      
      // Fallback to localStorage
      const savedScript = localStorage.getItem("current-script")
      if (savedScript) {
        const parsedScript = JSON.parse(savedScript)
        setScript(parsedScript)
      } else {
        router.push("/")
      }
      setIsLoading(false)
    }
    
    loadScript()
  }, [router, searchParams])

  const extractTitleFromScenes = (memoryScenes: MemoryScene[]): string | null => {
    // Try to extract title from first scene heading or use a default
    if (memoryScenes.length > 0) {
      // Extract potential title from first scene - this is a simple heuristic
      return `Imported Script - ${memoryScenes.length} scenes`
    }
    return null
  }

  const convertMemoryScenesToScript = (memoryScenes: MemoryScene[]): string => {
    const screenplayElements: any[] = []

    memoryScenes.forEach((scene) => {
      // Use fullContent if available (from FDX import), otherwise fall back to constructed content
      if (scene.fullContent) {
        // Parse the fullContent back into ScreenplayElements
        const elements = parseFullContentToElements(scene.fullContent)
        screenplayElements.push(...elements)
      } else {
        // Fallback: construct content from scene data
        // Add scene heading
        screenplayElements.push({
          type: 'scene_heading',
          children: [{ text: scene.slugline }],
          id: `scene_${Date.now()}_${Math.random()}`,
          metadata: {
            timestamp: new Date().toISOString(),
            uuid: crypto.randomUUID()
          }
        })

        // Add scene summary as action
        if (scene.summary) {
          screenplayElements.push({
            type: 'action',
            children: [{ text: scene.summary }],
            id: `action_${Date.now()}_${Math.random()}`,
            metadata: {
              timestamp: new Date().toISOString(),
              uuid: crypto.randomUUID()
            }
          })
        }

        // Add characters as dialogue placeholders if available
        if (scene.characters && scene.characters.length > 0) {
          scene.characters.forEach(character => {
            screenplayElements.push({
              type: 'character',
              children: [{ text: character.toUpperCase() }],
              id: `char_${Date.now()}_${Math.random()}`,
              metadata: {
                timestamp: new Date().toISOString(),
                uuid: crypto.randomUUID()
              }
            })

            screenplayElements.push({
              type: 'dialogue',
              children: [{ text: '(dialogue)' }],
              id: `dialogue_${Date.now()}_${Math.random()}`,
              metadata: {
                timestamp: new Date().toISOString(),
                uuid: crypto.randomUUID()
              }
            })
          })
        }
      }
    })

    // Return as JSON string that the editor expects
    return JSON.stringify(screenplayElements)
  }

  const parseFullContentToElements = (fullContent: string): any[] => {
    const lines = fullContent.split('\n')
    const elements: any[] = []

    let currentElement: any = null

    lines.forEach(line => {
      const trimmedLine = line.trim()

      if (!trimmedLine) {
        // Empty line - finish current element if it exists
        if (currentElement) {
          elements.push(currentElement)
          currentElement = null
        }
        return
      }

      // Detect element type by content patterns
      let elementType = 'action' // default

      if (trimmedLine.match(/^(INT\.|EXT\.)/i)) {
        elementType = 'scene_heading'
      } else if (trimmedLine.match(/^\([^)]+\)$/)) {
        // Text in parentheses = parenthetical
        elementType = 'parenthetical'
      } else if (trimmedLine.match(/^(FADE IN:|FADE OUT\.?|CUT TO:|DISSOLVE TO:)/i)) {
        // Transitions - including FADE OUT.
        elementType = 'transition'
      } else if (currentElement && (currentElement.type === 'character' || currentElement.type === 'parenthetical')) {
        // After a character or parenthetical = dialogue
        elementType = 'dialogue'
      } else if (trimmedLine === trimmedLine.toUpperCase() &&
                 trimmedLine.match(/^[A-Z][A-Z\s]*$/) &&
                 trimmedLine.length > 1 &&
                 !trimmedLine.match(/\./)) {
        // All caps, only letters and spaces, no periods = character name
        elementType = 'character'
      }

      // If we have a current element and the type changed, save the current one
      if (currentElement && currentElement.type !== elementType) {
        elements.push(currentElement)
        currentElement = null
      }

      // Create new element or append to current
      if (!currentElement) {
        currentElement = {
          type: elementType,
          children: [{ text: trimmedLine }],
          id: `element_${Date.now()}_${Math.random()}`,
          metadata: {
            timestamp: new Date().toISOString(),
            uuid: crypto.randomUUID()
          }
        }
      } else {
        // Append to current element (for multi-line content)
        if (currentElement.children[0].text) {
          currentElement.children[0].text += ' ' + trimmedLine
        } else {
          currentElement.children[0].text = trimmedLine
        }
      }
    })

    // Add final element if exists
    if (currentElement) {
      elements.push(currentElement)
    }

    return elements
  }

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


  if (isLoading || !script) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading script...</p>
        </div>
      </div>
    )
  }

  const sceneNumbers = script.scenes.map((_, index) => index + 1)

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Header - Final Draft Style */}
      <div className="fixed top-0 left-0 right-0 z-50 border-b border-gray-200 bg-white shadow-md">
        {/* Top Menu Bar with Centered Title */}
        <div className="px-6 py-3 flex items-center h-16">
          {/* Left Navigation */}
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => router.push("/")}
              className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md px-3 py-1"
            >
              <Home className="w-4 h-4 mr-2" />
              Home
            </Button>
            <Button variant="ghost" size="sm" className="text-gray-600 hover:bg-gray-100 rounded-md px-3 py-1">
              <FileText className="w-4 h-4 mr-1" />
              File
            </Button>
            <Button variant="ghost" size="sm" className="text-gray-600 hover:bg-gray-100 rounded-md px-3 py-1">
              <Eye className="w-4 h-4 mr-1" />
              View
            </Button>
            <Button variant="ghost" size="sm" className="text-gray-600 hover:bg-gray-100 rounded-md px-3 py-1">
              <HelpCircle className="w-4 h-4 mr-1" />
              Help
            </Button>
          </div>

          {/* Centered Script Title */}
          <div className="flex-1 flex justify-center min-w-0">
            <h1 className="font-semibold text-gray-800 text-xl tracking-wide truncate">
              {script.title}
            </h1>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-4 flex-1 justify-end min-w-0">
            <span className="text-xs text-gray-500 hidden sm:inline">
              Saved {lastSaved.toLocaleTimeString()}
            </span>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => saveScript(script)}
              className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md px-3 py-1"
            >
              <Save className="w-4 h-4 mr-1" />
              Save
            </Button>
          </div>
        </div>
      </div>

      {/* Scene Navigation - spans full width below header */}
      <div className="fixed top-16 left-0 right-0 z-40 border-b border-gray-200 bg-white shadow-sm px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button 
            onClick={() => setIsOutlineOpen(!isOutlineOpen)}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 shadow-sm ${
              isOutlineOpen 
                ? 'bg-blue-600 text-white shadow-md hover:bg-blue-700 hover:shadow-lg' 
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 hover:shadow-md hover:border-gray-300'
            }`}
          >
            Scene Descriptions
          </Button>
          <div className="flex items-center gap-2">
            {sceneNumbers.slice(0, 3).map((num, index) => (
              <Badge 
                key={num} 
                variant="outline" 
                className="text-xs bg-white/80 border-gray-200 text-gray-600 px-2 py-1"
              >
                {index + 1}. {script.scenes[index]?.heading.split(" - ")[0] || `Scene ${num}`}
              </Badge>
            ))}
            {script.scenes.length > 3 && (
              <Badge variant="outline" className="text-xs bg-white/80 border-gray-200 text-gray-500 px-2 py-1">
                +{script.scenes.length - 3} more
              </Badge>
            )}
          </div>
        </div>
        <Button 
          onClick={() => setIsAssistantOpen(!isAssistantOpen)}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 shadow-sm ${
            isAssistantOpen 
              ? 'bg-purple-600 text-white shadow-md hover:bg-purple-700 hover:shadow-lg' 
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 hover:shadow-md hover:border-gray-300'
          }`}
        >
          AI Assistant
        </Button>
      </div>

      {/* Main Content Area - starts below both headers */}
      <div className="pt-[112px] w-full flex">
        {/* Left Sidebar - Scene Outline */}
        {isOutlineOpen && (
          <div className="w-96 transition-all duration-300">
            <SceneDescriptions
              scenes={script.scenes}
              editorContent={script.content}
              currentSceneInView={currentSceneInView}
              onSceneSelect={() => {}}
            />
          </div>
        )}

        {/* Script Editor Container - dynamically centered */}
        <div 
          className="flex-1 flex justify-center transition-all duration-300"
          style={{
            marginLeft: isOutlineOpen && !isAssistantOpen ? 'auto' : '0',
            marginRight: !isOutlineOpen && isAssistantOpen ? 'auto' : '0'
          }}
        >
          <div 
            className="w-full transition-all duration-300"
            style={{
              maxWidth: isOutlineOpen && isAssistantOpen 
                ? 'calc(100vw - 768px)' // Both open: subtract both 384px panels
                : isOutlineOpen || isAssistantOpen 
                  ? 'calc(100vw - 384px)' // One open: subtract one 384px panel
                  : '100vw' // None open: full width
            }}
          >
            <ScreenplayEditor 
              content={script.content} 
              onChange={handleContentChange}
              onSceneChange={setCurrentSceneInView}
            />
          </div>
        </div>

        {/* Right Sidebar - AI Assistant */}
        {isAssistantOpen && (
          <div className="w-96 transition-all duration-300">
            <AIAssistant script={script} onClose={() => setIsAssistantOpen(false)} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function EditorPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading script...</p>
        </div>
      </div>
    }>
      <EditorPageContent />
    </Suspense>
  )
}
