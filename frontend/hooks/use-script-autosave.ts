/**
 * useScriptAutosave hook - Handles automatic saving of script-level content
 *
 * Features:
 * - Debounced saves (trailing + max wait)
 * - Offline queue with IndexedDB
 * - Conflict resolution with automatic fast-forward
 * - Rate limiting with automatic retry
 * - Exponential backoff for transient errors
 *
 * Adapted from scene-level use-autosave.ts with simplified content management
 * (no scene slicing - direct content_blocks handling).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  saveScript,
  generateOpId,
  slateToContentBlocks,
  isScriptConflictError,
  isScriptRateLimitError,
  ScriptAutosaveApiError,
  type ScriptUpdateRequest,
} from '../utils/script-autosave-api';
import {
  addPendingScriptSave,
  removePendingScriptSave,
  getPendingScriptSaves,
  clearPendingScriptSaves,
  updatePendingScriptSaveRetryCount,
  isIndexedDBAvailable,
  type PendingScriptSave,
} from '../utils/script-autosave-storage';

export type SaveState =
  | 'idle'           // No pending changes
  | 'pending'        // Changes pending, waiting for debounce
  | 'saving'         // Currently saving to server
  | 'saved'          // Successfully saved
  | 'offline'        // Offline, queued for later
  | 'conflict'       // Version conflict detected
  | 'error'          // Save failed
  | 'rate_limited';  // Rate limited, will retry

export interface AutosaveOptions {
  /** Debounce delay in milliseconds (default: 1500) */
  debounceMs?: number;
  /** Maximum wait time before forcing save (default: 5000) */
  maxWaitMs?: number;
  /** Maximum retry attempts for failed saves (default: 3) */
  maxRetries?: number;
  /** Enable offline queue (default: true) */
  enableOfflineQueue?: boolean;
}

export interface AutosaveState {
  saveState: SaveState;
  lastSaved: Date | null;
  currentVersion: number;
  pendingChanges: boolean;
  conflictData: any | null;
  error: string | null;
  retryAfter: number | null; // For rate limiting
  isProcessingQueue: boolean; // Flag to indicate queue processing in progress
}

export interface AutosaveActions {
  /** Trigger an immediate save */
  saveNow: () => Promise<void>;
  /** Mark content as changed (triggers debounced save) */
  markChanged: () => void;
  /** Resolve conflict by accepting server version */
  acceptServerVersion: () => void;
  /** Resolve conflict by forcing local version */
  forceLocalVersion: () => Promise<void>;
  /** Retry failed save */
  retry: () => Promise<void>;
  /** Process offline queue */
  processOfflineQueue: () => Promise<void>;
}

export function useScriptAutosave(
  scriptId: string,
  initialVersion: number,
  getContentBlocks: () => any[],
  authToken: string,
  options: AutosaveOptions = {}
): [AutosaveState, AutosaveActions] {
  const {
    debounceMs = 1500,
    maxWaitMs = 5000,
    maxRetries = 3,
    enableOfflineQueue = true,
  } = options;

  // State
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [currentVersion, setCurrentVersion] = useState(initialVersion);
  const [pendingChanges, setPendingChanges] = useState(false);
  const [conflictData, setConflictData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);

  // Refs for managing timers and state
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const maxWaitTimerRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastContentRef = useRef<string>(''); // JSON string for comparison
  const retryCountRef = useRef(0);
  const isOnlineRef = useRef(navigator.onLine);
  const currentVersionRef = useRef(initialVersion);
  const authTokenRef = useRef(authToken);

  // Clear all timers
  const clearTimers = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (maxWaitTimerRef.current) {
      clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // Perform the actual save operation
  const performSave = useCallback(
    async (contentBlocks: any[], opId?: string, baseVersionOverride?: number): Promise<void> => {
      if (!authTokenRef.current) {
        throw new Error('No auth token available');
      }

      // CRITICAL FIX: Check if offline BEFORE attempting save
      // This prevents network timeouts and ensures immediate queueing
      if (!isOnlineRef.current) {
        throw new Error('Offline - save skipped for queueing');
      }

      const request: ScriptUpdateRequest = {
        content_blocks: slateToContentBlocks(contentBlocks),
        base_version:
          typeof baseVersionOverride === 'number' ? baseVersionOverride : currentVersionRef.current,
        op_id: opId || generateOpId(),
        updated_at_client: new Date().toISOString(),
      };

      const response = await saveScript(scriptId, request, authTokenRef.current, opId);

      // Update version on successful save (both state and ref)
      setCurrentVersion(response.new_version);
      currentVersionRef.current = response.new_version;
      setLastSaved(new Date());
    },
    [scriptId]
  );

  // Save with error handling and offline queue
  const saveWithErrorHandling = useCallback(
    async (contentBlocks: any[], opId?: string): Promise<void> => {
      try {
        console.log('💾 [ScriptAutosave] Starting save:', {
          scriptId,
          baseVersion: currentVersionRef.current,
          blocksCount: contentBlocks.length,
        });

        setSaveState('saving');
        setError(null);
        setConflictData(null);

        await performSave(contentBlocks, opId);

        setSaveState('saved');
        setPendingChanges(false);
        retryCountRef.current = 0;

        // Clear any pending saves for this script on successful save
        if (enableOfflineQueue && isIndexedDBAvailable()) {
          await clearPendingScriptSaves(scriptId);
        }
      } catch (err) {
        console.log('💥 [ScriptAutosave] Save failed:', {
          error: err,
          errorType: err?.constructor?.name,
          isOnline: isOnlineRef.current,
        });

        if (isScriptConflictError(err)) {
          // Try a one-time fast-forward to the latest server version, then retry the save
          const latestVersion = err.conflictData?.latest?.version;
          if (typeof latestVersion === 'number' && retryCountRef.current === 0) {
            try {
              console.log('🔄 [ScriptAutosave] Attempting fast-forward to version:', latestVersion);

              // Adopt latest version and retry once with same opId (idempotent on server)
              setCurrentVersion(latestVersion);
              currentVersionRef.current = latestVersion;
              await performSave(contentBlocks, opId, latestVersion);

              setSaveState('saved');
              setPendingChanges(false);
              retryCountRef.current = 0;

              if (enableOfflineQueue && isIndexedDBAvailable()) {
                await clearPendingScriptSaves(scriptId);
              }

              console.log('✅ [ScriptAutosave] Fast-forward successful');
              return;
            } catch (err2) {
              if (isScriptConflictError(err2)) {
                // Fall through to conflict UI below
                console.log('⚠️ [ScriptAutosave] Fast-forward failed, showing conflict UI');
              } else if (isScriptRateLimitError(err2)) {
                // Handle rate limit from retry
                setSaveState('rate_limited');
                setRetryAfter(err2.retryAfter);
                setError(`Rate limited. Retry in ${err2.retryAfter}s`);
                retryTimerRef.current = setTimeout(() => {
                  saveWithErrorHandling(contentBlocks, opId);
                }, err2.retryAfter * 1000);
                return;
              } else {
                setSaveState('error');
                setError(err2 instanceof Error ? err2.message : 'Save failed');
                return;
              }
            }
          }

          // Could not auto-resolve — show conflict UI
          setSaveState('conflict');
          setConflictData(err.conflictData);
          setError('Version conflict detected. Please resolve.');
        } else if (isScriptRateLimitError(err)) {
          setSaveState('rate_limited');
          setRetryAfter(err.retryAfter);
          setError(`Rate limited. Retry in ${err.retryAfter}s`);

          // Schedule retry
          retryTimerRef.current = setTimeout(() => {
            saveWithErrorHandling(contentBlocks, opId);
          }, err.retryAfter * 1000);
        } else if (
          // CRITICAL FIX: Queue to offline storage if:
          // 1. We're offline (navigator.onLine is false), OR
          // 2. The error message indicates offline state, OR
          // 3. Network error (no response from server)
          (!isOnlineRef.current ||
           (err instanceof Error && (err.message.includes('Offline') || err.message.includes('Failed to fetch') || err.message.includes('Network request failed')))) &&
          enableOfflineQueue &&
          isIndexedDBAvailable()
        ) {
          // Queue for offline processing
          console.log('📦 [ScriptAutosave] Queueing save to IndexedDB:', {
            scriptId,
            blocksCount: contentBlocks.length,
            baseVersion: currentVersionRef.current,
            reason: err instanceof Error ? err.message : 'Unknown error',
          });

          setSaveState('offline');
          setError('Offline - queued for sync');

          const pendingSave: PendingScriptSave = {
            id: opId || generateOpId(),
            scriptId,
            contentBlocks,
            baseVersion: currentVersionRef.current,
            timestamp: Date.now(),
            retryCount: 0,
            opId: opId || generateOpId(),
          };

          await addPendingScriptSave(pendingSave);
          console.log('✅ [ScriptAutosave] Save queued successfully to IndexedDB');
        } else {
          setSaveState('error');
          setError(err instanceof Error ? err.message : 'Save failed');

          // Retry logic for transient errors
          if (retryCountRef.current < maxRetries) {
            retryCountRef.current++;
            const backoffMs = Math.pow(2, retryCountRef.current) * 1000;
            console.log(`🔄 [ScriptAutosave] Scheduling retry ${retryCountRef.current}/${maxRetries} in ${backoffMs}ms`);

            retryTimerRef.current = setTimeout(() => {
              saveWithErrorHandling(contentBlocks, opId);
            }, backoffMs); // Exponential backoff
          } else {
            console.error('❌ [ScriptAutosave] Max retries exceeded');
          }
        }
      }
    },
    [performSave, scriptId, enableOfflineQueue, maxRetries]
  );

  // Debounced save function
  const debouncedSave = useCallback(() => {
    const contentBlocks = getContentBlocks();
    const contentJson = JSON.stringify(contentBlocks);

    console.log('🔄 [ScriptAutosave] debouncedSave called:', {
      scriptId,
      blocksCount: contentBlocks.length,
      hasChanged: contentJson !== lastContentRef.current,
    });

    // Don't save if content hasn't changed
    if (contentJson === lastContentRef.current) {
      console.log('⏭️ [ScriptAutosave] Content unchanged, skipping save');
      return;
    }

    lastContentRef.current = contentJson;
    clearTimers();

    console.log('⏰ [ScriptAutosave] Setting up autosave timers');
    setSaveState('pending');
    setPendingChanges(true);

    // Set debounce timer
    debounceTimerRef.current = setTimeout(() => {
      console.log('⏰ [ScriptAutosave] Debounce timer fired, saving now');
      saveWithErrorHandling(contentBlocks);
    }, debounceMs);

    // Set max wait timer
    maxWaitTimerRef.current = setTimeout(() => {
      console.log('⏰ [ScriptAutosave] Max wait timer fired, forcing save');
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        saveWithErrorHandling(contentBlocks);
      }
    }, maxWaitMs);
  }, [getContentBlocks, saveWithErrorHandling, debounceMs, maxWaitMs, clearTimers, scriptId]);

  // Actions
  const saveNow = useCallback(async (): Promise<void> => {
    const contentBlocks = getContentBlocks();
    clearTimers();
    await saveWithErrorHandling(contentBlocks);
  }, [getContentBlocks, saveWithErrorHandling, clearTimers]);

  const markChanged = useCallback(() => {
    debouncedSave();
  }, [debouncedSave]);

  const acceptServerVersion = useCallback(() => {
    if (conflictData) {
      setCurrentVersion(conflictData.latest.version);
      currentVersionRef.current = conflictData.latest.version;
      setSaveState('idle');
      setConflictData(null);
      setError(null);
      setPendingChanges(false);
    }
  }, [conflictData]);

  const forceLocalVersion = useCallback(async (): Promise<void> => {
    if (conflictData) {
      // Update to server version first, then save our content
      setCurrentVersion(conflictData.latest.version);
      currentVersionRef.current = conflictData.latest.version;
      const contentBlocks = getContentBlocks();
      await saveWithErrorHandling(contentBlocks);
    }
  }, [conflictData, getContentBlocks, saveWithErrorHandling]);

  const retry = useCallback(async (): Promise<void> => {
    const contentBlocks = getContentBlocks();
    retryCountRef.current = 0;
    await saveWithErrorHandling(contentBlocks);
  }, [getContentBlocks, saveWithErrorHandling]);

  const processOfflineQueue = useCallback(async (): Promise<void> => {
    if (!enableOfflineQueue || !isIndexedDBAvailable()) {
      console.log('⏭️ [ScriptAutosave] Skipping queue processing:', {
        enableOfflineQueue,
        hasIndexedDB: isIndexedDBAvailable(),
      });
      return;
    }

    try {
      const pendingSaves = await getPendingScriptSaves(scriptId);
      console.log('📥 [ScriptAutosave] Processing offline queue:', {
        scriptId,
        queueLength: pendingSaves.length,
      });

      if (pendingSaves.length === 0) {
        console.log('✅ [ScriptAutosave] Queue empty, nothing to process');
        return;
      }

      // Set flag to indicate queue processing is active
      setIsProcessingQueue(true);

      for (let i = 0; i < pendingSaves.length; i++) {
        const save = pendingSaves[i];
        try {
          console.log('📤 [ScriptAutosave] Attempting to save queued item:', save.id, 'baseVersion:', save.baseVersion);

          // FIX #1: Pass save.baseVersion as third argument to use stored version
          await performSave(save.contentBlocks, save.opId, save.baseVersion);
          await removePendingScriptSave(save.id);
          setSaveState('saved'); // Update UI state to show save succeeded
          console.log('✅ [ScriptAutosave] Queued save successful, removed from queue:', save.id);

          // FIX #2: Update baseVersion for ALL remaining queue items
          // This prevents cascading conflicts when items were queued with same stale version
          const newVersion = currentVersionRef.current;
          console.log('🔄 [ScriptAutosave] Updating remaining queue items to baseVersion:', newVersion);
          for (let j = i + 1; j < pendingSaves.length; j++) {
            pendingSaves[j].baseVersion = newVersion;
            // Persist the updated baseVersion to IndexedDB
            await addPendingScriptSave(pendingSaves[j]);
          }
        } catch (err) {
          console.log('❌ [ScriptAutosave] Queued save failed:', { id: save.id, error: err });

          if (isScriptConflictError(err)) {
            // Skip conflicted saves for now
            console.log('⏭️ [ScriptAutosave] Skipping conflicted save:', save.id);
            await removePendingScriptSave(save.id);
            continue;
          } else if (isScriptRateLimitError(err)) {
            // FIX #3: Wait for retry-after period instead of stopping entirely
            const retryAfter = err.retryAfter || 10;
            console.log(`⏳ [ScriptAutosave] Rate limited, waiting ${retryAfter}s before continuing`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            // Retry this same item (decrement i so loop retries current index)
            i--;
            continue;
          } else {
            // Update retry count
            await updatePendingScriptSaveRetryCount(save.id, save.retryCount + 1);
            console.log('🔄 [ScriptAutosave] Updated retry count:', {
              id: save.id,
              retryCount: save.retryCount + 1,
            });

            // Remove if max retries exceeded
            if (save.retryCount >= maxRetries) {
              await removePendingScriptSave(save.id);
              console.log('🗑️ [ScriptAutosave] Max retries exceeded, removed from queue:', save.id);
            }
          }
        }
      }
      console.log('✅ [ScriptAutosave] Finished processing offline queue');
    } catch (err) {
      console.error('💥 [ScriptAutosave] Failed to process offline queue:', err);
    } finally {
      // Clear flag when queue processing completes (success or failure)
      setIsProcessingQueue(false);
    }
  }, [scriptId, performSave, enableOfflineQueue, maxRetries]);

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => {
      console.log('🌐 [ScriptAutosave] Network ONLINE detected');
      isOnlineRef.current = true;
      // CRITICAL: Always process queue on reconnect
      processOfflineQueue();
    };

    const handleOffline = () => {
      console.log('📴 [ScriptAutosave] Network OFFLINE detected');
      isOnlineRef.current = false;
      // Set offline state immediately for UI feedback
      setSaveState('offline');
      setError('Offline - changes will be queued');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [processOfflineQueue]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  // Reset internal state when script changes
  useEffect(() => {
    console.log('🔄 [ScriptAutosave] Script change detected:', { scriptId, initialVersion });
    // Sync to server-provided version for the new script
    setCurrentVersion(initialVersion);
    currentVersionRef.current = initialVersion;
    // Reset state
    setSaveState('idle');
    setPendingChanges(false);
    setConflictData(null);
    setError(null);
    setRetryAfter(null);
    retryCountRef.current = 0;
    clearTimers();
  }, [scriptId, initialVersion, clearTimers]);

  // If server raises the version for the current script, adopt it without a full reset
  useEffect(() => {
    setCurrentVersion((prev) => (initialVersion > prev ? initialVersion : prev));
  }, [initialVersion]);

  // Separate effect to establish content baseline when script changes
  useEffect(() => {
    try {
      const contentBlocks = getContentBlocks();
      lastContentRef.current = JSON.stringify(contentBlocks);
    } catch {
      lastContentRef.current = '';
    }
  }, [scriptId, getContentBlocks]);

  // Sync refs with state/props to prevent callback recreation
  useEffect(() => {
    currentVersionRef.current = currentVersion;
  }, [currentVersion]);

  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  // Process offline queue on mount if online
  useEffect(() => {
    if (isOnlineRef.current) {
      processOfflineQueue();
    }
  }, [processOfflineQueue]);

  const state: AutosaveState = {
    saveState,
    lastSaved,
    currentVersion,
    pendingChanges,
    conflictData,
    error,
    retryAfter,
    isProcessingQueue,
  };

  const actions: AutosaveActions = {
    saveNow,
    markChanged,
    acceptServerVersion,
    forceLocalVersion,
    retry,
    processOfflineQueue,
  };

  return [state, actions];
}
