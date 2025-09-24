"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'

export interface Scene {
  id: string
  heading: string
  content: string
  startLine?: number
  endLine?: number
}

export interface ScriptPage {
  id: number
  content: string
  scenes: Scene[]
  startLine: number
  endLine: number
}

export interface ScrollPosition {
  currentPageInView: number
  currentSceneInView: string
  totalPages: number
}

interface ScreenplayContextType {
  // Content state
  content: string
  setContent: (content: string) => void
  
  // Page state
  pages: ScriptPage[]
  currentPageInView: number
  totalPages: number
  
  // Scene state
  scenes: Scene[]
  currentSceneInView: string
  setCurrentSceneInView: (sceneId: string) => void
  
  // Page tracking
  setCurrentPageInView: (pageNumber: number) => void
  
  // Content updates with debouncing
  updateContent: (newContent: string) => void
  
  // Scene navigation
  scrollToScene: (sceneId: string) => void
  
  // Page refs for intersection observer
  pageRefs: React.MutableRefObject<(HTMLDivElement | null)[]>
  
  // Editor refs for content management
  editorRefs: React.MutableRefObject<(HTMLDivElement | null)[]>
}

const ScreenplayContext = createContext<ScreenplayContextType | undefined>(undefined)

export function useScreenplay() {
  const context = useContext(ScreenplayContext)
  if (context === undefined) {
    throw new Error('useScreenplay must be used within a ScreenplayProvider')
  }
  return context
}

interface ScreenplayProviderProps {
  children: React.ReactNode
  initialContent?: string
  onContentChange?: (content: string) => void
}

export function ScreenplayProvider({ 
  children, 
  initialContent = '', 
  onContentChange 
}: ScreenplayProviderProps) {
  const [content, setContent] = useState(initialContent)
  const [currentPageInView, setCurrentPageInView] = useState(1)
  const [currentSceneInView, setCurrentSceneInView] = useState('')
  
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const editorRefs = useRef<(HTMLDivElement | null)[]>([])
  const updateTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  // Parse scenes from content
  const parseScenes = useCallback((text: string): Scene[] => {
    if (!text.trim()) return []
    
    const lines = text.split('\n')
    const scenes: Scene[] = []
    let currentSceneContent = ''
    let currentSceneHeading = ''
    let sceneId = 1
    let startLine = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmedLine = line.trim()

      // Check if line is a scene heading (starts with INT. or EXT.)
      if (trimmedLine.match(/^(INT\.|EXT\.)/i)) {
        // Save previous scene if it exists
        if (currentSceneHeading) {
          scenes.push({
            id: sceneId.toString(),
            heading: currentSceneHeading,
            content: currentSceneContent.trim(),
            startLine,
            endLine: i - 1,
          })
          sceneId++
        }

        // Start new scene
        currentSceneHeading = trimmedLine
        currentSceneContent = line + '\n'
        startLine = i
      } else {
        currentSceneContent += line + '\n'
      }
    }

    // Add the last scene
    if (currentSceneHeading) {
      scenes.push({
        id: sceneId.toString(),
        heading: currentSceneHeading,
        content: currentSceneContent.trim(),
        startLine,
        endLine: lines.length - 1,
      })
    }

    return scenes
  }, [])

  // Split content into pages with scene awareness
  const splitContentIntoPages = useCallback((text: string): ScriptPage[] => {
    if (!text.trim()) {
      return [{ id: 1, content: '', scenes: [], startLine: 0, endLine: 0 }]
    }
    
    const lines = text.split('\n')
    const linesPerPage = 55
    const pages: ScriptPage[] = []
    const allScenes = parseScenes(text)
    
    for (let i = 0; i < lines.length; i += linesPerPage) {
      const pageLines = lines.slice(i, i + linesPerPage)
      const pageContent = pageLines.join('\n')
      const pageStartLine = i
      const pageEndLine = Math.min(i + linesPerPage - 1, lines.length - 1)
      
      // Find scenes that intersect with this page
      const scenesInPage = allScenes.filter(scene => {
        const sceneStart = scene.startLine || 0
        const sceneEnd = scene.endLine || 0
        return (sceneStart <= pageEndLine && sceneEnd >= pageStartLine)
      })
      
      pages.push({
        id: Math.floor(i / linesPerPage) + 1,
        content: pageContent,
        scenes: scenesInPage,
        startLine: pageStartLine,
        endLine: pageEndLine
      })
    }
    
    // Ensure at least one page exists
    if (pages.length === 0) {
      pages.push({ id: 1, content: '', scenes: [], startLine: 0, endLine: 0 })
    }
    
    return pages
  }, [parseScenes])

  // Memoized scenes and pages
  const scenes = React.useMemo(() => parseScenes(content), [content, parseScenes])
  const pages = React.useMemo(() => splitContentIntoPages(content), [content, splitContentIntoPages])
  const totalPages = pages.length

  // Update refs when pages change
  useEffect(() => {
    pageRefs.current = pageRefs.current.slice(0, pages.length)
    editorRefs.current = editorRefs.current.slice(0, pages.length)
  }, [pages.length])

  // Debounced content update
  const updateContent = useCallback((newContent: string) => {
    setContent(newContent)
    
    // Clear existing timeout
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current)
    }
    
    // Debounce the external callback
    updateTimeoutRef.current = setTimeout(() => {
      onContentChange?.(newContent)
    }, 300)
  }, [onContentChange])

  // Scroll to specific scene
  const scrollToScene = useCallback((sceneId: string) => {
    const scene = scenes.find(s => s.id === sceneId)
    if (!scene || scene.startLine === undefined) return
    
    // Find which page contains this scene
    const pageIndex = pages.findIndex(page => 
      page.scenes.some(s => s.id === sceneId)
    )
    
    if (pageIndex >= 0 && pageRefs.current[pageIndex]) {
      pageRefs.current[pageIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
    }
  }, [scenes, pages])

  // Update content when initialContent changes
  useEffect(() => {
    if (initialContent !== content) {
      setContent(initialContent)
    }
  }, [initialContent])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
      }
    }
  }, [])

  const value: ScreenplayContextType = {
    content,
    setContent,
    pages,
    currentPageInView,
    totalPages,
    scenes,
    currentSceneInView,
    setCurrentSceneInView,
    setCurrentPageInView,
    updateContent,
    scrollToScene,
    pageRefs,
    editorRefs,
  }

  return (
    <ScreenplayContext.Provider value={value}>
      {children}
    </ScreenplayContext.Provider>
  )
}