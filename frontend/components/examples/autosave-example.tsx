/**
 * AutosaveExample - Example component demonstrating autosave integration
 */

"use client"

import React, { useState, useCallback } from 'react';
import { ScreenplayEditorWithAutosave } from '../screenplay-editor-with-autosave';
import { AutosaveIndicator, AutosaveIndicatorCompact } from '../autosave-indicator';
import { useAutosave } from '../../hooks/use-autosave';
import { Button } from '../ui/button';
// import { Card } from '../ui/card'; // Using custom Card component below

// Mock auth token - in real app, get from auth context
const MOCK_AUTH_TOKEN = 'mock-token-123';

export function AutosaveExample() {
  const [sceneId] = useState('example-scene-123');
  const [currentVersion, setCurrentVersion] = useState(1);
  const [content, setContent] = useState('');

  const handleVersionUpdate = useCallback((newVersion: number) => {
    setCurrentVersion(newVersion);
    console.log('Scene version updated to:', newVersion);
  }, []);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    console.log('Content changed, length:', newContent.length);
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Autosave Example</h1>
        <p className="text-gray-600">
          This example demonstrates the autosave functionality. Start typing to see it in action.
        </p>
      </div>

      {/* Main Editor with Autosave */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Screenplay Editor with Autosave</h2>
        <ScreenplayEditorWithAutosave
          sceneId={sceneId}
          initialVersion={currentVersion}
          content={content}
          authToken={MOCK_AUTH_TOKEN}
          onChange={handleContentChange}
          onVersionUpdate={handleVersionUpdate}
          autosaveOptions={{
            debounceMs: 1500,
            maxWaitMs: 5000,
            maxRetries: 3,
            enableOfflineQueue: true
          }}
          showAutosaveIndicator={true}
          compactIndicator={false}
        />
      </Card>

      {/* Standalone Autosave Hook Example */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Standalone Autosave Hook</h2>
        <StandaloneAutosaveExample sceneId={sceneId} currentVersion={currentVersion} />
      </Card>

      {/* Status Indicators Examples */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Status Indicators</h2>
        <StatusIndicatorExamples />
      </Card>
    </div>
  );
}

function StandaloneAutosaveExample({ 
  sceneId, 
  currentVersion 
}: { 
  sceneId: string; 
  currentVersion: number; 
}) {
  const [textContent, setTextContent] = useState('');
  
  const getContent = useCallback(() => textContent, [textContent]);
  
  const [autosaveState, autosaveActions] = useAutosave(
    sceneId + '-standalone',
    currentVersion,
    getContent,
    MOCK_AUTH_TOKEN,
    {
      debounceMs: 1000,
      maxWaitMs: 3000
    }
  );

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextContent(e.target.value);
    autosaveActions.markChanged();
  }, [autosaveActions]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <AutosaveIndicator
          saveState={autosaveState.saveState}
          lastSaved={autosaveState.lastSaved}
          error={autosaveState.error}
          retryAfter={autosaveState.retryAfter}
          onRetry={autosaveActions.retry}
          className="text-sm"
        />
        
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={autosaveActions.saveNow}
            disabled={autosaveState.saveState === 'saving'}
          >
            Save Now
          </Button>
          
          <Button
            size="sm"
            variant="outline"
            onClick={autosaveActions.processOfflineQueue}
          >
            Process Queue
          </Button>
        </div>
      </div>
      
      <textarea
        value={textContent}
        onChange={handleTextChange}
        placeholder="Type here to test autosave..."
        className="w-full h-32 p-3 border rounded-md resize-none"
      />
      
      <div className="text-sm text-gray-600 space-y-1">
        <div>Current Version: {autosaveState.currentVersion}</div>
        <div>Pending Changes: {autosaveState.pendingChanges ? 'Yes' : 'No'}</div>
        <div>Last Saved: {autosaveState.lastSaved?.toLocaleTimeString() || 'Never'}</div>
      </div>
    </div>
  );
}

function StatusIndicatorExamples() {
  const mockStates = [
    { state: 'idle' as const, lastSaved: new Date(Date.now() - 60000) },
    { state: 'pending' as const, lastSaved: null },
    { state: 'saving' as const, lastSaved: null },
    { state: 'saved' as const, lastSaved: new Date() },
    { state: 'offline' as const, lastSaved: new Date(Date.now() - 300000) },
    { state: 'conflict' as const, lastSaved: new Date(Date.now() - 120000) },
    { state: 'error' as const, lastSaved: new Date(Date.now() - 180000) },
    { state: 'rate_limited' as const, lastSaved: null }
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium mb-2">Full Indicators</h3>
        <div className="space-y-2">
          {mockStates.map(({ state, lastSaved }) => (
            <AutosaveIndicator
              key={state}
              saveState={state}
              lastSaved={lastSaved}
              error={state === 'error' ? 'Network error occurred' : null}
              retryAfter={state === 'rate_limited' ? 30 : null}
              onRetry={() => console.log('Retry clicked')}
              onResolveConflict={() => console.log('Resolve conflict clicked')}
            />
          ))}
        </div>
      </div>
      
      <div>
        <h3 className="font-medium mb-2">Compact Indicators</h3>
        <div className="flex items-center gap-4">
          {mockStates.map(({ state, lastSaved }) => (
            <div key={state} className="flex items-center gap-2">
              <AutosaveIndicatorCompact
                saveState={state}
                lastSaved={lastSaved}
              />
              <span className="text-xs text-gray-500 capitalize">{state}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Simple Card component if not available
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-gray-200 rounded-lg shadow-sm ${className}`}>
      {children}
    </div>
  );
}
