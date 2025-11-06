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
// @ts-ignore - pagination extension may not have types
import { useScriptYjsCollaboration, SyncStatus } from '@/hooks/use-script-yjs-collaboration';
import { useAuth } from '@/contexts/AuthContext';
import { ScreenplayKit } from '@/extensions/screenplay/screenplay-kit';
import {PaginationPlus, PAGE_SIZES} from 'tiptap-pagination-plus';
import { contentBlocksToTipTap, getContentBlocksStats } from '@/utils/content-blocks-converter';
import { getScriptContent, type ScriptWithContent } from '@/lib/api';
import '@/styles/screenplay.css';

// Default script ID for testing
const DEFAULT_SCRIPT_ID = 'e4ba3b38-0c14-4e4a-b008-1399cb9beb42';

// Generate random color for user cursor
const getRandomColor = () => {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];
  return colors[Math.floor(Math.random() * colors.length)];
};

export default function TestTipTapPage() {
  const [userColor] = useState(getRandomColor());
  const [userName] = useState(`User-${Math.floor(Math.random() * 1000)}`);
  const [authToken, setAuthToken] = useState<string>('');
  const [scriptId, setScriptId] = useState<string>(DEFAULT_SCRIPT_ID);
  const [scriptInput, setScriptInput] = useState<string>(DEFAULT_SCRIPT_ID);
  const [loadingScript, setLoadingScript] = useState(false);
  const [scriptError, setScriptError] = useState<string>('');
  const [scriptStats, setScriptStats] = useState<any>(null);
  const [pendingContent, setPendingContent] = useState<JSONContent | null>(null);

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

  // Load script content from backend
  const loadScript = useCallback(async (id: string) => {
    setLoadingScript(true);
    setScriptError('');
    setScriptStats(null);

    try {
      console.log('[TestTipTap] Fetching script content for:', id);

      // Use existing API helper (handles auth automatically)
      const scriptData: ScriptWithContent = await getScriptContent(id);

      console.log('[TestTipTap] Script content received:', {
        title: scriptData.title,
        current_version: scriptData.current_version,
        content_source: scriptData.content_source,
        blocks: scriptData.content_blocks?.length || 0
      });

      if (!scriptData.content_blocks || scriptData.content_blocks.length === 0) {
        console.warn('[TestTipTap] No content_blocks found in script');
        setScriptError('Script has no content. Try uploading an FDX file first.');
        return;
      }

      // Convert backend format to TipTap format
      const tipTapDoc = contentBlocksToTipTap(scriptData.content_blocks);
      console.log('[TestTipTap] Converted to TipTap document:', {
        docType: tipTapDoc.type,
        contentNodes: tipTapDoc.content?.length || 0
      });

      // Get statistics
      const stats = getContentBlocksStats(scriptData.content_blocks);
      setScriptStats(stats);
      console.log('[TestTipTap] Content statistics:', stats);

      // Store content in state - useEffect will apply when editor is ready
      console.log('[TestTipTap] Storing content for application to editor');
      setPendingContent(tipTapDoc);

    } catch (error: any) {
      console.error('[TestTipTap] Load failed:', error);
      setScriptError(error.message || 'Failed to load script');
    } finally {
      setLoadingScript(false);
    }
  }, []);

  // Handle script ID change - allow reload even if same ID (useful for testing)
  const handleLoadScript = () => {
    if (scriptInput) {
      setScriptId(scriptInput);
      loadScript(scriptInput);
    }
  };

  // Reuse existing Yjs collaboration hook
  const {
    doc,
    provider,
    isConnected,
    syncStatus,
    connectionError,
    reconnect,
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
        enableSmartPageBreaks: true,  // Enable smart page breaks (Tier 1 foundation)
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
      /* Start at 1 so the *second* page shows 2 (we'll hide page 1 header) */
      .rm-with-pagination { counter-reset: page-number 1 !important; }

      /* Do NOT show a number in the first page header */
      .rm-with-pagination .rm-first-page-header .rm-page-number { 
        display: none !important; 
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  // Apply pending content when editor becomes ready
  useEffect(() => {
    if (editor && pendingContent) {
      console.log('[TestTipTap] Applying pending content to editor');
      editor.commands.setContent(pendingContent);
      console.log('[TestTipTap] Content applied successfully');
      setPendingContent(null); // Clear after applying
    }
  }, [editor, pendingContent]);

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

  const openNewTab = () => {
    window.open('/test-tiptap', '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header with Status and Controls */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">TipTap Phase 1 POC</h1>
            <p className="text-sm text-gray-600">Testing Collaboration + Pagination</p>
          </div>

          <div className="flex items-center gap-4">
            {/* Connection Status */}
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getStatusColor(syncStatus)}`}></div>
              <span className="text-sm font-medium text-gray-700 capitalize">
                {syncStatus}
              </span>
            </div>

            {/* Reconnect Button */}
            {!isConnected && (
              <button
                onClick={reconnect}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
              >
                Reconnect
              </button>
            )}

            {/* Open New Tab for Collaboration Test */}
            <button
              onClick={openNewTab}
              className="px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 font-medium"
            >
              Open in New Tab
            </button>
          </div>
        </div>
      </div>

      {/* Test Info Panel */}
      <div className="max-w-7xl mx-auto px-6 py-4">
        {/* Script Loader */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-gray-900 mb-3">Load Script from Backend</h3>
          <div className="flex gap-3 items-start">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Script ID
              </label>
              <input
                type="text"
                value={scriptInput}
                onChange={(e) => setScriptInput(e.target.value)}
                placeholder="Enter script ID (UUID)"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="pt-7">
              <button
                onClick={handleLoadScript}
                disabled={loadingScript || !scriptInput}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
              >
                {loadingScript ? 'Loading...' : 'Load Script'}
              </button>
            </div>
          </div>

          {scriptError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">
                <strong>Error:</strong> {scriptError}
              </p>
            </div>
          )}

          {scriptStats && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-800">
                <strong>Loaded:</strong> {scriptStats.totalBlocks} blocks, {scriptStats.totalWords} words
                {scriptStats.typeCounts.scene_heading && ` • ${scriptStats.typeCounts.scene_heading} scenes`}
              </p>
            </div>
          )}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-blue-900 mb-2">Phase 1 POC Testing Instructions</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>1. Upload an FDX file via backend API to get a script ID</li>
            <li>2. Enter the script ID above and click "Load Script"</li>
            <li>3. Click &ldquo;Open in New Tab&rdquo; to test real-time collaboration</li>
            <li>4. Type in one tab and watch it appear instantly in the other</li>
            <li>5. Verify pagination and formatting match industry standards</li>
          </ul>
        </div>

        {/* User Info */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-3">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: userColor }}
            ></div>
            <span className="text-sm font-medium text-gray-700">
              You are: {userName}
            </span>
            <span className="text-xs text-gray-500">
              (Cursor color: {userColor})
            </span>
            {user && (
              <span className="text-xs text-gray-500 ml-auto">
                Signed in as: {user.email}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Editor Container */}
      <div className="bg-white rounded-lg shadow-lg">
        {/* keep the outer card full-width if you like, but center the editor inside */}
        <div className="flex justify-center">
          <EditorContent editor={editor} className="screenplay-editor" />
        </div>
      </div>

      {/* Pagination Info (Footer) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-sm text-gray-600">
          <div>
            <span className="font-medium">Script ID:</span> {scriptId}
          </div>
          <div>
            <span className="font-medium">TipTap Version:</span> 2.26.4
          </div>
          <div>
            <span className="font-medium">Pagination:</span> US Letter (55 lines/page target)
          </div>
        </div>
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

        /* Page break styling */
        .screenplay-editor .page-break {
          border-top: 2px dashed #ccc;
          margin: 2rem 0;
          padding-top: 2rem;
          page-break-after: always;
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
    </div>
  );
}
