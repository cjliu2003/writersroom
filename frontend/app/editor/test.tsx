"use client"

import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

function TestComponent() {
  const searchParams = useSearchParams()
  const projectId = searchParams.get('projectId')

  return (
    <div className="p-8">
      <h1>Test Component</h1>
      <p>Project ID: {projectId || 'None'}</p>
    </div>
  )
}

export default function TestPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TestComponent />
    </Suspense>
  )
}