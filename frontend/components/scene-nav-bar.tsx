"use client"

import React, { useRef, useEffect, useState } from 'react';
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
  const [hoveredScene, setHoveredScene] = useState<{ heading: string; x: number; bottom: number } | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
      className="w-full bg-white border-b border-gray-200 shadow-sm overflow-visible"
      style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}
    >
      <div className="relative flex items-center h-11 overflow-visible">
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
          onScroll={() => {
            // Mark as scrolling and hide tooltip
            isScrollingRef.current = true;
            setHoveredScene(null);

            // Clear any pending hover timeout
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current);
              hoverTimeoutRef.current = null;
            }

            // Reset scroll end detection timer
            if (scrollTimeoutRef.current) {
              clearTimeout(scrollTimeoutRef.current);
            }
            scrollTimeoutRef.current = setTimeout(() => {
              isScrollingRef.current = false;
            }, 150); // Consider scrolling stopped after 150ms of no scroll events
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
                const fullHeading = scene.heading || 'UNTITLED';

                return (
                  <button
                    key={`scene-${index}-${scene.startIndex}`}
                    ref={isActive ? activeItemRef : null}
                    onClick={() => onSceneClick(index)}
                    onMouseEnter={(e) => {
                      // Don't show tooltip while scrolling
                      if (isScrollingRef.current) return;

                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = rect.left + rect.width / 2;
                      const bottom = rect.bottom;
                      // Clear any existing timeout
                      if (hoverTimeoutRef.current) {
                        clearTimeout(hoverTimeoutRef.current);
                      }
                      // Delay tooltip appearance by 500ms
                      hoverTimeoutRef.current = setTimeout(() => {
                        // Double-check we're still not scrolling when timeout fires
                        if (!isScrollingRef.current) {
                          setHoveredScene({ heading: fullHeading, x, bottom });
                        }
                      }, 500);
                    }}
                    onMouseLeave={() => {
                      // Clear timeout if mouse leaves before delay completes
                      if (hoverTimeoutRef.current) {
                        clearTimeout(hoverTimeoutRef.current);
                        hoverTimeoutRef.current = null;
                      }
                      setHoveredScene(null);
                    }}
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

      {/* Floating tooltip - renders outside scroll container */}
      {hoveredScene && (
        <div
          className="fixed z-[200] px-3 py-2 bg-white text-gray-700 text-xs rounded-md shadow-lg border border-gray-200 whitespace-nowrap animate-in fade-in slide-in-from-top-1 duration-150"
          style={{
            top: hoveredScene.bottom + 6,
            left: hoveredScene.x,
            transform: 'translateX(-50%)',
            fontFamily: "var(--font-courier-prime), 'Courier New', monospace"
          }}
        >
          {hoveredScene.heading}
          {/* Tooltip arrow pointing up */}
          <div className="absolute left-1/2 -translate-x-1/2 -top-1.5 w-2.5 h-2.5 bg-white border-l border-t border-gray-200 rotate-45" />
        </div>
      )}

      {/* Hide scrollbar CSS */}
      <style jsx>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
