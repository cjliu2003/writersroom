/**
 * ScriptEditorWithAutosave - Wrapper component integrating autosave with script-level editing
 *
 * Simplified from scene-level version:
 * - No scene slicing/merging logic
 * - Direct content_blocks array handling
 * - Reuses AutosaveIndicator and ConflictResolutionDialog components
 *
 * Integration pattern:
 * 1. useScriptAutosave hook manages save state and operations
 * 2. Stable ref pattern for getContentBlocks callback
 * 3. Change detection triggers markChanged() for debounced save
 * 4. Conflict resolution UI on version conflicts
 * 5. Autosave indicator shows current state
 */

"use client"

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useScriptAutosave } from '@/hooks/use-script-autosave';
import { AutosaveIndicator } from './autosave-indicator';
import { ConflictResolutionDialog, ConflictNotification } from './conflict-resolution-dialog';
import { ScriptEditorWithCollaboration } from './script-editor-with-collaboration';

export interface ScriptEditorWithAutosaveProps {
  /** Script UUID */
  scriptId: string;

  /** Initial script version for CAS */
  initialVersion: number;

  /** Initial content blocks (Slate-compatible) */
  initialContent: any[];

  /** Firebase auth token for API calls */
  authToken: string;

  /** Callback when content changes (for parent state sync) */
  onChange?: (contentBlocks: any[]) => void;

  /** Callback when version updates after successful save */
  onVersionUpdate?: (newVersion: number) => void;

  /** Callback when scene boundaries change */
  onSceneBoundariesChange?: (boundaries: any[]) => void;

  /** Callback when current scene changes */
  onCurrentSceneChange?: (sceneIndex: number | null) => void;

  /** Callback when scroll-to-scene function is ready */
  onScrollToSceneReady?: (scrollFn: (sceneIndex: number) => void) => void;

  /** Enable Yjs collaboration (default: false for non-collaborative editing) */
  enableCollaboration?: boolean;

  /** Autosave options */
  autosaveOptions?: {
    debounceMs?: number;
    maxWaitMs?: number;
    maxRetries?: number;
    enableOfflineQueue?: boolean;
  };

  /** UI options */
  showAutosaveIndicator?: boolean;
  compactIndicator?: boolean;
  className?: string;
}

/**
 * Script editor wrapper with integrated autosave, conflict resolution, and collaboration
 */
export function ScriptEditorWithAutosave({
  scriptId,
  initialVersion,
  initialContent,
  authToken,
  onChange,
  onVersionUpdate,
  onSceneBoundariesChange,
  onCurrentSceneChange,
  onScrollToSceneReady,
  enableCollaboration = false,
  autosaveOptions = {},
  showAutosaveIndicator = true,
  compactIndicator = false,
  className = '',
}: ScriptEditorWithAutosaveProps) {
  // Local content state
  const [contentBlocks, setContentBlocks] = useState<any[]>(initialContent || []);

  // Yjs sync status state
  const [syncStatus, setSyncStatus] = useState<'connecting' | 'connected' | 'synced' | 'offline' | 'error'>('connecting');

  // Stable refs for callbacks
  const contentBlocksRef = useRef(contentBlocks);
  const authTokenRef = useRef(authToken);
  const onChangeRef = useRef(onChange);
  const onVersionUpdateRef = useRef(onVersionUpdate);

  // Update refs when props change
  useEffect(() => { contentBlocksRef.current = contentBlocks; }, [contentBlocks]);
  useEffect(() => { authTokenRef.current = authToken; }, [authToken]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onVersionUpdateRef.current = onVersionUpdate; }, [onVersionUpdate]);

  // Stable getContentBlocks callback for autosave hook
  const getContentBlocks = useRef(() => contentBlocksRef.current);

  // Initialize autosave hook
  const [autosaveState, autosaveActions] = useScriptAutosave(
    scriptId,
    initialVersion,
    getContentBlocks.current,
    authToken,
    autosaveOptions
  );

  // Conflict dialog state
  const [showConflictDialog, setShowConflictDialog] = useState(false);

  // Show conflict dialog when conflict occurs
  useEffect(() => {
    if (autosaveState.saveState === 'conflict' && autosaveState.conflictData) {
      setShowConflictDialog(true);
    }
  }, [autosaveState.saveState, autosaveState.conflictData]);

  // Notify parent of version updates
  useEffect(() => {
    if (onVersionUpdateRef.current && autosaveState.currentVersion !== initialVersion) {
      onVersionUpdateRef.current(autosaveState.currentVersion);
    }
  }, [autosaveState.currentVersion, initialVersion]);

  // Handle editor content changes
  const handleContentChange = useCallback((newContentBlocks: any[]) => {
    console.log('🟢 [ScriptEditor] Content changed, blocks:', newContentBlocks.length);

    setContentBlocks(newContentBlocks);
    contentBlocksRef.current = newContentBlocks;

    // CRITICAL FIX: Only trigger REST autosave when Yjs can't handle persistence
    // - Skip during 'connected' (Yjs is syncing initial state - prevents spurious autosave on page load)
    // - Skip during 'synced' (Yjs handles persistence via WebSocket)
    // - Trigger during 'connecting' (network issues, WebSocket reconnecting, fallback to REST)
    // - Trigger during 'offline' (queue changes to IndexedDB)
    // - Trigger during 'error' (Yjs failure, fallback to REST)
    // - Trigger when navigator.onLine is false (browser offline detection)
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    // Fixed: Use syncStatus !== 'synced' instead of explicitly checking each non-synced state
    // This ensures autosave triggers for ALL non-synced states (connecting, offline, error)
    const shouldTriggerAutosave = !isOnline || syncStatus !== 'synced';
    console.log('🔵 [ScriptEditor] syncStatus:', syncStatus, 'navigator.onLine:', isOnline, 'will trigger autosave?', shouldTriggerAutosave);

    if (shouldTriggerAutosave) {
      console.log('✅ [ScriptEditor] Triggering autosave (Yjs not synced or offline)');
      autosaveActions.markChanged();
    } else {
      console.log('⏭️ [ScriptEditor] Skipping autosave (Yjs synced and online)');
    }

    // Notify parent
    if (onChangeRef.current) {
      onChangeRef.current(newContentBlocks);
    }
  }, [autosaveActions, syncStatus]);

  // Update local content when prop changes (external updates)
  useEffect(() => {
    if (JSON.stringify(initialContent) !== JSON.stringify(contentBlocksRef.current)) {
      console.log('🟢 [ScriptEditor] External content update detected');
      setContentBlocks(initialContent);
      contentBlocksRef.current = initialContent;
    }
  }, [initialContent]);

  // Conflict resolution handlers
  const handleResolveConflict = useCallback(() => {
    setShowConflictDialog(true);
  }, []);

  const handleAcceptServerVersion = useCallback(() => {
    if (!autosaveState.conflictData?.latest?.content_blocks) {
      console.error('No server content available');
      return;
    }

    const serverContentBlocks = autosaveState.conflictData.latest.content_blocks;

    console.log('✅ [ScriptEditor] Accepting server version:', autosaveState.conflictData.latest.version);

    // Update local state
    setContentBlocks(serverContentBlocks);
    contentBlocksRef.current = serverContentBlocks;

    // Notify parent
    if (onChangeRef.current) {
      onChangeRef.current(serverContentBlocks);
    }

    // Accept in autosave hook
    autosaveActions.acceptServerVersion();
    setShowConflictDialog(false);
  }, [autosaveState.conflictData, autosaveActions]);

  const handleForceLocalVersion = useCallback(async () => {
    console.log('⚠️ [ScriptEditor] Forcing local version');
    await autosaveActions.forceLocalVersion();
    setShowConflictDialog(false);
  }, [autosaveActions]);

  const handleCancelConflict = useCallback(() => {
    setShowConflictDialog(false);
  }, []);

  // Handle Yjs sync status changes
  const handleSyncStatusChange = useCallback((newStatus: 'connecting' | 'connected' | 'synced' | 'offline' | 'error') => {
    console.log('🔄 [ScriptEditor] Yjs sync status changed:', newStatus);
    setSyncStatus(newStatus);
  }, []);

  // Keyboard shortcuts for manual save (Cmd/Ctrl+S)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        console.log('⌨️ [ScriptEditor] Manual save triggered');
        autosaveActions.saveNow();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [autosaveActions]);

  // Format conflict data for ConflictResolutionDialog
  const conflictDataFormatted = autosaveState.conflictData ? {
    latest: {
      version: autosaveState.conflictData.latest.version,
      blocks: autosaveState.conflictData.latest.content_blocks || [],
      scene_heading: 'Script', // Not applicable for script-level
      position: 0,
      updated_at: autosaveState.conflictData.latest.updated_at,
    },
    your_base_version: autosaveState.conflictData.your_base_version,
    conflict: autosaveState.conflictData.conflict,
  } : null;

  // Format local content for conflict dialog
  const localContentFormatted = JSON.stringify(contentBlocks, null, 2);

  return (
    <div className={className}>
      {/* Autosave Indicator */}
      {showAutosaveIndicator && (
        <div className="mb-4">
          {compactIndicator ? (
            <div className="flex items-center justify-between">
              <AutosaveIndicator
                saveState={autosaveState.saveState}
                lastSaved={autosaveState.lastSaved}
                error={autosaveState.error}
                retryAfter={autosaveState.retryAfter}
                onRetry={autosaveActions.retry}
                onResolveConflict={handleResolveConflict}
              />
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

      {/* Script Editor with Collaboration */}
      <ScriptEditorWithCollaboration
        scriptId={scriptId}
        authToken={authToken}
        initialContent={contentBlocks}
        onContentChange={handleContentChange}
        onSyncStatusChange={handleSyncStatusChange}
        onSceneBoundariesChange={onSceneBoundariesChange}
        onCurrentSceneChange={onCurrentSceneChange}
        onScrollToSceneReady={onScrollToSceneReady}
      />

      {/* Conflict Resolution Dialog */}
      <ConflictResolutionDialog
        open={showConflictDialog}
        onOpenChange={setShowConflictDialog}
        conflictData={conflictDataFormatted}
        localContent={localContentFormatted}
        onAcceptServer={handleAcceptServerVersion}
        onForceLocal={handleForceLocalVersion}
        onCancel={handleCancelConflict}
      />
    </div>
  );
}

/**
 * Hook to get autosave status for external components (e.g., toolbars)
 */
export function useScriptAutosaveStatus(
  scriptId: string,
  initialVersion: number,
  getContentBlocks: () => any[],
  authToken: string,
  options?: {
    debounceMs?: number;
    maxWaitMs?: number;
    maxRetries?: number;
    enableOfflineQueue?: boolean;
  }
) {
  return useScriptAutosave(scriptId, initialVersion, getContentBlocks, authToken, options);
}

/**
 * Simple autosave indicator component for use in toolbars
 */
export function ToolbarScriptAutosaveIndicator({
  scriptId,
  initialVersion,
  getContentBlocks,
  authToken,
  className,
}: {
  scriptId: string;
  initialVersion: number;
  getContentBlocks: () => any[];
  authToken: string;
  className?: string;
}) {
  const [autosaveState] = useScriptAutosave(
    scriptId,
    initialVersion,
    getContentBlocks,
    authToken
  );

  return (
    <AutosaveIndicator
      saveState={autosaveState.saveState}
      lastSaved={autosaveState.lastSaved}
      error={autosaveState.error}
      retryAfter={autosaveState.retryAfter}
      className={className}
    />
  );
}
