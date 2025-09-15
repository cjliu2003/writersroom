"use client"

import React from 'react'
import { FileText } from 'lucide-react'

interface DragOverlayProps {
  isVisible: boolean
}

export default function DragOverlay({ isVisible }: DragOverlayProps) {
  if (!isVisible) return null

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Semi-transparent overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Animated glowing border */}
      <div className="absolute inset-4">
        <div className="w-full h-full rounded-2xl border-4 border-dashed border-blue-400/80
                        bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-blue-500/10
                        animate-pulse shadow-2xl shadow-blue-500/20" />
      </div>

      {/* Central content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center animate-in fade-in duration-300">
          {/* Floating icon with glow effect */}
          <div className="relative mb-6">
            <div className="absolute inset-0 rounded-full bg-blue-500/20 blur-xl scale-150 animate-pulse" />
            <div className="relative w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-blue-500 to-purple-600
                          flex items-center justify-center shadow-2xl shadow-blue-500/40">
              <FileText className="w-12 h-12 text-white animate-bounce" />
            </div>
          </div>

          {/* Text content */}
          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-white tracking-tight">
              Drop your script to upload
            </h2>
            <p className="text-blue-200 text-lg font-medium">
              Release to import your FDX file
            </p>
          </div>

          {/* Subtle floating particles effect */}
          <div className="absolute -top-8 -left-8 w-2 h-2 bg-blue-400 rounded-full animate-ping"
               style={{ animationDelay: '0s' }} />
          <div className="absolute -top-4 right-12 w-1.5 h-1.5 bg-purple-400 rounded-full animate-ping"
               style={{ animationDelay: '0.5s' }} />
          <div className="absolute top-8 -right-6 w-1 h-1 bg-blue-300 rounded-full animate-ping"
               style={{ animationDelay: '1s' }} />
        </div>
      </div>
    </div>
  )
}