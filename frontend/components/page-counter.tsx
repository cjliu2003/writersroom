"use client"

import React from 'react'

interface PageCounterProps {
  currentPage: number
  totalPages: number
  className?: string
}

export function PageCounter({ currentPage, totalPages, className = "" }: PageCounterProps) {
  return (
    <div className={`fixed top-4 right-4 z-50 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg px-3 py-2 shadow-lg ${className}`}>
      <span className="text-sm font-medium text-gray-700">
        Page {currentPage} of {totalPages}
      </span>
    </div>
  )
}

// Alternative floating version
export function FloatingPageCounter({ currentPage, totalPages }: PageCounterProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50 bg-slate-800 text-white px-4 py-2 rounded-full shadow-lg border border-slate-700">
      <span className="text-sm font-semibold">
        {currentPage} / {totalPages}
      </span>
    </div>
  )
}