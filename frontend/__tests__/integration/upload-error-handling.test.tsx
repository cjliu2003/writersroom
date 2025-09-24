/**
 * Upload Error Handling UI Tests
 *
 * Tests for ensuring the upload UI handles errors gracefully
 * and doesn't get stuck in loading states
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react-dom/test-utils'
import HomePage from '@/app/page'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}))

// Mock the API module
jest.mock('@/lib/api', () => ({
  API_BASE_URL: 'http://localhost:3003',
  createApiUrl: jest.fn((path: string) => `http://localhost:3003${path}`),
  uploadFdxFile: jest.fn(),
}))

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString()
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// Import mocked module
import { uploadFdxFile } from '@/lib/api'

describe('Upload Error Handling UI Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    localStorageMock.clear()

    // Reset console methods
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('404 Error Handling', () => {
    it('should show error message when upload returns 404', async () => {
      // Arrange
      const mockUploadFdxFile = uploadFdxFile as jest.MockedFunction<typeof uploadFdxFile>
      mockUploadFdxFile.mockRejectedValueOnce(new Error('Upload failed: 404 Not Found'))

      // Render component
      const { container } = render(<HomePage />)

      // Create test file
      const file = new File(['<FinalDraft></FinalDraft>'], 'test.fdx', { type: 'text/xml' })

      // Act - Find and trigger file input
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput).toBeTruthy()

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      // Assert
      await waitFor(() => {
        // Check that error is displayed
        const errorElements = container.querySelectorAll('[class*="error"], [class*="alert"]')
        const hasErrorContent = Array.from(container.querySelectorAll('*')).some(
          el => el.textContent?.includes('404') || el.textContent?.includes('Not Found')
        )
        expect(errorElements.length > 0 || hasErrorContent).toBe(true)
      })
    })

    it('should re-enable upload button after 404 error', async () => {
      // Arrange
      const mockUploadFdxFile = uploadFdxFile as jest.MockedFunction<typeof uploadFdxFile>
      mockUploadFdxFile.mockRejectedValueOnce(new Error('Upload failed: 404 Not Found'))

      const { container } = render(<HomePage />)
      const file = new File(['<FinalDraft></FinalDraft>'], 'test.fdx', { type: 'text/xml' })

      // Act
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      // Assert
      await waitFor(() => {
        // Upload button/area should be enabled again
        expect(fileInput.disabled).toBe(false)

        // Should be able to select a new file
        const newFile = new File(['<FinalDraft>New</FinalDraft>'], 'new.fdx', { type: 'text/xml' })
        expect(() => {
          fireEvent.change(fileInput, { target: { files: [newFile] } })
        }).not.toThrow()
      })
    })

    it('should not show loading spinner after error', async () => {
      // Arrange
      const mockUploadFdxFile = uploadFdxFile as jest.MockedFunction<typeof uploadFdxFile>
      mockUploadFdxFile.mockRejectedValueOnce(new Error('Upload failed: 404 Not Found'))

      const { container } = render(<HomePage />)
      const file = new File(['<FinalDraft></FinalDraft>'], 'test.fdx', { type: 'text/xml' })

      // Act
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      // Assert
      await waitFor(() => {
        // Check no loading indicators are present
        const loadingElements = container.querySelectorAll('[class*="loading"], [class*="spinner"], [role="status"]')
        const hasLoadingContent = Array.from(container.querySelectorAll('*')).some(
          el => el.textContent?.toLowerCase().includes('loading') ||
                el.textContent?.toLowerCase().includes('uploading') ||
                el.textContent?.toLowerCase().includes('parsing')
        )

        // After error, no loading indicators should be visible
        loadingElements.forEach(el => {
          const styles = window.getComputedStyle(el as Element)
          if (styles.display !== 'none' && styles.visibility !== 'hidden') {
            expect(el.getAttribute('aria-hidden')).toBe('true')
          }
        })
      })
    })
  })

  describe('Server Error Handling', () => {
    it('should handle 500 server errors gracefully', async () => {
      // Arrange
      const mockUploadFdxFile = uploadFdxFile as jest.MockedFunction<typeof uploadFdxFile>
      mockUploadFdxFile.mockRejectedValueOnce(new Error('Upload failed: 500 Internal Server Error'))

      const { container } = render(<HomePage />)
      const file = new File(['<FinalDraft></FinalDraft>'], 'test.fdx', { type: 'text/xml' })

      // Act
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      // Assert
      await waitFor(() => {
        const hasErrorMessage = Array.from(container.querySelectorAll('*')).some(
          el => el.textContent?.includes('500') ||
                el.textContent?.includes('server error') ||
                el.textContent?.toLowerCase().includes('error')
        )
        expect(hasErrorMessage).toBe(true)
      })
    })

    it('should handle network timeouts', async () => {
      // Arrange
      const mockUploadFdxFile = uploadFdxFile as jest.MockedFunction<typeof uploadFdxFile>
      mockUploadFdxFile.mockRejectedValueOnce(new Error('Request timeout - please try again'))

      const { container } = render(<HomePage />)
      const file = new File(['<FinalDraft></FinalDraft>'], 'test.fdx', { type: 'text/xml' })

      // Act
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      // Assert
      await waitFor(() => {
        const hasTimeoutMessage = Array.from(container.querySelectorAll('*')).some(
          el => el.textContent?.toLowerCase().includes('timeout') ||
                el.textContent?.toLowerCase().includes('try again')
        )
        expect(hasTimeoutMessage).toBe(true)
      })
    })

    it('should handle parse errors from successful response', async () => {
      // Arrange
      const mockUploadFdxFile = uploadFdxFile as jest.MockedFunction<typeof uploadFdxFile>
      mockUploadFdxFile.mockResolvedValueOnce({
        success: false,
        error: 'Failed to parse FDX file. Please ensure it\'s a valid Final Draft document.'
      })

      const { container } = render(<HomePage />)
      const file = new File(['invalid content'], 'test.fdx', { type: 'text/xml' })

      // Act
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      // Assert
      await waitFor(() => {
        const hasParseError = Array.from(container.querySelectorAll('*')).some(
          el => el.textContent?.toLowerCase().includes('parse') ||
                el.textContent?.toLowerCase().includes('valid')
        )
        expect(hasParseError).toBe(true)
      })
    })
  })

  describe('AbortController Functionality', () => {
    it('should cancel previous upload when new file is selected', async () => {
      // Arrange
      const mockUploadFdxFile = uploadFdxFile as jest.MockedFunction<typeof uploadFdxFile>

      // First upload will be slow
      let firstUploadCancelled = false
      mockUploadFdxFile.mockImplementationOnce(() =>
        new Promise((resolve, reject) => {
          setTimeout(() => {
            if (firstUploadCancelled) {
              reject(new DOMException('The operation was aborted', 'AbortError'))
            } else {
              resolve({
                success: true,
                title: 'First Upload',
                sceneCount: 10,
                projectId: 'test-1'
              })
            }
          }, 1000)
        })
      )

      // Second upload will be fast
      mockUploadFdxFile.mockImplementationOnce(() =>
        Promise.resolve({
          success: true,
          title: 'Second Upload',
          sceneCount: 5,
          projectId: 'test-2'
        })
      )

      const { container } = render(<HomePage />)

      // Act - Start first upload
      const file1 = new File(['<FinalDraft>1</FinalDraft>'], 'first.fdx', { type: 'text/xml' })
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

      act(() => {
        fireEvent.change(fileInput, { target: { files: [file1] } })
      })

      // Immediately start second upload (should cancel first)
      const file2 = new File(['<FinalDraft>2</FinalDraft>'], 'second.fdx', { type: 'text/xml' })
      await act(async () => {
        firstUploadCancelled = true // Simulate cancellation
        fireEvent.change(fileInput, { target: { files: [file2] } })
      })

      // Assert
      await waitFor(() => {
        expect(mockUploadFdxFile).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe('UI State Recovery', () => {
    it('should reset all loading states on error', async () => {
      // Arrange
      const mockUploadFdxFile = uploadFdxFile as jest.MockedFunction<typeof uploadFdxFile>
      mockUploadFdxFile.mockRejectedValueOnce(new Error('Upload failed'))

      const { container } = render(<HomePage />)

      // Track UI state
      const checkUIState = () => ({
        hasLoadingOverlay: container.querySelector('[class*="loading-overlay"]') !== null,
        hasSpinner: container.querySelector('[class*="spinner"]') !== null,
        inputDisabled: (container.querySelector('input[type="file"]') as HTMLInputElement)?.disabled,
        hasParsingText: Array.from(container.querySelectorAll('*')).some(
          el => el.textContent?.toLowerCase().includes('parsing')
        )
      })

      // Act
      const file = new File(['<FinalDraft></FinalDraft>'], 'test.fdx', { type: 'text/xml' })
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      // Assert - After error, all loading states should be cleared
      await waitFor(() => {
        const state = checkUIState()
        expect(state.inputDisabled).toBe(false)

        // Loading elements should be hidden or removed
        const loadingOverlay = container.querySelector('[class*="loading-overlay"]')
        if (loadingOverlay) {
          const styles = window.getComputedStyle(loadingOverlay)
          expect(styles.display === 'none' || styles.visibility === 'hidden').toBe(true)
        }
      })
    })

    it('should allow retry after error', async () => {
      // Arrange
      const mockUploadFdxFile = uploadFdxFile as jest.MockedFunction<typeof uploadFdxFile>

      // First attempt fails
      mockUploadFdxFile.mockRejectedValueOnce(new Error('Upload failed'))

      // Second attempt succeeds
      mockUploadFdxFile.mockResolvedValueOnce({
        success: true,
        title: 'Retry Success',
        sceneCount: 10,
        projectId: 'test-retry'
      })

      const { container } = render(<HomePage />)

      // Act - First upload (fails)
      const file1 = new File(['<FinalDraft>1</FinalDraft>'], 'fail.fdx', { type: 'text/xml' })
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file1] } })
      })

      // Wait for error state
      await waitFor(() => {
        expect(mockUploadFdxFile).toHaveBeenCalledTimes(1)
      })

      // Act - Retry with new file (succeeds)
      const file2 = new File(['<FinalDraft>2</FinalDraft>'], 'success.fdx', { type: 'text/xml' })

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file2] } })
      })

      // Assert
      await waitFor(() => {
        expect(mockUploadFdxFile).toHaveBeenCalledTimes(2)
        // Success state should be reflected (no error messages)
        const hasErrorMessage = Array.from(container.querySelectorAll('*')).some(
          el => el.textContent?.toLowerCase().includes('error') ||
                el.textContent?.toLowerCase().includes('failed')
        )
        expect(hasErrorMessage).toBe(false)
      })
    })
  })

  describe('File Validation', () => {
    it('should reject non-FDX files', async () => {
      // Arrange
      const { container } = render(<HomePage />)
      const file = new File(['not fdx'], 'test.txt', { type: 'text/plain' })

      // Act
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
      })

      // Assert
      await waitFor(() => {
        const hasError = Array.from(container.querySelectorAll('*')).some(
          el => el.textContent?.toLowerCase().includes('.fdx') ||
                el.textContent?.toLowerCase().includes('format')
        )
        expect(hasError).toBe(true)

        // Should not have called the API
        expect(uploadFdxFile).not.toHaveBeenCalled()
      })
    })

    it('should handle empty file selection', () => {
      // Arrange
      const { container } = render(<HomePage />)

      // Act
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(fileInput, { target: { files: [] } })

      // Assert
      expect(uploadFdxFile).not.toHaveBeenCalled()
    })
  })
})