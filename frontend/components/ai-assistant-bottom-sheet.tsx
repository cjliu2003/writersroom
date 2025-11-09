"use client"

import React, { useState, useRef, useEffect } from 'react';
import { motion, useSpring, useMotionValue } from 'framer-motion';
import { AIChatbot } from '@/components/ai-chatbot';
import { ChevronDown, MessageCircle } from 'lucide-react';

interface AIAssistantBottomSheetProps {
  isOpen: boolean;
  onToggle: () => void;
  projectId?: string;
}

export function AIAssistantBottomSheet({
  isOpen,
  onToggle,
  projectId,
}: AIAssistantBottomSheetProps) {
  const [height, setHeight] = useState(28); // 28% of viewport default
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(28);
  const heightMotion = useMotionValue(28);
  const springHeight = useSpring(heightMotion, { damping: 20, stiffness: 300 });

  // Handle drag to resize with spring-like behavior
  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = height;
  };

  // Handle dragging with smooth fluid physics
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = dragStartY.current - e.clientY;
      const viewportHeight = window.innerHeight;
      const deltaPercent = (deltaY / viewportHeight) * 100;
      const newHeight = Math.max(20, Math.min(50, dragStartHeight.current + deltaPercent));
      setHeight(newHeight);
      heightMotion.set(newHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      // No snapping - let it stay where user released it
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, heightMotion]);

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

  return (
    <>
      {/* Collapsible Sheet - Header always visible */}
      <motion.div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 z-[9999]"
        style={{
          width: '100%',
          maxWidth: '1200px',
          height: isOpen ? `${height}vh` : '36px',
          background: 'rgba(252, 252, 252, 0.97)',
          backdropFilter: 'blur(12px)',
          borderTopLeftRadius: '12px',
          borderTopRightRadius: '12px',
          border: '1px solid rgba(0, 0, 0, 0.08)',
          borderBottom: 'none',
          boxShadow: '0 -8px 24px rgba(0, 0, 0, 0.12)',
        }}
        initial={{ y: '100%', opacity: 0 }}
        animate={{
          y: 0,
          opacity: 1,
          height: isOpen ? `${height}vh` : '36px'
        }}
        transition={{
          duration: 0.25,
          ease: [0.25, 0.8, 0.25, 1],
        }}
      >
        {/* Draggable Header - Entire header is draggable (only when open) */}
        <div
          className={`relative flex items-center justify-between px-4 py-1.5 border-b ${isOpen ? 'cursor-ns-resize' : ''}`}
          style={{
            height: '36px',
            borderColor: 'rgba(0, 0, 0, 0.06)',
          }}
          onMouseDown={isOpen ? handleDragStart : undefined}
        >

          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-gray-700" />
            <h3
              className="text-sm font-semibold"
              style={{
                fontFamily: "'Courier New', 'Courier', monospace",
                color: '#222',
                letterSpacing: '0.02em',
              }}
            >
              AI ASSISTANT
            </h3>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-black/5 transition-colors text-gray-600 hover:text-gray-800 text-xs cursor-pointer"
            style={{ fontFamily: "'Courier New', 'Courier', monospace" }}
          >
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronDown className="w-4 h-4 rotate-180" />}
            <span>{isOpen ? 'Close' : 'Open'}</span>
          </button>
        </div>

        {/* Chat Content - only render when open */}
        {isOpen && (
          <div className="h-[calc(100%-36px)] overflow-hidden">
            <AIChatbot projectId={projectId} isVisible={true} light={true} />
          </div>
        )}
      </motion.div>

      {/* Drag Cursor Override */}
      {isDragging && (
        <style jsx global>{`
          * {
            cursor: ns-resize !important;
          }
        `}</style>
      )}
    </>
  );
}
