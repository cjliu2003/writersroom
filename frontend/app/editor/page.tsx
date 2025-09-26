"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { ScreenplayEditor } from "@/components/screenplay-editor"
import { AIChatbot } from "@/components/ai-chatbot"
import { SceneDescriptions } from "@/components/scene-descriptions"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Save, Home, FileText, Eye, HelpCircle } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import ErrorBoundary from "@/components/ErrorBoundary"

import { Scene, Script } from '@/types/screenplay'
import { getScriptScenes, type BackendScene } from '@/lib/api'
import { markOpened } from '@/lib/projectRegistry'
import { loadLayoutPrefs, saveLayoutPrefs, type EditorLayoutPrefs } from '@/utils/layoutPrefs'
import { useChunkRetry } from '@/hooks/useChunkRetry'

// Removed legacy MemoryScene/shared types — backend is the single source of truth

function EditorPageContent() {
  const [script, setScript] = useState<Script | null>(null)
  const [isAssistantOpen, setIsAssistantOpen] = useState(true)
  const [isOutlineOpen, setIsOutlineOpen] = useState(true)
  const [lastSaved, setLastSaved] = useState<Date>(new Date())
  const [isLoading, setIsLoading] = useState(true)
  const [isOfflineMode, setIsOfflineMode] = useState(false)
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [currentSceneInView, setCurrentSceneInView] = useState<string>('')

  // Enable chunk retry mechanism
  useChunkRetry()

  // Load layout preferences on mount
  useEffect(() => {
    const prefs = loadLayoutPrefs();
    setIsOutlineOpen(prefs.sceneListVisible);
    setIsAssistantOpen(prefs.assistantVisible);
  }, []);

  // Save layout preferences when sidebar states change
  useEffect(() => {
    const prefs: EditorLayoutPrefs = {
      sceneListVisible: isOutlineOpen,
      assistantVisible: isAssistantOpen
    };
    saveLayoutPrefs(prefs);
  }, [isOutlineOpen, isAssistantOpen]);

  useEffect(() => {
    let cancelled = false
    // Fail-safe: clear loading after 20s no matter what
    const failSafe = setTimeout(() => {
      if (!cancelled) {
        console.warn('Fail-safe timeout reached, clearing loading state')
        setIsLoading(false)
      }
    }, 20000)

    const loadScript = async () => {
      setIsLoading(true)
      setError(null)
      
      // Check if we have a projectId from the URL
      const projectId = searchParams.get('projectId')
      const isNewScript = searchParams.get('new') === 'true'

      if (projectId) {
        setCurrentProjectId(projectId)
        // Mark project as opened in the registry
        markOpened(projectId)

        // Handle new script creation
        if (isNewScript) {
          console.log('🆕 Creating new blank script for projectId:', projectId)

          // Get project title from registry
          const projects = JSON.parse(localStorage.getItem('wr.projects') || '[]')
          const project = projects.find((p: any) => p.projectId === projectId)
          const title = project?.title || 'Untitled Script'

          const newScript: Script = {
            id: projectId,
            title: title,
            scenes: [],
            content: '',
            createdAt: new Date().toISOString()
          }

          setScript(newScript)
          localStorage.setItem(`project-${projectId}`, JSON.stringify(newScript))
          setIsLoading(false)
          return
        }

        // Load scenes from FastAPI backend
        try {
          console.log('Editor: fetching scenes from backend for project', projectId)
          const backendScenes = await getScriptScenes(projectId)

          if (!backendScenes || backendScenes.length === 0) {
            console.warn('No scenes returned for script, initializing empty script')
            const emptyScript: Script = {
              id: projectId,
              title: 'Untitled Script',
              scenes: [],
              content: '',
              createdAt: new Date().toISOString()
            }
            setScript(emptyScript)
            localStorage.setItem(`project-${projectId}`, JSON.stringify(emptyScript))
            setIsLoading(false)
            return
          }

          // Build ScreenplayElements from backend data
          const elements = buildElementsFromBackendScenes(backendScenes)
          const content = JSON.stringify(elements)
          const scenes = parseScenes(content)

          const title = backendScenes[0]?.projectTitle || 'Untitled Script'
          const assembled: Script = {
            id: projectId,
            title,
            scenes,
            content,
            createdAt: new Date().toISOString()
          }

          setScript(assembled)
          localStorage.setItem('current-script', JSON.stringify(assembled))
          setIsLoading(false)
          return
        } catch (error) {
          console.error('Editor: Failed to load script scenes from backend:', error)
          setError('Failed to load script from server.')
          setIsLoading(false)
          return
        } finally {
          console.log('Editor: backend fetch sequence finished')
        }
      }

      // No projectId in URL
      setIsLoading(false)
    }

    loadScript().catch((err) => {
      console.error('Critical error loading script:', err)
      setError('Failed to load script. Please try refreshing the page.')
      setIsLoading(false)
    }).finally(() => {
      clearTimeout(failSafe)
    })

    return () => {
      cancelled = true
      clearTimeout(failSafe)
    }
  }, [router, searchParams])

  // Log script changes for debugging
  useEffect(() => {
    if (script) {
      console.log("📦 Props passed to ScreenplayEditor:")
      console.log("Content type:", typeof script.content)
      console.log("Content length:", script.content?.length || 'undefined')
      console.log("Script title:", script.title)
      console.log("Script scenes count:", script.scenes?.length || 0)
    }
  }, [script])

  // Title is derived from backendScenes[0].projectTitle when available

  const buildElementsFromBackendScenes = (backendScenes: BackendScene[]): any[] => {
    const all: any[] = []
    // Ensure deterministic order
    const sorted = [...backendScenes].sort((a, b) => a.sceneIndex - b.sceneIndex)

    sorted.forEach((s) => {
      // Scene heading first
      all.push({
        type: 'scene_heading',
        children: [{ text: s.slugline }],
        id: `scene_${s.sceneIndex}_${Date.now()}_${Math.random()}`,
        metadata: {
          timestamp: new Date().toISOString(),
          uuid: crypto.randomUUID()
        }
      })

      // Prefer typed blocks from backend
      if (s.contentBlocks && Array.isArray(s.contentBlocks) && s.contentBlocks.length > 0) {
        s.contentBlocks.forEach((b, idx) => {
          if (!b || !b.type) return
          if (b.type === 'scene_heading') return // avoid duplicating headings
          all.push({
            type: b.type,
            children: [{ text: (b.text ?? '').toString() }],
            id: `el_${s.sceneIndex}_${idx}_${Math.random()}`,
            metadata: b.metadata ?? {
              timestamp: new Date().toISOString(),
              uuid: crypto.randomUUID()
            }
          })
        })
      } else if (s.fullContent) {
        const els = parseFullContentToElements(s.fullContent)
        all.push(...els)
      }
    })

    return all
  }

  const parseFullContentToElements = (fullContent: string): any[] => {
    // Try to parse as JSON first (new FDX format with ScreenplayElements)
    try {
      const parsed = JSON.parse(fullContent)
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type) {
        // This is already ScreenplayElements JSON - return as is
        return parsed
      }
    } catch (e) {
      // Not JSON, fall through to text parsing
    }

    // Legacy text parsing for old format
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
    try {
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
    } catch (error) {
      console.error('Error handling content change:', error)
      setError('Error updating script content. Your changes may not be saved.')
    }
  }

  const parseScenes = (content: string): Scene[] => {
    const scenes: Scene[] = []

    // Try to parse as ScreenplayElements JSON first
    try {
      const elements = JSON.parse(content)
      if (Array.isArray(elements)) {
        let currentSceneElements: any[] = []
        let currentSceneHeading = ""
        let sceneId = 1

        elements.forEach(element => {
          if (element.type === 'scene_heading') {
            // Save previous scene if it exists - REMOVED LENGTH CHECK
            if (currentSceneHeading) {
              const sceneContent = JSON.stringify(currentSceneElements)
              scenes.push({
                id: sceneId.toString(),
                heading: currentSceneHeading,
                content: sceneContent,
              })
              sceneId++
            }

            // Start new scene
            currentSceneHeading = element.children[0].text
            currentSceneElements = [element]
          } else {
            // Add to current scene
            currentSceneElements.push(element)
          }
        })

        // Add the last scene - REMOVED LENGTH CHECK
        if (currentSceneHeading) {
          const sceneContent = JSON.stringify(currentSceneElements)
          scenes.push({
            id: sceneId.toString(),
            heading: currentSceneHeading,
            content: sceneContent,
          })
        }

        return scenes
      }
    } catch (e) {
      // Not JSON, fall through to text parsing
    }

    // Legacy text parsing
    const lines = content.split("\n")
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


  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center max-w-md p-8">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Error Loading Script</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <div className="space-y-3">
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => router.push("/")}
              className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    )
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

  const sceneNumbers = script.scenes.map((_: Scene, index: number) => index + 1)

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
            {sceneNumbers.slice(0, 3).map((num: number, index: number) => (
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

      {/* Offline Mode Banner */}
      {isOfflineMode && (
        <div className="fixed top-[112px] left-0 right-0 z-30 bg-amber-500/90 backdrop-blur border-b border-amber-600 px-6 py-2">
          <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-amber-900">
            <span className="text-lg">⚠️</span>
            <span className="font-medium text-sm">
              Offline Mode: Memory backend not connected. Changes will be saved locally only.
            </span>
          </div>
        </div>
      )}

      {/* Main Content Area - starts below both headers and banner */}
      <div className={`${isOfflineMode ? 'pt-[150px]' : 'pt-[112px]'} w-full flex`}>
        {/* Left Sidebar - Scene Outline */}
        {isOutlineOpen && (
          <div className="w-96 transition-all duration-300">
            <SceneDescriptions
              scenes={script.scenes}
              editorContent={script.content}
              currentSceneInView={currentSceneInView}
              onSceneSelect={() => {}}
              projectId={currentProjectId || undefined}
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
            <AIChatbot projectId={currentProjectId || undefined} isVisible={true} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function EditorPage() {
  return (
    <ErrorBoundary>
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
    </ErrorBoundary>
  )
}
