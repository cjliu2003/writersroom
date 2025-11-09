"use client"

import React from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Home, Download, UserPlus, CheckCircle, Loader2, WifiOff, AlertCircle } from 'lucide-react';
import type { SyncStatus } from '@/hooks/use-script-yjs-collaboration';

interface CompactHeaderProps {
  scriptTitle: string;
  syncStatus: SyncStatus;
  lastSaved: Date;
  isExporting: boolean;
  onHomeClick: () => void;
  onExportClick: () => void;
  onCollaboratorsClick: () => void;
}

export function CompactHeader({
  scriptTitle,
  syncStatus,
  lastSaved,
  isExporting,
  onHomeClick,
  onExportClick,
  onCollaboratorsClick,
}: CompactHeaderProps) {
  // Get sync status display
  const getSyncStatusDisplay = () => {
    switch (syncStatus) {
      case 'synced':
        return {
          icon: CheckCircle,
          text: 'Saved',
          color: 'text-green-600',
        };
      case 'saving':
      case 'connected':
        return {
          icon: Loader2,
          text: 'Saving...',
          color: 'text-blue-600',
          animate: true,
        };
      case 'offline':
        return {
          icon: WifiOff,
          text: 'Offline',
          color: 'text-orange-600',
        };
      case 'error':
        return {
          icon: AlertCircle,
          text: 'Error',
          color: 'text-red-600',
        };
      default:
        return {
          icon: Loader2,
          text: 'Saving...',
          color: 'text-gray-500',
          animate: true,
        };
    }
  };

  const statusDisplay = getSyncStatusDisplay();
  const StatusIcon = statusDisplay.icon;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-[#f8f8f8] border-b border-gray-300 shadow-sm">
      <div className="px-4 py-2 flex items-center justify-between h-12">
        {/* Left: Home Button */}
        <div className="flex items-center gap-2 min-w-[120px]">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onHomeClick}
                  className="text-gray-700 hover:text-gray-900 hover:bg-gray-200/50 px-3 py-2 h-10"
                >
                  <Home className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Home</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Center: Script Title */}
        <div className="flex-1 flex justify-center px-4">
          <h1 className="text-lg font-semibold text-gray-800 truncate max-w-md" style={{ fontFamily: "'Courier New', Courier, monospace" }}>
            {scriptTitle || 'Untitled Script'}
          </h1>
        </div>

        {/* Right: Collaborators, Export, Status */}
        <div className="flex items-center gap-2 min-w-[120px] justify-end">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCollaboratorsClick}
                  className="text-gray-700 hover:text-gray-900 hover:bg-gray-200/50 px-3 py-2 h-10"
                >
                  <UserPlus className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Share & Collaborate (Coming Soon)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onExportClick}
                  disabled={isExporting}
                  className="text-gray-700 hover:text-gray-900 hover:bg-gray-200/50 px-3 py-2 h-10 disabled:opacity-50"
                >
                  <Download className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isExporting ? 'Exporting...' : 'Export to FDX'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Sync Status - Google Drive style with fixed width */}
          <div className="flex items-center gap-1.5 text-xs text-gray-500 ml-2 w-24">
            <StatusIcon
              className={`w-3.5 h-3.5 ${statusDisplay.color} ${statusDisplay.animate ? 'animate-spin' : ''}`}
            />
            <span className="hidden sm:inline whitespace-nowrap">{statusDisplay.text}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
