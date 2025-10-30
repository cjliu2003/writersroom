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

import React, { useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
// @ts-ignore - pagination extension may not have types
import PaginationExtension, {PageNode, HeaderFooterNode, BodyNode} from 'tiptap-extension-pagination';
import { useScriptYjsCollaboration, SyncStatus } from '@/hooks/use-script-yjs-collaboration';
import { useAuth } from '@/contexts/AuthContext';
import { ScreenplayKit } from '@/extensions/screenplay/screenplay-kit';
import '@/styles/screenplay.css';

// Use a real script ID - you can get one from /script-editor page URL
// Or navigate to your home page, create a script, and copy its ID here
const TEST_SCRIPT_ID = 'bb82f02b-2ec5-4670-9f56-3268f693cd18'; // Replace with real script ID!

// Generate random color for user cursor
const getRandomColor = () => {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];
  return colors[Math.floor(Math.random() * colors.length)];
};

export default function TestTipTapPage() {
  const [userColor] = useState(getRandomColor());
  const [userName] = useState(`User-${Math.floor(Math.random() * 1000)}`);
  const [authToken, setAuthToken] = useState<string>('');

  // Get Firebase auth from context (same pattern as other editors)
  const { user, getToken, isLoading: authLoading } = useAuth();

  // Fetch auth token when user is available (force refresh to avoid expired tokens)
  useEffect(() => {
    let cancelled = false;
    const fetchToken = async () => {
      try {
        console.log('[AUTH DEBUG] Starting token fetch with forceRefresh=true');
        console.log('[AUTH DEBUG] Current user:', user?.email);

        // Force refresh to get a fresh token (WebSocket needs valid token)
        const token = await getToken(true);

        console.log('[AUTH DEBUG] Received token:', token ? `${token.substring(0, 50)}... (length: ${token.length})` : 'null');

        // Decode and log token expiration for debugging
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const now = Math.floor(Date.now() / 1000);
            const expiresIn = payload.exp - now;
            console.log('[AUTH DEBUG] Token exp:', new Date(payload.exp * 1000).toISOString());
            console.log('[AUTH DEBUG] Token expires in:', expiresIn, 'seconds');
            console.log('[AUTH DEBUG] Token is', expiresIn > 0 ? 'VALID' : 'EXPIRED');
          } catch (decodeError) {
            console.warn('[AUTH DEBUG] Could not decode token:', decodeError);
          }
        }

        if (cancelled) return;
        setAuthToken(token || '');
        console.log('[AUTH DEBUG] Token state updated');
      } catch (e) {
        console.error('[AUTH DEBUG] Token fetch FAILED:', e);
        if (cancelled) return;
        setAuthToken('');
      }
    };
    if (user) {
      console.log('[AUTH DEBUG] User detected, fetching token...');
      fetchToken();
    } else {
      console.log('[AUTH DEBUG] No user, skipping token fetch');
    }
    return () => { cancelled = true };
  }, [user, getToken]);

  // Reuse existing Yjs collaboration hook (100% unchanged!)
  const {
    doc,
    provider,
    isConnected,
    syncStatus,
    connectionError,
    reconnect,
  } = useScriptYjsCollaboration({
    scriptId: TEST_SCRIPT_ID,
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
      ScreenplayKit,
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
      PaginationExtension.configure({
        defaultPaperSize: "Letter", // 8.5" × 11"
        defaultMarginConfig: {
          top: 25.4,    // 1 inch (mm)
          bottom: 25.4,
          left: 38.1,  // 1.5 inches (screenplay binding margin)
          right: 25.4,
        },
        pageAmendmentOptions: { enableHeader: false, enableFooter: false }, 
        defaultPageBorders: {top: 10, right: 10, bottom: 10, left: 10}
      }),
      PageNode,
      HeaderFooterNode,
      BodyNode
    ],
    editorProps: {
      attributes: {
        class: 'screenplay-editor prose prose-sm focus:outline-none min-h-screen p-8',
      },
    },
    content: !doc ? '<p>Connecting to collaboration server...</p>' : undefined,
  }, [doc, provider]);

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
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-blue-900 mb-2">Phase 1 POC Testing Instructions</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>1. Click &ldquo;Open in New Tab&rdquo; to test real-time collaboration</li>
            <li>2. Type in one tab and watch it appear instantly in the other</li>
            <li>3. Type ~55 lines to see automatic page break insertion</li>
            <li>4. Verify collaboration status shows &ldquo;synced&rdquo; (green)</li>
            <li>5. Test: Close one tab, verify content persists in other tab</li>
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
      <div className="max-w-7xl mx-auto px-6 pb-12">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <EditorContent
            editor={editor}
            className="screenplay-editor"
          />
        </div>
      </div>

      {/* Pagination Info (Footer) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-sm text-gray-600">
          <div>
            <span className="font-medium">Script ID:</span> {TEST_SCRIPT_ID}
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
          padding: 2rem;
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
