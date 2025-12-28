"use client"

import React, { useState } from 'react'
import { Pencil, Undo2, Redo2, MousePointer2, Scissors, Copy, Clipboard, Search, Bold, Italic, Underline, LucideIcon } from 'lucide-react'
import { Editor } from '@tiptap/react'
import { yUndoPluginKey } from 'y-prosemirror'
import { getDualDialogueState, toggleDualDialogue } from '@/extensions/screenplay/dual-dialogue'

/**
 * Dual Dialogue icon - two speech bubbles side by side
 */
function DualDialogueIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4h6a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6l-2 2v-2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M14 10h6a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1v2l-2-2h-3a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z" />
    </svg>
  )
}

interface EditMenuDropdownProps {
  editor: Editor | null
}

export function EditMenuDropdown({ editor }: EditMenuDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Check undo/redo availability from Yjs UndoManager (not ProseMirror history plugin)
  // When using TipTap Collaboration extension, undo/redo is managed by y-prosemirror's UndoManager
  const undoManager = editor ? yUndoPluginKey.getState(editor.state)?.undoManager : null
  const canUndo = undoManager ? undoManager.undoStack.length > 0 : false
  const canRedo = undoManager ? undoManager.redoStack.length > 0 : false

  // Check if there's a text selection for cut/copy
  const hasSelection = editor ? !editor.state.selection.empty : false

  // Check dual dialogue state
  const dualDialogueState = editor ? getDualDialogueState(editor) : { canToggle: false, isInsideBlock: false }

  const menuItems = [
    {
      label: 'Undo',
      icon: Undo2,
      shortcut: '⌘Z',
      action: () => editor?.commands.undo(),
      disabled: !editor || !canUndo,
    },
    {
      label: 'Redo',
      icon: Redo2,
      shortcut: '⇧⌘Z',
      action: () => editor?.commands.redo(),
      disabled: !editor || !canRedo,
    },
    { type: 'separator' as const },
    {
      label: 'Cut',
      icon: Scissors,
      shortcut: '⌘X',
      action: () => {
        document.execCommand('cut')
      },
      disabled: !editor || !hasSelection,
    },
    {
      label: 'Copy',
      icon: Copy,
      shortcut: '⌘C',
      action: () => {
        document.execCommand('copy')
      },
      disabled: !editor || !hasSelection,
    },
    {
      label: 'Paste',
      icon: Clipboard,
      shortcut: '⌘V',
      action: () => {
        navigator.clipboard.readText().then(text => {
          editor?.commands.insertContent(text)
        }).catch(() => {
          // Fallback if clipboard API fails
          document.execCommand('paste')
        })
      },
      disabled: !editor,
    },
    { type: 'separator' as const },
    {
      label: 'Select All',
      icon: MousePointer2,
      shortcut: '⌘A',
      action: () => {
        editor?.commands.focus()
        editor?.commands.selectAll()
      },
      disabled: !editor,
    },
    { type: 'separator' as const },
    {
      label: 'Bold',
      icon: Bold,
      shortcut: '⌘B',
      action: () => editor?.chain().focus().toggleBold().run(),
      disabled: !editor || !hasSelection,
    },
    {
      label: 'Italic',
      icon: Italic,
      shortcut: '⌘I',
      action: () => editor?.chain().focus().toggleItalic().run(),
      disabled: !editor || !hasSelection,
    },
    {
      label: 'Underline',
      icon: Underline,
      shortcut: '⌘U',
      action: () => editor?.chain().focus().toggleUnderline().run(),
      disabled: !editor || !hasSelection,
    },
    { type: 'separator' as const },
    {
      label: dualDialogueState.isInsideBlock ? 'Exit Dual Dialogue' : 'Dual Dialogue',
      icon: DualDialogueIcon,
      shortcut: '⌘D',
      action: () => editor && toggleDualDialogue(editor),
      disabled: !editor || !dualDialogueState.canToggle,
    },
    { type: 'separator' as const },
    {
      label: 'Find & Replace',
      icon: Search,
      shortcut: '⌘F',
      action: () => {
        editor?.commands.openFind()
      },
      disabled: !editor,
    },
  ]

  const handleItemClick = (action: () => void) => {
    action()
    setIsOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2.5 py-1 text-sm font-normal rounded transition-colors ${
          isOpen
            ? 'text-gray-900 bg-gray-100'
            : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
        }`}
        style={{ fontFamily: "inherit" }}
      >
        <Pencil className="w-3.5 h-3.5" />
        Edit
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
            className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1"
            style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}
          >
            {menuItems.map((item, index) => {
              if ('type' in item && item.type === 'separator') {
                return <div key={index} className="my-1 border-t border-gray-200" />
              }

              const Icon = item.icon
              return (
                <button
                  key={index}
                  onClick={() => handleItemClick(item.action)}
                  disabled={item.disabled}
                  className={`w-full px-3 py-1.5 text-left text-sm flex items-center justify-between ${
                    item.disabled
                      ? 'text-gray-300 cursor-not-allowed'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5" />
                    {item.label}
                  </span>
                  <span className="text-xs text-gray-400">{item.shortcut}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
