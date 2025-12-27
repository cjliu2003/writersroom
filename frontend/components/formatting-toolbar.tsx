"use client"

import React from 'react'
import { Bold, Italic, Underline } from 'lucide-react'
import { Editor } from '@tiptap/react'

interface FormattingToolbarProps {
  editor: Editor | null
  className?: string
}

export function FormattingToolbar({ editor, className = '' }: FormattingToolbarProps) {
  if (!editor) return null

  const buttons = [
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
  ]

  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      {buttons.map((button) => {
        const Icon = button.icon
        return (
          <button
            key={button.label}
            onClick={button.action}
            title={`${button.label} (${button.shortcut})`}
            className={`
              flex items-center justify-center w-7 h-7 rounded transition-colors
              ${button.isActive
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
