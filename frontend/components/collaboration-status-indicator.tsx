/**
 * Collaboration Status Indicator
 * 
 * Shows the current WebSocket connection and sync status for collaborative editing.
 */

import React from 'react';
import { Wifi, WifiOff, RefreshCw, AlertCircle, Check } from 'lucide-react';
import { SyncStatus } from '@/hooks/use-yjs-collaboration';

export interface CollaborationStatusIndicatorProps {
  syncStatus: SyncStatus;
  isConnected: boolean;
  participantCount?: number;
  onReconnect?: () => void;
  className?: string;
}

export function CollaborationStatusIndicator({
  syncStatus,
  isConnected,
  participantCount = 0,
  onReconnect,
  className = '',
}: CollaborationStatusIndicatorProps) {
  const getStatusConfig = () => {
    switch (syncStatus) {
      case 'synced':
        return {
          icon: Check,
          text: 'Synced',
          color: 'text-green-600',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
        };
      case 'connected':
        return {
          icon: Wifi,
          text: 'Connected',
          color: 'text-blue-600',
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-200',
        };
      case 'connecting':
        return {
          icon: RefreshCw,
          text: 'Connecting...',
          color: 'text-yellow-600',
          bgColor: 'bg-yellow-50',
          borderColor: 'border-yellow-200',
          animate: true,
        };
      case 'offline':
        return {
          icon: WifiOff,
          text: 'Offline',
          color: 'text-gray-600',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200',
        };
      case 'error':
        return {
          icon: AlertCircle,
          text: 'Connection Error',
          color: 'text-red-600',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
        };
      default:
        return {
          icon: WifiOff,
          text: 'Unknown',
          color: 'text-gray-600',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200',
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;
  
  const showReconnectButton = syncStatus === 'offline' || syncStatus === 'error';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Status Badge */}
      <div
        className={`
          flex items-center gap-1.5 px-2.5 py-1 rounded-full border
          ${config.bgColor} ${config.borderColor}
        `}
        title={`Status: ${syncStatus}`}
      >
        <Icon
          className={`
            w-3.5 h-3.5 ${config.color}
            ${config.animate ? 'animate-spin' : ''}
          `}
        />
        <span className={`text-xs font-medium ${config.color}`}>
          {config.text}
        </span>
      </div>

      {/* Participant Count */}
      {isConnected && participantCount > 0 && (
        <div
          className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded-full border border-gray-200"
          title={`${participantCount} active user${participantCount !== 1 ? 's' : ''}`}
        >
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-xs font-medium text-gray-700">
            {participantCount} {participantCount === 1 ? 'user' : 'users'}
          </span>
        </div>
      )}

      {/* Reconnect Button */}
      {showReconnectButton && onReconnect && (
        <button
          onClick={onReconnect}
          className="
            px-2 py-1 text-xs font-medium rounded
            bg-blue-600 text-white hover:bg-blue-700
            transition-colors
          "
          title="Reconnect to server"
        >
          Reconnect
        </button>
      )}
    </div>
  );
}

/**
 * Minimal status dot for toolbar/header use
 */
export function CollaborationStatusDot({
  syncStatus,
  className = '',
}: {
  syncStatus: SyncStatus;
  className?: string;
}) {
  const getColor = () => {
    switch (syncStatus) {
      case 'synced':
        return 'bg-green-500';
      case 'connected':
        return 'bg-blue-500';
      case 'connecting':
        return 'bg-yellow-500 animate-pulse';
      case 'offline':
        return 'bg-gray-400';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };

  return (
    <div
      className={`w-2 h-2 rounded-full ${getColor()} ${className}`}
      title={`Status: ${syncStatus}`}
    />
  );
}
