"use client";

/**
 * Find/Replace Popup Component
 *
 * Minimal floating panel for find and replace functionality.
 * Always shows both find and replace in a compact layout.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Editor } from '@tiptap/react';
import { FindReplacePluginKey, FindReplaceState } from './find-replace-plugin';
import { ChevronUp, ChevronDown, X, ALargeSmall } from 'lucide-react';

interface FindReplacePopupProps {
  editor: Editor | null;
  isTopBarCollapsed?: boolean;
  isSceneNavCollapsed?: boolean;
}

export function FindReplacePopup({
  editor,
  isTopBarCollapsed = false,
  isSceneNavCollapsed = false
}: FindReplacePopupProps) {
  const [state, setState] = useState<FindReplaceState | null>(null);
  const [localQuery, setLocalQuery] = useState('');
  const [localReplaceText, setLocalReplaceText] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Calculate top position based on toolbar/nav bar state
  // Top bar: 48px, Scene nav: 44px
  const topPosition = isTopBarCollapsed
    ? (isSceneNavCollapsed ? 28 : 72)   // below top edge, or below scene nav
    : (isSceneNavCollapsed ? 76 : 120); // below top bar, or below both

  // Calculate right position based on scene nav state
  // When scene nav is expanded, shift closer to right edge
  // When collapsed, move slightly away from edge to avoid floating button
  const rightPosition = isSceneNavCollapsed ? 56 : 16;

  // Subscribe to Find/Replace plugin state changes
  useEffect(() => {
    if (!editor) return;

    const updateState = () => {
      const pluginState = FindReplacePluginKey.getState(editor.state);
      setState(pluginState || null);

      // Sync local state with plugin state
      if (pluginState) {
        if (pluginState.query !== localQuery) {
          setLocalQuery(pluginState.query);
        }
        if (pluginState.replaceText !== localReplaceText) {
          setLocalReplaceText(pluginState.replaceText);
        }
      }
    };

    // Initial state
    updateState();

    // Listen for state changes
    editor.on('transaction', updateState);

    return () => {
      editor.off('transaction', updateState);
    };
  }, [editor]);

  // Focus search input when panel opens or when shortcut is pressed again
  useEffect(() => {
    if (state?.isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }, [state?.isOpen, state?.focusTrigger]);

  // Handle search input change
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value;
      setLocalQuery(query);
      editor?.commands.setSearchQuery(query);
    },
    [editor]
  );

  // Handle replace input change
  const handleReplaceChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value;
      setLocalReplaceText(text);
      editor?.commands.setReplaceText(text);
    },
    [editor]
  );

  // Handle keyboard shortcuts in search input
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          editor?.commands.findPrevious();
        } else {
          editor?.commands.findNext();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        editor?.commands.closeFind();
        editor?.commands.focus();
      } else if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        replaceInputRef.current?.focus();
      }
    },
    [editor]
  );

  // Handle keyboard shortcuts in replace input
  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          editor?.commands.replaceAll();
        } else {
          editor?.commands.replaceCurrent();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        editor?.commands.closeFind();
        editor?.commands.focus();
      } else if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    },
    [editor]
  );

  // Handle close button
  const handleClose = useCallback(() => {
    editor?.commands.closeFind();
    editor?.commands.focus();
  }, [editor]);

  // Handle find next
  const handleFindNext = useCallback(() => {
    editor?.commands.findNext();
  }, [editor]);

  // Handle find previous
  const handleFindPrevious = useCallback(() => {
    editor?.commands.findPrevious();
  }, [editor]);

  // Handle replace current
  const handleReplaceCurrent = useCallback(() => {
    editor?.commands.replaceCurrent();
  }, [editor]);

  // Handle replace all
  const handleReplaceAll = useCallback(() => {
    editor?.commands.replaceAll();
  }, [editor]);

  // Handle toggle case sensitivity
  const handleToggleCaseSensitive = useCallback(() => {
    editor?.commands.toggleCaseSensitive();
  }, [editor]);

  // Don't render if not open or no editor
  if (!editor || !state?.isOpen) {
    return null;
  }

  const matchCount = state.matches.length;
  const currentIndex = state.currentIndex;
  const hasMatches = matchCount > 0;
  const caseSensitive = state.options.caseSensitive;

  return (
    <div
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg transition-[top,right] duration-200"
      style={{
        top: `${topPosition}px`,
        right: `${rightPosition}px`,
        fontFamily: "var(--font-courier-prime), 'Courier New', monospace",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
        }
      }}
    >
      {/* Compact layout with both fields */}
      <div className="p-2 space-y-1.5">
        {/* Find row */}
        <div className="flex items-center gap-1">
          <div className="relative" style={{ width: '130px' }}>
            <input
              ref={searchInputRef}
              type="text"
              value={localQuery}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              placeholder="Find"
              className="w-full pl-2 pr-12 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              style={{ fontFamily: 'inherit' }}
            />
            {localQuery && (
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">
                {hasMatches ? `${currentIndex + 1}/${matchCount}` : '0/0'}
              </span>
            )}
          </div>

          {/* Nav buttons */}
          <button
            onClick={handleFindPrevious}
            disabled={!hasMatches}
            className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded disabled:opacity-30"
            title="Previous (Shift+Enter)"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleFindNext}
            disabled={!hasMatches}
            className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded disabled:opacity-30"
            title="Next (Enter)"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {/* Case toggle */}
          <button
            onClick={handleToggleCaseSensitive}
            className={`p-1 rounded ${
              caseSensitive
                ? 'bg-blue-100 text-blue-600'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            }`}
            title="Match case"
          >
            <ALargeSmall className="w-3.5 h-3.5" />
          </button>

          {/* Close */}
          <button
            onClick={handleClose}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            title="Close (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Replace row */}
        <div className="flex items-center gap-1">
          <input
            ref={replaceInputRef}
            type="text"
            value={localReplaceText}
            onChange={handleReplaceChange}
            onKeyDown={handleReplaceKeyDown}
            placeholder="Replace"
            className="pl-2 pr-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            style={{ fontFamily: 'inherit', width: '130px' }}
          />
          <button
            onClick={handleReplaceCurrent}
            disabled={!hasMatches || currentIndex < 0}
            className="px-1.5 py-1 text-[11px] text-gray-600 hover:text-gray-800 hover:bg-gray-100 border border-gray-200 rounded disabled:opacity-30"
            title="Replace (Enter in replace field)"
          >
            Replace
          </button>
          <button
            onClick={handleReplaceAll}
            disabled={!hasMatches}
            className="px-1.5 py-1 text-[11px] text-gray-600 hover:text-gray-800 hover:bg-gray-100 border border-gray-200 rounded disabled:opacity-30"
            title="Replace All (Shift+Enter)"
          >
            All
          </button>
        </div>
      </div>
    </div>
  );
}

export default FindReplacePopup;
