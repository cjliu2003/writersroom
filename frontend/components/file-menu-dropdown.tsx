"use client"

import React, { useState } from 'react'
import { FileText, Home, Download } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface FileMenuDropdownProps {
  onExport: () => void
  isExporting: boolean
  scriptTitle?: string
}

export function FileMenuDropdown({ onExport, isExporting, scriptTitle }: FileMenuDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()

  const menuItems = [
    {
      label: 'Home',
      icon: Home,
      shortcut: '',
      action: () => router.push('/'),
      disabled: false,
    },
    { type: 'separator' as const },
    {
      label: 'Export FDX',
      icon: Download,
      shortcut: '',
      action: () => onExport(),
      disabled: isExporting,
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
            className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1"
            style={{ fontFamily: "var(--font-courier-prime), 'Courier New', monospace" }}
          >
            {menuItems.map((item, index) => {
              if ('type' in item && item.type === 'separator') {
                return <div key={index} className="border-t border-gray-100 my-1" />
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
                  {item.shortcut && (
                    <span className="text-xs text-gray-400">{item.shortcut}</span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
