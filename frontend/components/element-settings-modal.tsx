"use client"

import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScreenplayBlockType } from '@/types/screenplay'

interface ElementSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  currentBlockType: ScreenplayBlockType | null
  onBlockTypeChange?: (type: ScreenplayBlockType) => void
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

export function ElementSettingsModal({ 
  isOpen, 
  onClose, 
  currentBlockType,
  onBlockTypeChange 
}: ElementSettingsModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Element Settings</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-2">Current Element Type</h4>
            <p className="text-sm text-gray-600">
              {currentBlockType ? BLOCK_TYPE_LABELS[currentBlockType] : 'None'}
            </p>
          </div>
          
          <div>
            <h4 className="text-sm font-medium mb-2">Change Element Type</h4>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(BLOCK_TYPE_LABELS).map(([type, label]) => (
                <Button
                  key={type}
                  variant={currentBlockType === type ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    onBlockTypeChange?.(type as ScreenplayBlockType)
                    onClose()
                  }}
                  className="justify-start text-xs"
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          
          <div className="text-xs text-gray-500 space-y-1">
            <p><strong>Keyboard Shortcuts:</strong></p>
            <div className="grid grid-cols-2 gap-1 text-xs">
              <span>⌘+1 Scene Heading</span>
              <span>⌘+2 Action</span>
              <span>⌘+3 Character</span>
              <span>⌘+4 Parenthetical</span>
              <span>⌘+5 Dialogue</span>
              <span>⌘+6 Transition</span>
              <span>⌘+7 Shot</span>
              <span>⌘+8 Cast List</span>
              <span>⌘+9 New Act</span>
              <span>⌘+0 General</span>
            </div>
          </div>
        </div>
        
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}