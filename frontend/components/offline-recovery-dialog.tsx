/**
 * Offline Recovery Dialog
 *
 * Shown when the user has local changes in IndexedDB that are newer than
 * the server version. This typically happens after a browser crash while
 * editing offline.
 *
 * The dialog blocks interaction until the user chooses to:
 * - Recover: Load local content into Yjs (their work is preserved)
 * - Discard: Use server content (local changes are lost)
 */

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface OfflineRecoveryDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** When the pending offline save was created */
  pendingTimestamp: Date | null;
  /** When the server was last updated */
  serverTimestamp: Date | null;
  /** Called when user clicks "Recover My Changes" */
  onRecover: () => void;
  /** Called when user clicks "Discard Changes" */
  onDiscard: () => void;
  /** True while recovery is in progress (disables buttons) */
  isRecovering?: boolean;
}

/**
 * Format a date for display in the dialog
 */
function formatDate(date: Date | null): string {
  if (!date) return 'Unknown';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function OfflineRecoveryDialog({
  isOpen,
  pendingTimestamp,
  serverTimestamp,
  onRecover,
  onDiscard,
  isRecovering = false,
}: OfflineRecoveryDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 text-amber-500"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            Unsaved Offline Changes Detected
          </DialogTitle>
          <DialogDescription className="pt-2 space-y-3">
            <p>
              You have changes that weren't synced before your browser closed.
              Would you like to recover them?
            </p>
            <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-md text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Your offline changes:</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {formatDate(pendingTimestamp)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Server version:</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {formatDate(serverTimestamp)}
                </span>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-3">
          <Button
            variant="outline"
            onClick={onDiscard}
            disabled={isRecovering}
            className="w-full sm:w-auto order-2 sm:order-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4 mr-2"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
            Discard Changes
          </Button>
          <Button
            onClick={onRecover}
            disabled={isRecovering}
            className="w-full sm:w-auto order-1 sm:order-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 mr-2 ${isRecovering ? 'animate-spin' : ''}`}
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
            {isRecovering ? 'Recovering...' : 'Recover My Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
