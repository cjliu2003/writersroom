"use client"

import React, { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Upload, FileText, CheckCircle, AlertCircle, Plus, Folder, Clock, Eye } from "lucide-react"
import { useRouter } from "next/navigation"
import DragOverlay from "@/components/DragOverlay"
import LoadingOverlay from "@/components/LoadingOverlay"
import { listProjects, upsertProject, mirrorToBackend, type ProjectSummary } from "@/lib/projectRegistry"

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

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      dragCounter = 0
      setIsDragging(false)
    }

    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)

    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('drop', handleDrop)
    }
  }, [])

  const handleFileUpload = async (file: File) => {
    console.log("📥 Upload triggered")
    console.log("Uploaded file name:", file.name)
    console.log("File size:", file.size, "bytes")

    if (!file.name.toLowerCase().endsWith('.fdx')) {
      setUploadResult({
        success: false,
        error: 'Please upload a .fdx file'
      })
      return
    }

    setIsUploading(true)
    setIsParsing(true)
    setUploadResult(null)

    try {
      const formData = new FormData()
      formData.append('fdx', file)

      console.log("🌐 Sending upload request to /api/fdx/import...")
      const response = await fetch('/api/fdx/import', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()
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

        // Store full project data in localStorage for fallback when backend is down
        const fullContentString = result.screenplayElements ? JSON.stringify(result.screenplayElements) : ''

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
          backendAvailable: false // Will be set to true if backend storage succeeds
        }

        // Also store as "lastParsedProject" for easy fallback access
        const fallbackProject = {
          projectId: result.projectId,
          title: result.title,
          scenes: result.screenplayElements || [],
          sluglines: result.sluglines || [],
          timestamp: new Date().toISOString()
        }

        localStorage.setItem(`project-${result.projectId}`, JSON.stringify(scriptForEditor))
        localStorage.setItem('lastParsedProject', JSON.stringify(fallbackProject))

        console.log('💾 Stored full project data in localStorage:', result.projectId)
        console.log('💾 Stored fallback project with', result.screenplayElements?.length || 0, 'elements')

        // Navigate to editor immediately after parsing completes
        // Keep loading overlay visible during navigation
        console.log('🚀 Navigating to editor with projectId:', result.projectId)
        router.push(`/editor?projectId=${result.projectId}`)
        // Note: isUploading stays true to keep loading overlay visible during navigation
      }
    } catch (error) {
      setUploadResult({
        success: false,
        error: 'Upload failed. Please try again.'
      })
      setIsUploading(false)
      setIsParsing(false)
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

      {/* Success Toast - Disabled in favor of full-screen loading overlay */}
      {/* {showToast && uploadResult?.success && (
        <div className="fixed top-4 right-4 z-40 bg-green-900/90 backdrop-blur border border-green-700 rounded-lg p-4 shadow-lg">
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle className="w-5 h-5" />
            <div>
              <p className="font-medium">Script uploaded successfully!</p>
              <p className="text-sm text-green-300">Opening project...</p>
            </div>
          </div>
        </div>
      )} */}

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
                  onClick={() => document.getElementById('fdx-file-upload')?.click()}
                  variant="ghost"
                  disabled={isUploading}
                  className="h-auto flex flex-col items-center space-y-3 w-full p-6 hover:bg-transparent text-slate-300 hover:text-white"
                >
                  {isUploading ? (
                    <>
                      <div className="w-12 h-12 border-2 border-blue-600/50 border-t-blue-600 rounded-full animate-spin" />
                      <span className="text-sm opacity-60">Processing...</span>
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
                  onClick={() => router.push('/editor')}
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
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(project.status)}`}>
                      {project.status.replace('-', ' ')}
                    </span>
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

          {/* Error Display */}
          {uploadResult && !uploadResult.success && (
            <div className="max-w-md mx-auto mb-8">
              <div className="flex items-center gap-2 text-red-400 bg-red-900/20 p-4 rounded-lg border border-red-800">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Upload Failed</p>
                  <p className="text-sm">{uploadResult.error}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}