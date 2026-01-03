/**
 * Offline Recovery Hook
 *
 * Checks IndexedDB for pending saves on script load. If newer content exists
 * locally than on the server (due to a crash while offline), presents the user
 * with a choice to recover or discard.
 *
 * This addresses the crash recovery gap where:
 * 1. User edits offline → content queued to IndexedDB
 * 2. Browser crashes → Yjs (memory) lost, IndexedDB survives
 * 3. User reopens → without this hook, old server content would load
 *
 * COLLABORATION CONFLICT DETECTION:
 * When a collaborator has made changes while this user was offline, recovering
 * would overwrite their work. This hook detects such conflicts by comparing
 * the offline content with the current Yjs document state after sync.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getPendingScriptSaves,
  clearPendingScriptSaves,
  type PendingScriptSave,
} from '../utils/script-autosave-storage';

/**
 * Conflict information when offline content differs from current Yjs state
 */
export interface ConflictInfo {
  /** True if there's a conflict (current doc differs from offline) */
  hasConflict: boolean;
  /** Block count in offline version */
  offlineBlockCount: number;
  /** Block count in current Yjs version */
  currentBlockCount: number;
  /** Approximate text length in offline version */
  offlineTextLength: number;
  /** Approximate text length in current version */
  currentTextLength: number;
  /** Summary of the conflict severity */
  severity: 'none' | 'minor' | 'major';
}

export interface OfflineRecoveryState {
  /** True while checking IndexedDB */
  isChecking: boolean;
  /** True if we have local changes newer than server */
  hasUnsyncedChanges: boolean;
  /** The content blocks from IndexedDB (if recovery available) */
  pendingContent: any[] | null;
  /** When the pending save was created */
  pendingTimestamp: Date | null;
  /** When the server was last updated */
  serverTimestamp: Date | null;
  /** Conflict information (populated after Yjs sync) */
  conflictInfo: ConflictInfo | null;
}

export interface OfflineRecoveryActions {
  /** Recover the offline changes (returns content blocks). Does NOT clear IndexedDB. */
  recoverChanges: () => Promise<any[]>;
  /** Discard offline changes and use server content */
  discardChanges: () => Promise<void>;
  /** Update conflict info after comparing with Yjs document */
  setConflictInfo: (info: ConflictInfo) => void;
  /** Call after content is successfully applied to clear IndexedDB backup */
  confirmRecoveryComplete: () => Promise<void>;
}

/**
 * Calculate approximate text length from content blocks
 */
function calculateTextLength(blocks: any[]): number {
  if (!blocks || !Array.isArray(blocks)) return 0;

  let length = 0;
  for (const block of blocks) {
    if (block.text) {
      length += block.text.length;
    }
    // Handle nested content (e.g., from TipTap format)
    if (block.content && Array.isArray(block.content)) {
      length += calculateTextLength(block.content);
    }
  }
  return length;
}

/**
 * Detect conflict severity based on differences
 */
export function detectConflictSeverity(
  offlineBlocks: any[],
  currentBlockCount: number,
  currentTextLength: number
): ConflictInfo {
  const offlineBlockCount = offlineBlocks?.length || 0;
  const offlineTextLength = calculateTextLength(offlineBlocks);

  // Calculate differences
  const blockDiff = Math.abs(offlineBlockCount - currentBlockCount);
  const textDiff = Math.abs(offlineTextLength - currentTextLength);
  const blockDiffPercent = currentBlockCount > 0
    ? (blockDiff / currentBlockCount) * 100
    : (blockDiff > 0 ? 100 : 0);
  const textDiffPercent = currentTextLength > 0
    ? (textDiff / currentTextLength) * 100
    : (textDiff > 0 ? 100 : 0);

  // Determine if there's a conflict
  // No conflict if both are essentially the same
  const hasConflict = blockDiff > 0 || textDiffPercent > 5;

  // Determine severity
  let severity: 'none' | 'minor' | 'major' = 'none';
  if (hasConflict) {
    if (blockDiffPercent > 20 || textDiffPercent > 30) {
      severity = 'major';
    } else {
      severity = 'minor';
    }
  }

  console.log('[OfflineRecovery] Conflict detection:', {
    offlineBlockCount,
    currentBlockCount,
    offlineTextLength,
    currentTextLength,
    blockDiffPercent: blockDiffPercent.toFixed(1) + '%',
    textDiffPercent: textDiffPercent.toFixed(1) + '%',
    hasConflict,
    severity,
  });

  return {
    hasConflict,
    offlineBlockCount,
    currentBlockCount,
    offlineTextLength,
    currentTextLength,
    severity,
  };
}

/**
 * Hook to detect and manage offline crash recovery.
 *
 * @param scriptId - The script being loaded
 * @param serverUpdatedAt - The server's updated_at timestamp (ISO string)
 * @returns [state, actions] tuple for recovery UI
 */
export function useOfflineRecovery(
  scriptId: string,
  serverUpdatedAt: string | null
): [OfflineRecoveryState, OfflineRecoveryActions] {
  const [state, setState] = useState<OfflineRecoveryState>({
    isChecking: true,
    hasUnsyncedChanges: false,
    pendingContent: null,
    pendingTimestamp: null,
    serverTimestamp: serverUpdatedAt ? new Date(serverUpdatedAt) : null,
    conflictInfo: null,
  });

  // Check IndexedDB for pending saves on mount
  useEffect(() => {
    const checkForUnsyncedChanges = async () => {
      if (!scriptId) {
        setState(prev => ({ ...prev, isChecking: false, hasUnsyncedChanges: false }));
        return;
      }

      try {
        console.log('[OfflineRecovery] Checking for pending saves for script:', scriptId);
        const pendingSaves = await getPendingScriptSaves(scriptId);

        if (pendingSaves.length === 0) {
          console.log('[OfflineRecovery] No pending saves found');
          setState(prev => ({ ...prev, isChecking: false, hasUnsyncedChanges: false }));
          return;
        }

        // Get most recent pending save
        const sorted = pendingSaves.sort((a, b) => b.timestamp - a.timestamp);
        const latest = sorted[0];
        const pendingTime = new Date(latest.timestamp);
        const serverTime = serverUpdatedAt ? new Date(serverUpdatedAt) : null;

        console.log('[OfflineRecovery] Found pending save:', {
          pendingTimestamp: pendingTime.toISOString(),
          serverTimestamp: serverTime?.toISOString() || 'null',
          pendingContentBlocks: latest.contentBlocks?.length || 0,
        });

        // Check if pending save is newer than server
        // If server timestamp is null, assume pending is newer (new script case)
        const hasNewer = serverTime ? pendingTime > serverTime : true;

        if (hasNewer) {
          console.log('[OfflineRecovery] Local content is NEWER than server - recovery available');
        } else {
          console.log('[OfflineRecovery] Server is up to date - no recovery needed');
        }

        setState({
          isChecking: false,
          hasUnsyncedChanges: hasNewer,
          pendingContent: hasNewer ? latest.contentBlocks : null,
          pendingTimestamp: hasNewer ? pendingTime : null,
          serverTimestamp: serverTime,
          conflictInfo: null, // Will be set after Yjs sync
        });
      } catch (error) {
        console.error('[OfflineRecovery] Check failed:', error);
        setState(prev => ({ ...prev, isChecking: false, hasUnsyncedChanges: false }));
      }
    };

    // Reset state and check when scriptId or serverUpdatedAt changes
    setState(prev => ({
      ...prev,
      isChecking: true,
      serverTimestamp: serverUpdatedAt ? new Date(serverUpdatedAt) : null,
    }));

    checkForUnsyncedChanges();
  }, [scriptId, serverUpdatedAt]);

  const recoverChanges = useCallback(async (): Promise<any[]> => {
    if (!state.pendingContent) {
      throw new Error('No pending content to recover');
    }

    console.log('[OfflineRecovery] Recovering offline changes');
    const content = state.pendingContent;

    // IMPORTANT: Do NOT clear IndexedDB here!
    // The caller must call confirmRecoveryComplete() after successfully applying content.
    // This prevents data loss if the app crashes between clicking "Recover" and content
    // being applied to the editor.

    // Reset state (but IndexedDB still has the backup)
    setState(prev => ({
      ...prev,
      hasUnsyncedChanges: false,
      pendingContent: null,
      pendingTimestamp: null,
      conflictInfo: null,
    }));

    return content;
  }, [state.pendingContent]);

  const discardChanges = useCallback(async (): Promise<void> => {
    console.log('[OfflineRecovery] Discarding offline changes');
    await clearPendingScriptSaves(scriptId);
    console.log('[OfflineRecovery] Cleared pending saves');

    setState(prev => ({
      ...prev,
      hasUnsyncedChanges: false,
      pendingContent: null,
      pendingTimestamp: null,
      conflictInfo: null,
    }));
  }, [scriptId]);

  const setConflictInfo = useCallback((info: ConflictInfo) => {
    console.log('[OfflineRecovery] Setting conflict info:', info);
    setState(prev => ({
      ...prev,
      conflictInfo: info,
    }));
  }, []);

  /**
   * Called after content has been successfully applied to the editor.
   * This is the ONLY place that should clear IndexedDB - after we're sure
   * the content is safely in Yjs and will be persisted.
   */
  const confirmRecoveryComplete = useCallback(async (): Promise<void> => {
    console.log('[OfflineRecovery] Recovery confirmed - clearing IndexedDB backup');
    await clearPendingScriptSaves(scriptId);
    console.log('[OfflineRecovery] IndexedDB cleared after successful recovery');
  }, [scriptId]);

  // Memoize the actions object to prevent infinite loops in effect dependencies
  // Without this, the object literal creates a new reference on every render
  const actions = useMemo(
    () => ({ recoverChanges, discardChanges, setConflictInfo, confirmRecoveryComplete }),
    [recoverChanges, discardChanges, setConflictInfo, confirmRecoveryComplete]
  );

  return [state, actions];
}
