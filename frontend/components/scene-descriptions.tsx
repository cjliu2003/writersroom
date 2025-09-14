"use client"

import type React from "react"
import { useState, useEffect, useCallback } from "react"
import { FileText, Clock } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { extractScenesFromEditor, parseEditorContent } from "@/utils/scene-extraction"
import type { SceneDescription } from "@/utils/scene-extraction"

interface Scene {
  id: string
  heading: string
  content: string
}

interface SceneDescriptionsProps {
  scenes: Scene[]
  editorContent?: string // Add editor content prop
  onSceneSelect?: (sceneId: string) => void
  currentSceneInView?: string
}

export function SceneDescriptions({ scenes, editorContent, onSceneSelect, currentSceneInView }: SceneDescriptionsProps) {
  const [sceneDescriptions, setSceneDescriptions] = useState<SceneDescription[]>([])
  const [isProcessing, setIsProcessing] = useState(false)

  // Debounced scene extraction function
  const updateScenes = useCallback(() => {
    if (!editorContent) {
      // Fall back to scenes prop if no editor content
      const fallbackDescriptions: SceneDescription[] = scenes.map((scene, index) => ({
        id: index + 1,
        slugline: scene.heading,
        sceneText: scene.content,
        summary: scene.content.trim() ? "Scene contains dialogue and action." : "Scene in progress...",
        tokenCount: Math.ceil(scene.content.split(/\s+/).length * 1.3),
        runtime: `${Math.max(0.1, Math.ceil(scene.content.split(/\s+/).length * 1.3) / 250).toFixed(1)} min`
      }))
      setSceneDescriptions(fallbackDescriptions)
      return
    }

    setIsProcessing(true)
    try {
      const editorValue = parseEditorContent(editorContent)
      const extractedScenes = extractScenesFromEditor(editorValue)
      setSceneDescriptions(extractedScenes)
    } catch (error) {
      console.warn('Error extracting scenes:', error)
      // Fall back to empty state on error
      setSceneDescriptions([])
    } finally {
      setIsProcessing(false)
    }
  }, [editorContent, scenes])

  // Debounced useEffect to watch editor content changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      updateScenes()
    }, 300) // 300ms debounce as specified

    return () => clearTimeout(timeoutId)
  }, [updateScenes])

  const totalRuntime = sceneDescriptions.reduce((total, scene) => {
    // Only count completed scenes in total runtime
    if (scene.isInProgress) return total
    return total + parseFloat(scene.runtime.replace(' min', ''))
  }, 0)

  return (
    <div className="h-[calc(100vh-112px)] flex flex-col bg-gradient-to-br from-blue-50/40 to-slate-50 shadow-2xl drop-shadow-lg border-r border-slate-200/50 overflow-hidden rounded-lg backdrop-blur-sm">
      {/* Header */}
      <div className="border-b border-slate-200/80 bg-white/95 backdrop-blur-md p-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center">
            <FileText className="w-4 h-4 text-blue-600" />
          </div>
          <h3 className="font-semibold text-slate-700">Scene Descriptions</h3>
        </div>
      </div>

      {/* Scene Count and Runtime Info */}
      <div className="border-t border-slate-200/80 bg-gradient-to-r from-blue-50/50 to-purple-50/50 backdrop-blur-md p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-slate-700">Script Overview</h4>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs text-slate-700">
            <span>Total Scenes</span>
            <span className="font-medium bg-white/70 border border-slate-200 px-2 py-1 rounded">
              {sceneDescriptions.length}
            </span>
          </div>
          <div className="flex justify-between items-center text-xs text-slate-700">
            <span>Estimated Runtime</span>
            <span className="font-medium bg-white/70 border border-slate-200 px-2 py-1 rounded">
              {totalRuntime.toFixed(1)} min
            </span>
          </div>
        </div>
      </div>

      {/* Scenes List */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full p-4">
          <div className="space-y-4">
          {isProcessing && sceneDescriptions.length === 0 ? (
            <div className="p-6 text-center">
              <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-sm">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              </div>
              <p className="text-sm text-gray-500 mb-2 font-medium">Processing scenes...</p>
            </div>
          ) : sceneDescriptions.length === 0 ? (
            <div className="p-6 text-center">
              <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-sm">
                <FileText className="w-6 h-6 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500 mb-2 font-medium">No scenes yet</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                Start writing with scene headings like:<br />
                <code className="bg-gray-100 border border-gray-200 px-2 py-1 rounded text-xs mt-2 inline-block shadow-sm">
                  INT. COFFEE SHOP – DAY
                </code>
              </p>
            </div>
          ) : (
            sceneDescriptions.map((scene) => {
              const isCurrentScene = currentSceneInView === scene.slugline
              
              return (
                <div 
                  key={scene.id} 
                  className={`rounded-2xl border transition-all duration-200 cursor-pointer group ${
                    isCurrentScene
                      ? 'bg-blue-50 border-blue-200 shadow-sm ring-2 ring-blue-100/50'
                      : 'bg-white/70 border-slate-200 shadow-sm hover:bg-white hover:border-blue-300 hover:shadow-md'
                  }`}
                  onClick={() => onSceneSelect?.(scene.id.toString())}
                >
                  <div className="px-4 py-3">
                    {/* Scene Header with Number and Slugline */}
                    <div className="flex items-start gap-3 mb-2">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                        isCurrentScene 
                          ? 'bg-blue-200' 
                          : 'bg-slate-100 group-hover:bg-blue-100'
                      }`}>
                        <span className={`text-xs font-medium transition-colors ${
                          isCurrentScene ? 'text-blue-700' : 'text-slate-700 group-hover:text-blue-700'
                        }`}>{scene.id}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-slate-800 leading-relaxed group-hover:text-blue-700 transition-colors">
                          {scene.slugline.toUpperCase()}
                        </h4>
                      </div>
                    </div>

                    {/* Scene Content */}
                    <div className="ml-8">
                      {scene.isInProgress ? (
                        <div className="flex items-center gap-1.5 mb-2">
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                          <p className="text-xs font-medium text-blue-600 leading-relaxed">
                            Scene in Progress
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-600 leading-relaxed mb-2 group-hover:text-slate-700 transition-colors">
                          {scene.summary}
                        </p>
                      )}

                      {/* Scene Metadata */}
                      <div className="flex items-center justify-between text-xs text-slate-400 group-hover:text-slate-500 transition-colors">
                        {scene.isInProgress ? (
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>Writing...</span>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>{scene.runtime}</span>
                            </div>
                            <span>{scene.tokenCount.toLocaleString()} tokens</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}