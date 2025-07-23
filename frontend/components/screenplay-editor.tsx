"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"

interface ScreenplayEditorProps {
  content: string
  onChange: (content: string) => void
}

export function ScreenplayEditor({ content, onChange }: ScreenplayEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [cursorPosition, setCursorPosition] = useState(0)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px"
    }
  }, [content])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget
    const { selectionStart, selectionEnd, value } = textarea

    if (e.key === "Tab") {
      e.preventDefault()

      // Get current line
      const lines = value.substring(0, selectionStart).split("\n")
      const currentLine = lines[lines.length - 1].trim().toUpperCase()

      // Auto-format based on context
      let newText = value
      let newCursorPos = selectionStart

      if (currentLine.match(/^(INT\.|EXT\.)/)) {
        // Scene heading - already formatted, just add spacing
        newText = value.substring(0, selectionEnd) + "\n\n" + value.substring(selectionEnd)
        newCursorPos = selectionEnd + 2
      } else if (currentLine === "" || currentLine.match(/^[A-Z\s]+$/)) {
        // Potential character name - center it
        const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1
        const lineEnd = value.indexOf("\n", selectionStart)
        const actualLineEnd = lineEnd === -1 ? value.length : lineEnd

        if (currentLine.length > 0) {
          // Format as character name (centered)
          const characterName = currentLine
          const beforeLine = value.substring(0, lineStart)
          const afterLine = value.substring(actualLineEnd)

          newText = beforeLine + "                    " + characterName + "\n" + afterLine
          newCursorPos = lineStart + 20 + characterName.length + 1
        }
      } else {
        // Regular tab behavior for dialogue indentation
        newText = value.substring(0, selectionStart) + "          " + value.substring(selectionEnd)
        newCursorPos = selectionStart + 10
      }

      onChange(newText)

      // Set cursor position after state update
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
        }
      }, 0)
    } else if (e.key === "Enter") {
      // Handle Enter key for proper formatting
      const lines = value.substring(0, selectionStart).split("\n")
      const currentLine = lines[lines.length - 1].trim()

      if (currentLine.match(/^(INT\.|EXT\.)/i)) {
        // After scene heading, add extra line break
        e.preventDefault()
        const newText = value.substring(0, selectionEnd) + "\n\n" + value.substring(selectionEnd)
        onChange(newText)

        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.setSelectionRange(selectionEnd + 2, selectionEnd + 2)
          }
        }, 0)
      } else if (currentLine.match(/^\s+[A-Z\s]+$/)) {
        // After character name, add normal line break for dialogue
        e.preventDefault()
        const newText = value.substring(0, selectionEnd) + "\n          " + value.substring(selectionEnd)
        onChange(newText)

        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.setSelectionRange(selectionEnd + 11, selectionEnd + 11)
          }
        }, 0)
      }
    }
  }

  const insertTemplate = (template: string) => {
    if (!textareaRef.current) return

    const { selectionStart, selectionEnd, value } = textareaRef.current
    const newText = value.substring(0, selectionStart) + template + value.substring(selectionEnd)
    onChange(newText)

    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = selectionStart + template.length
        textareaRef.current.setSelectionRange(newPos, newPos)
        textareaRef.current.focus()
      }
    }, 0)
  }

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col bg-white">
      {/* Toolbar */}
      <div className="border-b p-2 flex items-center gap-2 bg-gray-50">
        <Button variant="ghost" size="sm" onClick={() => insertTemplate("INT. LOCATION - NIGHT\n\n")}>
          INT. Scene
        </Button>
        <Button variant="ghost" size="sm" onClick={() => insertTemplate("EXT. LOCATION - DAY\n\n")}>
          EXT. Scene
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => insertTemplate("                    CHARACTER NAME\n          ")}
        >
          Character
        </Button>
        <Button variant="ghost" size="sm" onClick={() => insertTemplate("FADE IN:\n\n")}>
          Fade In
        </Button>
        <Button variant="ghost" size="sm" onClick={() => insertTemplate("\n\nFADE OUT.\n\nTHE END")}>
          Fade Out
        </Button>
      </div>

      {/* Editor */}
      <div className="flex-1 p-4 overflow-auto max-h-[calc(100vh-200px)]">
        <div className="max-w-4xl mx-auto">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onSelect={(e) => setCursorPosition(e.currentTarget.selectionStart)}
            className="w-full min-h-full resize-none border-none outline-none text-black bg-white"
            style={{
              fontFamily: "Courier, monospace",
              fontSize: "12pt",
              lineHeight: "1.5",
              padding: "0.5in",
              minHeight: "600px", // Reduced from 11in
            }}
            placeholder="Start writing your screenplay...

Example:
FADE IN:

INT. COFFEE SHOP - DAY

A bustling coffee shop. SARAH sits at a corner table.

                    SARAH
          This is how dialogue looks.

FADE OUT."
          />
        </div>
      </div>

      {/* Status Bar */}
      <div className="border-t p-2 text-xs text-gray-500 bg-gray-50">
        <div className="flex justify-between items-center">
          <span>Courier 12pt • Industry Standard Format</span>
          <span>Position: {cursorPosition}</span>
        </div>
      </div>
    </div>
  )
}
