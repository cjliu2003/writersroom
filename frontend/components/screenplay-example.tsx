"use client"

import React, { useState } from "react"
import { ScreenplayEditor } from "./screenplay-editor"
import { SceneOutlineSidebar } from "./scene-outline-sidebar"

interface Scene {
  id: string
  heading: string
  content: string
}

export function ScreenplayExample() {
  const [scenes, setScenes] = useState<Scene[]>([])
  const [currentScene] = useState<string>("")

  const handleContentChange = (newContent: string) => {
    // Parse scenes from content for sidebar
    try {
      const parsed = JSON.parse(newContent)
      if (Array.isArray(parsed)) {
        interface BlockType {
          id?: string
          type: string
          children: Array<{ text: string }>
        }
        
        const extractedScenes = parsed
          .filter((block: BlockType) => block.type === 'scene_heading')
          .map((block: BlockType, index: number) => ({
            id: block.id || `scene_${index}`,
            heading: block.children.map(child => child.text).join(''),
            content: '' // We could extract following content blocks here
          }))
        setScenes(extractedScenes)
      }
    } catch {
      // If parsing fails, content might not be JSON yet
    }
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-80 border-r border-gray-200 bg-gray-50">
        <SceneOutlineSidebar 
          scenes={scenes}
          currentSceneInView={currentScene}
          onSceneSelect={(sceneId) => {
            // Could implement navigation to specific scene
            console.log('Navigate to scene:', sceneId)
          }}
        />
      </div>
      
      {/* Main Editor */}
      <div className="flex-1">
        <ScreenplayEditor
          onChange={handleContentChange}
          onCurrentBlockTypeChange={(type) => {
            // Handle block type changes if needed
            console.log('Current block type:', type)
          }}
        />
      </div>
    </div>
  )
}