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
import {PaginationPlus, PAGE_SIZES} from '@jack/tiptap-pagination-plus';
import { contentBlocksToTipTap } from '@/utils/content-blocks-converter';
import { getScriptContent, exportFDXFile, updateScript, type ScriptWithContent } from '@/lib/api';
import { loadLayoutPrefs, saveLayoutPrefs, type EditorLayoutPrefs } from '@/utils/layoutPrefs';
import {
  extractSceneBoundariesFromTipTap,
  scrollToScene,
  getCurrentSceneIndex,
  type SceneBoundary
} from '@/utils/tiptap-scene-tracker';
import { SceneNavBar } from '@/components/scene-nav-bar';
import { FloatingAIButton } from '@/components/floating-ai-button';
import { AIChatbot } from '@/components/ai-chatbot';
import ProcessingScreen from '@/components/ProcessingScreen';
import { ShareDialog } from '@/components/share-dialog';
import { Button } from '@/components/ui/button';
import { Home, FileText, Pencil, Share2, Download, ChevronUp, ChevronDown } from 'lucide-react';
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
  const [isAssistantOpen, setIsAssistantOpen] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date>(new Date());
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isLoadingScript, setIsLoadingScript] = useState(true);

  // Editable title state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  // Collapsible bar states
  const [isTopBarCollapsed, setIsTopBarCollapsed] = useState(false);
  const [isSceneNavCollapsed, setIsSceneNavCollapsed] = useState(false);

  // Share dialog state
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);

  // Scene tracking state
  const [sceneBoundaries, setSceneBoundaries] = useState<SceneBoundary[]>([]);
  const [currentSceneIndex, setCurrentSceneIndex] = useState<number | null>(null);

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
          blocks: scriptData.content_blocks?.length || 0,
          has_yjs_updates: scriptData.has_yjs_updates
        });

        // Always set script metadata (including title) even if no content yet
        setScript(scriptData);
        setLastSaved(new Date(scriptData.updated_at));

        // If no content blocks, check if we should wait for Yjs sync
        if (!scriptData.content_blocks || scriptData.content_blocks.length === 0) {
          console.warn('[TipTapEditor] No content_blocks found in script');

          // If Yjs has updates, keep loading screen visible until Yjs sync completes
          // Otherwise, hide loading screen and show empty editor
          if (!scriptData.has_yjs_updates) {
            console.log('[TipTapEditor] No Yjs updates, showing empty editor');
            setIsLoadingScript(false);
          } else {
            console.log('[TipTapEditor] Yjs updates exist, waiting for sync before hiding loading screen');
          }
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

        // If Yjs has updates, keep loading screen visible until Yjs sync completes
        // (content will come from Yjs, not from pendingContent)
        // Otherwise, hide loading screen now (we'll seed from pendingContent)
        if (!scriptData.has_yjs_updates) {
          console.log('[TipTapEditor] No Yjs updates, hiding loading screen (will seed from REST)');
          setIsLoadingScript(false);
        } else {
          console.log('[TipTapEditor] Yjs updates exist, keeping loading screen until sync completes');
        }
      } catch (error: any) {
        console.error('[TipTapEditor] Load failed:', error);
        setIsLoadingScript(false); // Hide loading screen even on error
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
        pageBreakBackground: '#f1f3f5',

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
      // Screenplay formatting extensions
      ScreenplayKit.configure({
        enableSmartPageBreaks: false,  // Enable smart page breaks
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

      // CRITICAL FIX: If backend has Yjs updates, skip seeding entirely
      // Yjs sync will provide the content from script_versions table
      // This prevents duplication when REST API returns stale content_blocks
      if (script?.has_yjs_updates) {
        console.log('[TestTipTap] Skipping setContent - Yjs updates exist in database (Yjs is source of truth)');
        setPendingContent(null); // Clear pending content to prevent retry
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
  }, [editor, pendingContent, doc, syncStatus, script]);

  // Hide loading screen when Yjs sync completes (for has_yjs_updates case)
  useEffect(() => {
    if (script?.has_yjs_updates && syncStatus === 'synced' && isLoadingScript) {
      console.log('[TipTapEditor] Yjs sync complete, hiding loading screen');
      setIsLoadingScript(false);
    }
  }, [script, syncStatus, isLoadingScript]);

  // Load layout preferences on mount
  useEffect(() => {
    const prefs = loadLayoutPrefs();
    setIsAssistantOpen(prefs.assistantVisible ?? true);
  }, []);

  // Save layout preferences when AI assistant state changes
  useEffect(() => {
    saveLayoutPrefs({ assistantVisible: isAssistantOpen });
  }, [isAssistantOpen]);

  // Extract scene boundaries when editor content changes
  useEffect(() => {
    if (editor && editor.state.doc) {
      const boundaries = extractSceneBoundariesFromTipTap(editor);
      setSceneBoundaries(boundaries);
      console.log('[TipTapEditor] Extracted', boundaries.length, 'scenes');
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

  // Handle title editing
  const handleTitleClick = () => {
    setEditingTitle(script?.title || 'Untitled Script');
    setIsEditingTitle(true);
  };

  const handleTitleSave = async () => {
    const trimmedTitle = editingTitle.trim();
    if (!trimmedTitle || trimmedTitle === script?.title) {
      setIsEditingTitle(false);
      return;
    }

    setIsSavingTitle(true);
    try {
      await updateScript(scriptId, { title: trimmedTitle });
      // Update local state
      setScript(prev => prev ? { ...prev, title: trimmedTitle } : prev);
      console.log('[TipTapEditor] Title updated successfully');
    } catch (e: any) {
      console.error('[TipTapEditor] Failed to update title:', e);
      // Revert to original title on error
      setEditingTitle(script?.title || 'Untitled Script');
    } finally {
      setIsSavingTitle(false);
      setIsEditingTitle(false);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTitleSave();
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false);
      setEditingTitle(script?.title || 'Untitled Script');
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
      case 'error': return 'bg-red-500';
      default: return 'bg-yellow-500';
    }
  };

  return (
    <>
      {/* Loading Screen */}
      <ProcessingScreen
        isVisible={isLoadingScript || authLoading}
        mode="open"
      />

      <div className="flex h-screen bg-gray-100">
        {/* Fixed Top Header - Compact Screenplay Style (collapsible) */}
      {!isTopBarCollapsed && (
        <div className="fixed top-0 left-0 right-0 z-50 border-b border-gray-300 bg-white shadow-sm transition-all duration-200" style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}>
          <div className="relative px-4 flex items-center justify-between h-12">
            {/* Left - Collapse button + Home, File, Edit */}
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsTopBarCollapsed(true)}
                className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded p-0.5 -ml-2 mr-0"
                title="Collapse toolbar"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/")}
                className="text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded px-2.5 py-1 text-sm font-normal"
                style={{ fontFamily: "inherit" }}
              >
                <Home className="w-3.5 h-3.5 mr-1.5" />
                Home
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded px-2.5 py-1 text-sm font-normal cursor-default opacity-75"
                style={{ fontFamily: "inherit" }}
                title="Coming soon"
              >
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                File
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded px-2.5 py-1 text-sm font-normal cursor-default opacity-75"
                style={{ fontFamily: "inherit" }}
                title="Coming soon"
              >
                <Pencil className="w-3.5 h-3.5 mr-1.5" />
                Edit
              </Button>
            </div>

          {/* Center - Script Title (absolutely centered on page, click to edit) */}
          <div className="absolute left-1/2 -translate-x-1/2">
            {isEditingTitle ? (
              <input
                type="text"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value.slice(0, 30))}
                onBlur={handleTitleSave}
                onKeyDown={handleTitleKeyDown}
                maxLength={30}
                autoFocus
                disabled={isSavingTitle}
                className="text-gray-800 text-base tracking-wide text-center bg-transparent underline focus:outline-none px-2 py-0.5 uppercase"
                style={{ fontFamily: "inherit", width: '34ch' }}
              />
            ) : (
              <h1
                onClick={handleTitleClick}
                className="text-gray-800 text-base tracking-wide truncate text-center cursor-pointer hover:opacity-60 transition-opacity px-2 py-0.5 uppercase underline"
                style={{ fontFamily: "inherit", maxWidth: '34ch' }}
                title="Click to edit title"
              >
                {script?.title || 'Untitled Script'}
              </h1>
            )}
          </div>

          {/* Right - Share, Export */}
          <div className="flex items-center gap-0.5 mr-16">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsShareDialogOpen(true)}
              className="text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded px-2.5 py-1 text-sm font-normal"
              style={{ fontFamily: "inherit" }}
              title="Share this script"
            >
              <Share2 className="w-3.5 h-3.5 mr-1.5" />
              Share
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isExporting}
              onClick={handleExportFDX}
              className="text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded px-2.5 py-1 text-sm font-normal disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontFamily: "inherit" }}
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              {isExporting ? 'Exporting...' : 'Export'}
            </Button>
          </div>

          {/* Autosave indicator - dot anchored, text extends rightward */}
          <div
            className="absolute flex items-center gap-1 pl-2 border-l border-gray-200"
            style={{ left: 'calc(100% - 80px)' }}
          >
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getStatusColor(syncStatus)} ${syncStatus === 'synced' ? '' : 'animate-pulse'}`} title={`Status: ${syncStatus}`}></div>
            <span className="text-[10px] text-gray-400 whitespace-nowrap" style={{ fontFamily: "inherit" }}>
              {syncStatus === 'synced' ? 'Saved' : syncStatus === 'connecting' ? 'Syncing' : syncStatus === 'connected' ? 'Synced' : syncStatus.charAt(0).toUpperCase() + syncStatus.slice(1)}
            </span>
          </div>
        </div>
      </div>
      )}

      {/* Expand button when top bar is collapsed */}
      {isTopBarCollapsed && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsTopBarCollapsed(false)}
          className="fixed top-[22px] left-2 -translate-y-1/2 z-50 text-gray-400 hover:text-gray-600 hover:bg-white/80 rounded p-1 shadow-sm border border-gray-200 bg-white/60 backdrop-blur-sm"
          title="Expand toolbar"
        >
          <ChevronDown className="w-4 h-4" />
        </Button>
      )}

      {/* Scene Navigation Bar */}
      {!isSceneNavCollapsed && (
        <div
          className={`fixed left-0 right-0 z-40 transition-all duration-200 ${isTopBarCollapsed ? 'top-0' : 'top-12'}`}
        >
          <SceneNavBar
            scenes={sceneBoundaries}
            onSceneClick={handleSceneClick}
            currentSceneIndex={currentSceneIndex}
            onCollapse={() => setIsSceneNavCollapsed(true)}
            isTopBarCollapsed={isTopBarCollapsed}
          />
        </div>
      )}

      {/* Expand button when scene nav is collapsed */}
      {isSceneNavCollapsed && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsSceneNavCollapsed(false)}
          className={`fixed z-50 text-gray-400 hover:text-gray-600 hover:bg-white/80 rounded p-1 shadow-sm border border-gray-200 bg-white/60 backdrop-blur-sm ${
            isTopBarCollapsed ? 'top-2 right-2' : 'top-14 right-2'
          }`}
          title="Expand scene navigation"
        >
          <ChevronDown className="w-4 h-4" />
        </Button>
      )}

      {/* Export Error Banner */}
      {exportError && (
        <div className="fixed top-24 right-4 z-50 max-w-sm">
          <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded border border-red-200 shadow-md text-sm" style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}>
            <span className="font-medium">Export Failed:</span>
            <span>{exportError}</span>
            <button
              onClick={() => setExportError(null)}
              className="ml-auto text-red-500 hover:text-red-700 font-bold text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area - scroll container with dynamic bounds */}
      <div
        className="flex transition-all duration-300 overflow-auto"
        style={{
          position: 'fixed',
          top: isTopBarCollapsed
            ? (isSceneNavCollapsed ? '0' : '44px')
            : (isSceneNavCollapsed ? '48px' : '92px'),
          left: 0,
          right: isAssistantOpen ? '384px' : '0',
          bottom: 0,
        }}
      >
        {/* Editor Container - dynamically centered */}
        <div
          className="flex-1 flex justify-center transition-all duration-300"
        >
          <div
            className="w-full transition-all duration-300"
            style={{
              maxWidth: isAssistantOpen ? 'calc(100vw - 384px)' : '100vw'
            }}
          >
            <div className="screenplay-editor-wrapper min-h-screen pt-6">
              <div className="flex justify-center">
                <EditorContent editor={editor} className="screenplay-editor" />
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar - AI Assistant */}
        {isAssistantOpen && (
          <div
            className="fixed right-0 w-96 z-30 transition-all duration-300"
            style={{
              top: isTopBarCollapsed
                ? (isSceneNavCollapsed ? '0' : '44px')
                : (isSceneNavCollapsed ? '48px' : '92px'),
              height: isTopBarCollapsed
                ? (isSceneNavCollapsed ? '100vh' : 'calc(100vh - 44px)')
                : (isSceneNavCollapsed ? 'calc(100vh - 48px)' : 'calc(100vh - 92px)')
            }}
          >
            <AIChatbot projectId={scriptId || undefined} isVisible={true} />
          </div>
        )}
      </div>

      {/* Floating AI Button */}
      <FloatingAIButton
        onClick={() => setIsAssistantOpen(!isAssistantOpen)}
        isOpen={isAssistantOpen}
      />

      {/* Custom Styles for Screenplay Editor */}
      <style jsx global>{`
        :root {
          --app-chrome-bg: #f1f3f5;
        }

        .screenplay-editor-wrapper {
          background: var(--app-chrome-bg);
        }

        .screenplay-editor {
          min-height: 800px;
        }

        .rm-with-pagination .page {
          background: #fff;
          box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 8px 24px rgba(0,0,0,.06);
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

      {/* Share Dialog */}
      {/* Note: isOwner defaults to true - backend enforces actual permissions */}
      <ShareDialog
        isOpen={isShareDialogOpen}
        onClose={() => setIsShareDialogOpen(false)}
        scriptId={scriptId}
        scriptTitle={script?.title}
        isOwner={true}
      />
      </div>
    </>
  );
}
