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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { JSONContent } from '@tiptap/core';
import * as Y from 'yjs';
import { yUndoPluginKey } from 'y-prosemirror';
// @ts-ignore - pagination extension may not have types
import { useScriptYjsCollaboration, SyncStatus } from '@/hooks/use-script-yjs-collaboration';
import { useScriptAutosave, SaveState } from '@/hooks/use-script-autosave';
import { useOfflineRecovery } from '@/hooks/use-offline-recovery';
import { OfflineRecoveryDialog } from '@/components/offline-recovery-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { ScreenplayKit, SmartTypePopup } from '@/extensions/screenplay/screenplay-kit';
import { ScreenplayDocument } from '@/extensions/screenplay/screenplay-document';
import { FindReplaceExtension, FindReplacePopup } from '@/extensions/find-replace';
import {PaginationPlus, PAGE_SIZES} from '@jack/tiptap-pagination-plus';
import { contentBlocksToTipTap, tipTapToContentBlocks } from '@/utils/content-blocks-converter';
import { getScriptContent, exportFDXFile, exportPDFFile, updateScript, type ScriptWithContent } from '@/lib/api';
import { loadLayoutPrefs, saveLayoutPrefs, type EditorLayoutPrefs, type ChatPosition } from '@/utils/layoutPrefs';
import {
  extractSceneBoundariesFromTipTap,
  scrollToScene,
  getCurrentSceneIndex,
  type SceneBoundary
} from '@/utils/tiptap-scene-tracker';
import { SceneNavBar } from '@/components/scene-nav-bar';
import { AIChatbot } from '@/components/ai-chatbot';
import ProcessingScreen from '@/components/ProcessingScreen';
import { ShareDialog } from '@/components/share-dialog';
import { EditMenuDropdown } from '@/components/edit-menu-dropdown';
import { FileMenuDropdown } from '@/components/file-menu-dropdown';
import { TipTapBlockTypeDropdown } from '@/components/tiptap-block-type-dropdown';
import { FormattingToolbar } from '@/components/formatting-toolbar';
import { Button } from '@/components/ui/button';
import { Home, Share2, ChevronUp, ChevronDown } from 'lucide-react';
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
  const [authToken, setAuthToken] = useState<string>('');
  // Read scriptId from query params, fallback to default for testing
  const [scriptId, setScriptId] = useState<string>(() => searchParams.get('scriptId') || DEFAULT_SCRIPT_ID);
  const [pendingContent, setPendingContent] = useState<JSONContent | null>(null);
  const [script, setScript] = useState<ScriptWithContent | null>(null);

  // UI state
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [chatHeight, setChatHeight] = useState(220);
  const [chatPosition, setChatPosition] = useState<ChatPosition>('bottom');
  const [chatWidth, setChatWidth] = useState(360);
  const [chatBottomWidth, setChatBottomWidth] = useState(1200);
  const [lastSaved, setLastSaved] = useState<Date>(new Date());
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isLoadingScript, setIsLoadingScript] = useState(true);

  // Editable title state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  // Offline recovery state (for crash recovery)
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveredContent, setRecoveredContent] = useState<any[] | null>(null);
  const [forceApplyRecovered, setForceApplyRecovered] = useState(false); // Bypass Yjs check during recovery

  // Collapsible bar states
  const [isTopBarCollapsed, setIsTopBarCollapsed] = useState(false);
  const [isSceneNavCollapsed, setIsSceneNavCollapsed] = useState(false);

  // Share dialog state
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);

  // Scene tracking state
  const [sceneBoundaries, setSceneBoundaries] = useState<SceneBoundary[]>([]);
  const [currentSceneIndex, setCurrentSceneIndex] = useState<number | null>(null);

  // Collaborator presence tracking
  const [collaborators, setCollaborators] = useState<Array<{ name: string; color: string; clientId: number }>>([]);

  // Get Firebase auth from context (same pattern as other editors)
  const { user, getToken, isLoading: authLoading } = useAuth();

  // Derive user name for collaboration cursor from authenticated user
  const userName = user?.displayName || user?.email?.split('@')[0] || 'Anonymous';

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

  // Offline recovery hook - checks IndexedDB for crash recovery
  const [recoveryState, recoveryActions] = useOfflineRecovery(
    scriptId,
    script?.updated_at || null
  );

  // Handle recovery dialog actions
  const handleRecover = async () => {
    setIsRecovering(true);
    try {
      const content = await recoveryActions.recoverChanges();
      console.log('[TipTapEditor] Recovered offline content:', content.length, 'blocks');
      setRecoveredContent(content);
      // This content will be used to seed Yjs instead of server content
    } catch (e) {
      console.error('[TipTapEditor] Recovery failed:', e);
    } finally {
      setIsRecovering(false);
    }
  };

  const handleDiscard = async () => {
    await recoveryActions.discardChanges();
    console.log('[TipTapEditor] Discarded offline changes');
    // Continue with normal load from server
  };

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
          // Otherwise, set initial content with scene heading and show editor
          if (!scriptData.has_yjs_updates) {
            console.log('[TipTapEditor] No Yjs updates, setting initial scene heading document');
            // Use contentBlocksToTipTap to get default document (starts with scene heading)
            const initialDoc = contentBlocksToTipTap([]);
            setPendingContent(initialDoc);
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
    awareness,
    syncStatus,
    connectionError,
  } = useScriptYjsCollaboration({
    scriptId: scriptId,
    authToken: authToken,
    enabled: !!authToken,
  });

  // Editor ref for autosave content extraction (set after editor is created)
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);

  // Content extraction function for REST autosave fallback
  // Converts TipTap ProseMirror JSON to backend content_blocks format
  const getContentBlocks = useCallback((): any[] => {
    if (!editorRef.current) {
      console.warn('[Autosave] No editor available for content extraction');
      return [];
    }
    const tipTapDoc = editorRef.current.getJSON();
    const blocks = tipTapToContentBlocks(tipTapDoc);
    console.log('[Autosave] Extracted content blocks:', blocks.length);
    return blocks;
  }, []);

  // REST autosave hook as fallback when Yjs WebSocket fails
  // This ensures edits are NEVER lost, even if Yjs has connection issues
  const [autosaveState, autosaveActions] = useScriptAutosave(
    scriptId,
    script?.current_version || 1,
    getContentBlocks,
    authToken,
    {
      debounceMs: 2000,    // Slightly longer debounce than scene-level (2s vs 1.5s)
      maxWaitMs: 8000,     // Force save after 8 seconds of changes
      maxRetries: 3,
      enableOfflineQueue: true,
    }
  );

  // CRITICAL: Trigger REST autosave when Yjs sync is NOT healthy
  // This is the fallback that prevents data loss
  useEffect(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;

    const handleUpdate = () => {
      // Conditions that should trigger REST autosave fallback:
      // 1. Yjs sync status is 'error' (connection failed)
      // 2. Yjs sync status is 'offline' (browser/network offline)
      // 3. Yjs is still 'connecting' for too long (connection stuck)
      const yjsUnhealthy = syncStatus === 'error' || syncStatus === 'offline' || syncStatus === 'connecting';

      if (yjsUnhealthy) {
        console.log('[Autosave] Yjs unhealthy, triggering REST fallback save. Status:', syncStatus);
        autosaveActions.markChanged();
      }
    };

    currentEditor.on('update', handleUpdate);

    return () => {
      currentEditor.off('update', handleUpdate);
    };
  }, [syncStatus, autosaveActions]);

  // Track collaborators via awareness for presence indicator
  useEffect(() => {
    if (!awareness) return;

    const updateCollaborators = () => {
      const states = awareness.getStates();
      const localClientId = awareness.clientID;
      const remoteUsers: Array<{ name: string; color: string; clientId: number }> = [];

      states.forEach((state: any, clientId: number) => {
        // Skip our own client
        if (clientId === localClientId) return;
        // Handle both TipTap CollaborationCursor format (user.name, user.color)
        // and our hook's format (name, color at root level)
        const name = state?.user?.name || state?.name;
        const color = state?.user?.color || state?.color || '#888888';
        if (name) {
          remoteUsers.push({ name, color, clientId });
        }
      });

      setCollaborators(remoteUsers);
    };

    // Initial update
    updateCollaborators();

    // Listen for changes
    awareness.on('change', updateCollaborators);

    return () => {
      awareness.off('change', updateCollaborators);
    };
  }, [awareness]);

  // Initialize TipTap editor with screenplay extensions + collaboration + pagination
  const editor = useEditor({
    extensions: [
      // Custom Document FIRST - enforces sceneHeading as first block for new scripts
      // This ensures ProseMirror's createAndFill() creates sceneHeading, not paragraph
      ScreenplayDocument,
      // Screenplay formatting - ensures screenplay keyboard handlers take precedence
      ScreenplayKit.configure({
        enableSmartPageBreaks: false,
      }),
      // StarterKit AFTER screenplay - disable conflicting extensions
      StarterKit.configure({
        document: false,   // Using ScreenplayDocument instead (enforces sceneHeading first)
        history: false,    // Yjs provides undo/redo
        heading: false,    // ScreenplayKit provides scene headings
        // Note: paragraph kept enabled for schema compatibility; Action handlers check for it
      }),
      // Text formatting marks (Underline not in StarterKit)
      Underline,
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
        // US Letter at 96 DPI
        pageHeight: 1056,            // 11" × 96 DPI
        pageWidth: 816,              // 8.5" × 96 DPI

        // Gap between pages in editor view
        pageGap: 24,
        pageGapBorderSize: 1,
        pageBreakBackground: '#e0e2e6',

        // Header: page number sits 0.5" from top edge
        pageHeaderHeight: 48,        // 0.5" × 96 DPI
        pageFooterHeight: 0,
        headerLeft: '',
        headerRight: '<span class="rm-page-number"></span>.',
        footerLeft: '',
        footerRight: '',

        // Margins: headerHeight + marginTop = 1" from page top to content
        marginTop: 48,               // 48 + 48 (header) = 96px = 1"
        marginBottom: 96,            // 1" × 96 DPI
        marginLeft: 144,             // 1.5" × 96 DPI
        marginRight: 96,             // 1" × 96 DPI

        // No extra content padding
        contentMarginTop: 0,
        contentMarginBottom: 0,
      }),
      // Find/Replace
      FindReplaceExtension,
    ],
    editorProps: {
      attributes: { class: 'screenplay-editor focus:outline-none min-h-screen' },
    },
    content: !doc ? '<p>Connecting to collaboration server...</p>' : undefined,
  }, [doc, provider]);

  // Keep editorRef in sync with editor instance for autosave content extraction
  useEffect(() => {
    if (editor) {
      (editorRef as React.MutableRefObject<typeof editor>).current = editor;
    }
  }, [editor]);

  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-pagination-overrides", "true");
    style.textContent = `
      /* Start at 1 so the *second* page shows 2 (we'll hide page 1 header content) */
      .rm-with-pagination { counter-reset: page-number 1 !important; }

      /* Hide first page header content (number and dot) but keep spacing */
      .rm-with-pagination.screenplay-editor .rm-first-page-header {
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
      // EXCEPTION: If we're recovering offline content, that content takes priority
      if (script?.has_yjs_updates && !forceApplyRecovered) {
        console.log('[TestTipTap] Skipping setContent - Yjs updates exist in database (Yjs is source of truth)');
        setPendingContent(null); // Clear pending content to prevent retry
        return;
      }

      // Log if we're force-applying recovered content
      if (forceApplyRecovered) {
        console.log('[TestTipTap] Force-applying recovered content (bypassing Yjs check)');
      }

      // After sync completes, check if Yjs document already has MEANINGFUL content
      // IMPORTANT: y-prosemirror creates a default empty paragraph when syncing with an
      // empty server document. This means yjsFragment.length > 0 is TRUE even for "empty"
      // documents. We must check actual text content, not just structural element count.
      // See: https://discuss.yjs.dev/t/whats-the-correct-way-to-set-default-content-for-y-prosemirror/1129
      const yjsFragment = doc.get('default', Y.XmlFragment);

      // Extract text content from Yjs fragment (strip XML tags, check for actual characters)
      const yjsXmlString = yjsFragment ? yjsFragment.toString() : '';
      const yjsTextContent = yjsXmlString.replace(/<[^>]*>/g, '').trim();
      const yjsHasContent = yjsTextContent.length > 0;

      // Check if editor already has MEANINGFUL content (actual text, not just empty structure)
      // Previously used `content.size > 2` but that's true even for an empty paragraph
      // which causes the scene heading seed to be skipped for new scripts
      const editorHasContent = editor.state.doc.textContent.trim().length > 0;

      // Skip seeding if content already exists - UNLESS we're force-applying recovered content
      if ((yjsHasContent || editorHasContent) && !forceApplyRecovered) {
        console.log('[TestTipTap] Skipping setContent - content already exists:', {
          yjsFragmentLength: yjsFragment?.length || 0,
          yjsTextLength: yjsTextContent.length,
          editorTextLength: editor.state.doc.textContent.trim().length,
          syncStatus: syncStatus,
          reason: yjsHasContent ? 'Yjs has text content (from sync)' : 'Editor has text content'
        });
        setPendingContent(null); // Clear pending content to prevent retry
        return;
      }

      // Safe to seed - either empty document or force-applying recovered content
      console.log('[TestTipTap] Seeding editor:', forceApplyRecovered ? 'recovered content' : 'no content found after sync');
      editor.commands.setContent(pendingContent);
      console.log('[TestTipTap] Content applied successfully');

      // Clear the force-apply flag after successful application
      if (forceApplyRecovered) {
        setForceApplyRecovered(false);
      }

      // Clear undo stack after seeding to prevent "undo removes entire script" edge case
      // The initial content seeding should not be undoable - only user edits should be
      setTimeout(() => {
        try {
          const undoManager = yUndoPluginKey.getState(editor.state)?.undoManager;
          if (undoManager) {
            undoManager.clear();
            console.log('[TestTipTap] Cleared undo stack after content seeding');
          }
        } catch (e) {
          console.warn('[TestTipTap] Failed to clear undo stack:', e);
        }
      }, 0);

      setPendingContent(null); // Clear after applying
    }
  }, [editor, pendingContent, doc, syncStatus, script, forceApplyRecovered]);

  // Hide loading screen when Yjs sync completes (for has_yjs_updates case)
  useEffect(() => {
    if (script?.has_yjs_updates && syncStatus === 'synced' && isLoadingScript) {
      console.log('[TipTapEditor] Yjs sync complete, hiding loading screen');
      setIsLoadingScript(false);
    }
  }, [script, syncStatus, isLoadingScript]);

  // Handle recovered offline content - convert to TipTap format and seed
  useEffect(() => {
    if (recoveredContent && recoveredContent.length > 0) {
      console.log('[TipTapEditor] Using recovered content:', recoveredContent.length, 'blocks');
      const tipTapDoc = contentBlocksToTipTap(recoveredContent);
      setPendingContent(tipTapDoc);
      setForceApplyRecovered(true); // Bypass Yjs check for this content
      setRecoveredContent(null); // Clear after using
      // Force hide loading screen since we have content to seed
      setIsLoadingScript(false);
    }
  }, [recoveredContent]);

  // Verify that ScreenplayDocument schema fix is working
  // The custom Document with content: 'sceneHeading block*' should ensure
  // new empty documents start with sceneHeading, not paragraph
  useEffect(() => {
    if (!editor || syncStatus !== 'synced') return;

    // Log first node type after sync to verify the schema fix is working
    const timer = setTimeout(() => {
      const firstNode = editor.state.doc.firstChild;
      const docText = editor.state.doc.textContent.trim();

      console.log('[TipTapEditor] Document initialized:', {
        firstNodeType: firstNode?.type.name,
        isEmpty: docText.length === 0,
        nodeCount: editor.state.doc.childCount,
      });

      // If first node is NOT sceneHeading on an empty doc, log a warning
      // This shouldn't happen with the ScreenplayDocument schema fix
      if (docText.length === 0 && firstNode?.type.name !== 'sceneHeading') {
        console.warn('[TipTapEditor] Unexpected first block type for empty document:', firstNode?.type.name);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [editor, syncStatus]);

  // Load layout preferences on mount
  useEffect(() => {
    const prefs = loadLayoutPrefs();
    setIsChatCollapsed(prefs.chatCollapsed ?? false);
    setChatHeight(prefs.chatHeight ?? 220);
    setChatPosition(prefs.chatPosition ?? 'bottom');
    setChatWidth(prefs.chatWidth ?? 360);
    setChatBottomWidth(prefs.chatBottomWidth ?? 1200);
  }, []);

  // Save layout preferences when chat state changes
  useEffect(() => {
    saveLayoutPrefs({
      chatCollapsed: isChatCollapsed,
      chatHeight,
      chatPosition,
      chatWidth,
      chatBottomWidth
    });
  }, [isChatCollapsed, chatHeight, chatPosition, chatWidth, chatBottomWidth]);

  // Handle vertical resize drag (for bottom position)
  const handleVerticalResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    const startY = e.clientY;
    const startHeight = chatHeight;
    const collapseThreshold = 100; // Collapse if dragged below this height

    const cleanup = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const rawHeight = startHeight + deltaY;

      // Auto-collapse immediately when dragged below threshold
      if (rawHeight < collapseThreshold) {
        setIsChatCollapsed(true);
        setChatHeight(220); // Reset to default for next expand
        cleanup();
        return;
      }

      const newHeight = Math.min(rawHeight, window.innerHeight * 0.6);
      setChatHeight(newHeight);
    };

    const handleMouseUp = () => {
      cleanup();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [chatHeight]);

  // Handle horizontal resize drag (for left/right positions)
  const handleHorizontalResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    const startX = e.clientX;
    const startWidth = chatWidth;
    const collapseThreshold = 150; // Collapse if dragged below this width
    const isLeftPosition = chatPosition === 'left';

    const cleanup = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      // For left position: dragging right increases width
      // For right position: dragging left increases width
      const rawWidth = isLeftPosition ? startWidth + deltaX : startWidth - deltaX;

      // Auto-collapse immediately when dragged below threshold
      if (rawWidth < collapseThreshold) {
        setIsChatCollapsed(true);
        setChatWidth(360); // Reset to default for next expand
        cleanup();
        return;
      }

      const newWidth = Math.min(Math.max(rawWidth, 280), window.innerWidth * 0.5);
      setChatWidth(newWidth);
    };

    const handleMouseUp = () => {
      cleanup();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [chatWidth, chatPosition]);

  // Handle horizontal resize drag for bottom position (symmetric, stays centered)
  const handleBottomHorizontalResizeMouseDown = useCallback((e: React.MouseEvent, side: 'left' | 'right') => {
    e.preventDefault();

    const startX = e.clientX;
    const startWidth = chatBottomWidth;
    const minWidth = 816; // Match script page width (letter size at 96 DPI)
    const maxWidth = Math.min(window.innerWidth * 0.95, 1600);

    const cleanup = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      // Multiply by 2 because we're resizing symmetrically from center
      // Left side: dragging left increases width, dragging right decreases
      // Right side: dragging right increases width, dragging left decreases
      const widthDelta = side === 'left' ? -deltaX * 2 : deltaX * 2;
      const newWidth = Math.min(Math.max(startWidth + widthDelta, minWidth), maxWidth);
      setChatBottomWidth(newWidth);
    };

    const handleMouseUp = () => {
      cleanup();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [chatBottomWidth]);

  // Track current scene and extract boundaries on any editor change
  // Combined into single effect to ensure boundaries are always fresh
  const sceneUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousSceneIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (!editor) return;

    const updateSceneState = () => {
      // Re-extract boundaries on every change to ensure positions are accurate
      const boundaries = extractSceneBoundariesFromTipTap(editor);
      setSceneBoundaries(boundaries);

      // Use fresh boundaries for scene detection
      const sceneIndex = getCurrentSceneIndex(editor, boundaries);

      // Guard: Detect spurious selection jumps to position 1 (Scene 1)
      // This happens when clicking in pagination gaps or outside content areas.
      // The editor resets selection to doc start, falsely highlighting Scene 1.
      const currentPos = editor.state.selection.anchor;
      const prevIndex = previousSceneIndexRef.current;

      if (
        sceneIndex === 0 &&           // New scene would be Scene 1
        currentPos <= 2 &&            // Selection is at very start of document
        prevIndex !== null &&         // We had a previous scene
        prevIndex !== 0               // We were NOT already in Scene 1
      ) {
        // Suspicious jump to position 1 from a different scene - ignore this update
        console.log('[TipTapEditor] Ignoring spurious selection jump to position 1');
        return;
      }

      previousSceneIndexRef.current = sceneIndex;
      setCurrentSceneIndex(sceneIndex);
    };

    // Debounced version for document changes (typing) - reduces CPU usage
    const debouncedUpdateSceneState = () => {
      if (sceneUpdateTimeoutRef.current) {
        clearTimeout(sceneUpdateTimeoutRef.current);
      }
      sceneUpdateTimeoutRef.current = setTimeout(updateSceneState, 200);
    };

    // Update on selection change (clicking/navigating in editor) - immediate for responsive highlighting
    editor.on('selectionUpdate', updateSceneState);

    // Update on document changes (typing, editing) - debounced for performance
    editor.on('update', debouncedUpdateSceneState);

    // Initial update
    updateSceneState();

    return () => {
      editor.off('selectionUpdate', updateSceneState);
      editor.off('update', debouncedUpdateSceneState);
      if (sceneUpdateTimeoutRef.current) {
        clearTimeout(sceneUpdateTimeoutRef.current);
      }
    };
  }, [editor]);

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
      console.log('[TipTapEditor] FDX export successful');
    } catch (e: any) {
      setExportError(e?.message || 'Export failed. Please try again.');
      console.error('[TipTapEditor] FDX export failed:', e);
    } finally {
      setIsExporting(false);
    }
  };

  // Export PDF handler
  const handleExportPDF = async () => {
    if (!scriptId) {
      setExportError('No script loaded.');
      return;
    }
    setIsExporting(true);
    setExportError(null);

    try {
      const blob = await exportPDFFile(scriptId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${script?.title || 'script'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      console.log('[TipTapEditor] PDF export successful');
    } catch (e: any) {
      setExportError(e?.message || 'PDF export failed. Please try again.');
      console.error('[TipTapEditor] PDF export failed:', e);
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
  // Get combined status from Yjs sync and REST autosave
  // Priority: Show Yjs status when healthy, show autosave status when Yjs is failing
  const getCombinedStatus = (): { color: string; text: string; animate: boolean } => {
    const yjsHealthy = syncStatus === 'synced' || syncStatus === 'connected';

    if (yjsHealthy) {
      // Yjs is working - show Yjs status
      return {
        color: syncStatus === 'synced' ? 'bg-green-500' : 'bg-yellow-500',
        text: syncStatus === 'synced' ? 'Saved' : 'Syncing',
        animate: syncStatus !== 'synced'
      };
    }

    // Yjs is unhealthy - show REST autosave status as fallback
    switch (autosaveState.saveState) {
      case 'saved':
        return { color: 'bg-green-500', text: 'Saved (REST)', animate: false };
      case 'saving':
        return { color: 'bg-blue-500', text: 'Saving...', animate: true };
      case 'pending':
        return { color: 'bg-yellow-500', text: 'Pending', animate: true };
      case 'offline':
        return { color: 'bg-orange-500', text: 'Offline (queued)', animate: true };
      case 'error':
        return { color: 'bg-red-500', text: 'Error', animate: false };
      case 'conflict':
        return { color: 'bg-red-500', text: 'Conflict', animate: true };
      case 'rate_limited':
        return { color: 'bg-orange-500', text: 'Rate limited', animate: true };
      default:
        // Yjs is failing but autosave hasn't kicked in yet
        if (syncStatus === 'error') {
          return { color: 'bg-red-500', text: 'Disconnected', animate: false };
        }
        return { color: 'bg-yellow-500', text: 'Connecting', animate: true };
    }
  };

  const combinedStatus = getCombinedStatus();

  return (
    <>
      {/* Loading Screen - covers everything until editor is fully ready */}
      <ProcessingScreen
        isVisible={isLoadingScript || authLoading || !script}
        mode="open"
      />

      {/* Offline Recovery Dialog - shown when crash recovery is available */}
      <OfflineRecoveryDialog
        isOpen={!recoveryState.isChecking && recoveryState.hasUnsyncedChanges}
        pendingTimestamp={recoveryState.pendingTimestamp}
        serverTimestamp={recoveryState.serverTimestamp}
        onRecover={handleRecover}
        onDiscard={handleDiscard}
        isRecovering={isRecovering}
      />

      <div className="flex h-screen bg-[#e0e2e6]">
        {/* Fixed Top Header - Compact Screenplay Style (collapsible) */}
      {!isTopBarCollapsed && (
        <div className="fixed top-0 left-0 right-0 z-50 border-b border-gray-300 bg-white shadow-sm transition-all duration-200" style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}>
          <div className="relative px-4 flex items-center justify-between h-11">
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
              <FileMenuDropdown
                onExportFDX={handleExportFDX}
                onExportPDF={handleExportPDF}
                isExporting={isExporting}
                scriptTitle={script?.title}
              />
              <EditMenuDropdown editor={editor} />
              {/* Separator */}
              <div className="w-px h-5 bg-gray-200 mx-1" />
              {/* Block Type Selector */}
              <TipTapBlockTypeDropdown editor={editor} />
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
                className="text-slate-700 text-xl tracking-wider text-center bg-transparent focus:outline-none px-3 py-0.5 uppercase"
                style={{ fontFamily: "inherit", width: '40ch' }}
              />
            ) : (
              <h1
                onClick={handleTitleClick}
                className="text-slate-700 text-xl tracking-wider truncate text-center cursor-pointer hover:opacity-70 transition-opacity px-3 py-0.5 uppercase"
                style={{ fontFamily: "inherit", maxWidth: '40ch' }}
                title="Click to edit title"
              >
                {script?.title || 'Untitled Script'}
              </h1>
            )}
          </div>

          {/* Right - Formatting, Collaborators, Share, Home, Save Status */}
          <div className="flex items-center gap-0.5 pr-0">
            {/* Formatting Toolbar */}
            <FormattingToolbar editor={editor} className="flex-shrink-0" />
            {/* Separator */}
            <div className="w-px h-5 bg-gray-200 mx-1 flex-shrink-0" />
            {/* Collaborator presence avatars - minimal, only shows when others are editing */}
            {collaborators.length > 0 && (
              <div className="flex items-center flex-shrink-0 mr-1">
                <div className="flex items-center -space-x-1.5">
                  {collaborators.slice(0, 3).map((collab) => (
                    <div
                      key={collab.clientId}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium text-white ring-2 ring-white"
                      style={{ backgroundColor: collab.color }}
                      title={collab.name}
                    >
                      {collab.name.charAt(0).toUpperCase()}
                    </div>
                  ))}
                  {collaborators.length > 3 && (
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium text-gray-600 bg-gray-200 ring-2 ring-white"
                      title={`${collaborators.length - 3} more`}
                    >
                      +{collaborators.length - 3}
                    </div>
                  )}
                </div>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsShareDialogOpen(true)}
              className="text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded px-2.5 py-1 text-sm font-normal flex-shrink-0"
              style={{ fontFamily: "inherit" }}
              title="Share this script"
            >
              <Share2 className="w-3.5 h-3.5 mr-1.5" />
              Share
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/")}
              className="text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded px-2.5 py-1 text-sm font-normal flex-shrink-0"
              style={{ fontFamily: "inherit" }}
              title="Go to home"
            >
              <Home className="w-3.5 h-3.5 mr-1.5" />
              Home
            </Button>
            {/* Separator */}
            <div className="w-px h-5 bg-gray-200 ml-0.5 mr-[10px] flex-shrink-0" />
            {/* Save status indicator - fixed width to prevent layout shift */}
            <div className="flex items-center gap-1 flex-shrink-0 w-16">
              <div
                className={`w-1.5 h-1.5 rounded-full ${combinedStatus.color} ${combinedStatus.animate ? 'animate-pulse' : ''}`}
                title={`Yjs: ${syncStatus}, Autosave: ${autosaveState.saveState}`}
              />
              <span className="text-[10px] text-gray-400 whitespace-nowrap" style={{ fontFamily: "inherit" }}>
                {combinedStatus.text}
              </span>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Expand button when top bar is collapsed */}
      {/* When scene nav is visible: sits on left side of scene nav bar, vertically centered (frames the bar with collapse button on right) */}
      {/* When scene nav is collapsed: moves to right side only if chat is on left (to avoid overlap) */}
      {isTopBarCollapsed && (() => {
        const sceneNavVisible = !isSceneNavCollapsed;
        const chatOnLeft = chatPosition === 'left' && !isChatCollapsed;

        // Horizontal: always left when scene nav visible (frames the bar), otherwise avoid chat
        const horizontalPos = sceneNavVisible ? 'left-2' : (chatOnLeft ? 'right-2' : 'left-2');

        // Vertical: center on scene nav bar when visible (top-[22px] = vertically centered on 44px bar)
        // Otherwise top-2 for floating position
        const verticalPos = sceneNavVisible ? 'top-[22px] -translate-y-1/2' : 'top-2';

        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsTopBarCollapsed(false)}
            className={`fixed z-50 text-gray-400 hover:text-gray-600 hover:bg-white/80 rounded p-1 shadow-sm border border-gray-200 bg-white/60 backdrop-blur-sm ${horizontalPos} ${verticalPos}`}
            title="Expand toolbar"
          >
            <ChevronDown className="w-4 h-4" />
          </Button>
        );
      })()}

      {/* Scene Navigation Bar */}
      {!isSceneNavCollapsed && (
        <div
          className={`fixed left-0 right-0 z-40 transition-all duration-200 ${isTopBarCollapsed ? 'top-0' : 'top-11'}`}
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
      {/* Moves to left side when chat is on right (to avoid overlap) */}
      {/* Stacks below top bar button when both collapsed and on same side */}
      {isSceneNavCollapsed && (() => {
        const chatOnRight = chatPosition === 'right' && !isChatCollapsed;
        const chatOnLeft = chatPosition === 'left' && !isChatCollapsed;

        // Determine horizontal position: move to left if chat is on right, otherwise stay right
        const horizontalPos = chatOnRight ? 'left-2' : 'right-2';

        // Determine vertical position:
        // - If top bar visible: below top bar (top-14)
        // - If top bar collapsed: check if we need to stack
        let verticalPos = 'top-14';
        if (isTopBarCollapsed) {
          // Top bar button is on left (default) unless chat is on left
          const topBarButtonOnLeft = !(chatOnLeft);
          const topBarButtonOnRight = chatOnLeft;

          // Scene nav button is on left if chat is on right, otherwise right
          const sceneNavButtonOnLeft = chatOnRight;
          const sceneNavButtonOnRight = !chatOnRight;

          // Stack below if both buttons end up on same side
          const bothOnLeft = topBarButtonOnLeft && sceneNavButtonOnLeft;
          const bothOnRight = topBarButtonOnRight && sceneNavButtonOnRight;

          verticalPos = (bothOnLeft || bothOnRight) ? 'top-10' : 'top-2';
        }

        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsSceneNavCollapsed(false)}
            className={`fixed z-50 text-gray-400 hover:text-gray-600 hover:bg-white/80 rounded p-1 shadow-sm border border-gray-200 bg-white/60 backdrop-blur-sm ${horizontalPos} ${verticalPos}`}
            title="Expand scene navigation"
          >
            <ChevronDown className="w-4 h-4" />
          </Button>
        );
      })()}

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
        id="editor-scroll-container"
        className="flex overflow-auto h-full"
        style={{
          position: 'fixed',
          top: isTopBarCollapsed
            ? (isSceneNavCollapsed ? '0' : '44px')
            : (isSceneNavCollapsed ? '44px' : '88px'),
          left: chatPosition === 'left' && !isChatCollapsed ? `${chatWidth}px` : 0,
          right: chatPosition === 'right' && !isChatCollapsed ? `${chatWidth}px` : 0,
          bottom: chatPosition === 'bottom' && !isChatCollapsed ? `${chatHeight}px` : 0,
        }}
      >
        {/* Editor Container - dynamically centered */}
        <div
          className="flex-1 flex justify-center"
        >
          <div
            className="w-full"
            style={{
              maxWidth: '100vw'
            }}
          >
            <div className="screenplay-editor-wrapper min-h-screen pt-6">
              <div className="flex justify-center">
                {/* Relative container for editor + popups */}
                <div className="relative">
                  <EditorContent editor={editor} className="screenplay-editor" />
                  <SmartTypePopup editor={editor} />
                  <FindReplacePopup
                    editor={editor}
                    isTopBarCollapsed={isTopBarCollapsed}
                    isSceneNavCollapsed={isSceneNavCollapsed}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* AI Chat - Position-Aware Container */}
      <div
        className="fixed z-30"
        style={
          isChatCollapsed
            ? chatPosition === 'left'
              ? {
                  // Collapsed left: floating circle on left side
                  bottom: '24px',
                  left: '16px',
                  width: 'auto',
                  height: 'auto',
                }
              : {
                  // Collapsed bottom/right: floating circle on right side
                  bottom: '24px',
                  right: '16px',
                  width: 'auto',
                  height: 'auto',
                }
            : chatPosition === 'bottom'
            ? {
                // Expanded bottom: centered
                bottom: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                width: `${chatBottomWidth}px`,
                maxWidth: '95vw',
                height: `${chatHeight}px`,
              }
            : chatPosition === 'left'
            ? {
                left: 0,
                top: isTopBarCollapsed
                  ? (isSceneNavCollapsed ? '0' : '44px')
                  : (isSceneNavCollapsed ? '44px' : '88px'),
                bottom: 0,
                width: `${chatWidth}px`,
              }
            : {
                // right position
                right: 0,
                top: isTopBarCollapsed
                  ? (isSceneNavCollapsed ? '0' : '44px')
                  : (isSceneNavCollapsed ? '44px' : '88px'),
                bottom: 0,
                width: `${chatWidth}px`,
              }
        }
      >
        {/* Resize Handles - position-aware */}
        {/* Bottom position: vertical handle (top) + horizontal handles (left & right) */}
        {!isChatCollapsed && chatPosition === 'bottom' && (
          <>
            {/* Top edge - vertical resize */}
            <div
              onMouseDown={handleVerticalResizeMouseDown}
              className="absolute top-0 left-4 right-4 h-3 cursor-ns-resize z-10"
              style={{ marginTop: '-6px' }}
            />
            {/* Left edge - horizontal resize */}
            <div
              onMouseDown={(e) => handleBottomHorizontalResizeMouseDown(e, 'left')}
              className="absolute top-0 bottom-0 left-0 w-3 cursor-ew-resize z-10"
              style={{ marginLeft: '-6px' }}
            />
            {/* Right edge - horizontal resize */}
            <div
              onMouseDown={(e) => handleBottomHorizontalResizeMouseDown(e, 'right')}
              className="absolute top-0 bottom-0 right-0 w-3 cursor-ew-resize z-10"
              style={{ marginRight: '-6px' }}
            />
          </>
        )}
        {!isChatCollapsed && chatPosition === 'left' && (
          <div
            onMouseDown={handleHorizontalResizeMouseDown}
            className="absolute top-0 bottom-0 right-0 w-3 cursor-ew-resize z-10"
            style={{ marginRight: '-6px' }}
          />
        )}
        {!isChatCollapsed && chatPosition === 'right' && (
          <div
            onMouseDown={handleHorizontalResizeMouseDown}
            className="absolute top-0 bottom-0 left-0 w-3 cursor-ew-resize z-10"
            style={{ marginLeft: '-6px' }}
          />
        )}
        <AIChatbot
          projectId={scriptId || undefined}
          scriptTitle={script?.title}
          isVisible={true}
          isCollapsed={isChatCollapsed}
          onCollapseToggle={() => setIsChatCollapsed(!isChatCollapsed)}
          position={chatPosition}
          onPositionChange={setChatPosition}
          isTopBarCollapsed={isTopBarCollapsed}
          isSceneNavCollapsed={isSceneNavCollapsed}
        />
      </div>

      {/* Custom Styles for Screenplay Editor */}
      <style jsx global>{`
        :root {
          --app-chrome-bg: #e0e2e6;
        }

        .screenplay-editor-wrapper {
          background: var(--app-chrome-bg);
        }

        .screenplay-editor {
          min-height: 800px;
        }

        .rm-with-pagination .page {
          background: #fff;
          box-shadow:
            0 2px 4px rgba(0,0,0,.1),
            0 8px 16px rgba(0,0,0,.12),
            0 16px 32px rgba(0,0,0,.14),
            0 24px 48px rgba(0,0,0,.08);
        }

        .screenplay-editor .ProseMirror {
          padding: 0rem;
          font-family: var(--font-courier-prime), 'Courier Prime', 'Courier New', monospace;
          font-size: 12pt;
          /* line-height inherited from screenplay.css */
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
