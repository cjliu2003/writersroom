"use client";

/**
 * SmartType Popup Component
 *
 * Renders autocomplete suggestions for character names, locations, and scene heading prefixes.
 * Positioned relative to cursor in the editor.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Editor } from '@tiptap/react';
import { SmartTypePluginKey, SmartTypeState } from './smart-type-extension';

interface SmartTypePopupProps {
  editor: Editor | null;
}

interface PopupPosition {
  left: number;
  top: number;
}

export function SmartTypePopup({ editor }: SmartTypePopupProps) {
  const [state, setState] = useState<SmartTypeState | null>(null);
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Subscribe to SmartType plugin state changes
  useEffect(() => {
    if (!editor) return;

    const updateState = () => {
      const pluginState = SmartTypePluginKey.getState(editor.state);
      setState(pluginState || null);

      // Calculate position from cursor
      if (pluginState?.active) {
        try {
          const { from } = editor.state.selection;
          const coords = editor.view.coordsAtPos(from);

          // Get the editor container's position for relative positioning
          const editorRect = editor.view.dom.getBoundingClientRect();

          setPosition({
            left: coords.left - editorRect.left,
            top: coords.bottom - editorRect.top + 4, // 4px gap below cursor
          });
        } catch {
          setPosition(null);
        }
      } else {
        setPosition(null);
      }
    };

    // Initial state
    updateState();

    // Listen for state changes
    editor.on('transaction', updateState);
    editor.on('selectionUpdate', updateState);

    return () => {
      editor.off('transaction', updateState);
      editor.off('selectionUpdate', updateState);
    };
  }, [editor]);

  // Handle suggestion click
  const handleSuggestionClick = useCallback(
    (suggestion: string, type: SmartTypeState['type'], e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (editor && type) {
        editor.commands.insertSmartTypeSuggestion(suggestion, type);
        editor.commands.focus();
      }
    },
    [editor]
  );

  // Don't render if not active or no editor
  if (!editor || !state?.active || !position || state.suggestions.length === 0) {
    return null;
  }

  // Get label based on type
  const getTypeLabel = () => {
    switch (state.type) {
      case 'character':
        return 'Characters';
      case 'location':
        return 'Locations';
      case 'prefix':
        return 'Scene Heading';
      case 'time':
        return 'Time of Day';
      default:
        return 'Suggestions';
    }
  };

  return (
    <div
      ref={popupRef}
      className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        minWidth: '200px',
        maxWidth: '300px',
        fontFamily: "var(--font-courier-prime), 'Courier New', monospace",
      }}
      // Prevent click from stealing focus
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
          {getTypeLabel()}
        </span>
      </div>

      {/* Suggestions list */}
      <div className="py-1 max-h-[200px] overflow-y-auto">
        {state.suggestions.map((suggestion, index) => {
          const isSelected = index === state.selectedIndex;

          return (
            <button
              key={suggestion}
              className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                isSelected
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
              onClick={(e) => handleSuggestionClick(suggestion, state.type, e)}
              onMouseEnter={() => {
                // Update selected index on hover
                const tr = editor.state.tr.setMeta(SmartTypePluginKey, {
                  action: 'navigate',
                  selectedIndex: index,
                });
                editor.view.dispatch(tr);
              }}
            >
              <HighlightedText text={suggestion} query={state.query} />
            </button>
          );
        })}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100">
        <span className="text-[10px] text-gray-400">
          <kbd className="px-1 py-0.5 bg-gray-100 rounded text-[9px]">Tab</kbd>
          {' or '}
          <kbd className="px-1 py-0.5 bg-gray-100 rounded text-[9px]">Enter</kbd>
          {' to insert'}
          {' • '}
          <kbd className="px-1 py-0.5 bg-gray-100 rounded text-[9px]">Esc</kbd>
          {' to close'}
        </span>
      </div>
    </div>
  );
}

/**
 * Highlights matching portion of text
 */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query || query.length === 0) {
    return <span>{text}</span>;
  }

  const upperText = text.toUpperCase();
  const upperQuery = query.toUpperCase();

  if (!upperText.startsWith(upperQuery)) {
    return <span>{text}</span>;
  }

  const matchLength = query.length;

  return (
    <span>
      <span className="font-semibold">{text.slice(0, matchLength)}</span>
      <span className="text-gray-500">{text.slice(matchLength)}</span>
    </span>
  );
}

export default SmartTypePopup;
