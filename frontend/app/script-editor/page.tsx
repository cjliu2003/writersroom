/**
 * Script-Level Editor Page
 *
 * Production page for script-level editing with autosave.
 * Uses ScriptEditorWithAutosave wrapper for automatic version management.
 *
 * Key differences from scene-level editor:
 * - Loads entire script content_blocks array (not individual scenes)
 * - Single version number for entire script (not per-scene versions)
 * - No scene slicing/merging logic
 * - Direct content_blocks handling
 *
 * Usage: /script-editor?scriptId=<uuid>
 */

"use client"

import { useState, useEffect, Suspense, useCallback } from "react"
import { ScriptEditorWithAutosave } from "@/components/script-editor-with-autosave"
import { ScriptSceneSidebar } from "@/components/script-scene-sidebar"
import { useAuth } from "@/contexts/AuthContext"
import { AIChatbot } from "@/components/ai-chatbot"
import { Button } from "@/components/ui/button"
import { Home, FileText, Eye, HelpCircle, Download, Menu } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import ErrorBoundary from "@/components/ErrorBoundary"
import type { SceneBoundary } from "@/utils/scene-boundary-tracker"

import { getScriptContent, exportFDXFile, type ScriptWithContent } from '@/lib/api'
import { markOpened } from '@/lib/projectRegistry'
import { loadLayoutPrefs, saveLayoutPrefs, type EditorLayoutPrefs } from '@/utils/layoutPrefs'
import { useChunkRetry } from '@/hooks/useChunkRetry'

function ScriptEditorPageContent() {
  const [script, setScript] = useState<ScriptWithContent | null>(null)
  const [isAssistantOpen, setIsAssistantOpen] = useState(true)
  const [lastSaved, setLastSaved] = useState<Date>(new Date())
  const [isLoading, setIsLoading] = useState(true)
  const [currentScriptId, setCurrentScriptId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentVersion, setCurrentVersion] = useState(0)
  const [authToken, setAuthToken] = useState<string>("")
  const [autosaveEnabled, setAutosaveEnabled] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // Scene sidebar state
  const [sceneBoundaries, setSceneBoundaries] = useState<SceneBoundary[]>([])
  const [currentSceneIndex, setCurrentSceneIndex] = useState<number | null>(null)
  const [scrollToSceneFn, setScrollToSceneFn] = useState<((index: number) => void) | null>(null)
  const [isSceneSidebarOpen, setIsSceneSidebarOpen] = useState(true)

  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isLoading: authLoading, getToken, signIn } = useAuth()

  // Enable chunk retry mechanism
  useChunkRetry()

  // Auth token and autosave enablement via AuthContext
  useEffect(() => {
    let cancelled = false
    const fetchToken = async () => {
      try {
        const token = await getToken()
        if (cancelled) return
        setAuthToken(token || "")
        setAutosaveEnabled(!!token)
      } catch (e) {
        console.warn('Failed to fetch auth token from context:', e)
        if (cancelled) return
        setAuthToken("")
        setAutosaveEnabled(false)
      }
    }
    fetchToken()
    return () => { cancelled = true }
  }, [user, getToken])

  // Load layout preferences on mount
  useEffect(() => {
    const prefs = loadLayoutPrefs();
    setIsAssistantOpen(prefs.assistantVisible);
  }, []);

  // Save layout preferences when sidebar states change
  useEffect(() => {
    const prefs: EditorLayoutPrefs = {
      sceneListVisible: false, // Not used in script-level editor
      assistantVisible: isAssistantOpen
    };
    saveLayoutPrefs(prefs);
  }, [isAssistantOpen]);

  useEffect(() => {
    let cancelled = false
    // Fail-safe: clear loading after 20s no matter what
    const failSafe = setTimeout(() => {
      if (!cancelled) {
        console.warn('[ScriptEditor] Fail-safe timeout reached, clearing loading state')
        setIsLoading(false)
      }
    }, 20000)

    const loadScript = async () => {
      setIsLoading(true)
      setError(null)

      // Check if we have a scriptId from the URL
      const scriptId = searchParams.get('scriptId')
      const isNewScript = searchParams.get('new') === 'true'
      const newScriptTitle = searchParams.get('title')

      if (!scriptId) {
        console.warn('[ScriptEditor] No scriptId in URL')
        setError('No script ID provided in URL')
        setIsLoading(false)
        return
      }

      setCurrentScriptId(scriptId)
      markOpened(scriptId)

      // Handle new script creation
      if (isNewScript) {
        console.log('[ScriptEditor] Creating new blank script:', scriptId)
        const title = newScriptTitle ? decodeURIComponent(newScriptTitle) : 'Untitled Script'

        const newScript: ScriptWithContent = {
          script_id: scriptId,
          owner_id: user?.uid || '',
          title: title,
          description: null,
          current_version: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          content_blocks: [],
          version: 0,
          updated_by: null,
          content_source: 'empty'
        }

        setScript(newScript)
        setCurrentVersion(0)
        setIsLoading(false)
        return
      }

      // Wait for auth token before fetching from backend
      if (!authToken && !authLoading) {
        console.log('[ScriptEditor] ⏳ Waiting for auth token before loading script...')
        // Keep isLoading=true so page continues showing loading state
        // useEffect will re-run when authToken becomes available
        return
      }

      if (authLoading) {
        console.log('[ScriptEditor] ⏳ Auth still loading, waiting...')
        return
      }

      // Load script content from backend
      try {
        console.log('[ScriptEditor] Fetching script content from backend for scriptId:', scriptId)
        const scriptContent = await getScriptContent(scriptId)
        console.log('[ScriptEditor] Script content response:', {
          title: scriptContent.title,
          current_version: scriptContent.current_version,
          content_source: scriptContent.content_source,
          blocks: scriptContent.content_blocks?.length || 0
        })

        if (!scriptContent.content_blocks || scriptContent.content_blocks.length === 0) {
          console.warn('[ScriptEditor] Script has no content blocks, initializing empty')
          scriptContent.content_blocks = []
        } else {
          // Transform blocks from {text, type} format to {type, children: [{text}]} format
          scriptContent.content_blocks = scriptContent.content_blocks.map((block: any) => {
            // If block already has children, it's in correct format
            if (block.children && Array.isArray(block.children)) {
              return block
            }
            // Transform old format to new format
            return {
              type: block.type || 'paragraph',
              children: [{ text: block.text || '' }],
              ...(block.metadata && { metadata: block.metadata })
            }
          })
        }

        setScript(scriptContent)
        setCurrentVersion(scriptContent.current_version)
        setLastSaved(new Date(scriptContent.updated_at))
        setIsLoading(false)
      } catch (error) {
        console.error('[ScriptEditor] Failed to load script content from backend:', error)
        setError('Failed to load script from server.')
        setIsLoading(false)
      }
    }

    loadScript().catch((err) => {
      console.error('[ScriptEditor] Critical error loading script:', err)
      setError('Failed to load script. Please try refreshing the page.')
      setIsLoading(false)
    }).finally(() => {
      clearTimeout(failSafe)
    })

    return () => {
      cancelled = true
      clearTimeout(failSafe)
    }
  }, [router, searchParams, authToken, authLoading])

  const handleExportFDX = async () => {
    if (!currentScriptId) {
      setExportError('No script loaded.');
      return;
    }
    setIsExporting(true);
    setExportError(null);

    try {
      const blob = await exportFDXFile(currentScriptId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${script?.title || 'script'}.fdx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      console.log('[ScriptEditor] Export successful');
    } catch (e: any) {
      setExportError(e?.message || 'Export failed. Please try again.');
      console.error('[ScriptEditor] FDX export failed:', e);
    } finally {
      setIsExporting(false);
    }
  }

  const handleContentChange = useCallback((newContentBlocks: any[]) => {
    console.log('[ScriptEditor] Content changed, blocks:', newContentBlocks.length);

    // Update script state
    setScript(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        content_blocks: newContentBlocks
      };
    });
  }, []);

  const handleVersionUpdate = useCallback((newVersion: number) => {
    console.log('[ScriptEditor] Version updated to:', newVersion);
    setCurrentVersion(newVersion);
    setLastSaved(new Date());
  }, []);

  // Scene navigation callbacks
  const handleSceneBoundariesChange = useCallback((boundaries: SceneBoundary[]) => {
    console.log('[ScriptEditor] Scene boundaries updated:', boundaries.length);
    setSceneBoundaries(boundaries);
  }, []);

  const handleCurrentSceneChange = useCallback((index: number | null) => {
    console.log('[ScriptEditor] Current scene index changed:', index);
    setCurrentSceneIndex(index);
  }, []);

  const handleScrollToSceneReady = useCallback((fn: (index: number) => void) => {
    console.log('[ScriptEditor] Scroll function ready');
    setScrollToSceneFn(() => fn);
  }, []);

  const handleSceneClick = useCallback((index: number) => {
    console.log('[ScriptEditor] Scene clicked:', index);
    if (scrollToSceneFn) {
      scrollToSceneFn(index);
    }
  }, [scrollToSceneFn]);

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

  const canAutosave = autosaveEnabled && !!authToken && !!currentScriptId

  // Debug logging for autosave gating
  console.log('[ScriptEditor] 🔍 Autosave Debug:', {
    autosaveEnabled,
    hasToken: !!authToken,
    currentScriptId,
    canAutosave,
    currentVersion
  })

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
              v{currentVersion} • Saved {lastSaved.toLocaleTimeString()}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={isExporting}
              onClick={handleExportFDX}
              className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4 mr-1" />
              {isExporting ? 'Exporting...' : 'Export'}
            </Button>
          </div>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="fixed top-16 left-0 right-0 z-40 border-b border-gray-200 bg-white shadow-sm px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsSceneSidebarOpen(!isSceneSidebarOpen)}
            className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md px-3 py-1"
          >
            <Menu className="w-4 h-4 mr-2" />
            {isSceneSidebarOpen ? 'Hide' : 'Show'} Scenes
          </Button>
          <span className="text-sm text-gray-600">
            Script-Level Editing
          </span>
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

      {/* Export Error Banner */}
      {exportError && (
        <div className="fixed top-20 right-6 z-50 max-w-md">
          <div className="flex items-center gap-2 text-red-400 bg-red-900/20 p-4 rounded-lg border border-red-800 shadow-lg">
            <span className="font-medium">Export Failed</span>
            <span className="text-sm">{exportError}</span>
            <button
              onClick={() => setExportError(null)}
              className="ml-auto text-red-400 hover:text-red-300 font-bold text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Left Sidebar - Scene Navigation (Fixed Position) */}
      {isSceneSidebarOpen && (
        <div className="fixed left-0 top-[112px] w-80 h-[calc(100vh-112px)] z-30 transition-all duration-300">
          <ScriptSceneSidebar
            scenes={sceneBoundaries}
            onSceneClick={handleSceneClick}
            currentSceneIndex={currentSceneIndex}
            scriptContent={script.content_blocks || []}
            scriptId={currentScriptId || undefined}
            script={script}
          />
        </div>
      )}

      {/* Main Content Area - starts below both headers */}
      <div
        className="pt-[112px] w-full flex transition-all duration-300"
        style={{
          marginLeft: isSceneSidebarOpen ? '320px' : '0' // Account for fixed sidebar
        }}
      >
        {/* Script Editor Container - dynamically centered */}
        <div
          className="flex-1 flex justify-center transition-all duration-300"
          style={{
            marginRight: isAssistantOpen ? 'auto' : '0'
          }}
        >
          <div
            className="w-full transition-all duration-300"
            style={{
              maxWidth: isAssistantOpen
                ? 'calc(100vw - 704px)' // AI assistant open: subtract 320px scene + 384px AI
                : '100vw' // No AI sidebar: full available width
            }}
          >
            {canAutosave ? (
              <ScriptEditorWithAutosave
                scriptId={currentScriptId as string}
                initialVersion={currentVersion}
                initialContent={script.content_blocks || []}
                authToken={authToken}
                onChange={handleContentChange}
                onVersionUpdate={handleVersionUpdate}
                onSceneBoundariesChange={handleSceneBoundariesChange}
                onCurrentSceneChange={handleCurrentSceneChange}
                onScrollToSceneReady={handleScrollToSceneReady}
                showAutosaveIndicator={true}
                compactIndicator={false}
                autosaveOptions={{
                  debounceMs: 1500,
                  maxWaitMs: 5000,
                  maxRetries: 3,
                  enableOfflineQueue: true
                }}
              />
            ) : (
              <div className="space-y-4 p-8">
                {/* Authentication status banner */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-blue-600">🔒</span>
                      <div>
                        <h3 className="font-medium text-blue-800">Sign In for Autosave</h3>
                        <p className="text-sm text-blue-700">
                          Sign in to enable automatic saving and collaboration features.
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={async () => { await signIn() }}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                      disabled={authLoading}
                      size="sm"
                    >
                      Sign In
                    </Button>
                  </div>
                </div>

                <div className="text-center text-gray-500">
                  <p>Please sign in to edit this script.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar - AI Assistant */}
        {isAssistantOpen && (
          <div className="w-96 transition-all duration-300">
            <AIChatbot projectId={currentScriptId || undefined} isVisible={true} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function ScriptEditorPage() {
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
        <ScriptEditorPageContent />
      </Suspense>
    </ErrorBoundary>
  )
}
