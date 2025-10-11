/**
 * ScreenplayEditorWithAutosave - Enhanced screenplay editor with autosave functionality
 */

"use client"

import React, { useCallback, useState, useEffect } from 'react';
import { ScreenplayEditor } from './screenplay-editor';
import { useAutosave } from '../hooks/use-autosave';
import { AutosaveIndicator } from './autosave-indicator';
import { ConflictResolutionDialog, ConflictNotification } from './conflict-resolution-dialog';
import type { ScreenplayBlockType } from '../types/screenplay';
import { useYjsCollaboration } from '@/hooks/use-yjs-collaboration';

interface ScreenplayEditorWithAutosaveProps {
  /** Scene ID for autosave */
  sceneId: string;
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
  const [localContent, setLocalContent] = useState(content);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  
  // Initialize Yjs collaboration (always on when authToken exists)
  const { doc, awareness } = useYjsCollaboration({
    sceneId,
    authToken,
    enabled: !!authToken,
  });

  // Get content function for autosave hook
  const getContent = useCallback(() => localContent, [localContent]);

  // Initialize autosave
  const [autosaveState, autosaveActions] = useAutosave(
    sceneId,
    initialVersion,
    getContent,
    authToken,
    autosaveOptions
  );

  // Handle content changes from editor
  const handleContentChange = useCallback((newContent: string) => {
    console.log('📝 Content changed in editor, triggering autosave');
    setLocalContent(newContent);
    onChange?.(newContent);
    
    // Trigger autosave
    autosaveActions.markChanged(newContent);
  }, [onChange, autosaveActions]);

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
      // Convert server blocks back to content format
      const serverContent = autosaveState.conflictData.latest.blocks
        .map((block: any) => block.text || '')
        .join('\n');
      
      setLocalContent(serverContent);
      onChange?.(serverContent);
      autosaveActions.acceptServerVersion();
    }
    setShowConflictDialog(false);
  }, [autosaveState.conflictData, onChange, autosaveActions]);

  const handleForceLocalVersion = useCallback(async () => {
    await autosaveActions.forceLocalVersion();
    setShowConflictDialog(false);
  }, [autosaveActions]);

  const handleCancelConflict = useCallback(() => {
    setShowConflictDialog(false);
  }, []);

  // Update local content when prop changes (external updates)
  useEffect(() => {
    if (content !== localContent && autosaveState.saveState !== 'saving') {
      setLocalContent(content);
    }
  }, [content, localContent, autosaveState.saveState]);

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
        content={localContent}
        onChange={handleContentChange}
        onSceneChange={onSceneChange}
        onCurrentBlockTypeChange={onCurrentBlockTypeChange}
        collaboration={doc ? { doc, awareness } : undefined}
      />

      {/* Conflict Resolution Dialog */}
      <ConflictResolutionDialog
        open={showConflictDialog}
        onOpenChange={setShowConflictDialog}
        conflictData={autosaveState.conflictData}
        localContent={localContent}
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
