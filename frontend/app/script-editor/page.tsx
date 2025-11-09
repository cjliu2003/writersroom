/**
 * TipTap Phase 1 POC Test Route - REFACTORED UI
 *
 * UI Refactoring: Clean minimal top bar + horizontal scene navigation + bottom AI assistant
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
import { useScriptYjsCollaboration, SyncStatus } from '@/hooks/use-script-yjs-collaboration';
import { useAuth } from '@/contexts/AuthContext';
import { ScreenplayKit } from '@/extensions/screenplay/screenplay-kit';
import {PaginationPlus, PAGE_SIZES} from 'tiptap-pagination-plus';
import { contentBlocksToTipTap } from '@/utils/content-blocks-converter';
import { getScriptContent, exportFDXFile, updateScript, type ScriptWithContent } from '@/lib/api';
import { loadLayoutPrefs, saveLayoutPrefs, type EditorLayoutPrefs } from '@/utils/layoutPrefs';
import {
  extractSceneBoundariesFromTipTap,
  scrollToScene,
  getCurrentSceneIndex,
  type SceneBoundary
} from '@/utils/tiptap-scene-tracker';
import { extractSlateContentFromTipTap } from '@/utils/tiptap-to-slate-format';
import ProcessingScreen from '@/components/ProcessingScreen';
import { CompactHeader } from '@/components/compact-header';
import { HorizontalSceneBar } from '@/components/horizontal-scene-bar';
import { AIAssistantBottomSheet } from '@/components/ai-assistant-bottom-sheet';
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
  const [scriptId, setScriptId] = useState<string>(() => searchParams.get('scriptId') || DEFAULT_SCRIPT_ID);
  const [pendingContent, setPendingContent] = useState<JSONContent | null>(null);
  const [script, setScript] = useState<ScriptWithContent | null>(null);

  // UI state
  const [isAssistantOpen, setIsAssistantOpen] = useState(false); // Start closed for cleaner view
  const [assistantSideWidth, setAssistantSideWidth] = useState(0); // Width of side panel when open
  const [assistantPosition, setAssistantPosition] = useState<'bottom' | 'left' | 'right'>('bottom');
  const [lastSaved, setLastSaved] = useState<Date>(new Date());
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isLoadingScript, setIsLoadingScript] = useState(true);

  // Scene tracking state
  const [sceneBoundaries, setSceneBoundaries] = useState<SceneBoundary[]>([]);
  const [currentSceneIndex, setCurrentSceneIndex] = useState<number | null>(null);
  const [liveSlateContent, setLiveSlateContent] = useState<any[]>([]);

  // Get Firebase auth from context
  const { user, getToken, isLoading: authLoading } = useAuth();

  // Fetch auth token when user is available
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
        const scriptData: ScriptWithContent = await getScriptContent(scriptId);

        console.log('[TipTapEditor] Script content received:', {
          title: scriptData.title,
          current_version: scriptData.current_version,
          content_source: scriptData.content_source,
          blocks: scriptData.content_blocks?.length || 0,
          has_yjs_updates: scriptData.has_yjs_updates
        });

        setScript(scriptData);
        setLastSaved(new Date(scriptData.updated_at));

        if (!scriptData.content_blocks || scriptData.content_blocks.length === 0) {
          console.warn('[TipTapEditor] No content_blocks found in script');
          if (!scriptData.has_yjs_updates) {
            console.log('[TipTapEditor] No Yjs updates, showing empty editor');
            setIsLoadingScript(false);
          } else {
            console.log('[TipTapEditor] Yjs updates exist, waiting for sync before hiding loading screen');
          }
          return;
        }

        const tipTapDoc = contentBlocksToTipTap(scriptData.content_blocks);
        console.log('[TipTapEditor] Converted to TipTap document:', {
          docType: tipTapDoc.type,
          contentNodes: tipTapDoc.content?.length || 0
        });

        setPendingContent(tipTapDoc);

        if (!scriptData.has_yjs_updates) {
          console.log('[TipTapEditor] No Yjs updates, hiding loading screen (will seed from REST)');
          setIsLoadingScript(false);
        } else {
          console.log('[TipTapEditor] Yjs updates exist, keeping loading screen until sync completes');
        }
      } catch (error: any) {
        console.error('[TipTapEditor] Load failed:', error);
        setIsLoadingScript(false);
      }
    };

    if (scriptId && authToken) {
      loadScriptFromAPI();
    }
  }, [scriptId, authToken]);

  // Yjs collaboration hook
  const {
    doc,
    provider,
    syncStatus,
    connectionError,
  } = useScriptYjsCollaboration({
    scriptId: scriptId,
    authToken: authToken,
    enabled: !!authToken,
  });

  // Initialize TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: false,
        heading: false,
      }),
      ScreenplayKit.configure({
        enableSmartPageBreaks: true,
      }),
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
      PaginationPlus.configure({
        ...PAGE_SIZES.LETTER,
        pageGap: 24,
        pageGapBorderSize: 1,
        pageBreakBackground: '#f1f3f5',
        pageHeaderHeight: 48,
        pageFooterHeight: 0,
        headerLeft: '',
        headerRight: '<span class="rm-page-number"></span>.',
        footerLeft: '',
        footerRight: '',
        marginTop: 48,
        marginBottom: 96,
        marginLeft: 144,
        marginRight: 96,
        contentMarginTop: 0,
        contentMarginBottom: 0,
      }),
    ],
    editorProps: {
      attributes: { class: 'screenplay-editor focus:outline-none min-h-screen' },
    },
    content: !doc ? '<p>Connecting to collaboration server...</p>' : undefined,
  }, [doc, provider]);

  // Page numbering CSS override
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-pagination-overrides", "true");
    style.textContent = `
      .rm-with-pagination { counter-reset: page-number 1 !important; }
      .rm-with-pagination .rm-first-page-header {
        visibility: hidden !important;
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  // Apply pending content when editor is ready
  useEffect(() => {
    if (editor && pendingContent && doc) {
      if (syncStatus !== 'synced') {
        console.log('[TestTipTap] Waiting for sync before seeding, current status:', syncStatus);
        return;
      }

      if (script?.has_yjs_updates) {
        console.log('[TestTipTap] Skipping setContent - Yjs updates exist in database');
        setPendingContent(null);
        return;
      }

      const yjsFragment = doc.get('default', Y.XmlFragment);
      const yjsHasContent = yjsFragment && yjsFragment.length > 0;
      const editorHasContent = editor.state.doc.content.size > 2;

      if (yjsHasContent || editorHasContent) {
        console.log('[TestTipTap] Skipping setContent - content already exists');
        setPendingContent(null);
        return;
      }

      console.log('[TestTipTap] Seeding editor - no content found after sync');
      editor.commands.setContent(pendingContent);
      setPendingContent(null);
    }
  }, [editor, pendingContent, doc, syncStatus, script]);

  // Hide loading screen when Yjs sync completes
  useEffect(() => {
    if (script?.has_yjs_updates && syncStatus === 'synced' && isLoadingScript) {
      console.log('[TipTapEditor] Yjs sync complete, hiding loading screen');
      setIsLoadingScript(false);
    }
  }, [script, syncStatus, isLoadingScript]);

  // Load layout preferences
  useEffect(() => {
    const prefs = loadLayoutPrefs();
    setIsAssistantOpen(prefs.assistantVisible ?? false);
  }, []);

  // Save layout preferences
  useEffect(() => {
    const prefs: EditorLayoutPrefs = {
      sceneListVisible: true, // Horizontal bar always visible
      assistantVisible: isAssistantOpen
    };
    saveLayoutPrefs(prefs);
  }, [isAssistantOpen]);

  // Extract scene boundaries when editor content changes
  useEffect(() => {
    if (editor && editor.state.doc) {
      const boundaries = extractSceneBoundariesFromTipTap(editor);
      setSceneBoundaries(boundaries);

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

    editor.on('selectionUpdate', updateCurrentScene);
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

  // Handle collaborators button click (placeholder)
  const handleCollaboratorsClick = () => {
    console.log('[TipTapEditor] Collaborators feature coming soon');
    // TODO: Open share/collaborate dialog
  };

  const handleTitleChange = async (newTitle: string) => {
    if (!script) return;

    // Optimistically update local state immediately for seamless UX
    const previousTitle = script.title;
    setScript(prev => prev ? { ...prev, title: newTitle } : null);

    try {
      console.log('[TipTapEditor] Updating script title:', newTitle);
      await updateScript(scriptId, { title: newTitle });
      console.log('[TipTapEditor] Script title updated successfully');
    } catch (error) {
      console.error('[TipTapEditor] Failed to update script title:', error);
      // Revert to previous title on error
      setScript(prev => prev ? { ...prev, title: previousTitle } : null);
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

  // Show loading state while waiting for auth token or Yjs
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

  return (
    <>
      {/* Loading Screen */}
      <ProcessingScreen
        isVisible={isLoadingScript || authLoading}
        mode="open"
      />

      {/* Compact Header */}
      <CompactHeader
        scriptTitle={script?.title || 'Untitled Script'}
        syncStatus={syncStatus}
        lastSaved={lastSaved}
        isExporting={isExporting}
        onHomeClick={() => router.push("/")}
        onExportClick={handleExportFDX}
        onCollaboratorsClick={handleCollaboratorsClick}
        onTitleChange={handleTitleChange}
      />

      {/* Horizontal Scene Navigation Bar */}
      <HorizontalSceneBar
        scenes={sceneBoundaries}
        currentSceneIndex={currentSceneIndex}
        onSceneClick={handleSceneClick}
      />

      {/* Export Error Banner */}
      {exportError && (
        <div className="fixed top-20 right-6 z-50 max-w-md">
          <div className="flex items-center gap-2 text-red-600 bg-red-50 p-4 rounded-lg border border-red-200 shadow-lg">
            <span className="font-medium">Export Failed</span>
            <span className="text-sm">{exportError}</span>
            <button
              onClick={() => setExportError(null)}
              className="ml-auto text-red-600 hover:text-red-800 font-bold text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area - Screenplay Editor */}
      <div className="pt-[105px] w-full bg-[#f1f3f5]">
        <div
          className="screenplay-editor-wrapper min-h-screen transition-all duration-200 ease-out"
          style={{
            marginLeft: assistantPosition === 'left' && assistantSideWidth > 0 ? `${assistantSideWidth}px` : '0',
            marginRight: assistantPosition === 'right' && assistantSideWidth > 0 ? `${assistantSideWidth}px` : '0',
            willChange: assistantSideWidth > 0 ? 'margin-left, margin-right' : 'auto',
          }}
        >
          <div className="flex justify-center">
            <EditorContent editor={editor} className="screenplay-editor" />
          </div>
        </div>
      </div>

      {/* AI Assistant Bottom Sheet */}
      <AIAssistantBottomSheet
        isOpen={isAssistantOpen}
        onToggle={() => setIsAssistantOpen(!isAssistantOpen)}
        projectId={scriptId}
        onWidthChange={(width) => setAssistantSideWidth(width)}
        onPositionChange={(position) => setAssistantPosition(position)}
      />

      {/* Custom Styles for Screenplay Editor - PRESERVED */}
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

        /* Collaboration cursor styling */
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
    </>
  );
}
