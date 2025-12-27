"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, FilePlus, FolderOpen, Save, Download } from 'lucide-react'

interface FileMenuDropdownProps {
  onExportFDX: () => void
  onExportPDF: () => void
  isExporting: boolean
  scriptTitle?: string
  onSaveToast?: () => void
}

export function FileMenuDropdown({ onExportFDX, onExportPDF, isExporting, scriptTitle, onSaveToast }: FileMenuDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showSaveToast, setShowSaveToast] = useState(false)
  const router = useRouter()

  const handleItemClick = (action: () => void) => {
    action()
    setIsOpen(false)
  }

  const handleNew = useCallback(() => {
    router.push('/?action=new')
  }, [router])

  const handleOpen = useCallback(() => {
    router.push('/')
  }, [router])

  const handleSave = useCallback(() => {
    // Show toast - autosave handles actual persistence
    if (onSaveToast) {
      onSaveToast()
    } else {
      setShowSaveToast(true)
      setTimeout(() => setShowSaveToast(false), 2000)
    }
  }, [onSaveToast])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd (Mac) or Ctrl (Windows)
      const isMod = e.metaKey || e.ctrlKey

      if (isMod && e.key === 's') {
        e.preventDefault()
        handleSave()
      } else if (isMod && e.key === 'n') {
        e.preventDefault()
        handleNew()
      } else if (isMod && e.key === 'o') {
        e.preventDefault()
        handleOpen()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, handleNew, handleOpen])

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
        <FileText className="w-3.5 h-3.5" />
        File
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
            className="absolute top-full left-0 mt-1 w-52 bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1"
            style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}
          >
            {/* New */}
            <button
              onClick={() => handleItemClick(handleNew)}
              className="w-full px-3 py-1.5 text-left text-sm flex items-center justify-between text-gray-700 hover:bg-gray-100"
            >
              <span className="flex items-center gap-2">
                <FilePlus className="w-3.5 h-3.5" />
                New
              </span>
              <span className="text-xs text-gray-400">⌘N</span>
            </button>

            {/* Open */}
            <button
              onClick={() => handleItemClick(handleOpen)}
              className="w-full px-3 py-1.5 text-left text-sm flex items-center justify-between text-gray-700 hover:bg-gray-100"
            >
              <span className="flex items-center gap-2">
                <FolderOpen className="w-3.5 h-3.5" />
                Open
              </span>
              <span className="text-xs text-gray-400">⌘O</span>
            </button>

            {/* Separator */}
            <div className="my-1 border-t border-gray-200" />

            {/* Save */}
            <button
              onClick={() => handleItemClick(handleSave)}
              className="w-full px-3 py-1.5 text-left text-sm flex items-center justify-between text-gray-700 hover:bg-gray-100"
            >
              <span className="flex items-center gap-2">
                <Save className="w-3.5 h-3.5" />
                Save
              </span>
              <span className="text-xs text-gray-400">⌘S</span>
            </button>

            {/* Separator */}
            <div className="my-1 border-t border-gray-200" />

            {/* Export to PDF */}
            <button
              onClick={() => handleItemClick(onExportPDF)}
              disabled={isExporting}
              className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${
                isExporting
                  ? 'text-gray-300 cursor-not-allowed'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              Export to PDF
            </button>

            {/* Export to FDX */}
            <button
              onClick={() => handleItemClick(onExportFDX)}
              disabled={isExporting}
              className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${
                isExporting
                  ? 'text-gray-300 cursor-not-allowed'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              Export to FDX
            </button>
          </div>
        </>
      )}

      {/* Save Toast - only shown if no external onSaveToast handler */}
      {showSaveToast && !onSaveToast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
          Script saved
        </div>
      )}
    </div>
  )
}
