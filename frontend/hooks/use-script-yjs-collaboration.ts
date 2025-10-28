/**
 * Script-Level Yjs Collaboration Hook
 *
 * Manages WebSocket connection and Yjs document synchronization for
 * real-time collaborative editing at the script level (entire screenplay).
 *
 * This is the script-level equivalent of use-yjs-collaboration.ts which
 * operates at the scene level.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

export type SyncStatus = 'connecting' | 'connected' | 'synced' | 'offline' | 'error';

export interface UseScriptYjsCollaborationProps {
  scriptId: string;
  authToken: string;
  enabled?: boolean;  // Feature flag to enable/disable collaboration
  onSyncStatusChange?: (status: SyncStatus) => void;
  onError?: (error: Error) => void;
  onUpdate?: (update: Uint8Array, origin: any) => void;
}

export interface UseScriptYjsCollaborationReturn {
  doc: Y.Doc | null;
  provider: WebsocketProvider | null;
  awareness: any | null;  // Awareness API for presence
  isConnected: boolean;
  syncStatus: SyncStatus;
  connectionError: Error | null;
  reconnect: () => void;
}

/**
 * Hook for managing script-level Yjs collaborative editing.
 *
 * Connects to `/api/ws/scripts/{scriptId}` endpoint for entire script collaboration.
 */
export function useScriptYjsCollaboration({
  scriptId,
  authToken,
  enabled = true,
  onSyncStatusChange,
  onError,
  onUpdate,
}: UseScriptYjsCollaborationProps): UseScriptYjsCollaborationReturn {
  // Track connection attempts to prevent infinite loops
  const connectionAttemptsRef = useRef(0);
  const maxConnectionAttempts = 5;

  // Reconnect key to force provider recreation when coming back online from error state
  const [reconnectKey, setReconnectKey] = useState(0);

  // Yjs document - persistent across re-renders
  const [doc] = useState(() => new Y.Doc());

  // WebSocket provider
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);

  // Awareness for presence (cursors, selections)
  const [awareness, setAwareness] = useState<any | null>(null);

  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('offline');
  const [connectionError, setConnectionError] = useState<Error | null>(null);

  // Refs to track cleanup
  const providerRef = useRef<WebsocketProvider | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const heartbeatRef = useRef<number | null>(null);

  // Decode JWT (best-effort, no verification) to extract user identity for awareness
  const decodeJwt = useCallback((token: string): any | null => {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64Url.length % 4)) % 4);
      const json = typeof window !== 'undefined' ? window.atob(base64) : Buffer.from(base64, 'base64').toString('utf-8');
      return JSON.parse(json);
    } catch {
      return null;
    }
  }, []);

  // Update sync status and notify callback
  const updateSyncStatus = useCallback((status: SyncStatus) => {
    setSyncStatus(status);
    onSyncStatusChange?.(status);
  }, [onSyncStatusChange]);

  // Reconnect function
  const reconnect = useCallback(() => {
    if (providerRef.current) {
      try {
        providerRef.current.connect();
        updateSyncStatus('connecting');
        setConnectionError(null);
      } catch (error) {
        const err = error instanceof Error ? error : new Error('Reconnection failed');
        setConnectionError(err);
        onError?.(err);
      }
    }
  }, [updateSyncStatus, onError]);

  // Listen for online/offline events to manage connection efficiently
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOffline = () => {
      console.log('[ScriptYjsCollaboration] Browser went offline - pausing reconnection attempts');
      // Disconnect provider to prevent wasted reconnection attempts
      if (providerRef.current) {
        providerRef.current.shouldConnect = false;
        providerRef.current.disconnect();
      }
      updateSyncStatus('offline');
    };

    const handleOnline = () => {
      console.log('[ScriptYjsCollaboration] Browser came online');

      if (syncStatus === 'offline') {
        // Resume connection after being offline
        console.log('[ScriptYjsCollaboration] Resuming connection after offline period');
        connectionAttemptsRef.current = 0; // Reset counter for fresh start
        if (providerRef.current) {
          providerRef.current.shouldConnect = true;
          providerRef.current.connect();
          updateSyncStatus('connecting');
        }
      } else if (syncStatus === 'error') {
        // Provider was destroyed after max retries - need full recreation
        console.log('[ScriptYjsCollaboration] Recovering from error state - forcing provider recreation');
        connectionAttemptsRef.current = 0;
        setConnectionError(null);
        setReconnectKey(k => k + 1);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncStatus, updateSyncStatus]);

  useEffect(() => {
    if (!enabled || !scriptId || !authToken) {
      return;
    }

    // Get WebSocket base URL from environment or default (prefer explicit backend URL)
    // Avoid deriving from window.location to prevent pointing to Next.js port in dev.
    const apiBase = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    let wsBaseUrl: string;
    try {
      const apiUrl = new URL(apiBase);
      const wsProtocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      // Note: WebsocketProvider appends the room name to the URL, so we use base URL without script ID
      wsBaseUrl = `${wsProtocol}//${apiUrl.host}/api/ws/scripts`;
    } catch {
      // Fallback if env var isn't a full URL
      const host = apiBase.replace(/^https?:\/\//, '');
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      wsBaseUrl = `${isHttps ? 'wss:' : 'ws:'}//${host}/api/ws/scripts`;
    }

    console.log('[ScriptYjsCollaboration] Connecting to:', `${wsBaseUrl}/${scriptId}?token=***`);

    // Reset connection attempts when starting fresh
    connectionAttemptsRef.current = 0;

    try {
      // Create WebSocket provider for script-level collaboration
      // The provider will construct: wsBaseUrl + '/' + scriptId
      // Then we add token as query param via custom params
      const newProvider = new WebsocketProvider(
        wsBaseUrl,
        scriptId,  // This becomes the room name and is appended to the URL
        doc,
        {
          connect: true,
          resyncInterval: -1,  // Disable automatic resync (use -1 to disable)
          maxBackoffTime: 10000,  // Max backoff for reconnection (10 seconds)
          params: { token: authToken },  // Add token as query parameter
        }
      );

      providerRef.current = newProvider;
      setProvider(newProvider);

      // Debug: Log Y.Doc updates to ensure local edits produce updates
      const handleDocUpdate = (update: Uint8Array, origin: any) => {
        try {
          const otype = typeof origin === 'string' ? origin : (origin?.constructor?.name || typeof origin);
          console.log('[ScriptYjsCollaboration] doc.update', { bytes: update?.length, origin: otype });
          onUpdate?.(update, origin);
        } catch {}
      };
      doc.on('update', handleDocUpdate);

      // Get awareness instance
      const awarenessInstance = newProvider.awareness;

      // Ensure local awareness state is set so local client is counted
      try {
        const currentLocal = awarenessInstance.getLocalState();
        const payload = decodeJwt(authToken) || {};
        const userId = payload.uid || payload.user_id || payload.sub || undefined;
        const name = payload.name || payload.email || 'Anonymous';
        const desiredState = { status: 'online', userId, name, clientId: doc.clientID, ts: Date.now() };
        if (!currentLocal) {
          awarenessInstance.setLocalState(desiredState);
        } else {
          awarenessInstance.setLocalState({ ...currentLocal, ...desiredState });
        }
      } catch (e) {
        console.warn('[ScriptYjsCollaboration] Failed to set local awareness state', e);
      }
      setAwareness(awarenessInstance);

      // Clear local awareness on page unload to avoid ghost participants
      const clearLocalAwareness = () => {
        try {
          awarenessInstance.setLocalState(null);
        } catch (e) {
          console.warn('[ScriptYjsCollaboration] Failed to clear local awareness state on unload', e);
        }
      };
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', clearLocalAwareness);
        window.addEventListener('pagehide', clearLocalAwareness);
      }

      // Heartbeat to refresh local awareness timestamp so peers can drop stale entries
      const sendHeartbeat = () => {
        try {
          const st = awarenessInstance.getLocalState() || {};
          awarenessInstance.setLocalState({ ...st, ts: Date.now() });
        } catch {}
      };
      sendHeartbeat();
      if (typeof window !== 'undefined') {
        heartbeatRef.current = window.setInterval(sendHeartbeat, 10000);
      }

      // Set up event listeners
      const handleStatus = ({ status }: { status: string }) => {
        console.log('[ScriptYjsCollaboration] Status:', status);
        setIsConnected(status === 'connected');

        switch (status) {
          case 'connecting':
            updateSyncStatus('connecting');
            break;
          case 'connected':
            updateSyncStatus('connected');
            break;
          case 'disconnected':
            updateSyncStatus('offline');
            break;
        }
      };

      const handleSynced = (arg: any) => {
        const synced = typeof arg === 'boolean' ? arg : !!arg?.synced;
        console.log('[ScriptYjsCollaboration] Synced:', synced);
        if (synced) {
          updateSyncStatus('synced');
        }
      };

      const handleConnectionError = (event: any) => {
        console.error('[ScriptYjsCollaboration] Connection error:', event);

        // CRITICAL: Don't count failures while browser is offline
        // Only count failures while online (actual connection issues)
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

        if (!isOnline) {
          // Browser is offline - don't count this failure, just set status
          console.log('[ScriptYjsCollaboration] Connection error while offline - not counting toward retry limit');
          updateSyncStatus('offline');
          return;
        }

        // Browser is online but connection failed - count toward retry limit
        connectionAttemptsRef.current += 1;
        console.error(`[ScriptYjsCollaboration] Connection failed while online (attempt ${connectionAttemptsRef.current}/${maxConnectionAttempts})`);

        if (connectionAttemptsRef.current >= maxConnectionAttempts) {
          console.error('[ScriptYjsCollaboration] Max connection attempts reached. Stopping reconnection.');
          const error = new Error(`WebSocket connection failed after ${maxConnectionAttempts} attempts. Please refresh the page.`);
          setConnectionError(error);
          updateSyncStatus('error');
          onError?.(error);

          // Disconnect permanently and destroy provider to stop reconnection
          if (newProvider) {
            try {
              newProvider.shouldConnect = false; // Prevent automatic reconnection
              newProvider.disconnect();
              newProvider.destroy();
            } catch (e) {
              console.error('[ScriptYjsCollaboration] Error destroying provider:', e);
            }
          }
          return;
        }

        const error = new Error(`WebSocket connection failed (attempt ${connectionAttemptsRef.current}/${maxConnectionAttempts})`);
        setConnectionError(error);
        updateSyncStatus('error');
        onError?.(error);
      };

      const handleConnectionClose = (event: any) => {
        console.log('[ScriptYjsCollaboration] Connection closed:', event);
        setIsConnected(false);
        updateSyncStatus('offline');
      };

      // Reset connection attempts on successful connection
      const handleStatusWithReset = (args: { status: string }) => {
        if (args.status === 'connected') {
          connectionAttemptsRef.current = 0;
        }
        handleStatus(args);
      };

      // Attach listeners
      newProvider.on('status', handleStatusWithReset);
      newProvider.on('synced', handleSynced);
      newProvider.on('connection-error', handleConnectionError);
      newProvider.on('connection-close', handleConnectionClose);

      // Initial connection status
      updateSyncStatus('connecting');

      // Cleanup function
      cleanupRef.current = () => {
        console.log('[ScriptYjsCollaboration] Cleaning up...');
        try { doc.off('update', handleDocUpdate); } catch {}

        // Clear local awareness state so other clients remove us
        try {
          if (awarenessInstance) {
            awarenessInstance.setLocalState(null);
          }
        } catch (e) {
          console.warn('[ScriptYjsCollaboration] Failed to clear local awareness state', e);
        }

        // Remove window listeners
        if (typeof window !== 'undefined') {
          window.removeEventListener('beforeunload', clearLocalAwareness);
          window.removeEventListener('pagehide', clearLocalAwareness);
        }

        // Clear heartbeat
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }

        // Remove provider listeners
        newProvider.off('status', handleStatusWithReset);
        newProvider.off('synced', handleSynced);
        newProvider.off('connection-error', handleConnectionError);
        newProvider.off('connection-close', handleConnectionClose);

        // Disconnect and destroy
        newProvider.disconnect();
        newProvider.destroy();

        // Don't destroy the doc - it might be reused
        // doc.destroy();
      };

    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to initialize script-level Yjs');
      console.error('[ScriptYjsCollaboration] Initialization error:', err);
      setConnectionError(err);
      updateSyncStatus('error');
      onError?.(err);
    }

    // Cleanup on unmount or dependency change
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  // Keep dependencies minimal to avoid HMR and callback identity churn causing reconnect loops
  // reconnectKey is included to force recreation when recovering from error state
  }, [scriptId, authToken, enabled, reconnectKey]);

  return {
    doc: enabled ? doc : null,
    provider: enabled ? provider : null,
    awareness: enabled ? awareness : null,
    isConnected,
    syncStatus,
    connectionError,
    reconnect,
  };
}
