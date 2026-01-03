/**
 * Offline Recovery Dialog
 *
 * Shown when the user has local changes in IndexedDB that are newer than
 * the server version. This typically happens after a browser crash while
 * editing offline.
 *
 * COLLABORATION CONFLICT WARNING:
 * If the document has changed since the user went offline (e.g., a collaborator
 * made edits), this dialog shows a warning that recovering will overwrite those
 * changes. The severity of the warning depends on how different the versions are.
 *
 * The dialog blocks interaction until the user chooses to:
 * - Recover: Load local content into Yjs (their work is preserved, collaborator work may be lost)
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
import { type ConflictInfo } from '@/hooks/use-offline-recovery';

interface OfflineRecoveryDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** When the pending offline save was created */
  pendingTimestamp: Date | null;
  /** When the server was last updated */
  serverTimestamp: Date | null;
  /** Conflict information (null if not yet detected) */
  conflictInfo: ConflictInfo | null;
  /** Called when user clicks "Recover My Changes" */
  onRecover: () => void;
  /** Called when user clicks "Discard Changes" or "Keep Current Version" */
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

/**
 * Warning icon SVG
 */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/**
 * Alert triangle icon for conflict warnings
 */
function AlertTriangleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/**
 * Trash icon for discard button
 */
function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

/**
 * Refresh icon for recover button
 */
function RefreshIcon({ className, spin }: { className?: string; spin?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className} ${spin ? 'animate-spin' : ''}`}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

/**
 * Check icon for keep current button
 */
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function OfflineRecoveryDialog({
  isOpen,
  pendingTimestamp,
  serverTimestamp,
  conflictInfo,
  onRecover,
  onDiscard,
  isRecovering = false,
}: OfflineRecoveryDialogProps) {
  const hasConflict = conflictInfo?.hasConflict ?? false;
  const isMajorConflict = conflictInfo?.severity === 'major';

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WarningIcon className={`h-5 w-5 ${hasConflict ? 'text-red-500' : 'text-amber-500'}`} />
            {hasConflict ? 'Conflict Detected' : 'Unsaved Offline Changes Detected'}
          </DialogTitle>
          <div className="pt-2 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            {hasConflict ? (
              <p>
                Your offline version differs from the current document.
                {isMajorConflict
                  ? ' There are significant differences that suggest a collaborator made changes while you were offline.'
                  : ' There are some differences between the versions.'}
              </p>
            ) : (
              <p>
                You have changes that were not synced before your browser closed.
                Would you like to recover them?
              </p>
            )}

            {/* Version comparison box */}
            <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-md space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Your offline version:</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {formatDate(pendingTimestamp)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Current version:</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {formatDate(serverTimestamp)}
                </span>
              </div>

              {/* Block count comparison when conflict info is available */}
              {conflictInfo && (
                <>
                  <div className="border-t border-slate-200 dark:border-slate-700 my-2" />
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500 dark:text-slate-400">Offline blocks:</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {conflictInfo.offlineBlockCount} blocks
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500 dark:text-slate-400">Current blocks:</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {conflictInfo.currentBlockCount} blocks
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Conflict warning banner */}
            {hasConflict && (
              <div className={`flex items-start gap-2 p-3 rounded-md ${
                isMajorConflict
                  ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                  : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
              }`}>
                <AlertTriangleIcon className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
                  isMajorConflict ? 'text-red-500' : 'text-amber-500'
                }`} />
                <div className="text-sm">
                  <p className={`font-medium ${
                    isMajorConflict ? 'text-red-800 dark:text-red-200' : 'text-amber-800 dark:text-amber-200'
                  }`}>
                    {isMajorConflict
                      ? 'Major changes detected'
                      : 'Document has been modified'}
                  </p>
                  <p className={`mt-1 ${
                    isMajorConflict ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'
                  }`}>
                    {isMajorConflict
                      ? 'Recovering will REPLACE the current document and may remove collaborator work. Consider keeping the current version if you are unsure.'
                      : 'Recovering will replace the current document. Any changes made since you went offline will be lost.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </DialogHeader>

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-3 mt-4">
          {hasConflict ? (
            <>
              {/* Keep Current Version - primary action when there's a conflict */}
              <Button
                onClick={onDiscard}
                disabled={isRecovering}
                className="w-full sm:w-auto order-1"
              >
                <CheckIcon className="h-4 w-4 mr-2" />
                Keep Current Version
              </Button>
              {/* Recover with warning styling */}
              <Button
                variant="outline"
                onClick={onRecover}
                disabled={isRecovering}
                className={`w-full sm:w-auto order-2 ${
                  isMajorConflict
                    ? 'border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20'
                    : 'border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20'
                }`}
              >
                <RefreshIcon className="h-4 w-4 mr-2" spin={isRecovering} />
                {isRecovering ? 'Recovering...' : 'Recover Anyway (Override)'}
              </Button>
            </>
          ) : (
            <>
              {/* Normal flow - no conflict detected */}
              <Button
                variant="outline"
                onClick={onDiscard}
                disabled={isRecovering}
                className="w-full sm:w-auto order-2 sm:order-1"
              >
                <TrashIcon className="h-4 w-4 mr-2" />
                Discard Changes
              </Button>
              <Button
                onClick={onRecover}
                disabled={isRecovering}
                className="w-full sm:w-auto order-1 sm:order-2"
              >
                <RefreshIcon className="h-4 w-4 mr-2" spin={isRecovering} />
                {isRecovering ? 'Recovering...' : 'Recover My Changes'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
