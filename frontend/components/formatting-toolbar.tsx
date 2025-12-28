"use client"

import React from 'react'
import { Bold, Italic, Underline, LucideIcon } from 'lucide-react'
import { Editor } from '@tiptap/react'
import { getDualDialogueState, toggleDualDialogue } from '@/extensions/screenplay/dual-dialogue'

/**
 * Dual Dialogue icon - two speech bubbles side by side
 */
function DualDialogueIcon({ className, strokeWidth = 2 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Left speech bubble */}
      <path d="M4 4h6a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6l-2 2v-2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      {/* Right speech bubble */}
      <path d="M14 10h6a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1v2l-2-2h-3a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z" />
    </svg>
  )
}

interface ToolbarButton {
  label: string
  icon: LucideIcon | React.FC<{ className?: string; strokeWidth?: number }>
  shortcut: string
  isActive: boolean
  isDisabled?: boolean
  disabledReason?: string
  action: () => void
}

interface FormattingToolbarProps {
  editor: Editor | null
  className?: string
}

export function FormattingToolbar({ editor, className = '' }: FormattingToolbarProps) {
  if (!editor) return null

  // Get dual dialogue state for button
  const dualDialogueState = getDualDialogueState(editor)

  const buttons: ToolbarButton[] = [
    {
      label: 'Bold',
      icon: Bold,
      shortcut: '⌘B',
      isActive: editor.isActive('bold'),
      action: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      icon: Italic,
      shortcut: '⌘I',
      isActive: editor.isActive('italic'),
      action: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Underline',
      icon: Underline,
      shortcut: '⌘U',
      isActive: editor.isActive('underline'),
      action: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: 'Dual Dialogue',
      icon: DualDialogueIcon,
      shortcut: '⌘D',
      isActive: dualDialogueState.isInsideBlock,
      isDisabled: !dualDialogueState.canToggle,
      disabledReason: dualDialogueState.reason,
      action: () => toggleDualDialogue(editor),
    },
  ]

  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      {buttons.map((button) => {
        const Icon = button.icon
        const isDisabled = button.isDisabled ?? false
        const title = isDisabled && button.disabledReason
          ? `${button.label}: ${button.disabledReason}`
          : `${button.label} (${button.shortcut})`

        return (
          <button
            key={button.label}
            onClick={button.action}
            disabled={isDisabled}
            title={title}
            className={`
              flex items-center justify-center w-7 h-7 rounded transition-colors
              ${isDisabled
                ? 'text-gray-300 cursor-not-allowed'
                : button.isActive
                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }
            `}
          >
            <Icon className="w-4 h-4" strokeWidth={button.isActive ? 2.5 : 2} />
          </button>
        )
      })}
    </div>
  )
}
