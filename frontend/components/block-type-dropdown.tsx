"use client"

import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ScreenplayBlockType } from '@/types/screenplay'

interface BlockTypeDropdownProps {
  currentType: ScreenplayBlockType | null
  onTypeChange: (type: ScreenplayBlockType) => void
  className?: string
}

const BLOCK_TYPE_LABELS: Record<ScreenplayBlockType, string> = {
  'scene_heading': 'Scene Heading',
  'action': 'Action',
  'character': 'Character',
  'parenthetical': 'Parenthetical', 
  'dialogue': 'Dialogue',
  'transition': 'Transition',
  'shot': 'Shot',
  'general': 'General',
  'cast_list': 'Cast List',
  'new_act': 'New Act',
  'end_of_act': 'End of Act',
  'summary': 'Summary'
}

const SHORTCUT_KEYS: Record<ScreenplayBlockType, string> = {
  'scene_heading': '⌘1',
  'action': '⌘2', 
  'character': '⌘3',
  'parenthetical': '⌘4',
  'dialogue': '⌘5',
  'transition': '⌘6',
  'shot': '⌘7',
  'cast_list': '⌘8',
  'new_act': '⌘9',
  'end_of_act': '',
  'summary': '',
  'general': '⌘0'
}

export function BlockTypeDropdown({ currentType, onTypeChange, className = '' }: BlockTypeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  
  const currentLabel = currentType ? BLOCK_TYPE_LABELS[currentType] : 'Scene Heading'
  
  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 min-w-[140px]"
        style={{ fontFamily: '"Courier Prime", Courier, monospace' }}
      >
        <span className="flex-1 text-left">{currentLabel}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown Menu */}
          <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-md shadow-lg z-20 max-h-80 overflow-y-auto">
            <div className="py-1">
              {Object.entries(BLOCK_TYPE_LABELS).map(([type, label]) => (
                <button
                  key={type}
                  onClick={() => {
                    onTypeChange(type as ScreenplayBlockType)
                    setIsOpen(false)
                  }}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between ${
                    currentType === type ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                  }`}
                  style={{ fontFamily: '"Courier Prime", Courier, monospace' }}
                >
                  <span>{label}</span>
                  {SHORTCUT_KEYS[type as ScreenplayBlockType] && (
                    <span className="text-xs text-gray-400 ml-2">
                      {SHORTCUT_KEYS[type as ScreenplayBlockType]}
                    </span>
                  )}
                </button>
              ))}
            </div>
            
            {/* Separator */}
            <div className="border-t border-gray-100 my-1" />
            
            {/* Help text */}
            <div className="px-4 py-2 text-xs text-gray-500">
              <div className="mb-1">Keyboard shortcuts:</div>
              <div>⌘+E for settings • Tab/Enter for transitions</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}