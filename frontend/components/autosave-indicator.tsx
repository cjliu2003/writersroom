/**
 * AutosaveIndicator - Shows the current autosave status with appropriate icons and messages
 */

import React from 'react';
import { 
  CheckCircle, 
  Clock, 
  AlertCircle, 
  Wifi, 
  WifiOff, 
  RefreshCw,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import { cn } from '../utils/cn';
import type { SaveState } from '../hooks/use-autosave';

interface AutosaveIndicatorProps {
  saveState: SaveState;
  lastSaved: Date | null;
  error: string | null;
  retryAfter: number | null;
  className?: string;
  onRetry?: () => void;
  onResolveConflict?: () => void;
}

export function AutosaveIndicator({
  saveState,
  lastSaved,
  error,
  retryAfter,
  className,
  onRetry,
  onResolveConflict
}: AutosaveIndicatorProps) {
  const getStatusConfig = () => {
    switch (saveState) {
      case 'idle':
        return {
          icon: CheckCircle,
          text: lastSaved ? `Saved ${formatRelativeTime(lastSaved)}` : 'No changes',
          color: 'text-green-600',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200'
        };
        
      case 'pending':
        return {
          icon: Clock,
          text: 'Pending changes...',
          color: 'text-yellow-600',
          bgColor: 'bg-yellow-50',
          borderColor: 'border-yellow-200'
        };
        
      case 'saving':
        return {
          icon: Loader2,
          text: 'Saving...',
          color: 'text-blue-600',
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-200',
          animate: true
        };
        
      case 'saved':
        return {
          icon: CheckCircle,
          text: `Saved ${formatRelativeTime(lastSaved)}`,
          color: 'text-green-600',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200'
        };
        
      case 'offline':
        return {
          icon: WifiOff,
          text: 'Offline — queued',
          color: 'text-orange-600',
          bgColor: 'bg-orange-50',
          borderColor: 'border-orange-200'
        };
        
      case 'conflict':
        return {
          icon: AlertTriangle,
          text: 'Conflict detected',
          color: 'text-red-600',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          actionable: true
        };
        
      case 'error':
        return {
          icon: AlertCircle,
          text: error || 'Save failed',
          color: 'text-red-600',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          actionable: true
        };
        
      case 'rate_limited':
        return {
          icon: RefreshCw,
          text: retryAfter ? `Rate limited — retry in ${retryAfter}s` : 'Rate limited',
          color: 'text-purple-600',
          bgColor: 'bg-purple-50',
          borderColor: 'border-purple-200'
        };
        
      default:
        return {
          icon: AlertCircle,
          text: 'Unknown state',
          color: 'text-gray-600',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200'
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors',
      config.color,
      config.bgColor,
      config.borderColor,
      className
    )}>
      <Icon 
        size={14} 
        className={cn(
          config.animate && 'animate-spin'
        )}
      />
      
      <span className="truncate">
        {config.text}
      </span>
      
      {config.actionable && (
        <div className="flex items-center gap-1 ml-2">
          {saveState === 'conflict' && onResolveConflict && (
            <button
              onClick={onResolveConflict}
              className="text-xs px-2 py-0.5 bg-white border border-current rounded hover:bg-gray-50 transition-colors"
            >
              Resolve
            </button>
          )}
          
          {(saveState === 'error' || saveState === 'conflict') && onRetry && (
            <button
              onClick={onRetry}
              className="text-xs px-2 py-0.5 bg-white border border-current rounded hover:bg-gray-50 transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Format a date as relative time (e.g., "2 minutes ago")
 */
function formatRelativeTime(date: Date | null): string {
  if (!date) return 'never';
  
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  
  if (diffSeconds < 10) {
    return 'just now';
  } else if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  } else if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Compact version of the autosave indicator for tight spaces
 */
export function AutosaveIndicatorCompact({
  saveState,
  lastSaved,
  className,
  ...props
}: Omit<AutosaveIndicatorProps, 'error' | 'retryAfter' | 'onRetry' | 'onResolveConflict'>) {
  const getIcon = () => {
    switch (saveState) {
      case 'idle':
      case 'saved':
        return <CheckCircle size={16} className="text-green-600" />;
      case 'pending':
        return <Clock size={16} className="text-yellow-600" />;
      case 'saving':
        return <Loader2 size={16} className="text-blue-600 animate-spin" />;
      case 'offline':
        return <WifiOff size={16} className="text-orange-600" />;
      case 'conflict':
        return <AlertTriangle size={16} className="text-red-600" />;
      case 'error':
        return <AlertCircle size={16} className="text-red-600" />;
      case 'rate_limited':
        return <RefreshCw size={16} className="text-purple-600" />;
      default:
        return <AlertCircle size={16} className="text-gray-600" />;
    }
  };

  return (
    <div className={cn('flex items-center', className)} title={`Autosave: ${saveState}`}>
      {getIcon()}
    </div>
  );
}
