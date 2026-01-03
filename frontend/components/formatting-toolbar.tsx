"use client"

import React from 'react'
import { Bold, Italic, Underline, LucideIcon } from 'lucide-react'
import { Editor } from '@tiptap/react'
import { getDualDialogueState, toggleDualDialogue } from '@/extensions/screenplay/dual-dialogue'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'

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
  description: string
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
      description: 'Make selected text bold',
      icon: Bold,
      shortcut: '⌘B',
      isActive: editor.isActive('bold'),
      action: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      description: 'Make selected text italic',
      icon: Italic,
      shortcut: '⌘I',
      isActive: editor.isActive('italic'),
      action: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Underline',
      description: 'Underline selected text',
      icon: Underline,
      shortcut: '⌘U',
      isActive: editor.isActive('underline'),
      action: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: 'Dual Dialogue',
      description: 'Display two characters speaking simultaneously',
      icon: DualDialogueIcon,
      shortcut: '⌘D',
      isActive: dualDialogueState.isInsideBlock,
      isDisabled: !dualDialogueState.canToggle,
      disabledReason: dualDialogueState.reason,
      action: () => toggleDualDialogue(editor),
    },
  ]

  return (
    <TooltipProvider delayDuration={500}>
      <div className={`flex items-center gap-0.5 ${className}`}>
        {buttons.map((button) => {
          const Icon = button.icon
          const isDisabled = button.isDisabled ?? false

          // Build tooltip content
          const tooltipContent = isDisabled && button.disabledReason
            ? button.disabledReason
            : button.description

          return (
            <Tooltip key={button.label}>
              <TooltipTrigger asChild>
                <button
                  onClick={button.action}
                  disabled={isDisabled}
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
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                sideOffset={4}
                className="bg-white text-gray-700 shadow-md border border-gray-200 [&>svg]:hidden"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800">{button.label}</span>
                    <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-gray-100 text-gray-500 rounded border border-gray-200">
                      {button.shortcut}
                    </kbd>
                  </div>
                  <span className="text-[11px] text-gray-500">{tooltipContent}</span>
                </div>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
