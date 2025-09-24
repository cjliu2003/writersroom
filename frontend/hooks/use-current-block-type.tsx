"use client"

import { useEffect, useState } from 'react'
import { Editor } from 'slate'
import { useSlate } from 'slate-react'
import { ScreenplayBlockType, ScreenplayElement } from '@/types/screenplay'
import { getCurrentBlockType, isScreenplayElement } from '@/utils/screenplay-utils'

export function useCurrentBlockType(): ScreenplayBlockType | null {
  const editor = useSlate()
  const [currentType, setCurrentType] = useState<ScreenplayBlockType | null>(null)
  
  useEffect(() => {
    const updateCurrentType = () => {
      const type = getCurrentBlockType(editor)
      setCurrentType(type)
    }
    
    // Update on selection change
    updateCurrentType()
    
    // Listen for selection changes
    const handleSelectionChange = () => {
      // Debounce to avoid excessive updates
      setTimeout(updateCurrentType, 10)
    }
    
    // Listen for editor changes that might affect block type
    document.addEventListener('selectionchange', handleSelectionChange)
    
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [editor])
  
  // Also update when editor value changes
  useEffect(() => {
    const type = getCurrentBlockType(editor)
    setCurrentType(type)
  }, [editor.children, editor.selection])
  
  return currentType
}

// Hook to get additional block information
export function useCurrentBlockInfo() {
  const editor = useSlate()
  const currentType = useCurrentBlockType()
  const [blockInfo, setBlockInfo] = useState<{
    type: ScreenplayBlockType | null
    isEmpty: boolean
    isDualDialogue: boolean
    text: string
  }>({
    type: null,
    isEmpty: false,
    isDualDialogue: false,
    text: ''
  })
  
  useEffect(() => {
    const { selection } = editor
    if (!selection) return
    
    const [match] = Editor.nodes(editor, {
      match: n => isScreenplayElement(n)
    })
    
    if (match) {
      const [node] = match
      const element = node as ScreenplayElement
      const text = Editor.string(editor, [])
      
      setBlockInfo({
        type: element.type,
        isEmpty: text.trim() === '',
        isDualDialogue: element.isDualDialogue || false,
        text
      })
    }
  }, [editor, editor.selection, editor.children])
  
  return blockInfo
}