"use client"

import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import type { SceneBoundary } from '@/utils/scene-boundary-tracker';

interface HorizontalSceneBarProps {
  scenes: SceneBoundary[];
  currentSceneIndex: number | null;
  onSceneClick: (sceneIndex: number) => void;
  className?: string;
}

// Shared constants
const MAX_HEADING_LENGTH = 35;
const TRUNCATE_SUBSTRING_LENGTH = 32;
const BAR_CONTAINER_CLASSES = 'fixed left-0 right-0 top-12 z-40 bg-white/95 backdrop-blur-sm border-b border-gray-200';
const SCENE_BUTTON_CLASSES = 'flex items-center gap-2 px-3 py-2 rounded-md border transition-all duration-200 whitespace-nowrap text-sm font-medium flex-shrink-0 bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm';
const SCENE_NUMBER_BADGE_CLASSES = 'w-5 h-5 rounded flex items-center justify-center flex-shrink-0 text-xs font-semibold bg-blue-100 text-blue-600';

export function HorizontalSceneBar({
  scenes,
  currentSceneIndex,
  onSceneClick,
  className = '',
}: HorizontalSceneBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Memoized truncate heading function
  const truncateHeading = useCallback((heading: string): string => {
    const headingUppercase = heading.toUpperCase();
    return headingUppercase.length > MAX_HEADING_LENGTH
      ? `${headingUppercase.substring(0, TRUNCATE_SUBSTRING_LENGTH)}...`
      : headingUppercase;
  }, []);

  // Auto-scroll to active scene when it changes
  useEffect(() => {
    if (currentSceneIndex !== null && scrollRef.current) {
      const activeButton = scrollRef.current.querySelector(`[data-scene-index="${currentSceneIndex}"]`);
      if (activeButton) {
        activeButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [currentSceneIndex]);

  // Memoized scene buttons to prevent unnecessary re-renders
  const sceneButtons = useMemo(() => {
    return scenes.map((scene, index) => {
      const isActive = currentSceneIndex === index;
      const sceneNumber = index + 1;
      const truncatedHeading = truncateHeading(scene.heading);

      return (
        <button
          key={`scene-${index}-${scene.startIndex}`}
          data-scene-index={index}
          onClick={() => onSceneClick(index)}
          className={SCENE_BUTTON_CLASSES}
        >
          {/* Scene Number Badge */}
          <div className={SCENE_NUMBER_BADGE_CLASSES}>
            {sceneNumber}
          </div>

          {/* Scene Heading */}
          <span className="text-sm">
            {truncatedHeading}
          </span>
        </button>
      );
    });
  }, [scenes, currentSceneIndex, onSceneClick, truncateHeading]);

  if (scenes.length === 0) {
    return (
      <div className={`${BAR_CONTAINER_CLASSES} ${className}`}>
        <div className="px-4 py-3 flex items-center justify-center">
          <p className="text-xs text-gray-500 italic">
            Start writing with scene headings like: <code className="ml-2 bg-gray-100 px-2 py-1 rounded text-xs">INT. COFFEE SHOP - DAY</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style jsx>{`
        .scene-bar-scroll::-webkit-scrollbar {
          height: 6px;
        }
        .scene-bar-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .scene-bar-scroll::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 3px;
        }
        .scene-bar-scroll::-webkit-scrollbar-thumb:hover {
          background: #9ca3af;
        }
      `}</style>
      <div className={`${BAR_CONTAINER_CLASSES} shadow-sm ${className}`}>
        <div className="scene-bar-scroll overflow-x-auto overflow-y-hidden" style={{ scrollBehavior: 'smooth' }}>
          <div ref={scrollRef} className="flex items-center gap-2 px-3 py-2 min-w-max">
            {sceneButtons}
          </div>
        </div>

      {/* Scroll fade indicators for visual affordance */}
      {scenes.length > 3 && (
        <>
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white/95 to-transparent pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white/95 to-transparent pointer-events-none" />
        </>
      )}
      </div>
    </>
  );
}
