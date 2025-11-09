"use client"

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AIChatbot } from '@/components/ai-chatbot';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { MessageCircle, X, Sparkles } from 'lucide-react';

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
  return (
    <>
      {/* Bottom Sheet Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl border-t border-gray-200"
            style={{ height: '35vh', minHeight: '300px', maxHeight: '500px' }}
          >
            {/* Handle bar for visual affordance */}
            <div className="flex justify-center pt-2 pb-1 cursor-pointer" onClick={onToggle}>
              <div className="w-12 h-1 bg-gray-300 rounded-full" />
            </div>

            {/* Chat Component */}
            <div className="h-[calc(100%-16px)] overflow-hidden">
              <AIChatbot projectId={projectId} isVisible={true} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle Tab - Bottom center, comes off the floor */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.button
              onClick={onToggle}
              className={`
                fixed bottom-0 left-1/2 -translate-x-1/2 z-40
                px-6 py-2 rounded-t-lg shadow-lg
                transition-all duration-200
                ${isOpen
                  ? 'bg-white border-t border-x border-gray-200 text-gray-700'
                  : 'bg-gradient-to-br from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white hover:py-3'
                }
              `}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.95 }}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {isOpen ? 'Close AI Assistant' : 'AI Assistant'}
                </span>
              </div>
            </motion.button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{isOpen ? 'Close AI Assistant' : 'Get AI help with your screenplay'}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  );
}
