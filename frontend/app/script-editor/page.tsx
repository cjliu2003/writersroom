/**
 * TipTap Phase 1 POC Test Route
 *
 * Validates TipTap v2.26.4 + Pagination with existing Y.js collaboration infrastructure.
 *
 * Success Criteria:
 * 1. Real-time collaboration works with existing WebSocket backend (zero changes)
 * 2. Pagination extension provides screenplay-accurate page breaks (~55 lines/page)
 *
 * Testing: Open in multiple tabs to test collaboration
 */

"use client"

import React, { useState, useEffect, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { JSONContent } from '@tiptap/core';
import * as Y from 'yjs';
// @ts-ignore - pagination extension may not have types
import { useScriptYjsCollaboration, SyncStatus } from '@/hooks/use-script-yjs-collaboration';
import { useAuth } from '@/contexts/AuthContext';
import { ScreenplayKit } from '@/extensions/screenplay/screenplay-kit';
import {PaginationPlus, PAGE_SIZES} from 'tiptap-pagination-plus';
import { contentBlocksToTipTap } from '@/utils/content-blocks-converter';
import { getScriptContent, exportFDXFile, type ScriptWithContent } from '@/lib/api';
import { loadLayoutPrefs, saveLayoutPrefs, type EditorLayoutPrefs } from '@/utils/layoutPrefs';
import {
  extractSceneBoundariesFromTipTap,
  scrollToScene,
  getCurrentSceneIndex,
  type SceneBoundary
} from '@/utils/tiptap-scene-tracker';
import { extractSlateContentFromTipTap } from '@/utils/tiptap-to-slate-format';
import { ScriptSceneSidebar } from '@/components/script-scene-sidebar';
import { AIChatbot } from '@/components/ai-chatbot';
import { Button } from '@/components/ui/button';
import { Home, FileText, Eye, HelpCircle, Download, Menu } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import '@/styles/screenplay.css';

// Default script ID for testing (fallback if no query param)
const DEFAULT_SCRIPT_ID = '3acb35d4-86ac-4875-8c93-5529e340572c';

// Generate random color for user cursor
const getRandomColor = () => {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];
  return colors[Math.floor(Math.random() * colors.length)];
};

export default function TestTipTapPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [userColor] = useState(getRandomColor());
  const [userName] = useState(`User-${Math.floor(Math.random() * 1000)}`);
  const [authToken, setAuthToken] = useState<string>('');
  // Read scriptId from query params, fallback to default for testing
  const [scriptId, setScriptId] = useState<string>(() => searchParams.get('scriptId') || DEFAULT_SCRIPT_ID);
  const [pendingContent, setPendingContent] = useState<JSONContent | null>(null);
  const [script, setScript] = useState<ScriptWithContent | null>(null);

  // UI state
  const [isSceneSidebarOpen, setIsSceneSidebarOpen] = useState(true);
  const [isAssistantOpen, setIsAssistantOpen] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date>(new Date());
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Scene tracking state
  const [sceneBoundaries, setSceneBoundaries] = useState<SceneBoundary[]>([]);
  const [currentSceneIndex, setCurrentSceneIndex] = useState<number | null>(null);
  const [liveSlateContent, setLiveSlateContent] = useState<any[]>([]);

  // Get Firebase auth from context (same pattern as other editors)
  const { user, getToken, isLoading: authLoading } = useAuth();

  // Fetch auth token when user is available (needed for WebSocket)
  useEffect(() => {
    let cancelled = false;
    const fetchToken = async () => {
      try {
        const token = await getToken();
        if (cancelled) return;
        setAuthToken(token || '');
      } catch (e) {
        console.warn('[TestTipTap] Failed to fetch auth token:', e);
        if (cancelled) return;
        setAuthToken('');
      }
    };
    fetchToken();
    return () => { cancelled = true };
  }, [user, getToken]);

  // Load script content from backend on mount
  useEffect(() => {
    const loadScriptFromAPI = async () => {
      try {
        console.log('[TipTapEditor] Fetching script content for:', scriptId);

        // Use existing API helper (handles auth automatically)
        const scriptData: ScriptWithContent = await getScriptContent(scriptId);

        console.log('[TipTapEditor] Script content received:', {
          title: scriptData.title,
          current_version: scriptData.current_version,
          content_source: scriptData.content_source,
          blocks: scriptData.content_blocks?.length || 0
        });

        if (!scriptData.content_blocks || scriptData.content_blocks.length === 0) {
          console.warn('[TipTapEditor] No content_blocks found in script');
          return;
        }

        // Convert backend format to TipTap format
        const tipTapDoc = contentBlocksToTipTap(scriptData.content_blocks);
        console.log('[TipTapEditor] Converted to TipTap document:', {
          docType: tipTapDoc.type,
          contentNodes: tipTapDoc.content?.length || 0
        });

        // Store content in state - useEffect will apply when editor is ready
        console.log('[TipTapEditor] Storing content for application to editor');
        setPendingContent(tipTapDoc);
        setScript(scriptData);
        setLastSaved(new Date(scriptData.updated_at));
      } catch (error: any) {
        console.error('[TipTapEditor] Load failed:', error);
      }
    };

    if (scriptId && authToken) {
      loadScriptFromAPI();
    }
  }, [scriptId, authToken]);

  // Reuse existing Yjs collaboration hook
  const {
    doc,
    provider,
    syncStatus,
    connectionError,
  } = useScriptYjsCollaboration({
    scriptId: scriptId,
    authToken: authToken,
    enabled: !!authToken, // Only enable when we have auth token
  });

  // Initialize TipTap editor with screenplay extensions + collaboration + pagination
  const editor = useEditor({
    extensions: [
      // Configure StarterKit to disable conflicting extensions
      StarterKit.configure({
        history: false, // Yjs provides undo/redo
        heading: false, // ScreenplayKit provides scene headings
        // Note: paragraph is kept enabled as a fallback and for compatibility with pagination
      }),
      // Screenplay formatting extensions
      ScreenplayKit.configure({
        enableSmartPageBreaks: true,  // Enable smart page breaks
      }),
      // Collaboration
      ...(doc ? [
        Collaboration.configure({
          document: doc,
        }),
      ] : []),
      ...(provider ? [
        CollaborationCursor.configure({
          provider: provider,
          user: {
            name: userName,
            color: userColor,
          },
        }),
      ] : []),
      // Pagination
      PaginationPlus.configure({
        // geometry
        ...PAGE_SIZES.LETTER,
        // chrome between pages
        pageGap: 24,
        pageGapBorderSize: 1,
        pageBreakBackground: '#ffffff',

        // header/footer (set to 0 if you don't want page numbers)
        pageHeaderHeight: 48,    // ~0.5in @ 96 DPI
        pageFooterHeight: 0,
        headerLeft: '',
        headerRight: '<span class="rm-page-number"></span>.',
        footerLeft: '',
        footerRight: '',
      
        // screenplay margins (in px)
        marginTop: 48,           // 1.0in Total (stacks with header height)
        marginBottom: 96,        // 1.0in
        marginLeft: 144,         // 1.5in
        marginRight: 96,         // 1.0in

        // extra padding inside content area (keep 0)
        contentMarginTop: 0,
        contentMarginBottom: 0,
      }),
    ],
    editorProps: {
      attributes: { class: 'screenplay-editor focus:outline-none min-h-screen' },
    },
    content: !doc ? '<p>Connecting to collaboration server...</p>' : undefined,
  }, [doc, provider]);

  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-pagination-overrides", "true");
    style.textContent = `
      /* Start at 1 so the *second* page shows 2 (we'll hide page 1 header content) */
      .rm-with-pagination { counter-reset: page-number 1 !important; }

      /* Hide first page header content (number and dot) but keep spacing */
      .rm-with-pagination .rm-first-page-header {
        visibility: hidden !important;
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  // Apply pending content when editor becomes ready
  // CRITICAL: Wait for initial Yjs sync to complete before seeding to prevent duplication
  useEffect(() => {
    if (editor && pendingContent && doc) {
      // CRITICAL: Must wait for initial sync to complete before checking/seeding
      // If we check while syncStatus is 'connecting' or 'connected', the Yjs doc
      // might still be empty even though sync is in progress
      if (syncStatus !== 'synced') {
        console.log('[TestTipTap] Waiting for sync before seeding, current status:', syncStatus);
        return;
      }

      // After sync completes, check if Yjs document already has content
      const yjsFragment = doc.get('default', Y.XmlFragment);
      const yjsHasContent = yjsFragment && yjsFragment.length > 0;

      // Check if editor already has content
      const editorHasContent = editor.state.doc.content.size > 2; // >2 accounts for empty doc structure

      if (yjsHasContent || editorHasContent) {
        console.log('[TestTipTap] Skipping setContent - content already exists:', {
          yjsLength: yjsFragment?.length || 0,
          editorSize: editor.state.doc.content.size,
          syncStatus: syncStatus,
          reason: yjsHasContent ? 'Yjs has content (from sync)' : 'Editor has content'
        });
        setPendingContent(null); // Clear pending content to prevent retry
        return;
      }

      // Both Yjs and editor are empty after sync - safe to seed
      console.log('[TestTipTap] Seeding editor - no content found after sync');
      editor.commands.setContent(pendingContent);
      console.log('[TestTipTap] Content applied successfully');
      setPendingContent(null); // Clear after applying
    }
  }, [editor, pendingContent, doc, syncStatus]);

  // Load layout preferences on mount
  useEffect(() => {
    const prefs = loadLayoutPrefs();
    setIsAssistantOpen(prefs.assistantVisible);
    setIsSceneSidebarOpen(prefs.sceneListVisible ?? true);
  }, []);

  // Save layout preferences when sidebar states change
  useEffect(() => {
    const prefs: EditorLayoutPrefs = {
      sceneListVisible: isSceneSidebarOpen,
      assistantVisible: isAssistantOpen
    };
    saveLayoutPrefs(prefs);
  }, [isSceneSidebarOpen, isAssistantOpen]);

  // Extract scene boundaries and live content when editor content changes
  useEffect(() => {
    if (editor && editor.state.doc) {
      const boundaries = extractSceneBoundariesFromTipTap(editor);
      setSceneBoundaries(boundaries);

      // Extract live content in Slate format for sidebar features
      const slateContent = extractSlateContentFromTipTap(editor);
      setLiveSlateContent(slateContent);

      console.log('[TipTapEditor] Extracted', boundaries.length, 'scenes,', slateContent.length, 'blocks');
    }
  }, [editor, editor?.state.doc.content]);

  // Track current scene as user navigates
  useEffect(() => {
    if (!editor) return;

    const updateCurrentScene = () => {
      const sceneIndex = getCurrentSceneIndex(editor, sceneBoundaries);
      setCurrentSceneIndex(sceneIndex);
    };

    // Update on selection change
    editor.on('selectionUpdate', updateCurrentScene);

    // Initial update
    updateCurrentScene();

    return () => {
      editor.off('selectionUpdate', updateCurrentScene);
    };
  }, [editor, sceneBoundaries]);

  // Scene navigation handler
  const handleSceneClick = useCallback((sceneIndex: number) => {
    const scene = sceneBoundaries[sceneIndex];
    if (scene && editor) {
      console.log('[TipTapEditor] Scene clicked:', sceneIndex, scene.heading);
      scrollToScene(editor, scene);
    }
  }, [editor, sceneBoundaries]);

  // Export FDX handler
  const handleExportFDX = async () => {
    if (!scriptId) {
      setExportError('No script loaded.');
      return;
    }
    setIsExporting(true);
    setExportError(null);

    try {
      const blob = await exportFDXFile(scriptId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${script?.title || 'script'}.fdx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      console.log('[TipTapEditor] Export successful');
    } catch (e: any) {
      setExportError(e?.message || 'Export failed. Please try again.');
      console.error('[TipTapEditor] FDX export failed:', e);
    } finally {
      setIsExporting(false);
    }
  };

  // Show auth loading state
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading authentication...</p>
        </div>
      </div>
    );
  }

  // Show sign-in prompt if no user
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <p className="text-gray-800 text-xl mb-4">Please sign in to test TipTap collaboration</p>
          <p className="text-gray-600 text-sm">WebSocket requires Firebase authentication</p>
        </div>
      </div>
    );
  }

  // Show loading state while waiting for auth token or Yjs to connect
  if (!authToken || !doc || !editor) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">
            {!authToken ? 'Getting auth token...' : 'Connecting to collaboration server...'}
          </p>
          {connectionError && (
            <p className="text-red-600 mt-2">Error: {connectionError.message}</p>
          )}
        </div>
      </div>
    );
  }

  // Get sync status color
  const getStatusColor = (status: SyncStatus) => {
    switch (status) {
      case 'synced': return 'bg-green-500';
      case 'connected': return 'bg-yellow-500';
      case 'connecting': return 'bg-gray-500';
      case 'offline': return 'bg-red-500';
      case 'error': return 'bg-red-700';
      default: return 'bg-gray-400';
    }
  };

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Fixed Top Header - Final Draft Style */}
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
              {script?.title || 'Untitled Script'}
            </h1>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-4 flex-1 justify-end min-w-0">
            {/* Connection Status */}
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getStatusColor(syncStatus)}`}></div>
              <span className="text-xs text-gray-500 capitalize hidden sm:inline">
                {syncStatus}
              </span>
            </div>
            <span className="text-xs text-gray-500 hidden sm:inline">
              Saved {lastSaved.toLocaleTimeString()}
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
            Screenplay Editor • TipTap
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
        <div className="fixed top-32 right-6 z-50 max-w-md">
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

      {/* Left Sidebar - Scene Navigation */}
      {isSceneSidebarOpen && (
        <div className="fixed left-0 top-[112px] w-80 h-[calc(100vh-112px)] z-30 transition-all duration-300">
          <ScriptSceneSidebar
            scenes={sceneBoundaries}
            onSceneClick={handleSceneClick}
            currentSceneIndex={currentSceneIndex}
            scriptContent={liveSlateContent}
            scriptId={scriptId}
            script={script || undefined}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div
        className="pt-[112px] w-full flex transition-all duration-300"
        style={{
          marginLeft: isSceneSidebarOpen ? '320px' : '0',
          marginRight: isAssistantOpen ? '384px' : '0'
        }}
      >
        {/* Editor Container - dynamically centered */}
        <div
          className="flex-1 flex justify-center transition-all duration-300"
        >
          <div
            className="w-full transition-all duration-300"
            style={{
              maxWidth: isSceneSidebarOpen && isAssistantOpen
                ? 'calc(100vw - 704px)' // Both sidebars: 320px + 384px
                : isSceneSidebarOpen
                ? 'calc(100vw - 320px)' // Scene sidebar only
                : isAssistantOpen
                ? 'calc(100vw - 384px)' // AI assistant only
                : '100vw' // No sidebars
            }}
          >
            <div className="bg-white rounded-lg shadow-lg">
              <div className="flex justify-center">
                <EditorContent editor={editor} className="screenplay-editor" />
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar - AI Assistant */}
        {isAssistantOpen && (
          <div className="fixed right-0 top-[112px] w-96 h-[calc(100vh-112px)] z-30 transition-all duration-300">
            <AIChatbot projectId={scriptId || undefined} isVisible={true} />
          </div>
        )}
      </div>

      {/* Custom Styles for Screenplay Editor */}
      <style jsx global>{`
        .screenplay-editor {
          min-height: 800px;
        }

        .screenplay-editor .ProseMirror {
          padding: 0rem;
          font-family: 'Courier', 'Courier New', monospace;
          font-size: 12pt;
          line-height: 12pt;
          color: #000;
        }

        .screenplay-editor .ProseMirror:focus {
          outline: none;
        }

        /* Collaboration cursor styling */}
        .collaboration-cursor__caret {
          position: relative;
          margin-left: -1px;
          margin-right: -1px;
          border-left: 1px solid;
          border-right: 1px solid;
          word-break: normal;
          pointer-events: none;
        }

        .collaboration-cursor__label {
          position: absolute;
          top: -1.4em;
          left: -1px;
          font-size: 12px;
          font-style: normal;
          font-weight: 600;
          line-height: normal;
          user-select: none;
          color: #fff;
          padding: 0.1rem 0.3rem;
          border-radius: 3px 3px 3px 0;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
