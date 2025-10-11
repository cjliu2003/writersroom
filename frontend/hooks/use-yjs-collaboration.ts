/**
 * Yjs Collaboration Hook
 * 
 * Manages WebSocket connection and Yjs document synchronization for
 * real-time collaborative editing.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

export type SyncStatus = 'connecting' | 'connected' | 'synced' | 'offline' | 'error';

export interface UseYjsCollaborationProps {
  sceneId: string;
  authToken: string;
  enabled?: boolean;  // Feature flag to enable/disable collaboration
  onSyncStatusChange?: (status: SyncStatus) => void;
  onError?: (error: Error) => void;
}

export interface UseYjsCollaborationReturn {
  doc: Y.Doc | null;
  provider: WebsocketProvider | null;
  awareness: any | null;  // Awareness API for presence
  isConnected: boolean;
  syncStatus: SyncStatus;
  connectionError: Error | null;
  reconnect: () => void;
}

/**
 * Hook for managing Yjs collaborative editing
 */
export function useYjsCollaboration({
  sceneId,
  authToken,
  enabled = true,
  onSyncStatusChange,
  onError,
}: UseYjsCollaborationProps): UseYjsCollaborationReturn {
  // Track connection attempts to prevent infinite loops
  const connectionAttemptsRef = useRef(0);
  const maxConnectionAttempts = 5;
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
      const parts = token.split('.')
      if (parts.length < 2) return null
      const base64Url = parts[1]
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64Url.length % 4)) % 4)
      const json = typeof window !== 'undefined' ? window.atob(base64) : Buffer.from(base64, 'base64').toString('utf-8')
      return JSON.parse(json)
    } catch {
      return null
    }
  }, [])
  
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
  
  useEffect(() => {
    if (!enabled || !sceneId || !authToken) {
      return;
    }
    
    // Get WebSocket base URL from environment or default (prefer explicit backend URL)
    // Avoid deriving from window.location to prevent pointing to Next.js port in dev.
    const apiBase = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    let wsBaseUrl: string;
    try {
      const apiUrl = new URL(apiBase);
      const wsProtocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      // Note: WebsocketProvider appends the room name to the URL, so we use base URL without scene ID
      wsBaseUrl = `${wsProtocol}//${apiUrl.host}/api/ws/scenes`;
    } catch {
      // Fallback if env var isn't a full URL
      const host = apiBase.replace(/^https?:\/\//, '');
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      wsBaseUrl = `${isHttps ? 'wss:' : 'ws:'}//${host}/api/ws/scenes`;
    }
    
    console.log('[YjsCollaboration] Connecting to:', `${wsBaseUrl}/${sceneId}?token=***`);
    
    try {
      // Create WebSocket provider
      // The provider will construct: wsBaseUrl + '/' + sceneId
      // Then we add token as query param via custom params
      const newProvider = new WebsocketProvider(
        wsBaseUrl,
        sceneId,  // This becomes the room name and is appended to the URL
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
          const otype = typeof origin === 'string' ? origin : (origin?.constructor?.name || typeof origin)
          console.log('[YjsCollaboration] doc.update', { bytes: update?.length, origin: otype });
        } catch {}
      };
      doc.on('update', handleDocUpdate);
      // Get awareness instance
      const awarenessInstance = newProvider.awareness;
      // Ensure local awareness state is set so local client is counted
      try {
        const currentLocal = awarenessInstance.getLocalState();
        const payload = decodeJwt(authToken) || {}
        const userId = payload.uid || payload.user_id || payload.sub || undefined
        const name = payload.name || payload.email || 'Anonymous'
        const desiredState = { status: 'online', userId, name, clientId: doc.clientID, ts: Date.now() }
        if (!currentLocal) {
          awarenessInstance.setLocalState(desiredState);
        } else {
          awarenessInstance.setLocalState({ ...currentLocal, ...desiredState })
        }
      } catch (e) {
        console.warn('[YjsCollaboration] Failed to set local awareness state', e);
      }
      setAwareness(awarenessInstance);

      // Clear local awareness on page unload to avoid ghost participants
      const clearLocalAwareness = () => {
        try {
          awarenessInstance.setLocalState(null);
        } catch (e) {
          console.warn('[YjsCollaboration] Failed to clear local awareness state on unload', e);
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
        console.log('[YjsCollaboration] Status:', status);
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
        const synced = typeof arg === 'boolean' ? arg : !!arg?.synced
        console.log('[YjsCollaboration] Synced:', synced);
        if (synced) {
          updateSyncStatus('synced');
        }
      };
      
      const handleConnectionError = (event: any) => {
        console.error('[YjsCollaboration] Connection error:', event);
        connectionAttemptsRef.current += 1;
        
        if (connectionAttemptsRef.current >= maxConnectionAttempts) {
          console.error('[YjsCollaboration] Max connection attempts reached. Stopping reconnection.');
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
              console.error('[YjsCollaboration] Error destroying provider:', e);
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
        console.log('[YjsCollaboration] Connection closed:', event);
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
        console.log('[YjsCollaboration] Cleaning up...');
        try { doc.off('update', handleDocUpdate) } catch {}
        
        // Clear local awareness state so other clients remove us
        try {
          if (awarenessInstance) {
            awarenessInstance.setLocalState(null);
          }
        } catch (e) {
          console.warn('[YjsCollaboration] Failed to clear local awareness state', e);
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
      const err = error instanceof Error ? error : new Error('Failed to initialize Yjs');
      console.error('[YjsCollaboration] Initialization error:', err);
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
  }, [sceneId, authToken, enabled]);
  
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
