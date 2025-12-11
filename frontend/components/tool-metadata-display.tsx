"use client"

import React from 'react'
import { ToolCallMetadata } from '@/lib/api'
import { Wrench, CheckCircle2, Clock } from 'lucide-react'

interface ToolMetadataDisplayProps {
  metadata: ToolCallMetadata
  className?: string
}

/**
 * Component to display MCP tool usage metadata in a compact, informative way.
 *
 * Shows:
 * - Number of tool calling iterations
 * - Which tools were used
 * - Why the tool loop stopped (natural end vs iteration limit)
 */
export function ToolMetadataDisplay({ metadata, className = '' }: ToolMetadataDisplayProps) {
  const isNaturalStop = metadata.stop_reason === 'end_turn'

  return (
    <div className={`flex items-center gap-2 text-xs text-muted-foreground ${className}`}>
      <Wrench className="h-3 w-3" />
      <span className="font-medium">
        {metadata.tools_used.length === 0
          ? 'No tools used'
          : `Tools: ${metadata.tools_used.join(', ')}`
        }
      </span>

      {metadata.tool_calls_made > 0 && (
        <>
          <span className="text-muted-foreground/60">•</span>
          <span>
            {metadata.tool_calls_made} iteration{metadata.tool_calls_made > 1 ? 's' : ''}
          </span>
        </>
      )}

      <span className="text-muted-foreground/60">•</span>
      {isNaturalStop ? (
        <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-3 w-3" />
          Complete
        </span>
      ) : (
        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <Clock className="h-3 w-3" />
          Max iterations
        </span>
      )}
    </div>
  )
}
