"use client"

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
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
  onTitleChange?: (newTitle: string) => void;
}

const MAX_TITLE_LENGTH = 25;

// Shared class strings for consistency and performance
const TITLE_BASE_CLASSES = "font-[family-name:var(--font-courier-prime)] text-lg font-normal text-center uppercase tracking-normal text-black underline decoration-1 underline-offset-2";
const BUTTON_CLASSES = "text-gray-700 hover:text-gray-900 hover:bg-gray-200/50 px-3 py-2 h-10";
const ICON_SIZE = "w-6 h-6";

export function CompactHeader({
  scriptTitle,
  syncStatus,
  lastSaved,
  isExporting,
  onHomeClick,
  onExportClick,
  onCollaboratorsClick,
  onTitleChange,
}: CompactHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(scriptTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update local state when prop changes
  useEffect(() => {
    setEditedTitle(scriptTitle);
  }, [scriptTitle]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Memoized handlers for performance
  const handleTitleClick = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleTitleBlur = useCallback(() => {
    const trimmedTitle = editedTitle.trim();

    // Always revert to original if empty or unchanged
    if (!trimmedTitle || trimmedTitle === scriptTitle) {
      setEditedTitle(scriptTitle);
      setIsEditing(false);
      return;
    }

    // Only save if we have a valid new title
    if (onTitleChange) {
      setIsEditing(false);
      onTitleChange(trimmedTitle);
    }
  }, [editedTitle, scriptTitle, onTitleChange]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setEditedTitle(scriptTitle);
      setIsEditing(false);
    }
  }, [scriptTitle]);

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.slice(0, MAX_TITLE_LENGTH);
    setEditedTitle(value);
  }, []);

  // Memoized sync status display
  const statusDisplay = useMemo(() => {
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
  }, [syncStatus]);

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
                  className={BUTTON_CLASSES}
                >
                  <Home className={ICON_SIZE} />
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
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editedTitle}
              onChange={handleTitleChange}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
              maxLength={MAX_TITLE_LENGTH}
              className={`${TITLE_BASE_CLASSES} bg-transparent border-none outline-none focus:outline-none w-full max-w-xl px-2`}
            />
          ) : (
            <h1
              onClick={handleTitleClick}
              className={`${TITLE_BASE_CLASSES} truncate max-w-xl cursor-text hover:opacity-70 px-2 transition-opacity`}
              title="Click to edit title"
            >
              {scriptTitle || 'Untitled Script'}
            </h1>
          )}
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
                  className={BUTTON_CLASSES}
                >
                  <UserPlus className={ICON_SIZE} />
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
                  className={`${BUTTON_CLASSES} disabled:opacity-50`}
                >
                  <Download className={ICON_SIZE} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isExporting ? 'Exporting...' : 'Export to FDX'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Sync Status - Google Drive style with fixed width */}
          <div className="flex items-center gap-1.5 text-sm text-gray-500 ml-2 w-24">
            <StatusIcon
              className={`w-4 h-4 ${statusDisplay.color} ${statusDisplay.animate ? 'animate-spin' : ''}`}
            />
            <span className="hidden sm:inline whitespace-nowrap">{statusDisplay.text}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
