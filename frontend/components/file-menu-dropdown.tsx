"use client"

import React, { useState } from 'react'
import { FileText, Download } from 'lucide-react'

interface FileMenuDropdownProps {
  onExportFDX: () => void
  onExportPDF: () => void
  isExporting: boolean
  scriptTitle?: string
}

export function FileMenuDropdown({ onExportFDX, onExportPDF, isExporting, scriptTitle }: FileMenuDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)

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
            className="absolute top-full left-0 mt-1 w-44 bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1"
            style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}
          >
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
    </div>
  )
}
