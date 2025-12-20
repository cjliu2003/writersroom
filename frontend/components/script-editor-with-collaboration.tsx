/**
 * Script-Level Collaborative Editor
 *
 * Renders entire screenplay with real-time collaboration via Yjs.
 * This component manages script-level editing where a single Y.Doc contains
 * the complete screenplay (vs scene-level where each scene has its own Y.Doc).
 *
 * Key Features:
 * - Full Slate + Yjs integration for real-time collaboration
 * - Scene boundary tracking for navigation and metadata
 * - Sync status indicator for connection feedback
 * - Proper Y.Doc seeding and synchronization
 * - Content and boundary change callbacks
 *
 * TODO: Add virtual scrolling optimization with react-virtuoso
 * Note: Virtual scrolling with Slate requires advanced rendering patterns
 * to maintain proper document structure while virtualizing display.
 */

"use client"

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createEditor, Descendant, Editor, Transforms, Element, Text, Node } from 'slate';
import { Slate, Editable, withReact, RenderElementProps, RenderLeafProps, ReactEditor } from 'slate-react';
import { withHistory } from 'slate-history';
import { withYjs, YjsEditor, toSharedType } from 'slate-yjs';
import { useScriptYjsCollaboration, SyncStatus } from '@/hooks/use-script-yjs-collaboration';
import { SceneBoundaryTracker, SceneBoundary } from '@/utils/scene-boundary-tracker';
import { usePageBreaks, getPageNumber } from '@/hooks/use-page-breaks';
import { usePageDecorations } from '@/hooks/use-page-decorations';
import { ScreenplayElement, ScreenplayBlockType } from '@/types/screenplay';

// Custom editor wrapper for screenplay-specific normalization
const withScreenplayEditor = (editor: Editor) => {
  const { normalizeNode } = editor;

  editor.normalizeNode = ([node, path]) => {
    try {
      // Ensure all screenplay elements have at least one text child
      if (Element.isElement(node)) {
        const element = node as ScreenplayElement;
        if (!element.children || element.children.length === 0) {
          Transforms.insertNodes(editor, { text: '' }, { at: [...path, 0] });
          return;
        }

        // Ensure all children are valid text nodes
        for (let i = 0; i < element.children.length; i++) {
          const child = element.children[i];
          if (!Text.isText(child) || typeof child.text !== 'string') {
            Transforms.removeNodes(editor, { at: [...path, i] });
            Transforms.insertNodes(editor, { text: '' }, { at: [...path, i] });
            return;
          }
        }
      }

      normalizeNode([node, path]);
    } catch (error) {
      console.warn('[ScriptEditor] Error in normalization:', error);
      try {
        normalizeNode([node, path]);
      } catch (fallbackError) {
        console.warn('[ScriptEditor] Error in fallback normalization:', fallbackError);
      }
    }
  };

  return editor;
};

export interface ScriptEditorWithCollaborationProps {
  scriptId: string;
  authToken: string;
  initialContent?: ScreenplayElement[];
  onContentChange?: (content: ScreenplayElement[]) => void;
  onSceneBoundariesChange?: (boundaries: SceneBoundary[]) => void;
  onSyncStatusChange?: (status: SyncStatus) => void;
  onCurrentSceneChange?: (sceneIndex: number | null) => void;
  onScrollToSceneReady?: (scrollFn: (sceneIndex: number) => void) => void;
  className?: string;
}

export function ScriptEditorWithCollaboration({
  scriptId,
  authToken,
  initialContent = [],
  onContentChange,
  onSceneBoundariesChange,
  onSyncStatusChange,
  onCurrentSceneChange,
  onScrollToSceneReady,
  className = '',
}: ScriptEditorWithCollaborationProps) {
  // Yjs collaboration hook
  const { doc, provider, awareness, syncStatus, isConnected } = useScriptYjsCollaboration({
    scriptId,
    authToken,
    enabled: true,
    onSyncStatusChange,
  });

  // Seed content reference (persists across re-renders)
  const seedContentRef = useRef<Descendant[]>(
    Array.isArray(initialContent) && initialContent.length > 0
      ? initialContent
      : [
          {
            type: 'scene_heading' as ScreenplayBlockType,
            children: [{ text: '' }],
            metadata: {
              timestamp: new Date().toISOString(),
              uuid: crypto.randomUUID(),
            },
          },
        ]
  );

  // Create Slate editor with Yjs integration
  const editor = useMemo(() => {
    let e = withScreenplayEditor(withHistory(withReact(createEditor())));

    // Wrap with Yjs if doc is available
    if (doc) {
      try {
        const sharedRoot = doc.getArray('content');
        e = withYjs(e as any, sharedRoot) as any;
      } catch (err) {
        console.warn('[ScriptEditor] Failed to init Yjs binding:', err);
      }
    }

    return e as Editor;
  }, [doc]);

  // Slate value state
  const [value, setValue] = useState<Descendant[]>(seedContentRef.current);

  // Scene boundary tracking
  const boundaryTracker = useMemo(() => new SceneBoundaryTracker(), []);
  const [sceneBoundaries, setSceneBoundaries] = useState<SceneBoundary[]>([]);
  const [currentSceneIndex, setCurrentSceneIndex] = useState<number | null>(null);

  // Page break calculation for professional page formatting (Web Worker - existing)
  const { pageBreaks, totalPages, isCalculating: isCalculatingPages } = usePageBreaks(value as ScreenplayElement[]);

  // NEW: Decoration-based pagination (Phase 1.4)
  const { decorate: decoratePageBreaks, totalPages: decorationPages, isCalculating: isCalculatingDecorations } = usePageDecorations(
    editor,
    doc,
    { enabled: true, debounceMs: 150 } // Feature flag for gradual rollout
  );

  // Editor container ref for scroll navigation
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Update scene boundaries when content changes
  useEffect(() => {
    try {
      const boundaries = boundaryTracker.extractBoundaries(value as ScreenplayElement[]);
      boundaryTracker.updateBoundaries(boundaries);
      setSceneBoundaries(boundaries);
      onSceneBoundariesChange?.(boundaries);
    } catch (error) {
      console.warn('[ScriptEditor] Error updating scene boundaries:', error);
    }
  }, [value, boundaryTracker, onSceneBoundariesChange]);

  // Validation logging: Compare Web Worker vs decoration pagination (temporary)
  useEffect(() => {
    console.log('[Pagination Validation]', {
      workerPages: totalPages,
      decorationPages,
      match: totalPages === decorationPages,
      difference: Math.abs(totalPages - decorationPages),
    });
  }, [totalPages, decorationPages]);

  // Scroll to scene navigation
  const scrollToScene = useCallback((sceneIndex: number) => {
    if (!sceneBoundaries[sceneIndex] || !editor) return;

    try {
      const scene = sceneBoundaries[sceneIndex];
      const targetBlock = editor.children[scene.startIndex] as Element;

      if (targetBlock) {
        // Get the DOM node for the target block
        const domNode = ReactEditor.toDOMNode(editor, targetBlock);

        // Calculate position accounting for fixed header (112px) plus padding buffer
        // 112px = 64px top menu + 48px controls bar
        // +16px buffer to ensure scene header is fully visible above fixed headers
        const headerOffset = 112 + 16;
        const elementPosition = domNode.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        // Scroll to position with smooth behavior
        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });

        // Update current scene index
        setCurrentSceneIndex(sceneIndex);

        console.log(`[ScriptEditor] Scrolled to scene ${sceneIndex + 1}:`, scene.heading);
      }
    } catch (error) {
      console.warn('[ScriptEditor] Error scrolling to scene:', error);
    }
  }, [sceneBoundaries, editor]);

  // Expose scroll function to parent
  useEffect(() => {
    if (onScrollToSceneReady && editor && sceneBoundaries.length > 0) {
      onScrollToSceneReady(scrollToScene);
    }
  }, [onScrollToSceneReady, scrollToScene, editor, sceneBoundaries.length]);

  // Notify parent of current scene changes
  useEffect(() => {
    if (onCurrentSceneChange) {
      onCurrentSceneChange(currentSceneIndex);
    }
  }, [currentSceneIndex, onCurrentSceneChange]);

  // Seed Y.Doc and sync with Slate
  useEffect(() => {
    if (!doc || !editor) return;

    const sharedRoot = doc.getArray('content');
    const meta = doc.getMap('wr_meta');

    // Track whether remote content has been received
    let hasReceivedRemoteContent = false;

    // Prevent re-entrant seeding calls
    let isSeeding = false;

    // Sync editor from Yjs
    const syncEditorFromYjs = () => {
      try {
        console.log('[ScriptEditor] Before sync - sharedRoot length:', sharedRoot.length, 'editor.children length:', editor.children.length);
        (YjsEditor as any).synchronizeValue?.(editor as any);
        console.log('[ScriptEditor] After sync - editor.children length:', editor.children.length);

        // Force a state update to trigger React re-render
        if (editor.children.length > 0) {
          setValue([...editor.children] as Descendant[]);
        }

        console.log('[ScriptEditor] Synchronized Slate from Yjs');
      } catch (err) {
        console.warn('[ScriptEditor] Failed to sync from Yjs:', err);
      }
    };

    // Handle remote updates
    const handleDocUpdate = (update: Uint8Array, origin: any) => {
      const isLocalChange = typeof origin === 'symbol' || origin === editor;

      if (!isLocalChange) {
        console.log('[ScriptEditor] Remote change detected, syncing to Slate');
        hasReceivedRemoteContent = true;
        syncEditorFromYjs();
      }
    };

    doc.on('update', handleDocUpdate);

    // Seed doc if needed
    const seedDocIfNeeded = () => {
      // CRITICAL: Prevent re-entrant calls
      if (isSeeding) {
        console.log('[ScriptEditor] Skipping seed - already seeding');
        return;
      }

      const alreadySeeded = !!meta.get('seeded');
      const hasContent = sharedRoot.length > 0;
      const editorHasContent = editor.children.length > 0;

      // CRITICAL: Never seed if editor already has content
      // This is the ultimate safeguard - if Slate has content, we're done
      if (editorHasContent) {
        console.log('[ScriptEditor] Skipping seed - editor already has content:', editor.children.length, 'blocks');
        if (!alreadySeeded) {
          meta.set('seeded', true);
          meta.set('seeded_at', new Date().toISOString());
          meta.set('script_id', scriptId);
        }
        return;
      }

      // CRITICAL: Never seed if remote content has already been received
      // This prevents overwriting server content that arrived before seeding
      if (hasReceivedRemoteContent) {
        console.log('[ScriptEditor] Skipping seed - remote content already received');
        if (!alreadySeeded) {
          meta.set('seeded', true);
          meta.set('seeded_at', new Date().toISOString());
          meta.set('script_id', scriptId);
        }
        syncEditorFromYjs();
        return;
      }

      // If Yjs already has content, NEVER seed - just sync from Yjs
      // This prevents overwriting content loaded from the server
      if (hasContent) {
        console.log('[ScriptEditor] Skipping seed - Yjs doc already has content');
        if (!alreadySeeded) {
          // Mark as seeded so we don't try again
          meta.set('seeded', true);
          meta.set('seeded_at', new Date().toISOString());
          meta.set('script_id', scriptId);
        }
        syncEditorFromYjs();
        return;
      }

      // Only seed if Yjs doc is completely empty AND we have initial content
      if (alreadySeeded) {
        // Already marked as seeded but has no content - something went wrong
        // Just sync whatever is there (likely nothing)
        console.log('[ScriptEditor] Skipping seed - already marked as seeded');
        syncEditorFromYjs();
        return;
      }

      // CRITICAL: If editor already has content, NEVER seed - this means user has edited
      // This prevents re-seeding with stale seedContentRef after edits
      if (editor.children.length > 1 || (editor.children.length === 1 && editor.children[0].children?.[0]?.text !== '')) {
        console.log('[ScriptEditor] Skipping seed - editor already has content (user has edited)');
        // Mark as seeded to prevent future attempts
        if (!meta.get('seeded')) {
          meta.set('seeded', true);
          meta.set('seeded_at', new Date().toISOString());
          meta.set('script_id', scriptId);
        }
        return;
      }

      // Seed with initial content (only if Yjs doc is empty and never seeded)
      const nodesToSeed = seedContentRef.current;
      if (!Array.isArray(nodesToSeed) || nodesToSeed.length === 0) {
        console.log('[ScriptEditor] Skipping seed - no content to seed');
        return;
      }

      console.log('[ScriptEditor] Proceeding with seed, nodesToSeed length:', nodesToSeed.length);

      isSeeding = true; // Set flag before transaction

      try {
        let seededSuccessfully = false;

        doc.transact(() => {
          // CRITICAL: Check if content exists and abort if so
          const currentYjsLength = sharedRoot.length;
          const currentEditorLength = editor.children.length;

          if (currentYjsLength > 0 || currentEditorLength > 0) {
            console.log(`[ScriptEditor] Aborting seed - content exists: Yjs=${currentYjsLength}, Editor=${currentEditorLength}`);
            // Mark as seeded to prevent retry loops
            if (!meta.get('seeded')) {
              meta.set('seeded', true);
              meta.set('seeded_at', new Date().toISOString());
              meta.set('script_id', scriptId);
            }
            return;
          }

          // CRITICAL: Clear sharedRoot before seeding to prevent toSharedType from appending
          // toSharedType() appends content rather than replacing, so we must clear first
          while (sharedRoot.length > 0) {
            sharedRoot.delete(0);
          }
          console.log('[ScriptEditor] Cleared sharedRoot before seeding (safeguard against append)');

          console.log('[ScriptEditor] Calling toSharedType with', nodesToSeed.length, 'nodes');
          toSharedType(sharedRoot as any, nodesToSeed as any);
          meta.set('seeded', true);
          meta.set('seeded_at', new Date().toISOString());
          meta.set('script_id', scriptId);
          console.log('[ScriptEditor] toSharedType completed, sharedRoot length now:', sharedRoot.length);
          seededSuccessfully = true;
        });

        // CRITICAL: Only log if we actually seeded
        // DO NOT call syncEditorFromYjs() here - let Yjs update events handle it
        // Calling sync immediately after toSharedType causes race conditions
        if (seededSuccessfully) {
          console.log('[ScriptEditor] Seeded Y.Doc with initial content - waiting for Yjs sync');
        } else {
          console.log('[ScriptEditor] Seed aborted');
        }
      } finally {
        isSeeding = false; // Clear flag after transaction completes
      }
    };

    // Seed after connection synced - listen to provider events
    const cleanupTasks: Array<() => void> = [];

    if (provider) {
      // CRITICAL FIX: Wait for backend to send its state before deciding to seed
      // The 'synced' event fires when WebSocket handshake completes, but backend hasn't sent
      // its SYNC_STEP2 response yet. We need to wait a brief moment for that to arrive.
      const handleSynced = (event: any) => {
        const synced = typeof event === 'boolean' ? event : !!event?.synced;
        if (synced) {
          console.log('[ScriptEditor] WebSocket synced, waiting for backend state...');

          // Wait 1000ms for backend to send its state (SYNC_STEP2)
          // This generous timeout prevents race condition where:
          // 1. User makes edits → Yjs updates saved to script_versions
          // 2. User navigates before autosave completes → Script.content_blocks not updated
          // 3. On return, if timeout is too short, frontend seeds with stale REST data
          // 4. Then Yjs updates arrive and merge → DUPLICATION
          // 1000ms allows time for WebSocket handshake + DB query + network latency
          setTimeout(() => {
            if (hasReceivedRemoteContent) {
              console.log('[ScriptEditor] Backend sent content, skipping REST seed');
              // Backend already sent content, just ensure editor is synced
              if (sharedRoot.length > 0) {
                syncEditorFromYjs();
              }
            } else if (sharedRoot.length > 0) {
              console.log('[ScriptEditor] Yjs has content, syncing to editor');
              syncEditorFromYjs();
            } else {
              console.log('[ScriptEditor] No backend content after wait, seeding from REST API');
              seedDocIfNeeded();
            }
          }, 1000);
        }
      };

      provider.on('synced', handleSynced);
      cleanupTasks.push(() => provider.off('synced', handleSynced));

      // Check if already synced
      const isAlreadySynced = (provider as any).synced;
      console.log('[ScriptEditor] Checking if provider already synced:', isAlreadySynced, 'sharedRoot.length:', sharedRoot.length, 'hasReceivedRemoteContent:', hasReceivedRemoteContent);

      if (isAlreadySynced) {
        console.log('[ScriptEditor] Provider already synced, waiting for backend state...');
        setTimeout(() => {
          console.log('[ScriptEditor] setTimeout fired (already synced path). hasReceivedRemoteContent:', hasReceivedRemoteContent, 'sharedRoot.length:', sharedRoot.length);
          if (hasReceivedRemoteContent) {
            console.log('[ScriptEditor] Backend sent content (already synced)');
            if (sharedRoot.length > 0) {
              syncEditorFromYjs();
            }
          } else if (sharedRoot.length > 0) {
            console.log('[ScriptEditor] Yjs has content (already synced)');
            syncEditorFromYjs();
          } else {
            console.log('[ScriptEditor] No backend content (already synced), seeding from REST API');
            seedDocIfNeeded();
          }
        }, 1000);
      }
    } else {
      console.log('[ScriptEditor] No provider yet - waiting for provider to initialize');
      // CRITICAL FIX: Don't seed immediately if no provider
      // The provider might not be ready yet - wait for it to initialize
      // Once it initializes, the 'synced' event will fire and handle seeding
    }

    return () => {
      doc.off('update', handleDocUpdate);
      cleanupTasks.forEach(fn => {
        try { fn() } catch {}
      });
    };
  }, [doc, editor, provider, scriptId]);

  // Handle content changes
  const handleChange = useCallback((newValue: Descendant[]) => {
    console.log('[ScriptEditor] handleChange called, blocks:', newValue.length);

    // Validate that newValue is not empty and has valid structure
    if (newValue && Array.isArray(newValue) && newValue.length > 0) {
      setValue(newValue);
      onContentChange?.(newValue as ScreenplayElement[]);
    } else {
      console.warn('[ScriptEditor] Received invalid editor value, ignoring');
    }
  }, [onContentChange]);

  // Render screenplay elements
  const renderElement = useCallback((props: RenderElementProps) => {
    const { element, attributes, children } = props;
    const screenplayElement = element as ScreenplayElement;

    // Check if this element is at a page break or is the first element
    const path = ReactEditor.findPath(editor, element);
    const elementIndex = path[0];
    const isAtPageBreak = pageBreaks.includes(elementIndex);
    // First element on page 1 should have no top margin (container padding provides it)
    const isFirstElement = elementIndex === 0;

    const baseStyles: React.CSSProperties = {
      fontFamily: 'Courier, monospace',
      fontSize: '12pt',
      lineHeight: '12pt', // Fixed: use 12pt for 6 lines/inch (standard screenplay format)
      whiteSpace: 'pre-wrap',
      wordWrap: 'break-word',
    };

    // Page break component - adds spacing to jump from current page to next page
    // Page boxes are rendered separately (absolutely positioned), so this just handles content flow
    // Spacing: bottom margin (1in) + gap (2rem) + top margin (1in) = 2in + 2rem
    const pageBreakElement = isAtPageBreak ? (
      <div
        contentEditable={false}
        style={{
          userSelect: 'none',
          // Total spacing to align content with next page box
          height: 'calc(2in + 2rem)',
          // No background - the page boxes handle visuals
        }}
      />
    ) : null;

    switch (screenplayElement.type) {
      case 'scene_heading':
        // baseLines=2: 24px marginTop matches 2 lines of spacing
        return (
          <>
                        {pageBreakElement}
            <div
              {...attributes}
              className="font-bold uppercase text-black"
              style={{
                ...baseStyles,
                marginTop: (isAtPageBreak || isFirstElement) ? '0' : '24px',
                marginBottom: '12px',
              }}
            >
              {children}
            </div>
          </>
        );

      case 'action':
        // baseLines=1: no extra top margin needed
        return (
          <>
                        {pageBreakElement}
            <div
              {...attributes}
              className="text-black"
              style={{
                ...baseStyles,
                marginTop: (isAtPageBreak || isFirstElement) ? '0' : undefined,
                marginBottom: '12px',
                width: '100%',
              }}
            >
              {children}
            </div>
          </>
        );

      case 'character':
        // baseLines=2: 24px marginTop matches 2 lines of spacing (synced with pagination)
        return (
          <>
                        {pageBreakElement}
            <div
              {...attributes}
              className="uppercase text-black"
              style={{
                ...baseStyles,
                textAlign: 'left',
                marginLeft: '220px',
                marginTop: (isAtPageBreak || isFirstElement) ? '0' : '24px',
                marginBottom: '0px',
              }}
            >
              {children}
            </div>
          </>
        );

      case 'parenthetical':
        // baseLines=1: no extra top margin needed
        return (
          <>
                        {pageBreakElement}
            <div
              {...attributes}
              className="text-black"
              style={{
                ...baseStyles,
                textAlign: 'left',
                marginLeft: '160px',
                marginTop: (isAtPageBreak || isFirstElement) ? '0' : undefined,
                marginBottom: '0px',
              }}
            >
              <span>(</span>{children}<span>)</span>
            </div>
          </>
        );

      case 'dialogue':
        // baseLines=1: no extra top margin needed
        return (
          <>
                        {pageBreakElement}
            <div
              {...attributes}
              className="text-black"
              style={{
                ...baseStyles,
                marginLeft: screenplayElement.isDualDialogue ? '100px' : '100px',
                marginRight: screenplayElement.isDualDialogue ? '100px' : '150px',
                marginTop: (isAtPageBreak || isFirstElement) ? '0' : undefined,
                marginBottom: '12px',
                maxWidth: '350px',
                wordWrap: 'break-word',
              }}
            >
              {children}
            </div>
          </>
        );

      case 'transition':
        // baseLines=2: 24px marginTop matches 2 lines of spacing (synced with pagination)
        return (
          <>
                        {pageBreakElement}
            <div
              {...attributes}
              className="uppercase text-black"
              style={{
                ...baseStyles,
                textAlign: 'right',
                marginTop: (isAtPageBreak || isFirstElement) ? '0' : '24px',
                marginBottom: '24px',
              }}
            >
              {children}
            </div>
          </>
        );

      case 'shot':
        // baseLines=1: 12px marginTop is close to 1 line of spacing
        return (
          <>
                        {pageBreakElement}
            <div
              {...attributes}
              className="uppercase text-black"
              style={{
                ...baseStyles,
                marginTop: (isAtPageBreak || isFirstElement) ? '0' : '12px',
                marginBottom: '6px',
              }}
            >
              {children}
            </div>
          </>
        );

      default:
        // baseLines=1: no extra top margin needed
        return (
          <>
                        {pageBreakElement}
            <div {...attributes} style={{...baseStyles, marginTop: (isAtPageBreak || isFirstElement) ? '0' : undefined}}>
              {children}
            </div>
          </>
        );
    }
  }, [editor, pageBreaks]);

  // Render text leaf (for formatting like bold, italic)
  // Note: Page breaks are now handled in renderElement for proper margin control
  const renderLeaf = useCallback((props: RenderLeafProps) => {
    let { attributes, children, leaf } = props;

    // Handle text formatting (existing)
    if (leaf.bold) {
      children = <strong>{children}</strong>;
    }

    if (leaf.italic) {
      children = <em>{children}</em>;
    }

    if (leaf.underline) {
      children = <u>{children}</u>;
    }

    return <span {...attributes}>{children}</span>;
  }, []);

  // Sync status indicator
  const renderSyncStatus = () => {
    let statusText = '';
    let statusColor = '';

    switch (syncStatus) {
      case 'synced':
        statusText = '✓ Synced';
        statusColor = 'text-green-600';
        break;
      case 'connected':
        statusText = '⟳ Connected';
        statusColor = 'text-blue-600';
        break;
      case 'connecting':
        statusText = '⟳ Connecting...';
        statusColor = 'text-yellow-600';
        break;
      case 'offline':
        statusText = '○ Offline';
        statusColor = 'text-gray-400';
        break;
      case 'error':
        statusText = '✕ Error';
        statusColor = 'text-red-600';
        break;
      default:
        statusText = '○ Unknown';
        statusColor = 'text-gray-400';
    }

    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
        <span className={`text-sm font-medium ${statusColor}`}>
          {statusText}
        </span>
        {sceneBoundaries.length > 0 && (
          <span className="text-xs text-gray-500">
            • {sceneBoundaries.length} scene{sceneBoundaries.length !== 1 ? 's' : ''}
          </span>
        )}
        {/* Page count validation - show both systems during transition */}
        <span className="text-xs text-gray-500">
          • Pages: {totalPages} (worker) / {decorationPages} (decorations)
          {totalPages === decorationPages ? ' ✓' : ' ⚠️'}
        </span>
      </div>
    );
  };

  return (
    <div className={`script-editor-container flex flex-col h-full ${className}`}>
      {/* Sync status indicator */}
      {renderSyncStatus()}

      {/* Scroll container with gray background */}
      <div className="flex-1 overflow-auto py-8 px-4 bg-gray-100">
        {/* Page container - relative positioning for absolute page boxes */}
        <div className="screenplay-container" style={{
          width: '8.5in',
          margin: '0 auto',
          position: 'relative',
          // Total height: all pages + gaps between them
          minHeight: `calc(${totalPages} * 11in + ${Math.max(0, totalPages - 1)} * 2rem)`,
        }}>
          {/* Fixed-height page boxes - absolutely positioned */}
          {Array.from({ length: totalPages }).map((_, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: `calc(${i} * (11in + 2rem))`,
                left: 0,
                width: '8.5in',
                height: '11in',
                background: 'white',
                border: '1px solid #e5e7eb',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 -2px 4px rgba(0, 0, 0, 0.05)',
                boxSizing: 'border-box',
              }}
            />
          ))}

          {/* Content wrapper - flows on top of page boxes */}
          <div style={{
            position: 'relative',
            zIndex: 1,
            padding: '1in 1in 0 1.5in',
            fontFamily: '"Courier Prime", Courier, monospace',
            fontSize: '12pt',
            lineHeight: '12pt',
          }}>
            <Slate editor={editor} initialValue={value} onChange={handleChange}>
              <Editable
                renderElement={renderElement}
                renderLeaf={renderLeaf}
                decorate={decoratePageBreaks}
                placeholder="Start writing your screenplay..."
                spellCheck
                autoFocus
                className="screenplay-content focus:outline-none"
              />
            </Slate>
          </div>
        </div>
      </div>
    </div>
  );
}
