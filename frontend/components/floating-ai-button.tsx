"use client"

import React from 'react';
import { Sparkles } from 'lucide-react';

interface FloatingAIButtonProps {
  onClick: () => void;
  isOpen: boolean;
}

export function FloatingAIButton({ onClick, isOpen }: FloatingAIButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`
        fixed bottom-6 right-6 z-50
        w-12 h-12 rounded-full
        flex items-center justify-center
        shadow-lg hover:shadow-xl
        transition-all duration-200 ease-out
        ${isOpen
          ? 'bg-purple-700 ring-2 ring-purple-300 ring-offset-2'
          : 'bg-purple-600 hover:bg-purple-700'
        }
      `}
      title="AI Assistant"
      aria-label={isOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
    >
      <Sparkles
        className={`w-5 h-5 text-white ${isOpen ? '' : 'hover:scale-110'} transition-transform`}
      />
    </button>
  );
}
