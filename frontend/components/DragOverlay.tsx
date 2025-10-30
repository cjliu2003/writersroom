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
      {/* Subtle dimmed overlay - soft and minimal */}
      <div className="absolute inset-0 bg-black/10 backdrop-blur-sm transition-all duration-200 ease-out" />

      {/* Frosted glass border with gentle blue glow */}
      <div className="absolute inset-4">
        <div
          className="w-full h-full rounded-2xl border-2 border-blue-400/40 bg-white/40 backdrop-blur-md shadow-[0_0_20px_rgba(37,99,235,0.15)] transition-all duration-200 ease-out"
          style={{
            animation: 'pulseBorder 2s ease-in-out infinite'
          }}
        />
      </div>

      {/* Central content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center transition-all duration-300 ease-out">
          {/* Floating icon with soft blue glow */}
          <div className="relative mb-8">
            <div className="absolute inset-0 rounded-full bg-blue-400/15 blur-2xl scale-150"
                 style={{ animation: 'pulseGlow 2s ease-in-out infinite' }} />
            <div className="relative w-24 h-24 mx-auto rounded-full bg-white/95 backdrop-blur-sm border border-gray-200/50
                          flex items-center justify-center shadow-[0_8px_32px_rgba(37,99,235,0.2)]">
              <FileText className="w-12 h-12 text-blue-600" style={{ animation: 'gentleBounce 2s ease-in-out infinite' }} />
            </div>
          </div>

          {/* Text content - monospaced, screenplay style */}
          <div className="space-y-2">
            <h2 className="font-[family-name:var(--font-courier-prime)] text-2xl font-normal text-gray-900 tracking-tight">
              <span className="text-blue-600 font-semibold">Drop your script</span> to upload
            </h2>
            <p className="font-[family-name:var(--font-courier-prime)] text-gray-600 text-base font-light">
              Release to import your FDX file
            </p>
          </div>

          {/* Subtle floating particles - muted blue/gray */}
          <div className="absolute -top-8 -left-8 w-1.5 h-1.5 bg-blue-400/60 rounded-full animate-ping"
               style={{ animationDelay: '0s' }} />
          <div className="absolute -top-4 right-12 w-1 h-1 bg-gray-400/60 rounded-full animate-ping"
               style={{ animationDelay: '0.5s' }} />
          <div className="absolute top-8 -right-6 w-1 h-1 bg-blue-300/60 rounded-full animate-ping"
               style={{ animationDelay: '1s' }} />
        </div>
      </div>

      {/* Inline keyframe animations */}
      <style jsx>{`
        @keyframes pulseBorder {
          0%, 100% {
            box-shadow: 0 0 20px rgba(37, 99, 235, 0.15);
            border-color: rgba(37, 99, 235, 0.4);
          }
          50% {
            box-shadow: 0 0 25px rgba(37, 99, 235, 0.3);
            border-color: rgba(37, 99, 235, 0.5);
          }
        }

        @keyframes pulseGlow {
          0%, 100% {
            opacity: 0.15;
          }
          50% {
            opacity: 0.25;
          }
        }

        @keyframes gentleBounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-4px);
          }
        }
      `}</style>
    </div>
  )
}