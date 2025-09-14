"use client"

import type React from "react"
import { FileText, Clock, Users } from "lucide-react"

interface Scene {
  id: string
  heading: string
  content: string
}

interface SceneOutlineSidebarProps {
  scenes: Scene[]
  onSceneSelect?: (sceneId: string) => void
  currentSceneInView?: string
}

export function SceneOutlineSidebar({ scenes, onSceneSelect, currentSceneInView }: SceneOutlineSidebarProps) {

  const generateSceneSummary = (scene: Scene): string => {
    const lines = scene.content.split('\n').filter(line => line.trim())
    
    // Extract action lines (not dialogue or character names)
    const actionLines = lines.filter(line => {
      const trimmed = line.trim()
      return !trimmed.match(/^(INT\.|EXT\.|FADE|CUT)/i) && 
             !trimmed.match(/^\s+[A-Z][A-Z\s]{2,}$/) && // Not character names
             !trimmed.match(/^\s{8,}/) && // Not dialogue
             trimmed.length > 0
    })

    if (actionLines.length === 0) return "New scene"
    
    // Take first meaningful action line and truncate
    const firstAction = actionLines[0].trim()
    return firstAction.length > 60 ? `${firstAction.substring(0, 57)}...` : firstAction
  }

  const extractCharacters = (scene: Scene): string[] => {
    const lines = scene.content.split('\n')
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

    return Array.from(characters).slice(0, 3) // Limit to 3 characters per scene
  }

  return (
    <div className="h-[calc(100vh-112px)] flex flex-col bg-white border-r border-gray-200 shadow-lg overflow-hidden">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white p-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center">
            <FileText className="w-4 h-4 text-blue-600" />
          </div>
          <h3 className="font-semibold text-slate-700">Scene Descriptions</h3>
        </div>
      </div>

      {/* Scene Count Info */}
      <div className="p-4 border-b border-gray-200 bg-gray-50/50">
        <div className="text-xs text-gray-600 space-y-2">
          <div className="flex justify-between items-center">
            <span>Total Scenes</span>
            <span className="font-medium text-slate-700 bg-white border border-gray-200 px-2 py-1 rounded shadow-sm">
              {scenes.length}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span>Estimated Runtime</span>
            <span className="font-medium text-slate-700 bg-white border border-gray-200 px-2 py-1 rounded shadow-sm">
              {Math.max(1, Math.ceil(scenes.reduce((acc, scene) => 
                acc + scene.content.split(/\s+/).length, 0) / 250))} min
            </span>
          </div>
        </div>
      </div>

      {/* Scenes List - Enhanced Independent Scrolling */}
      <div className="flex-1 overflow-hidden relative">
        <div className="h-full overflow-y-auto hover:overflow-y-scroll">
          <div className="p-4 space-y-3">
            {scenes.length === 0 ? (
              <div className="p-6 text-center">
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-sm">
                  <FileText className="w-6 h-6 text-gray-400" />
                </div>
                <p className="text-sm text-gray-500 mb-2 font-medium">No scenes yet</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Start writing with scene headings like:<br />
                  <code className="bg-gray-100 border border-gray-200 px-2 py-1 rounded text-xs mt-2 inline-block shadow-sm">
                    INT. COFFEE SHOP - DAY
                  </code>
                </p>
              </div>
            ) : (
              scenes.map((scene, index) => {
                const summary = generateSceneSummary(scene)
                const characters = extractCharacters(scene)
                const wordCount = scene.content.split(/\s+/).length

                return (
                  <div 
                    key={scene.id} 
                    className={`p-4 rounded-lg border transition-all duration-200 cursor-pointer group ${
                      currentSceneInView === scene.heading
                        ? 'bg-blue-50 border-blue-200 shadow-md ring-2 ring-blue-100'
                        : 'bg-white border-gray-200 shadow-sm hover:bg-gray-50 hover:shadow-lg hover:border-gray-300 hover:-translate-y-0.5'
                    }`}
                    onClick={() => onSceneSelect?.(scene.id)}
                  >
                    {/* Scene Number & Heading */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                        currentSceneInView === scene.heading 
                          ? 'bg-blue-200' 
                          : 'bg-blue-100 group-hover:bg-blue-200'
                      }`}>
                        <span className="text-xs font-semibold text-blue-700">{index + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-slate-800 mb-1 leading-tight group-hover:text-slate-900">
                          {scene.heading}
                        </h4>
                        <p className="text-xs text-gray-600 leading-relaxed group-hover:text-gray-700">
                          {summary}
                        </p>
                      </div>
                    </div>

                    {/* Scene Metadata */}
                    <div className="flex items-center gap-4 text-xs text-gray-500 group-hover:text-gray-600">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{Math.max(1, Math.ceil(wordCount / 250))} min</span>
                      </div>
                      {characters.length > 0 && (
                        <div className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          <span className="truncate">
                            {characters.join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
        
        {/* Scroll Fade Indicators */}
        {scenes.length > 3 && (
          <>
            <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-gray-50 to-transparent pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-gray-50 to-transparent pointer-events-none"></div>
          </>
        )}
      </div>

      {/* Footer with Visual Enhancement */}
      <div className="p-4 border-t border-gray-200 bg-gray-50/50">
        <div className="text-xs text-gray-500 text-center flex items-center justify-center gap-1">
          <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
          <span>Scene navigation</span>
          <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
          <span>Independent scrolling</span>
          <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
        </div>
      </div>
    </div>
  )
}