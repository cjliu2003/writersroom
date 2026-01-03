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
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getPendingScriptSaves,
  clearPendingScriptSaves,
  type PendingScriptSave,
} from '../utils/script-autosave-storage';

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
}

export interface OfflineRecoveryActions {
  /** Recover the offline changes (returns content blocks) */
  recoverChanges: () => Promise<any[]>;
  /** Discard offline changes and use server content */
  discardChanges: () => Promise<void>;
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

    // Clear the queue after recovering (they'll be synced via Yjs once recovered)
    await clearPendingScriptSaves(scriptId);
    console.log('[OfflineRecovery] Cleared pending saves after recovery');

    // Reset state
    setState(prev => ({
      ...prev,
      hasUnsyncedChanges: false,
      pendingContent: null,
      pendingTimestamp: null,
    }));

    return content;
  }, [scriptId, state.pendingContent]);

  const discardChanges = useCallback(async (): Promise<void> => {
    console.log('[OfflineRecovery] Discarding offline changes');
    await clearPendingScriptSaves(scriptId);
    console.log('[OfflineRecovery] Cleared pending saves');

    setState(prev => ({
      ...prev,
      hasUnsyncedChanges: false,
      pendingContent: null,
      pendingTimestamp: null,
    }));
  }, [scriptId]);

  return [state, { recoverChanges, discardChanges }];
}
