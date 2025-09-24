"use client"

import React, { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Upload, FileText, AlertCircle, Plus, Clock, Eye, X, Trash } from "lucide-react"
import { useRouter } from "next/navigation"
import DragOverlay from "@/components/DragOverlay"
import LoadingOverlay from "@/components/LoadingOverlay"
import { listProjects, upsertProject, removeProject, mirrorToBackend, type ProjectSummary } from "@/lib/projectRegistry"
import { uploadFdxFile } from "@/lib/api"

interface UploadResult {
  success: boolean
  title?: string
  sceneCount?: number
  sluglines?: string[]
  error?: string
  projectId?: string
}

interface Project {
  id: string
  title: string
  sceneCount: number
  lastModified: Date
  status: 'draft' | 'in-progress' | 'completed'
}

export default function HomePage() {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [showTitleModal, setShowTitleModal] = useState(false)
  const [newScriptTitle, setNewScriptTitle] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const hasUploadedRef = useRef(false) // StrictMode double-invoke guard
  const router = useRouter()

  // Load projects from localStorage on mount
  useEffect(() => {
    const savedProjects = listProjects()

    if (savedProjects.length > 0) {
      // Convert saved projects to display format
      const displayProjects = savedProjects.map(p => ({
        id: p.projectId,
        title: p.title,
        sceneCount: p.sceneCount,
        lastModified: new Date(p.lastOpenedAt || p.updatedAt || p.createdAt),
        status: p.status as 'draft' | 'in-progress' | 'completed'
      }))
      setProjects(displayProjects)
    } else {
      // Show sample projects if no real projects exist
      setProjects([
        {
          id: '1',
          title: 'The Last Stand',
          sceneCount: 24,
          lastModified: new Date('2024-01-15'),
          status: 'in-progress'
        },
        {
          id: '2',
          title: 'Midnight Runner',
          sceneCount: 18,
          lastModified: new Date('2024-01-10'),
          status: 'draft'
        }
      ])
    }
  }, [])

  // Simple window-level drag detection
  useEffect(() => {
    let dragCounter = 0

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault()
      dragCounter++
      if (dragCounter === 1) {
        setIsDragging(true)
      }
    }

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault()
      dragCounter--
      if (dragCounter === 0) {
        setIsDragging(false)
      }
    }

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
    }

    const handleWindowDrop = (e: DragEvent) => {
      e.preventDefault()
      dragCounter = 0
      setIsDragging(false)
    }

    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleWindowDrop)

    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('drop', handleWindowDrop)
    }
  }, [])

  const handleFileUpload = async (file: File) => {
    // StrictMode double-invoke guard
    if (hasUploadedRef.current) {
      console.log('🚫 Duplicate upload prevented by StrictMode guard')
      return
    }
    hasUploadedRef.current = true

    console.log("📥 Upload triggered")
    console.log("Uploaded file name:", file.name)
    console.log("File size:", file.size, "bytes")

    // Cancel any previous upload
    if (abortControllerRef.current) {
      console.log('📋 Canceling previous upload...')
      abortControllerRef.current.abort()
    }

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.fdx')) {
      const error = 'Please upload a .fdx file'
      setUploadError(error)
      setUploadResult({
        success: false,
        error
      })
      hasUploadedRef.current = false // Allow retry
      return
    }

    // Validate file size (50MB limit)
    const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
    if (file.size > MAX_FILE_SIZE) {
      const error = 'File too large. Please upload a file smaller than 50MB.'
      setUploadError(error)
      setUploadResult({
        success: false,
        error
      })
      hasUploadedRef.current = false // Allow retry
      return
    }

    // Reset state and start upload
    setIsUploading(true)
    setIsParsing(true)
    setUploadResult(null)
    setUploadError(null)

    // Create new abort controller for this upload
    abortControllerRef.current = new AbortController()

    try {
      console.log("🌐 Uploading FDX to Express backend (port 3003)...")

      const result = await uploadFdxFile(file)

      console.log("✅ FDX Parse Success:")
      console.log("Parsed title:", result.title)
      console.log("Scene count:", result.sceneCount)
      console.log("Sluglines:", result.sluglines)
      console.log("Project ID:", result.projectId)

      setUploadResult(result)

      if (result.success) {
        console.log('✅ FDX Upload successful:', result)

        // Save to project registry
        const projectSummary: ProjectSummary = {
          projectId: result.projectId || Date.now().toString(),
          title: result.title || file.name.replace('.fdx', ''),
          sceneCount: result.sceneCount || 0,
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }

        // Save to localStorage
        upsertProject(projectSummary)

        // Optional: Mirror to backend (fire-and-forget)
        mirrorToBackend(projectSummary)

        // Add new project to display list (optimistic update)
        const newProject: Project = {
          id: projectSummary.projectId,
          title: projectSummary.title,
          sceneCount: projectSummary.sceneCount,
          lastModified: new Date(),
          status: 'draft'
        }

        // Filter out sample projects if this is the first real project
        setProjects(prev => {
          const hasSampleProjects = prev.some(p => p.id === '1' || p.id === '2')
          if (hasSampleProjects && listProjects().length === 1) {
            // Replace samples with first real project
            return [newProject]
          }
          return [newProject, ...prev]
        })

        // Only store localStorage fallback if we have actual content
        if (result.screenplayElements && result.screenplayElements.length > 0) {
          const fullContentString = JSON.stringify(result.screenplayElements)

          const scriptForEditor = {
            id: result.projectId,
            title: result.title,
            scenes: result.sluglines?.map((slug: string, index: number) => ({
              id: index.toString(),
              heading: slug,
              content: fullContentString // Store full content for fallback
            })) || [],
            content: fullContentString, // Store full parsed screenplay elements
            createdAt: new Date().toISOString(),
            backendAvailable: true // Backend storage succeeded
          }

          // Also store as "lastParsedProject" for easy fallback access
          const fallbackProject = {
            projectId: result.projectId,
            title: result.title,
            scenes: result.screenplayElements,
            sluglines: result.sluglines || [],
            timestamp: new Date().toISOString()
          }

          localStorage.setItem(`project-${result.projectId}`, JSON.stringify(scriptForEditor))
          localStorage.setItem('lastParsedProject', JSON.stringify(fallbackProject))

          console.log('💾 Stored full project data in localStorage:', result.projectId)
          console.log('💾 Stored fallback project with', result.screenplayElements.length, 'elements')
        } else {
          console.log('⚠️ No screenplay elements to store in localStorage fallback')
        }

        // Navigate to editor immediately after parsing completes
        // Keep loading overlay visible during navigation
        console.log('🚀 Navigating to editor with projectId:', result.projectId)
        router.push(`/editor?projectId=${result.projectId}`)
        // Note: isUploading stays true to keep loading overlay visible during navigation
      }
    } catch (error) {
      console.error('❌ Upload failed:', error)

      // Handle different error types
      let errorMessage = 'Upload failed. Please try again.'

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Upload was canceled.'
          console.log('📋 Upload canceled by user or new upload')
        } else if (error.message.includes('timeout')) {
          errorMessage = 'Upload timed out. Please check your connection and try again.'
        } else if (error.message.includes('404')) {
          errorMessage = 'Backend service not available. Please check if the server is running on port 3003.'
        } else if (error.message.includes('500')) {
          errorMessage = 'Server error occurred. Please try again in a moment.'
        } else {
          errorMessage = error.message
        }
      }

      setUploadError(errorMessage)
      setUploadResult({
        success: false,
        error: errorMessage
      })

      // Re-enable upload controls only if not aborted
      if (!(error instanceof Error && error.name === 'AbortError')) {
        setIsUploading(false)
        setIsParsing(false)
        hasUploadedRef.current = false
      }
    } finally {
      // Clear the abort controller
      abortControllerRef.current = null
    }
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      handleFileUpload(file)
    }
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    console.log('🎯 File dropped on drop zone')

    const file = event.dataTransfer.files[0]
    if (file && file.name.toLowerCase().endsWith('.fdx')) {
      handleFileUpload(file)
    }
  }

  const openProject = (projectId: string) => {
    router.push(`/editor?projectId=${projectId}`)
  }

  const createNewScript = () => {
    setShowTitleModal(true)
  }

  const handleCreateScript = () => {
    if (newScriptTitle.trim()) {
      const projectId = Date.now().toString()
      const newProject = {
        projectId,
        title: newScriptTitle.trim(),
        sceneCount: 0,
        status: 'draft' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      // Save to project registry
      upsertProject(newProject)

      // Add to display list
      const displayProject = {
        id: projectId,
        title: newScriptTitle.trim(),
        sceneCount: 0,
        lastModified: new Date(),
        status: 'draft' as const
      }

      setProjects(prev => {
        const hasSampleProjects = prev.some(p => p.id === '1' || p.id === '2')
        if (hasSampleProjects && listProjects().length === 1) {
          return [displayProject]
        }
        return [displayProject, ...prev]
      })

      // Reset modal state
      setShowTitleModal(false)
      setNewScriptTitle('')

      // Navigate to blank editor
      router.push(`/editor?projectId=${projectId}&new=true`)
    }
  }

  const handleCancelModal = () => {
    setShowTitleModal(false)
    setNewScriptTitle('')
  }

  const handleDeleteProject = (project: Project, event: React.MouseEvent) => {
    event.stopPropagation() // Prevent opening the project
    setProjectToDelete(project)
    setShowDeleteModal(true)
  }

  const confirmDeleteProject = () => {
    if (projectToDelete) {
      // Remove from project registry
      removeProject(projectToDelete.id)

      // Remove from localStorage
      localStorage.removeItem(`project-${projectToDelete.id}`)

      // Remove from display list
      setProjects(prev => prev.filter(p => p.id !== projectToDelete.id))

      // Reset modal state
      setShowDeleteModal(false)
      setProjectToDelete(null)
    }
  }

  const handleCancelDelete = () => {
    setShowDeleteModal(false)
    setProjectToDelete(null)
  }

  const getStatusColor = (status: Project['status']) => {
    switch (status) {
      case 'completed': return 'bg-green-500/20 text-green-400'
      case 'in-progress': return 'bg-blue-500/20 text-blue-400'
      default: return 'bg-gray-500/20 text-gray-400'
    }
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
    })
  }

  return (
    <>
      {/* Enhanced Drag and Drop Overlay */}
      <DragOverlay isVisible={isDragging} />

      {/* Loading Overlay */}
      <LoadingOverlay
        isVisible={isParsing}
        title={uploadResult?.title || "Processing your screenplay"}
      />

      <div
        className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6"
        onDrop={handleDrop}
      >
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-white mb-4">
              WritersRoom
            </h1>
            <p className="text-slate-300 text-xl">
              Professional screenwriting meets AI assistance
            </p>
          </div>

          {/* Project Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
            {/* Upload a Script Button */}
            <Card className={`border-2 border-dashed transition-all duration-200 cursor-pointer hover:scale-[1.02] ${
              isDragging
                ? 'border-purple-400 bg-purple-50/10 ring-4 ring-purple-400 shadow-lg shadow-purple-500/20'
                : 'border-slate-600 bg-slate-800/50 hover:border-slate-500 hover:bg-slate-800/70'
            } backdrop-blur`}>
              <CardContent className="p-6 text-center">
                <input
                  type="file"
                  accept=".fdx"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="fdx-file-upload"
                  disabled={isUploading}
                />
                <Button
                  onClick={() => {
                    if (isUploading && abortControllerRef.current) {
                      // Cancel upload if currently uploading
                      abortControllerRef.current.abort()
                      setIsUploading(false)
                      setIsParsing(false)
                      hasUploadedRef.current = false
                      setUploadError('Upload canceled')
                    } else {
                      // Start new upload
                      document.getElementById('fdx-file-upload')?.click()
                    }
                  }}
                  variant="ghost"
                  disabled={false} // Always enabled for cancel functionality
                  className="h-auto flex flex-col items-center space-y-3 w-full p-6 hover:bg-transparent text-slate-300 hover:text-white"
                >
                  {isUploading ? (
                    <>
                      <div className="w-12 h-12 border-2 border-blue-600/50 border-t-blue-600 rounded-full animate-spin" />
                      <span className="text-sm opacity-60">
                        {isParsing ? 'Processing...' : 'Uploading...'}
                      </span>
                      <span className="text-xs opacity-40 mt-1">Click to cancel</span>
                    </>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-lg bg-blue-600/20 flex items-center justify-center">
                        <Upload className="w-6 h-6 text-blue-400" />
                      </div>
                      <div>
                        <p className="font-semibold">Upload a Script</p>
                        <p className="text-xs text-slate-400">Drop FDX file or click</p>
                      </div>
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* New Project Button */}
            <Card className="border-slate-700 bg-slate-800/50 backdrop-blur hover:bg-slate-800/70 transition-all duration-200 cursor-pointer hover:scale-[1.02]">
              <CardContent className="p-6 text-center">
                <Button
                  onClick={createNewScript}
                  variant="ghost"
                  className="h-auto flex flex-col items-center space-y-3 w-full p-6 hover:bg-transparent text-slate-300 hover:text-white"
                >
                  <div className="w-12 h-12 rounded-lg bg-purple-600/20 flex items-center justify-center">
                    <Plus className="w-6 h-6 text-purple-400" />
                  </div>
                  <div>
                    <p className="font-semibold">Start New Script</p>
                    <p className="text-xs text-slate-400">Create from scratch</p>
                  </div>
                </Button>
              </CardContent>
            </Card>

            {/* Project Tiles */}
            {projects.map((project) => (
              <Card 
                key={project.id}
                className="border-slate-700 bg-slate-800/50 backdrop-blur hover:bg-slate-800/70 transition-all duration-200 cursor-pointer hover:scale-[1.02]"
                onClick={() => openProject(project.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <FileText className="w-8 h-8 text-slate-400 flex-shrink-0" />
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(project.status)}`}>
                        {project.status.replace('-', ' ')}
                      </span>
                      <Button
                        onClick={(e) => handleDeleteProject(project, e)}
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                      >
                        <Trash className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <h3 className="text-white font-semibold text-lg mb-2 truncate">{project.title}</h3>
                  <div className="space-y-1 text-sm text-slate-400">
                    <div className="flex items-center gap-2">
                      <Eye className="w-4 h-4" />
                      <span>{project.sceneCount} scenes</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>{formatDate(project.lastModified)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Enhanced Error Display */}
          {((uploadResult && !uploadResult.success) || uploadError) && (
            <div className="max-w-md mx-auto mb-8">
              <div className="flex items-center gap-3 text-red-400 bg-red-900/20 p-4 rounded-lg border border-red-800">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">Upload Failed</p>
                  <p className="text-sm">{uploadError || uploadResult?.error}</p>
                  {uploadError && uploadError.includes('port 3003') && (
                    <p className="text-xs mt-1 text-red-300">
                      Make sure the Express backend is running with: <code>npm run dev</code>
                    </p>
                  )}
                </div>
                <Button
                  onClick={() => {
                    setUploadError(null)
                    setUploadResult(null)
                    hasUploadedRef.current = false // Allow retry
                  }}
                  variant="ghost"
                  size="sm"
                  className="text-red-400 hover:text-red-300 hover:bg-red-800/20"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="text-center mt-3 flex gap-2 justify-center">
                <Button
                  onClick={() => {
                    setUploadError(null)
                    setUploadResult(null)
                    hasUploadedRef.current = false // Allow retry
                    document.getElementById('fdx-file-upload')?.click()
                  }}
                  variant="outline"
                  size="sm"
                  className="text-red-400 border-red-800 hover:bg-red-900/20"
                  disabled={isUploading}
                >
                  Try Again
                </Button>
                {isUploading && (
                  <Button
                    onClick={() => {
                      if (abortControllerRef.current) {
                        abortControllerRef.current.abort()
                        setIsUploading(false)
                        setIsParsing(false)
                        hasUploadedRef.current = false
                        setUploadError('Upload canceled')
                      }
                    }}
                    variant="ghost"
                    size="sm"
                    className="text-slate-400 hover:text-slate-300"
                  >
                    Cancel Upload
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Beautiful Title Modal */}
      {showTitleModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-600 rounded-xl shadow-2xl p-8 max-w-md w-full mx-4 relative">
            {/* Close button */}
            <Button
              onClick={handleCancelModal}
              variant="ghost"
              size="sm"
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </Button>

            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-purple-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-purple-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Create New Script</h2>
              <p className="text-slate-300">What&apos;s the title of your masterpiece?</p>
            </div>

            {/* Input */}
            <div className="mb-6">
              <input
                type="text"
                value={newScriptTitle}
                onChange={(e) => setNewScriptTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateScript()
                  if (e.key === 'Escape') handleCancelModal()
                }}
                placeholder="Enter script title..."
                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                autoFocus
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <Button
                onClick={handleCancelModal}
                variant="ghost"
                className="flex-1 text-slate-300 hover:text-white hover:bg-slate-700/50"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateScript}
                disabled={!newScriptTitle.trim()}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Script
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && projectToDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-600 rounded-xl shadow-2xl p-8 max-w-md w-full mx-4 relative">
            {/* Close button */}
            <Button
              onClick={handleCancelDelete}
              variant="ghost"
              size="sm"
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </Button>

            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-red-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash className="w-8 h-8 text-red-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Delete Script</h2>
              <p className="text-slate-300">
                Are you sure you want to delete <span className="font-semibold text-white">&quot;{projectToDelete.title}&quot;</span>?
              </p>
              <p className="text-slate-400 text-sm mt-2">This action cannot be undone.</p>
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <Button
                onClick={handleCancelDelete}
                variant="ghost"
                className="flex-1 text-slate-300 hover:text-white hover:bg-slate-700/50"
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDeleteProject}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              >
                Delete Script
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}