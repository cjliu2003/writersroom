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
import { SceneMemory } from '../../../shared/types'
import { markOpened } from '@/lib/projectRegistry'
import { API_BASE_URL, apiFetch } from '@/lib/api'
import { loadLayoutPrefs, saveLayoutPrefs, type EditorLayoutPrefs } from '@/utils/layoutPrefs'
import { useChunkRetry } from '@/hooks/useChunkRetry'

interface MemoryScene extends SceneMemory {
  themes: string[]
}

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

        // Load from snapshot backend (atomic storage)
        console.log('🔄 Editor: Loading project from snapshot backend:', projectId)
        try {
          const API_PATH = '/api'

          // First try the new snapshot endpoint
          console.log('📸 Editor: Fetching from snapshot:', `${API_BASE_URL}${API_PATH}/projects/${projectId}/snapshot`)
          let response = await apiFetch(`${API_BASE_URL}${API_PATH}/projects/${projectId}/snapshot`)

          let memoryScenes: MemoryScene[] = []

          if (response.ok) {
            // Use snapshot data
            const result = await response.json()
            console.log('✅ Editor: Snapshot loaded successfully')
            if (result.success && result.data) {
              const snapshot = result.data
              memoryScenes = snapshot.scenes || []
              console.log(`   📊 Snapshot version: ${snapshot.version}`)
              console.log(`   🎬 Scene count: ${memoryScenes.length}`)
              console.log(`   📝 Title: ${snapshot.title}`)
            }
          } else if (response.status === 404) {
            // Fallback to old memory/all endpoint for backward compatibility
            console.log('⚠️ No snapshot found, falling back to memory/all endpoint')
            response = await apiFetch(`${API_BASE_URL}${API_PATH}/memory/all?projectId=${projectId}`)

            if (response.ok) {
              const result = await response.json()
              console.log('📊 Editor: Memory backend response:', result)
              if (result.success && result.data) {
                memoryScenes = result.data
              }
            } else {
              console.log("❌ Backend response not OK", response.status, response.statusText)
              setIsOfflineMode(true)
            }
          } else {
            console.log("❌ Backend response not OK", response.status, response.statusText)
            setIsOfflineMode(true)
          }

          if (memoryScenes.length > 0) {
              // Sort scenes by sequence index with robust error handling
              const scenesWithIndex = memoryScenes.map((scene, originalIndex) => {
                let sequenceIndex = originalIndex // fallback to original order

                try {
                  if (scene.fullContent) {
                    const elements = JSON.parse(scene.fullContent)
                    if (Array.isArray(elements) && elements.length > 0) {
                      // Check multiple possible locations for sequence index
                      const firstElement = elements[0]
                      sequenceIndex = firstElement?.metadata?.sequenceIndex
                        || firstElement?.sequenceIndex
                        || elements.find(el => el.metadata?.sequenceIndex !== undefined)?.metadata?.sequenceIndex
                        || elements.find(el => el.sequenceIndex !== undefined)?.sequenceIndex
                        || originalIndex
                    }
                  }
                } catch (error) {
                  console.warn(`Error parsing sequence index for scene "${scene.slugline}":`, error)
                }

                return { scene, sequenceIndex, originalIndex }
              })

              // Sort by sequence index, fallback to original order
              scenesWithIndex.sort((a, b) => {
                if (a.sequenceIndex !== b.sequenceIndex) {
                  return a.sequenceIndex - b.sequenceIndex
                }
                return a.originalIndex - b.originalIndex // Stable sort fallback
              })

              const sortedScenes = scenesWithIndex.map(item => item.scene)

              console.log('Scene ordering loaded:', sortedScenes.length, 'scenes')

              const scriptContent = convertMemoryScenesToScript(sortedScenes)
              const scenes = parseScenes(scriptContent)

              const newScript: Script = {
                id: projectId,
                title: extractTitleFromScenes(sortedScenes) || 'Untitled Script',
                scenes: scenes,
                content: scriptContent,
                createdAt: new Date().toISOString()
              }

              console.log('Script loaded:', newScript.title, '-', newScript.scenes.length, 'scenes')

              setScript(newScript)
              // Also save to localStorage for future editing
              localStorage.setItem("current-script", JSON.stringify(newScript))
              setIsLoading(false)
              return
            } else {
              console.log('❌ Editor: No scenes found in backend response')
              console.warn("⚠️ Script has no scenes, initializing empty script")

              // Get project title from registry
              const projects = JSON.parse(localStorage.getItem('wr.projects') || '[]')
              const project = projects.find((p: any) => p.projectId === projectId)
              const title = project?.title || 'Untitled Script'

              const emptyScript: Script = {
                id: projectId,
                title: title,
                scenes: [],
                content: '',
                createdAt: new Date().toISOString()
              }

              setScript(emptyScript)
              localStorage.setItem(`project-${projectId}`, JSON.stringify(emptyScript))
              setIsLoading(false)
              return
            }
        } catch (error) {
          console.error('Editor: Failed to load script from memory backend:', error)
          setIsOfflineMode(true)
        }
      }

      // Enhanced fallback system when backend is down
      if (!script) {  // Only fallback if no script has been loaded yet
        console.log('Backend unavailable, using localStorage fallback...')
        console.warn('Offline Mode triggered: backend unavailable or unreachable')
        setIsOfflineMode(true)

      // Try lastParsedProject first (most recent FDX upload)
      const lastParsedProject = localStorage.getItem('lastParsedProject')
      if (lastParsedProject && projectId) {
        try {
          const parsed = JSON.parse(lastParsedProject)
          if (parsed.projectId === projectId && parsed.scenes && parsed.scenes.length > 0) {
            console.log('✅ Found lastParsedProject with', parsed.scenes.length, 'elements')

            const fallbackScript: Script = {
              id: parsed.projectId,
              title: parsed.title || 'Imported Script',
              scenes: parseScenes(JSON.stringify(parsed.scenes)),
              content: JSON.stringify(parsed.scenes),
              createdAt: parsed.timestamp || new Date().toISOString()
            }

            console.log('🔄 OFFLINE MODE: Loading script with', fallbackScript.scenes.length, 'scenes')
            setScript(fallbackScript)
            setIsLoading(false)
            return
          }
        } catch (error) {
          console.warn('Failed to parse lastParsedProject:', error)
        }
      }

      // Fallback to project-specific localStorage
      const projectSpecificKey = `project-${projectId}`
      const savedScript = localStorage.getItem(projectSpecificKey)
      if (savedScript) {
        const parsedScript = JSON.parse(savedScript)
        console.log("🧠 Project fallback: Updating editor from project-specific localStorage...")
        console.log("Using key:", projectSpecificKey)
        console.log("Stored script title:", parsedScript.title)
        console.log("Content length:", parsedScript.content?.length || 0)

        // If we have full content, use it
        if (parsedScript.content && parsedScript.content.length > 50) {
          console.log("✅ Found full content in project localStorage")
          setScript(parsedScript)
          setIsLoading(false)
          return
        }

        setScript(parsedScript)
      } else {
        console.log("❌ No project-specific localStorage found for key:", projectSpecificKey)
        // Fallback to generic current-script for backward compatibility
        const genericScript = localStorage.getItem("current-script")
        if (genericScript) {
          const parsedScript = JSON.parse(genericScript)
          console.log("🧠 Using generic localStorage fallback...")
          setScript(parsedScript)
        } else {
          router.push("/")
        }
      }
      setIsLoading(false)
      }  // End of if (!script) condition

      // Fallback: Ensure loading always resolves
      if (isLoading) {
        console.warn('⚠️ Loading state fallback triggered - ensuring spinner stops')
        setIsLoading(false)
      }
    }

    loadScript().catch((err) => {
      console.error('Critical error loading script:', err)
      setError('Failed to load script. Please try refreshing the page.')
      setIsLoading(false)
    })
  }, [router, searchParams])

  // Helper functions moved outside useEffect to avoid dependency warnings

  // Track script loading for error handling
  useEffect(() => {
    if (script) {
      // Script loaded successfully - could add analytics here if needed
    }
  }, [script])

  const extractTitleFromScenes = (memoryScenes: MemoryScene[]): string | null => {
    // Use stored projectTitle from FDX import, without scene count
    if (memoryScenes.length > 0 && memoryScenes[0].projectTitle) {
      return memoryScenes[0].projectTitle
    }
    return null
  }

  const convertMemoryScenesToScript = (memoryScenes: MemoryScene[]): string => {
    const allScreenplayElements: any[] = []

    memoryScenes.forEach((scene) => {
      // Use fullContent if available (from FDX import), otherwise fall back to constructed content
      if (scene.fullContent) {
        // Parse the fullContent back into ScreenplayElements
        const elements = parseFullContentToElements(scene.fullContent)
        allScreenplayElements.push(...elements)
      } else {
        // Fallback: construct content from scene data
        // Add scene heading
        allScreenplayElements.push({
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
          allScreenplayElements.push({
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
            allScreenplayElements.push({
              type: 'character',
              children: [{ text: character.toUpperCase() }],
              id: `char_${Date.now()}_${Math.random()}`,
              metadata: {
                timestamp: new Date().toISOString(),
                uuid: crypto.randomUUID()
              }
            })

            allScreenplayElements.push({
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
    return JSON.stringify(allScreenplayElements)
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
