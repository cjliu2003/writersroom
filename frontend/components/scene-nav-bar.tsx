"use client"

import React, { useRef, useEffect } from 'react';
import { ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SceneBoundary } from '@/utils/tiptap-scene-tracker';

interface SceneNavBarProps {
  scenes: SceneBoundary[];
  onSceneClick: (sceneIndex: number) => void;
  currentSceneIndex: number | null;
  onCollapse?: () => void;
}

/**
 * Truncate scene heading to fit in nav bar
 * Keeps INT./EXT. prefix and truncates location
 */
function truncateHeading(heading: string, maxLength: number = 36): string {
  if (!heading) return 'UNTITLED';
  if (heading.length <= maxLength) return heading;
  return heading.substring(0, maxLength - 1) + '…';
}

export function SceneNavBar({
  scenes,
  onSceneClick,
  currentSceneIndex,
  onCollapse,
}: SceneNavBarProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll to keep active scene visible
  useEffect(() => {
    if (activeItemRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const activeItem = activeItemRef.current;

      const containerRect = container.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();

      // Check if item is outside visible area
      if (itemRect.left < containerRect.left || itemRect.right > containerRect.right) {
        activeItem.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center'
        });
      }
    }
  }, [currentSceneIndex]);

  return (
    <div
      className="w-full bg-white border-b border-gray-200 shadow-sm"
      style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}
    >
      <div className="relative flex items-center h-11">
        {/* Left fade indicator - sized for top bar collapse arrow */}
        <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-white to-transparent pointer-events-none z-10" />

        {/* Scrollable scene container */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-x-auto scrollbar-hide pl-12 pr-12"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <div className="flex items-center gap-2 py-2">
            {scenes.length === 0 ? (
              <div className="text-xs text-gray-400 italic px-2">
                No scenes yet — start with a scene heading like INT. LOCATION - DAY
              </div>
            ) : (
              scenes.map((scene, index) => {
                const isActive = currentSceneIndex === index;
                return (
                  <button
                    key={`scene-${index}-${scene.startIndex}`}
                    ref={isActive ? activeItemRef : null}
                    onClick={() => onSceneClick(index)}
                    title={scene.heading || 'UNTITLED'}
                    className={`
                      flex items-center gap-1.5 px-3 py-1.5 rounded-md
                      text-xs whitespace-nowrap flex-shrink-0
                      transition-all duration-150 ease-out
                      ${isActive
                        ? 'bg-blue-50 text-blue-800 border border-blue-300 shadow-sm'
                        : 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                      }
                    `}
                  >
                    {/* Scene number badge */}
                    <span
                      className={`
                        flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold
                        ${isActive ? 'bg-blue-200 text-blue-800' : 'bg-blue-100 text-blue-700'}
                      `}
                    >
                      {index + 1}
                    </span>
                    {/* Scene heading */}
                    <span className="font-medium">
                      {truncateHeading(scene.heading)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right fade indicator - sized for scene nav collapse arrow */}
        <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-white to-transparent pointer-events-none z-10" />

        {/* Collapse button - right side (matches floating expand button style) */}
        {onCollapse && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCollapse}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-20 text-gray-400 hover:text-gray-600 hover:bg-white/80 rounded p-1 shadow-sm border border-gray-200 bg-white/60 backdrop-blur-sm"
            title="Collapse scene navigation"
          >
            <ChevronUp className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Hide scrollbar CSS */}
      <style jsx>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
