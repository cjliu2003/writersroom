"use client"

import React, { Component, ReactNode } from 'react'
import { AlertCircle, RefreshCw, Home } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onRetry?: () => void
}

interface State {
  hasError: boolean
  error?: Error
  retryCount: number
}

export class ErrorBoundary extends Component<Props, State> {
  private retryTimeout?: NodeJS.Timeout

  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, retryCount: 0 }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, retryCount: 0 }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)

    // Report chunk loading errors specifically
    if (error.message.includes('Loading chunk') || error.message.includes('ChunkLoadError')) {
      console.error('🚨 Chunk Loading Error detected:', error.message)
      this.handleChunkLoadError(error)
    }
  }

  private handleChunkLoadError = (error: Error) => {
    // Attempt automatic retry for chunk loading errors
    if (this.state.retryCount < 3) {
      console.log(`🔄 Attempting automatic retry ${this.state.retryCount + 1}/3 for chunk loading error`)

      this.retryTimeout = setTimeout(() => {
        this.setState(prevState => ({
          hasError: false,
          retryCount: prevState.retryCount + 1
        }))
      }, 1000 * (this.state.retryCount + 1)) // Progressive delay: 1s, 2s, 3s
    }
  }

  private handleManualRetry = () => {
    if (this.props.onRetry) {
      this.props.onRetry()
    }
    window.location.reload()
  }

  private clearCache = () => {
    // Clear all caches and reload
    if ('caches' in window) {
      caches.keys().then(function(names) {
        for (let name of names) caches.delete(name)
      })
    }
    localStorage.removeItem('.next-cache')
    window.location.reload()
  }

  componentWillUnmount() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
    }
  }

  render() {
    if (this.state.hasError) {
      const isChunkError = this.state.error?.message.includes('Loading chunk') ||
                          this.state.error?.message.includes('ChunkLoadError')

      // Show custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default error boundary UI
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-8 text-center">
            <div className="text-red-500 mb-4">
              <AlertCircle className="w-16 h-16 mx-auto" />
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {isChunkError ? 'Loading Error' : 'Something went wrong'}
            </h2>

            <p className="text-gray-600 mb-6">
              {isChunkError
                ? 'There was a problem loading part of the application. This usually resolves with a refresh.'
                : 'An unexpected error occurred. Please try refreshing the page.'
              }
            </p>

            {this.state.retryCount > 0 && (
              <p className="text-sm text-amber-600 mb-4">
                Retry attempt {this.state.retryCount}/3
              </p>
            )}

            <div className="space-y-3">
              <button
                onClick={this.handleManualRetry}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>

              {isChunkError && (
                <button
                  onClick={this.clearCache}
                  className="w-full px-4 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium"
                >
                  Clear Cache & Reload
                </button>
              )}

              <button
                onClick={() => window.location.href = '/'}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                <Home className="w-4 h-4" />
                Back to Home
              </button>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-6 text-left">
                <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
                  Error Details (Development)
                </summary>
                <pre className="mt-2 text-xs bg-gray-100 p-3 rounded overflow-auto max-h-40">
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary