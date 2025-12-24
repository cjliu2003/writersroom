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
  isTopBarCollapsed?: boolean;
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
  isTopBarCollapsed = false,
}: SceneNavBarProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);
  const [hoveredScene, setHoveredScene] = useState<{ heading: string; x: number; bottom: number } | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousSceneCountRef = useRef(0);

  // Reset scroll to beginning when scenes are first loaded (e.g., after FDX upload)
  useEffect(() => {
    if (scrollContainerRef.current && scenes.length > 0) {
      // If scenes just appeared (went from 0 to some), scroll to beginning
      if (previousSceneCountRef.current === 0) {
        scrollContainerRef.current.scrollLeft = 0;
      }
      previousSceneCountRef.current = scenes.length;
    }
  }, [scenes.length]);

  // Auto-scroll to keep active scene visible when currentSceneIndex changes
  useEffect(() => {
    if (activeItemRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const activeItem = activeItemRef.current;

      const containerRect = container.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();

      // Scroll if item is outside visible area
      const isOutsideView = itemRect.left < containerRect.left || itemRect.right > containerRect.right;
      if (isOutsideView) {
        activeItem.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center'
        });
      }
    }
  }, [currentSceneIndex]);

  // Handler for scene click
  const handleSceneClick = (index: number) => {
    onSceneClick(index);
  };

  return (
    <div
      className="w-full bg-white border-b border-gray-200 shadow-sm overflow-visible"
      style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}
    >
      <div className="relative flex items-center h-11 overflow-visible">
        {/* Left fade indicator - sized for top bar collapse arrow when collapsed */}
        <div className={`absolute left-0 top-0 bottom-0 bg-gradient-to-r from-white to-transparent pointer-events-none z-10 ${isTopBarCollapsed ? 'w-12' : 'w-3'}`} />

        {/* Scrollable scene container */}
        <div
          ref={scrollContainerRef}
          className={`flex-1 overflow-x-auto scene-nav-scrollbar ${isTopBarCollapsed ? 'pl-12' : 'pl-3'}`}
          style={{
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
          <div className="flex items-center gap-2 py-2 w-max">
            {scenes.length === 0 ? (
              <div className="text-xs text-gray-400 italic px-2">
                No scenes yet — start with a scene heading like INT. LOCATION - DAY
              </div>
            ) : (
              <>
                {scenes.map((scene, index) => {
                  const isActive = currentSceneIndex === index;
                  const fullHeading = scene.heading || 'UNTITLED';

                  return (
                    <button
                      key={`scene-${index}-${scene.startIndex}`}
                      ref={isActive ? activeItemRef : null}
                      onClick={() => handleSceneClick(index)}
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
                        {truncateHeading(scene.heading).toUpperCase()}
                      </span>
                    </button>
                  );
                })}
                {/* Spacer to ensure last scene is fully visible past the collapse arrow */}
                <div className="flex-shrink-0 w-10" aria-hidden="true" />
              </>
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
          {hoveredScene.heading.toUpperCase()}
          {/* Tooltip arrow pointing up */}
          <div className="absolute left-1/2 -translate-x-1/2 -top-1.5 w-2.5 h-2.5 bg-white border-l border-t border-gray-200 rotate-45" />
        </div>
      )}

      {/* Subtle scrollbar styling */}
      <style jsx>{`
        .scene-nav-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(0, 0, 0, 0.15) transparent;
        }
        .scene-nav-scrollbar::-webkit-scrollbar {
          height: 4px;
        }
        .scene-nav-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .scene-nav-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(0, 0, 0, 0.12);
          border-radius: 4px;
        }
        .scene-nav-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(0, 0, 0, 0.25);
        }
      `}</style>
    </div>
  );
}
