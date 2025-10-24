/**
 * useAutosave hook - Handles automatic saving with debouncing, offline queue, and conflict resolution
 */

  import { useCallback, useEffect, useRef, useState } from 'react';
  import { 
    saveScene, 
    generateOpId, 
    contentToBlocks, 
    extractSceneHeading,
    extractSceneSlice,
    ConflictError,
    RateLimitError,
    AutosaveApiError,
    type SceneUpdateRequest 
  } from '../utils/autosave-api';
import {
  addPendingSave,
  removePendingSave,
  getPendingSaves,
  clearPendingSaves,
  updatePendingSaveRetryCount,
  isIndexedDBAvailable,
  type PendingSave
} from '../utils/autosave-storage';

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
}

export interface AutosaveActions {
  /** Trigger an immediate save */
  saveNow: () => Promise<void>;
  /** Mark content as changed (triggers debounced save) */
  markChanged: (contentOverride?: string) => void;
  /** Resolve conflict by accepting server version */
  acceptServerVersion: () => void;
  /** Resolve conflict by forcing local version */
  forceLocalVersion: () => Promise<void>;
  /** Retry failed save */
  retry: () => Promise<void>;
  /** Process offline queue */
  processOfflineQueue: () => Promise<void>;
}

export function useAutosave(
  sceneId: string,
  initialVersion: number,
  getContent: () => string,
  authToken: string,
  options: AutosaveOptions = {},
  scenePosition?: number
): [AutosaveState, AutosaveActions] {
  const {
    debounceMs = 1500,
    maxWaitMs = 5000,
    maxRetries = 3,
    enableOfflineQueue = true
  } = options;

  // State
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [currentVersion, setCurrentVersion] = useState(initialVersion);
  const [pendingChanges, setPendingChanges] = useState(false);
  const [conflictData, setConflictData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  // Refs for managing timers and state
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const maxWaitTimerRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastContentRef = useRef<string>('');
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
  const performSave = useCallback(async (
    content: string,
    opId?: string,
    baseVersionOverride?: number,
    positionOverride?: number
  ): Promise<void> => {
    if (!authTokenRef.current) {
      throw new Error('No auth token available');
    }

    // Extract only the current scene slice by UUID (with position hint for reliability)
    const { elements, heading, position } = extractSceneSlice(content, sceneId, scenePosition);
    const sliceJson = JSON.stringify(elements);
    const blocks = contentToBlocks(sliceJson);
    const sceneHeading = heading || extractSceneHeading(sliceJson);

    const request: SceneUpdateRequest = {
      position: (typeof positionOverride === 'number' ? positionOverride : position),
      scene_heading: sceneHeading,
      blocks,
      // NOTE: Do NOT send full_content from autosave
      // - full_content is for plain text search/analysis (set by FDX parser)
      // - Autosave sends Slate JSON which corrupts the plain text format
      // - Backend can regenerate full_content from blocks if needed
      updated_at_client: new Date().toISOString(),
      base_version: (typeof baseVersionOverride === 'number' ? baseVersionOverride : currentVersionRef.current),
      op_id: opId || generateOpId()
    };

    const response = await saveScene(sceneId, request, authTokenRef.current, opId);

    // Update version on successful save (both state and ref)
    setCurrentVersion(response.new_version);
    currentVersionRef.current = response.new_version;
    setLastSaved(new Date());
  }, [sceneId]);

  // Save with error handling and offline queue
  const saveWithErrorHandling = useCallback(async (content: string, opId?: string): Promise<void> => {
    try {
      console.log('💾 Starting save to server:', { sceneId, baseVersion: currentVersionRef.current });
      setSaveState('saving');
      setError(null);
      setConflictData(null);

      await performSave(content, opId);

      setSaveState('saved');
      setPendingChanges(false);
      retryCountRef.current = 0;

      // Clear any pending saves for this scene on successful save
      if (enableOfflineQueue && isIndexedDBAvailable()) {
        await clearPendingSaves(sceneId);
      }

    } catch (err) {
      if (err instanceof ConflictError) {
        // Try a one-time fast-forward to the latest server version (and position), then retry the save.
        const latestVersion = err.conflictData?.latest?.version;
        const latestPosition = err.conflictData?.latest?.position;
        if (typeof latestVersion === 'number' && !retryCountRef.current) {
          try {
            // Adopt latest version and retry once with same opId (idempotent on server if supported)
            setCurrentVersion(latestVersion);
            currentVersionRef.current = latestVersion;
            await performSave(content, opId, latestVersion, typeof latestPosition === 'number' ? latestPosition : undefined);
            setSaveState('saved');
            setPendingChanges(false);
            retryCountRef.current = 0;
            if (enableOfflineQueue && isIndexedDBAvailable()) {
              await clearPendingSaves(sceneId);
            }
            return;
          } catch (err2) {
            if (err2 instanceof ConflictError) {
              // Fall through to conflict UI below
            } else if (err2 instanceof RateLimitError) {
              setSaveState('rate_limited');
              setRetryAfter(err2.retryAfter);
              setError(`Rate limited. Retry in ${err2.retryAfter}s`);
              retryTimerRef.current = setTimeout(() => {
                saveWithErrorHandling(content, opId);
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
      } else if (err instanceof RateLimitError) {
        setSaveState('rate_limited');
        setRetryAfter(err.retryAfter);
        setError(`Rate limited. Retry in ${err.retryAfter}s`);
        
        // Schedule retry
        retryTimerRef.current = setTimeout(() => {
          saveWithErrorHandling(content, opId);
        }, err.retryAfter * 1000);
        
      } else if (!isOnlineRef.current && enableOfflineQueue && isIndexedDBAvailable()) {
        // Queue for offline processing
        setSaveState('offline');
        setError('Offline - queued for sync');

        const pendingSave: PendingSave = {
          id: opId || generateOpId(),
          sceneId,
          content,
          baseVersion: currentVersionRef.current,
          timestamp: Date.now(),
          retryCount: 0,
          opId: opId || generateOpId()
        };

        await addPendingSave(pendingSave);

      } else {
        setSaveState('error');
        setError(err instanceof Error ? err.message : 'Save failed');

        // Retry logic for transient errors
        if (retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          retryTimerRef.current = setTimeout(() => {
            saveWithErrorHandling(content, opId);
          }, Math.pow(2, retryCountRef.current) * 1000); // Exponential backoff
        }
      }
    }
  }, [performSave, sceneId, enableOfflineQueue, maxRetries]);

  // Debounced save function
  const debouncedSave = useCallback((overrideContent?: string) => {
    const content = overrideContent ?? getContent();
    
    console.log('🔄 debouncedSave called:', {
      sceneId,
      contentLength: content.length,
      lastContentLength: lastContentRef.current.length,
      hasChanged: content !== lastContentRef.current
    });
    
    // Don't save if content hasn't changed
    if (content === lastContentRef.current) {
      console.log('⏭️ Content unchanged, skipping save');
      return;
    }
    
    lastContentRef.current = content;
    clearTimers();
    
    console.log('⏰ Setting up autosave timers');
    setSaveState('pending');
    setPendingChanges(true);
    
    // Set debounce timer
    debounceTimerRef.current = setTimeout(() => {
      console.log('⏰ Debounce timer fired, saving now');
      saveWithErrorHandling(content);
    }, debounceMs);
    
    // Set max wait timer
    maxWaitTimerRef.current = setTimeout(() => {
      console.log('⏰ Max wait timer fired, forcing save');
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        saveWithErrorHandling(content);
      }
    }, maxWaitMs);
    
  }, [getContent, saveWithErrorHandling, debounceMs, maxWaitMs, clearTimers]);

  // Actions
  const saveNow = useCallback(async (): Promise<void> => {
    const content = getContent();
    clearTimers();
    await saveWithErrorHandling(content);
  }, [getContent, saveWithErrorHandling, clearTimers]);

  const markChanged = useCallback((contentOverride?: string) => {
    debouncedSave(contentOverride);
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
      const content = getContent();
      await saveWithErrorHandling(content);
    }
  }, [conflictData, getContent, saveWithErrorHandling]);

  const retry = useCallback(async (): Promise<void> => {
    const content = getContent();
    retryCountRef.current = 0;
    await saveWithErrorHandling(content);
  }, [getContent, saveWithErrorHandling]);

  const processOfflineQueue = useCallback(async (): Promise<void> => {
    if (!enableOfflineQueue || !isIndexedDBAvailable()) return;
    
    try {
      const pendingSaves = await getPendingSaves(sceneId);
      
      for (const save of pendingSaves.sort((a, b) => a.timestamp - b.timestamp)) {
        try {
          await performSave(save.content, save.opId);
          await removePendingSave(save.id);
        } catch (err) {
          if (err instanceof ConflictError) {
            // Skip conflicted saves for now
            continue;
          } else if (err instanceof RateLimitError) {
            // Stop processing on rate limit
            break;
          } else {
            // Update retry count
            await updatePendingSaveRetryCount(save.id, save.retryCount + 1);
            
            // Remove if max retries exceeded
            if (save.retryCount >= maxRetries) {
              await removePendingSave(save.id);
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to process offline queue:', err);
    }
  }, [sceneId, performSave, enableOfflineQueue, maxRetries]);

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => {
      isOnlineRef.current = true;
      if (saveState === 'offline') {
        processOfflineQueue();
      }
    };
    
    const handleOffline = () => {
      isOnlineRef.current = false;
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [saveState, processOfflineQueue]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  // Reset internal state only when the scene changes
  useEffect(() => {
    console.log('🔄 Autosave reset (scene change):', { sceneId, initialVersion });
    // Sync to server-provided version for the new scene
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
  }, [sceneId, initialVersion, clearTimers]);

  // If server raises the version for the current scene, adopt it without a full reset
  useEffect(() => {
    setCurrentVersion(prev => (initialVersion > prev ? initialVersion : prev));
  }, [initialVersion]);

  // Separate effect to establish content baseline when scene changes
  useEffect(() => {
    try {
      lastContentRef.current = getContent();
    } catch {
      lastContentRef.current = '';
    }
  }, [sceneId]); // Only reset content baseline when scene changes, not on every getContent change

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
    retryAfter
  };

  const actions: AutosaveActions = {
    saveNow,
    markChanged,
    acceptServerVersion,
    forceLocalVersion,
    retry,
    processOfflineQueue
  };

  return [state, actions];
}
