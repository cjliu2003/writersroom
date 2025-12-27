"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { Editor } from '@tiptap/react'
import { ChevronDown } from 'lucide-react'

interface TipTapBlockTypeDropdownProps {
  editor: Editor | null
  className?: string
}

// TipTap node names (camelCase)
type TipTapBlockType =
  | 'sceneHeading'
  | 'action'
  | 'character'
  | 'dialogue'
  | 'parenthetical'
  | 'transition'

const BLOCK_TYPE_LABELS: Record<TipTapBlockType, string> = {
  'sceneHeading': 'Scene Heading',
  'action': 'Action',
  'character': 'Character',
  'dialogue': 'Dialogue',
  'parenthetical': 'Parenthetical',
  'transition': 'Transition',
}

// Display order for dropdown
const BLOCK_TYPE_ORDER: TipTapBlockType[] = [
  'sceneHeading',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
]

const SHORTCUT_KEYS: Record<TipTapBlockType, string> = {
  'sceneHeading': '⌥⌘1',
  'action': '⌥⌘2',
  'character': '⌥⌘3',
  'dialogue': '⌥⌘4',
  'parenthetical': '⌥⌘5',
  'transition': '⌥⌘6',
}

export function TipTapBlockTypeDropdown({ editor, className = '' }: TipTapBlockTypeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [currentType, setCurrentType] = useState<TipTapBlockType | null>(null)

  // Get current block type from editor selection
  const updateCurrentType = useCallback(() => {
    if (!editor) {
      setCurrentType(null)
      return
    }

    const { $from } = editor.state.selection
    const node = $from.parent
    const typeName = node.type.name as TipTapBlockType

    // Check if it's one of our screenplay types
    if (BLOCK_TYPE_ORDER.includes(typeName)) {
      setCurrentType(typeName)
    } else {
      // Default to action for paragraph or unknown types
      setCurrentType('action')
    }
  }, [editor])

  // Update on editor changes
  useEffect(() => {
    if (!editor) return

    // Initial update
    updateCurrentType()

    // Listen for selection changes
    editor.on('selectionUpdate', updateCurrentType)
    editor.on('update', updateCurrentType)

    return () => {
      editor.off('selectionUpdate', updateCurrentType)
      editor.off('update', updateCurrentType)
    }
  }, [editor, updateCurrentType])

  // Handle block type change
  const handleTypeChange = useCallback((type: TipTapBlockType) => {
    if (!editor) return

    const { $from } = editor.state.selection
    const currentNode = $from.parent
    const currentType = currentNode.type.name

    // When leaving parenthetical, strip the parentheses first
    if (currentType === 'parenthetical' && type !== 'parenthetical') {
      const textContent = currentNode.textContent
      const hasParens = textContent.startsWith('(') && textContent.endsWith(')')
      if (hasParens && textContent.length > 2) {
        // Strip parentheses and set new type
        const innerContent = textContent.slice(1, -1)
        editor.chain()
          .focus()
          .command(({ tr, state, dispatch }) => {
            const range = state.selection.$from.blockRange()
            if (!range) return false
            // Delete all content
            tr.delete(range.start + 1, range.end - 1)
            // Insert content without parens
            tr.insertText(innerContent, range.start + 1)
            if (dispatch) dispatch(tr)
            return true
          })
          .setNode(type)
          .run()
        setIsOpen(false)
        return
      }
    }

    // Use the appropriate command for each type
    switch (type) {
      case 'sceneHeading':
        editor.chain().focus().setNode('sceneHeading').run()
        break
      case 'action':
        editor.chain().focus().setNode('action').run()
        break
      case 'character':
        editor.chain().focus().setNode('character').run()
        break
      case 'dialogue':
        editor.chain().focus().setNode('dialogue').run()
        break
      case 'parenthetical':
        // Parenthetical has a special command that adds ()
        editor.chain().focus().setParenthetical().run()
        break
      case 'transition':
        editor.chain().focus().setNode('transition').run()
        break
    }

    setIsOpen(false)
  }, [editor])

  if (!editor) return null

  const currentLabel = currentType ? BLOCK_TYPE_LABELS[currentType] : 'Action'

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors min-w-[130px]"
        style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}
      >
        <span className="flex-1 text-left font-normal">{currentLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown Menu */}
          <div
            className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden"
            style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}
          >
            <div className="py-1">
              {BLOCK_TYPE_ORDER.map((type) => (
                <button
                  key={type}
                  onClick={() => handleTypeChange(type)}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center justify-between transition-colors ${
                    currentType === type
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700'
                  }`}
                >
                  <span className="font-normal">{BLOCK_TYPE_LABELS[type]}</span>
                  <span className="text-[10px] text-gray-400 tracking-wider">
                    {SHORTCUT_KEYS[type]}
                  </span>
                </button>
              ))}
            </div>

            {/* Separator */}
            <div className="border-t border-gray-100" />

            {/* Help text */}
            <div className="px-3 py-2 text-[10px] text-gray-400 bg-gray-50/50">
              <span className="tracking-wide">Tab cycles (empty blocks) • Enter for smart transition</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
