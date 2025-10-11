/**
 * Collaborative Editor Example
 * 
 * Example component demonstrating how to integrate Yjs collaboration
 * with the screenplay editor.
 * 
 * This is a reference implementation for Phase 2.1 foundation testing.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useYjsCollaboration } from '@/hooks/use-yjs-collaboration';
import { CollaborationStatusIndicator } from './collaboration-status-indicator';

export interface CollaborativeEditorExampleProps {
  sceneId: string;
  authToken: string;
}

export function CollaborativeEditorExample({
  sceneId,
  authToken,
}: CollaborativeEditorExampleProps) {
  const [participantCount, setParticipantCount] = useState(0);
  
  const {
    doc,
    provider,
    awareness,
    isConnected,
    syncStatus,
    connectionError,
    reconnect,
  } = useYjsCollaboration({
    sceneId,
    authToken,
    enabled: true,
    onSyncStatusChange: (status) => {
      console.log('Sync status changed:', status);
    },
    onError: (error) => {
      console.error('Collaboration error:', error);
    },
  });
  
  // Monitor awareness changes (other users joining/leaving)
  useEffect(() => {
    if (!awareness) return;
    
    const updateParticipants = () => {
      const states = awareness.getStates();
      // Count total participants (per client/tab)
      setParticipantCount(states.size);
    };
    
    awareness.on('change', updateParticipants);
    updateParticipants();
    
    return () => {
      awareness.off('change', updateParticipants);
    };
  }, [awareness]);
  
  // Example: Access Yjs shared text for editor integration
  useEffect(() => {
    if (!doc) return;
    
    // Get or create a shared text type
    const yText = doc.getText('content');
    
    // Listen to changes
    const observer = () => {
      console.log('Document changed:', yText.toString());
    };
    
    yText.observe(observer);
    
    return () => {
      yText.unobserve(observer);
    };
  }, [doc]);
  
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Collaborative Editor</h2>
        <CollaborationStatusIndicator
          syncStatus={syncStatus}
          isConnected={isConnected}
          participantCount={participantCount}
          onReconnect={reconnect}
        />
      </div>
      
      {connectionError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800">
            <strong>Error:</strong> {connectionError.message}
          </p>
        </div>
      )}
      
      <div className="p-4 bg-gray-50 rounded-lg space-y-2">
        <h3 className="font-medium text-sm">Connection Info</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-gray-600">Scene ID:</span>
            <span className="ml-2 font-mono text-xs">{sceneId}</span>
          </div>
          <div>
            <span className="text-gray-600">Status:</span>
            <span className="ml-2">{syncStatus}</span>
          </div>
          <div>
            <span className="text-gray-600">Connected:</span>
            <span className="ml-2">{isConnected ? 'Yes' : 'No'}</span>
          </div>
          <div>
            <span className="text-gray-600">Total participants:</span>
            <span className="ml-2">{participantCount}</span>
          </div>
        </div>
      </div>
      
      <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg min-h-[200px]">
        <p className="text-sm text-gray-500 text-center">
          Editor integration will go here
        </p>
        <p className="text-xs text-gray-400 text-center mt-2">
          Phase 2.2 will bind Yjs doc to the screenplay editor
        </p>
      </div>
      
      <div className="text-xs text-gray-500 space-y-1">
        <p><strong>Note:</strong> This is a Phase 2.1 foundation component.</p>
        <p>It demonstrates:</p>
        <ul className="list-disc list-inside ml-2">
          <li>WebSocket connection management</li>
          <li>Yjs document synchronization</li>
          <li>Awareness/presence tracking</li>
          <li>Connection status indicators</li>
        </ul>
      </div>
    </div>
  );
}
