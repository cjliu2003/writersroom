"use client"

import React from 'react'
import { type TopicModeOverride } from '@/lib/api'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

interface TopicModeToggleProps {
  value: TopicModeOverride | undefined
  onChange: (value: TopicModeOverride | undefined) => void
  disabled?: boolean
}

type ModeOption = {
  id: TopicModeOverride | undefined
  label: string
  tooltip: string
}

const MODE_OPTIONS: ModeOption[] = [
  {
    id: undefined,
    label: 'Auto',
    tooltip: "We'll decide based on your message."
  },
  {
    id: 'continue',
    label: 'Continue',
    tooltip: 'Use earlier context.'
  },
  {
    id: 'new_topic',
    label: 'New topic',
    tooltip: 'Start fresh.'
  }
]

/**
 * Topic Mode Toggle for AI Chat
 *
 * A segmented 3-way toggle (pill group) for controlling conversation context.
 *
 * Design principles:
 * - All options visible at once for discoverability
 * - Text-first (no icons) for clarity with non-technical writers
 * - Subtle styling: ghost unselected, soft fill selected
 * - Instant tooltips via Radix UI
 */
export function TopicModeToggle({ value, onChange, disabled = false }: TopicModeToggleProps) {
  return (
    <div
      className={`
        inline-flex rounded-lg border border-gray-200/80 bg-gray-50/50 p-0.5
        ${disabled ? 'opacity-50' : ''}
      `}
    >
      {MODE_OPTIONS.map((option) => {
        const isSelected = value === option.id
        return (
          <Tooltip key={option.label}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => !disabled && onChange(option.id)}
                disabled={disabled}
                className={`
                  px-2.5 py-1 text-[9px] font-medium rounded-md
                  transition-all duration-150 ease-in-out
                  ${isSelected
                    ? 'bg-white text-gray-700 shadow-sm border border-gray-200/60'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'
                  }
                  ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                {option.label}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {option.tooltip}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
