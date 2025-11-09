"use client"

import React, { useState, useRef, useEffect } from 'react';
import { motion, useSpring, useMotionValue } from 'framer-motion';
import { AIChatbot } from '@/components/ai-chatbot';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, MessageCircle, MoveHorizontal } from 'lucide-react';

type ChatPosition = 'bottom' | 'left' | 'right';

interface AIAssistantBottomSheetProps {
  isOpen: boolean;
  onToggle: () => void;
  projectId?: string;
  onPositionChange?: (position: ChatPosition) => void;
  onWidthChange?: (width: number) => void;
}

export function AIAssistantBottomSheet({
  isOpen,
  onToggle,
  projectId,
  onPositionChange,
  onWidthChange,
}: AIAssistantBottomSheetProps) {
  const [position, setPosition] = useState<ChatPosition>('bottom');
  const [height, setHeight] = useState(35); // % of viewport for bottom mode
  const [sideWidth, setSideWidth] = useState(420); // pixels for side modes
  const [isDragging, setIsDragging] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const dragStartY = useRef(0);
  const dragStartX = useRef(0);
  const dragStartHeight = useRef(35);
  const dragStartWidth = useRef(420);

  // Check if we're on client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Initialize parent with current position on mount
  useEffect(() => {
    if (onPositionChange) {
      onPositionChange(position);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // Initialize with clean state
  useEffect(() => {
    localStorage.removeItem('ai-chat-layout');
    setPosition('bottom');
    setSideWidth(420);
    setHeight(35);
  }, []);

  // Notify parent of width changes - immediate, no delay
  useEffect(() => {
    if (!onWidthChange) return;

    if (isOpen && (position === 'left' || position === 'right')) {
      onWidthChange(sideWidth);
    } else {
      onWidthChange(0);
    }
  }, [sideWidth, isOpen, position, onWidthChange]);

  // Notify parent of position changes immediately
  useEffect(() => {
    if (onPositionChange) {
      onPositionChange(position);
    }
  }, [position, onPositionChange]);

  // Responsive: Force bottom mode on narrow screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1200 && position !== 'bottom') {
        setPosition('bottom');
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [position]);

  // Position toggle function
  const cyclePosition = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1200) return;

    const next = position === 'bottom' ? 'right' : position === 'right' ? 'left' : 'bottom';
    setPosition(next);
  };

  // Resize drag handlers
  const handleResizeDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartX.current = e.clientX;
    dragStartHeight.current = height;
    dragStartWidth.current = sideWidth;
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (position === 'bottom') {
        const deltaY = dragStartY.current - e.clientY;
        const viewportHeight = window.innerHeight;
        const deltaPercent = (deltaY / viewportHeight) * 100;
        const newHeight = Math.max(20, Math.min(80, dragStartHeight.current + deltaPercent));
        setHeight(newHeight);
      } else {
        const deltaX = position === 'left'
          ? e.clientX - dragStartX.current
          : dragStartX.current - e.clientX;
        const newWidth = Math.max(300, Math.min(800, dragStartWidth.current + deltaX));
        setSideWidth(newWidth);
        // Immediate callback during drag for smooth resize
        if (onWidthChange && isOpen) {
          onWidthChange(newWidth);
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, position]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onToggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onToggle]);

  // Get container styles based on position and open state
  const getContainerStyles = () => {
    const headerOffset = 116; // Height of CompactHeader + HorizontalSceneBar

    const baseStyles = {
      background: 'rgba(255, 255, 255, 0.98)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(0, 0, 0, 0.06)',
      zIndex: 40,
      transition: 'width 0.2s ease-out, height 0.2s ease-out',
      willChange: isOpen ? 'width, height' : 'auto',
    };

    if (position === 'bottom') {
      return {
        ...baseStyles,
        position: 'fixed' as const,
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: '1200px',
        height: isOpen ? `${height}vh` : '32px',
        borderTopLeftRadius: '8px',
        borderTopRightRadius: '8px',
        borderBottom: 'none',
        boxShadow: '0 -2px 8px rgba(0, 0, 0, 0.06), 0 -1px 2px rgba(0, 0, 0, 0.04)',
      };
    } else if (position === 'left') {
      return {
        ...baseStyles,
        position: 'fixed' as const,
        left: 0,
        top: `${headerOffset}px`,
        bottom: 0,
        width: isOpen ? `${sideWidth}px` : '36px',
        height: `calc(100vh - ${headerOffset}px)`,
        borderTopRightRadius: '8px',
        borderBottomRightRadius: '8px',
        borderLeft: 'none',
        boxShadow: '2px 0 8px rgba(0, 0, 0, 0.06), 1px 0 2px rgba(0, 0, 0, 0.04)',
      };
    } else { // right
      return {
        ...baseStyles,
        position: 'fixed' as const,
        right: 0,
        top: `${headerOffset}px`,
        bottom: 0,
        width: isOpen ? `${sideWidth}px` : '36px',
        height: `calc(100vh - ${headerOffset}px)`,
        borderTopLeftRadius: '8px',
        borderBottomLeftRadius: '8px',
        borderRight: 'none',
        boxShadow: '-2px 0 8px rgba(0, 0, 0, 0.06), -1px 0 2px rgba(0, 0, 0, 0.04)',
      };
    }
  };

  // Render collapsed tab for side modes
  const renderCollapsedSideTab = () => {
    if (position === 'bottom' || isOpen) return null;

    return (
      <div
        onClick={onToggle}
        className="h-full flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-all duration-200 group"
      >
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="p-1.5 rounded-md bg-gray-100 group-hover:bg-purple-50 transition-colors">
            <MessageCircle className="w-4 h-4 text-gray-600 group-hover:text-purple-400" />
          </div>
          <div
            style={{
              writingMode: position === 'left' ? 'vertical-rl' : 'vertical-lr',
              fontFamily: "'Courier New', 'Courier', monospace",
              fontSize: '10px',
              fontWeight: 600,
              color: '#666',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
            className="group-hover:text-purple-500 transition-colors"
          >
            AI Chat
          </div>
          {position === 'left' ? (
            <ChevronRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-purple-400 transition-colors" />
          ) : (
            <ChevronLeft className="w-3.5 h-3.5 text-gray-400 group-hover:text-purple-400 transition-colors" />
          )}
        </div>
      </div>
    );
  };

  // Render collapsed bar for bottom mode
  const renderCollapsedBottomBar = () => {
    if (position !== 'bottom' || isOpen) return null;

    return (
      <div
        onClick={onToggle}
        className="h-full flex items-center justify-between px-4 cursor-pointer hover:bg-gray-50 transition-all duration-200 group"
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1 rounded bg-gray-100 group-hover:bg-purple-50 transition-colors">
            <MessageCircle className="w-3.5 h-3.5 text-gray-600 group-hover:text-purple-400" />
          </div>
          <span
            style={{
              fontFamily: "'Courier New', 'Courier', monospace",
              fontSize: '11px',
              fontWeight: 600,
              color: '#666',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
            className="group-hover:text-purple-500 transition-colors"
          >
            AI Chat
          </span>
        </div>
        <ChevronUp className="w-3.5 h-3.5 text-gray-400 group-hover:text-purple-400 transition-colors" />
      </div>
    );
  };

  // Render expanded header
  const renderExpandedHeader = () => {
    if (!isOpen) return null;

    return (
      <div
        className="relative flex items-center justify-between px-4 py-2 border-b select-none bg-white/50"
        style={{
          height: '40px',
          borderColor: 'rgba(0, 0, 0, 0.06)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1 rounded bg-purple-50">
            <MessageCircle className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <h3
            className="text-xs font-semibold"
            style={{
              fontFamily: "'Courier New', 'Courier', monospace",
              color: '#444',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            AI Chat
          </h3>
        </div>

        <div className="flex items-center gap-1">
          {/* Position Toggle Button */}
          {isClient && window.innerWidth >= 1200 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                cyclePosition();
              }}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-purple-50 transition-colors text-gray-500 hover:text-purple-500 text-xs"
              style={{ fontFamily: "'Courier New', 'Courier', monospace" }}
              title="Change position"
            >
              <MoveHorizontal className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Close Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-700 text-xs"
            style={{ fontFamily: "'Courier New', 'Courier', monospace" }}
          >
            {position === 'bottom' ? (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span className="text-[10px] uppercase tracking-wide">Close</span>
              </>
            ) : position === 'left' ? (
              <>
                <ChevronLeft className="w-3.5 h-3.5" />
                <span className="text-[10px] uppercase tracking-wide">Close</span>
              </>
            ) : (
              <>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-[10px] uppercase tracking-wide">Close</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <motion.div
        className="z-[9999]"
        style={getContainerStyles()}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{
          duration: 0.2,
          ease: [0.25, 0.8, 0.25, 1],
        }}
      >
        {/* Resize Handle for Bottom Mode */}
        {isOpen && position === 'bottom' && (
          <div
            className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-purple-100/60 opacity-0 hover:opacity-100 transition-opacity z-10"
            onMouseDown={handleResizeDragStart}
          />
        )}

        {/* Resize Handle for Left Mode */}
        {isOpen && position === 'left' && (
          <div
            className="absolute top-0 bottom-0 right-0 w-1.5 cursor-ew-resize hover:bg-purple-100/60 opacity-0 hover:opacity-100 transition-opacity z-10"
            onMouseDown={handleResizeDragStart}
          />
        )}

        {/* Resize Handle for Right Mode */}
        {isOpen && position === 'right' && (
          <div
            className="absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize hover:bg-purple-100/60 opacity-0 hover:opacity-100 transition-opacity z-10"
            onMouseDown={handleResizeDragStart}
          />
        )}

        {/* Collapsed States */}
        {renderCollapsedBottomBar()}
        {renderCollapsedSideTab()}

        {/* Expanded State */}
        {isOpen && (
          <>
            {renderExpandedHeader()}
            <div className="h-[calc(100%-40px)] overflow-hidden bg-white">
              <AIChatbot projectId={projectId} isVisible={true} light={true} />
            </div>
          </>
        )}
      </motion.div>

      {/* Drag Cursor Override */}
      {isDragging && (
        <style jsx global>{`
          * {
            cursor: ${position === 'bottom' ? 'ns-resize' : 'ew-resize'} !important;
          }
        `}</style>
      )}
    </>
  );
}
