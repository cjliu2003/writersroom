/**
 * ConflictResolutionDialog - Handles version conflicts during autosave
 */

import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './ui/button';
import { AlertTriangle, Clock, User } from 'lucide-react';
import { cn } from '../utils/cn';

interface ConflictData {
  latest: {
    version: number;
    blocks: Array<any>;
    scene_heading: string;
    position: number;
    updated_at: string;
  };
  your_base_version: number;
  conflict: boolean;
}

interface ConflictResolutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflictData: ConflictData | null;
  localContent: string;
  onAcceptServer: () => void;
  onForceLocal: () => Promise<void>;
  onCancel: () => void;
}

export function ConflictResolutionDialog({
  open,
  onOpenChange,
  conflictData,
  localContent,
  onAcceptServer,
  onForceLocal,
  onCancel
}: ConflictResolutionDialogProps) {
  const [isForcing, setIsForcing] = useState(false);

  if (!conflictData) return null;

  const handleForceLocal = async () => {
    setIsForcing(true);
    try {
      await onForceLocal();
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to force local version:', error);
    } finally {
      setIsForcing(false);
    }
  };

  const handleAcceptServer = () => {
    onAcceptServer();
    onOpenChange(false);
  };

  const serverContent = conflictData.latest.blocks
    .map(block => block.text || '')
    .join('\n');

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-4xl max-h-[80vh] w-[90vw] bg-white rounded-lg shadow-lg z-50 overflow-hidden flex flex-col">
          <div className="p-6 border-b">
            <Dialog.Title className="flex items-center gap-2 text-lg font-semibold">
              <AlertTriangle className="text-red-500" size={20} />
              Version Conflict Detected
            </Dialog.Title>
            <Dialog.Description className="text-gray-600 mt-2">
              Your changes conflict with recent updates to this scene. Choose how to resolve:
            </Dialog.Description>
          </div>

          <div className="flex-1 overflow-hidden p-6">
            <div className="grid grid-cols-2 gap-4 h-full">
              {/* Server Version */}
              <div className="flex flex-col">
                <div className="flex items-center gap-2 mb-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <User size={16} className="text-blue-600" />
                  <div>
                    <h3 className="font-medium text-blue-900">Server Version</h3>
                    <p className="text-sm text-blue-700">
                      Version {conflictData.latest.version} • {formatTimestamp(conflictData.latest.updated_at)}
                    </p>
                  </div>
                </div>
                
                <div className="flex-1 overflow-auto">
                  <pre className="text-sm bg-gray-50 p-3 rounded border whitespace-pre-wrap font-mono">
                    {serverContent}
                  </pre>
                </div>
              </div>

              {/* Local Version */}
              <div className="flex flex-col">
                <div className="flex items-center gap-2 mb-3 p-3 bg-green-50 rounded-lg border border-green-200">
                  <Clock size={16} className="text-green-600" />
                  <div>
                    <h3 className="font-medium text-green-900">Your Version</h3>
                    <p className="text-sm text-green-700">
                      Based on version {conflictData.your_base_version} • Local changes
                    </p>
                  </div>
                </div>
                
                <div className="flex-1 overflow-auto">
                  <pre className="text-sm bg-gray-50 p-3 rounded border whitespace-pre-wrap font-mono">
                    {localContent}
                  </pre>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center p-6 border-t">
            <Button
              variant="outline"
              onClick={onCancel}
            >
              Cancel
            </Button>
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleAcceptServer}
                className="border-blue-200 text-blue-700 hover:bg-blue-50"
              >
                Use Server Version
              </Button>
              
              <Button
                onClick={handleForceLocal}
                disabled={isForcing}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {isForcing ? 'Saving...' : 'Keep My Changes'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Simple conflict notification for inline display
 */
export function ConflictNotification({
  onResolve,
  className
}: {
  onResolve: () => void;
  className?: string;
}) {
  return (
    <div className={cn(
      'flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg',
      className
    )}>
      <AlertTriangle size={20} className="text-red-600 flex-shrink-0" />
      
      <div className="flex-1">
        <h4 className="font-medium text-red-900">Version Conflict</h4>
        <p className="text-sm text-red-700">
          Your changes conflict with recent updates. Click to resolve.
        </p>
      </div>
      
      <Button
        size="sm"
        onClick={onResolve}
        className="bg-red-600 hover:bg-red-700 text-white"
      >
        Resolve
      </Button>
    </div>
  );
}
