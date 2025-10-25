/**
 * ScreenplayEditorWithAutosave - Enhanced screenplay editor with autosave functionality
 */

"use client"

import React, { useCallback, useState, useEffect, useRef } from 'react';
import { ScreenplayEditor } from './screenplay-editor';
import { useAutosave } from '../hooks/use-autosave';
import { AutosaveIndicator } from './autosave-indicator';
import { ConflictResolutionDialog, ConflictNotification } from './conflict-resolution-dialog';
import type { ScreenplayBlockType } from '../types/screenplay';
import { useYjsCollaboration } from '@/hooks/use-yjs-collaboration';
import { extractSceneSlice, replaceSceneSlice } from '../utils/autosave-api';
import { toSharedType, SyncElement } from 'slate-yjs';

interface ScreenplayEditorWithAutosaveProps {
  /** Scene ID for autosave */
  sceneId: string;
  /** Scene position/index in the script (0-based) */
  scenePosition?: number;
  /** Initial scene version for optimistic concurrency control */
  initialVersion: number;
  /** Initial content */
  content?: string;
  /** Auth token for API calls */
  authToken: string;
  /** Called when content changes */
  onChange?: (content: string) => void;
  /** Called when scene changes */
  onSceneChange?: (currentScene: string) => void;
  /** Called when current block type changes */
  onCurrentBlockTypeChange?: (type: ScreenplayBlockType | null) => void;
  /** Called when version is updated after successful save */
  onVersionUpdate?: (newVersion: number) => void;
  /** Autosave options */
  autosaveOptions?: {
    debounceMs?: number;
    maxWaitMs?: number;
    maxRetries?: number;
    enableOfflineQueue?: boolean;
  };
  /** Show autosave indicator */
  showAutosaveIndicator?: boolean;
  /** Compact autosave indicator */
  compactIndicator?: boolean;
  /** Custom className */
  className?: string;
}

export function ScreenplayEditorWithAutosave({
  sceneId,
  scenePosition,
  initialVersion,
  content = '',
  authToken,
  onChange,
  onSceneChange,
  onCurrentBlockTypeChange,
  onVersionUpdate,
  autosaveOptions = {},
  showAutosaveIndicator = true,
  compactIndicator = false,
  className
}: ScreenplayEditorWithAutosaveProps) {
  const [showConflictDialog, setShowConflictDialog] = useState(false);

  // Helper function to extract scene content (not a useCallback to avoid dependency issues)
  const computeSceneContent = (scriptContent: string) => {
    const { elements, heading } = extractSceneSlice(scriptContent, sceneId, scenePosition);
    if (Array.isArray(elements) && elements.length > 0) {
      return JSON.stringify(elements);
    }
    // Provide a stable placeholder scene heading when no content exists yet.
    const placeholderHeading = heading || 'UNTITLED SCENE';
    const placeholder = [
      {
        type: 'scene_heading' as ScreenplayBlockType,
        children: [{ text: placeholderHeading }],
        id: `scene_${sceneId}`,
        metadata: {
          uuid: sceneId,
          timestamp: '1970-01-01T00:00:00.000Z',
        },
      },
    ];
    return JSON.stringify(placeholder);
  };

  const [fullScriptContent, setFullScriptContent] = useState(content);
  const [sceneContent, setSceneContent] = useState(() => computeSceneContent(content));
  const fullContentRef = useRef(content);
  const sceneContentRef = useRef(sceneContent);
  
  // Initialize Yjs collaboration (always on when authToken exists)
  const { doc, provider, awareness, syncStatus } = useYjsCollaboration({
    sceneId,
    authToken,
    enabled: !!authToken,
  });

  // Sync doc metadata so downstream seeding knows which scene should populate the shared type.
  const previousSceneIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!doc) return;
    if (previousSceneIdRef.current === sceneId) return;
    previousSceneIdRef.current = sceneId;
    try {
      doc.transact(() => {
        const sharedType = doc.getArray('content') as any;
        const currentLength = (sharedType as any)?.length ?? 0;
        if (currentLength > 0) {
          sharedType.delete(0, currentLength);
        }
        const meta = doc.getMap('wr_meta') as any;
        meta.set('seeded', false);
        meta.set('target_scene_id', sceneId);
        if (typeof meta.delete === 'function') {
          meta.delete('seeded_scene_id');
        } else {
          meta.set('seeded_scene_id', null);
        }
      });
    } catch (err) {
      console.warn('[ScreenplayEditorWithAutosave] Failed to update doc meta for scene change', err);
    }
  }, [doc, sceneId]);

  useEffect(() => {
    fullContentRef.current = fullScriptContent;
  }, [fullScriptContent]);

  useEffect(() => {
    sceneContentRef.current = sceneContent;
  }, [sceneContent]);

  // Get content function for autosave hook (full script, not just the active scene)
  // Use stable function reference to prevent infinite loop from callback recreation
  const getContentStable = useRef<() => string>();
  if (!getContentStable.current) {
    getContentStable.current = () => fullContentRef.current;
  }

  // Initialize autosave
  const [autosaveState, autosaveActions] = useAutosave(
    sceneId,
    initialVersion,
    getContentStable.current,
    authToken,
    autosaveOptions,
    scenePosition
  );

  // Handle content changes from editor
  const handleContentChange = useCallback((newSceneContent: string) => {
    console.log('🔵 [handleContentChange] Called with length:', newSceneContent.length);

    if (newSceneContent === sceneContentRef.current) {
      console.log('🔵 [handleContentChange] Content unchanged, skipping');
      return;
    }

    let parsedElements: any[] = [];
    try {
      const parsed = JSON.parse(newSceneContent);
      if (Array.isArray(parsed)) {
        parsedElements = parsed;
        console.log('🔵 [handleContentChange] Parsed elements:', parsedElements.length, 'first text:', parsedElements[0]?.children?.[0]?.text?.substring(0, 50));
      }
    } catch (err) {
      console.warn('[ScreenplayEditorWithAutosave] Failed to parse scene content from editor', err);
    }

    // CRITICAL FIX: Filter out fallback placeholder scenes
    // Fallback scenes have IDs starting with 'fallback_' or 'error_fallback_'
    // They are temporary placeholders during Yjs sync and should not persist
    const isFallbackScene = parsedElements.length === 1 &&
      parsedElements[0]?.id?.startsWith('fallback_') ||
      parsedElements[0]?.id?.startsWith('error_fallback_');

    if (isFallbackScene) {
      console.warn('[ScreenplayEditorWithAutosave] Ignoring fallback scene, not persisting');
      return;
    }

    setSceneContent(newSceneContent);
    sceneContentRef.current = newSceneContent;

    const updatedScript = replaceSceneSlice(fullContentRef.current, sceneId, parsedElements);
    console.log('🔵 [handleContentChange] Updated script length:', updatedScript.length);
    setFullScriptContent(updatedScript);
    fullContentRef.current = updatedScript;

    // Set flag to prevent content useEffect from triggering on our own onChange
    isHandlingChange.current = true;
    console.log('🔵 [handleContentChange] Calling parent onChange, isHandlingChange=true');
    onChange?.(updatedScript);
    // Reset flag after a microtask to allow parent to update
    Promise.resolve().then(() => {
      isHandlingChange.current = false;
      console.log('🔵 [handleContentChange] Reset isHandlingChange=false');
    });

    // CRITICAL FIX: Check both syncStatus AND navigator.onLine
    // When browser goes offline but Yjs WebSocket is still connected, syncStatus might stay 'synced'
    // We need to trigger autosave when offline regardless of Yjs sync state to queue changes to IndexedDB
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const shouldTriggerAutosave = syncStatus !== 'synced' || !isOnline;
    console.log('🔵 [handleContentChange] syncStatus:', syncStatus, 'navigator.onLine:', isOnline, 'will trigger autosave?', shouldTriggerAutosave);

    if (shouldTriggerAutosave) {
      console.log('✅ [handleContentChange] Triggering autosave');
      autosaveActions.markChanged(updatedScript);
    } else {
      console.log('⏭️ [handleContentChange] Skipping autosave (Yjs synced and online)');
    }
  }, [onChange, autosaveActions, sceneId, syncStatus]);

  // Handle version updates: only propagate when a save has completed and version increased
  const lastReportedVersionRef = React.useRef<number>(initialVersion)
  useEffect(() => {
    // Only report after a successful save to avoid race with scene switches/resets
    if (autosaveState.saveState === 'saved' && autosaveState.currentVersion !== initialVersion) {
      if (autosaveState.currentVersion !== lastReportedVersionRef.current) {
        lastReportedVersionRef.current = autosaveState.currentVersion
        onVersionUpdate?.(autosaveState.currentVersion)
      }
    }
  }, [autosaveState.currentVersion, autosaveState.saveState, initialVersion, onVersionUpdate]);

  // Handle conflict resolution
  const handleResolveConflict = useCallback(() => {
    setShowConflictDialog(true);
  }, []);

  const handleAcceptServerVersion = useCallback(() => {
    if (autosaveState.conflictData) {
      const blocks = autosaveState.conflictData.latest.blocks;
      const headingText = autosaveState.conflictData.latest.scene_heading || 'UNTITLED SCENE';

      const elements = Array.isArray(blocks)
        ? blocks.map((block: any, index: number) => ({
            type: block?.type || 'action',
            children: [{ text: (block?.text ?? '').toString() }],
            id: block?.metadata?.id || `server_block_${index}`,
            metadata: {
              uuid: block?.metadata?.uuid || (block?.type === 'scene_heading' ? sceneId : crypto.randomUUID()),
              timestamp: block?.metadata?.timestamp || new Date().toISOString(),
            },
          }))
        : [];

      if (!elements.some((el: any) => el?.type === 'scene_heading')) {
        elements.unshift({
          type: 'scene_heading',
          children: [{ text: headingText }],
          id: `server_scene_${sceneId}`,
          metadata: {
            uuid: sceneId,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const serverContent = JSON.stringify(elements);
      setSceneContent(serverContent);
      sceneContentRef.current = serverContent;

      const updatedScript = replaceSceneSlice(fullContentRef.current, sceneId, elements);
      setFullScriptContent(updatedScript);
      fullContentRef.current = updatedScript;

      onChange?.(updatedScript);
      autosaveActions.acceptServerVersion();
    }
    setShowConflictDialog(false);
  }, [autosaveState.conflictData, onChange, autosaveActions, sceneId]);

  const handleForceLocalVersion = useCallback(async () => {
    await autosaveActions.forceLocalVersion();
    setShowConflictDialog(false);
  }, [autosaveActions]);

  const handleCancelConflict = useCallback(() => {
    setShowConflictDialog(false);
  }, []);

  // Track if we're in the middle of handling our own onChange to prevent loops
  const isHandlingChange = useRef(false);

  // Update local content when prop changes (external updates)
  useEffect(() => {
    console.log('🟢 [contentEffect] Triggered, isHandlingChange:', isHandlingChange.current);
    // Skip if content is same or if we're handling our own onChange
    if (content === fullContentRef.current) {
      console.log('🟢 [contentEffect] Content unchanged, skipping');
      return;
    }
    if (isHandlingChange.current) {
      console.log('🟢 [contentEffect] isHandlingChange=true, skipping to prevent loop');
      return;
    }

    console.log('🟢 [contentEffect] Processing external content update');
    setFullScriptContent(content);
    fullContentRef.current = content;

    // CRITICAL FIX: Do NOT write to Yjs doc here during active collaboration
    // The slate-yjs plugin handles all Yjs updates automatically
    // Writing to Yjs doc here creates a feedback loop causing character duplication
    // Only update local state, let Yjs handle its own state through the editor
    // The seeding logic in screenplay-editor.tsx handles initial population

    const { elements, heading } = extractSceneSlice(content, sceneId);
    const derived = Array.isArray(elements) && elements.length > 0
      ? JSON.stringify(elements)
      : JSON.stringify([{
          type: 'scene_heading',
          children: [{ text: heading || 'UNTITLED SCENE' }],
          id: `scene_${sceneId}`,
          metadata: {
            uuid: sceneId,
            timestamp: '1970-01-01T00:00:00.000Z',
          },
        }]);
    console.log('🟢 [contentEffect] Setting sceneContent, first text:', elements[0]?.children?.[0]?.text?.substring(0, 50));
    setSceneContent(derived);
    sceneContentRef.current = derived;
  }, [content, doc, sceneId]);

  useEffect(() => {
    const { elements, heading } = extractSceneSlice(fullContentRef.current, sceneId);
    const derived = Array.isArray(elements) && elements.length > 0
      ? JSON.stringify(elements)
      : JSON.stringify([{
          type: 'scene_heading',
          children: [{ text: heading || 'UNTITLED SCENE' }],
          id: `scene_${sceneId}`,
          metadata: {
            uuid: sceneId,
            timestamp: '1970-01-01T00:00:00.000Z',
          },
        }]);
    if (derived !== sceneContentRef.current) {
      setSceneContent(derived);
      sceneContentRef.current = derived;
    }
  }, [sceneId]);

  // Keyboard shortcuts for manual save
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        autosaveActions.saveNow();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [autosaveActions]);

  return (
    <div className={className}>
      {/* Autosave Indicator */}
      {showAutosaveIndicator && (
        <div className="mb-4">
          {compactIndicator ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AutosaveIndicator
                  saveState={autosaveState.saveState}
                  lastSaved={autosaveState.lastSaved}
                  error={autosaveState.error}
                  retryAfter={autosaveState.retryAfter}
                  onRetry={autosaveActions.retry}
                  onResolveConflict={handleResolveConflict}
                />
              </div>
            </div>
          ) : (
            <AutosaveIndicator
              saveState={autosaveState.saveState}
              lastSaved={autosaveState.lastSaved}
              error={autosaveState.error}
              retryAfter={autosaveState.retryAfter}
              onRetry={autosaveActions.retry}
              onResolveConflict={handleResolveConflict}
            />
          )}
        </div>
      )}

      {/* Conflict Notification (inline) */}
      {autosaveState.saveState === 'conflict' && !showConflictDialog && (
        <ConflictNotification
          onResolve={handleResolveConflict}
          className="mb-4"
        />
      )}

      {/* Screenplay Editor */}
      <ScreenplayEditor
        content={sceneContent}
        onChange={handleContentChange}
        onSceneChange={onSceneChange}
        onCurrentBlockTypeChange={onCurrentBlockTypeChange}
        collaboration={doc ? { doc, provider, awareness, sceneId } : undefined}
        isProcessingQueue={autosaveState.isProcessingQueue}
      />

      {/* Conflict Resolution Dialog */}
      <ConflictResolutionDialog
        open={showConflictDialog}
        onOpenChange={setShowConflictDialog}
        conflictData={autosaveState.conflictData}
        localContent={sceneContent}
        onAcceptServer={handleAcceptServerVersion}
        onForceLocal={handleForceLocalVersion}
        onCancel={handleCancelConflict}
      />
    </div>
  );
}

/**
 * Hook to get autosave status for external components
 */
export function useAutosaveStatus(
  sceneId: string,
  initialVersion: number,
  getContent: () => string,
  authToken: string,
  options?: {
    debounceMs?: number;
    maxWaitMs?: number;
    maxRetries?: number;
    enableOfflineQueue?: boolean;
  }
) {
  return useAutosave(sceneId, initialVersion, getContent, authToken, options);
}

/**
 * Simple autosave indicator component for use in toolbars
 */
export function ToolbarAutosaveIndicator({
  sceneId,
  initialVersion,
  getContent,
  authToken,
  className
}: {
  sceneId: string;
  initialVersion: number;
  getContent: () => string;
  authToken: string;
  className?: string;
}) {
  const [autosaveState] = useAutosave(sceneId, initialVersion, getContent, authToken);

  return (
    <div className={className}>
      <AutosaveIndicator
        saveState={autosaveState.saveState}
        lastSaved={autosaveState.lastSaved}
        error={autosaveState.error}
        retryAfter={autosaveState.retryAfter}
        className="text-xs"
      />
    </div>
  );
}
