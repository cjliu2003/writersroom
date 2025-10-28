/**
 * Unit tests for script-autosave-api
 *
 * Tests API client functionality including:
 * - Successful saves
 * - Conflict detection and handling
 * - Rate limit handling
 * - Error handling
 * - Utility functions
 */

import {
  saveScript,
  generateOpId,
  slateToContentBlocks,
  isScriptConflictError,
  isScriptRateLimitError,
  ScriptConflictError,
  ScriptRateLimitError,
  ScriptAutosaveApiError,
  type ScriptUpdateRequest,
  type ScriptUpdateResponse,
  type ScriptConflictResponse,
} from '../script-autosave-api';

// Mock fetch globally
global.fetch = jest.fn();

describe('script-autosave-api', () => {
  const mockScriptId = '550e8400-e29b-41d4-a716-446655440000';
  const mockAuthToken = 'mock-jwt-token';
  const mockContentBlocks = [
    {
      type: 'scene_heading',
      children: [{ text: 'INT. TEST ROOM - DAY' }],
    },
    {
      type: 'action',
      children: [{ text: 'A test scene.' }],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('saveScript', () => {
    it('should successfully save script content', async () => {
      const mockResponse: ScriptUpdateResponse = {
        script: {
          script_id: mockScriptId,
          version: 6,
          updated_at: '2025-10-26T12:00:00Z',
        },
        new_version: 6,
        conflict: false,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        headers: new Headers(),
      });

      const request: ScriptUpdateRequest = {
        content_blocks: mockContentBlocks,
        base_version: 5,
        op_id: 'test-op-id',
        updated_at_client: '2025-10-26T11:59:00Z',
      };

      const response = await saveScript(mockScriptId, request, mockAuthToken);

      expect(response).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/scripts/${mockScriptId}`),
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${mockAuthToken}`,
          }),
          body: JSON.stringify(request),
        })
      );
    });

    it('should include idempotency key in headers when provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ new_version: 6, conflict: false }),
        headers: new Headers(),
      });

      const idempotencyKey = 'test-idempotency-key';
      const request: ScriptUpdateRequest = {
        content_blocks: mockContentBlocks,
        base_version: 5,
        op_id: 'test-op-id',
        updated_at_client: '2025-10-26T11:59:00Z',
      };

      await saveScript(mockScriptId, request, mockAuthToken, idempotencyKey);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Idempotency-Key': idempotencyKey,
          }),
        })
      );
    });

    it('should throw ScriptConflictError on 409 response', async () => {
      const conflictData: ScriptConflictResponse = {
        latest: {
          version: 7,
          content_blocks: [{ type: 'paragraph', children: [{ text: 'Server version' }] }],
          updated_at: '2025-10-26T12:01:00Z',
          updated_by: 'other-user-id',
        },
        your_base_version: 5,
        conflict: true,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ detail: conflictData }),
        headers: new Headers(),
      });

      const request: ScriptUpdateRequest = {
        content_blocks: mockContentBlocks,
        base_version: 5,
        op_id: 'test-op-id',
        updated_at_client: '2025-10-26T11:59:00Z',
      };

      await expect(
        saveScript(mockScriptId, request, mockAuthToken)
      ).rejects.toThrow(ScriptConflictError);

      try {
        await saveScript(mockScriptId, request, mockAuthToken);
      } catch (err) {
        expect(err).toBeInstanceOf(ScriptConflictError);
        expect((err as ScriptConflictError).conflictData).toEqual(conflictData);
        expect((err as ScriptConflictError).status).toBe(409);
      }
    });

    it('should throw ScriptRateLimitError on 429 response', async () => {
      const retryAfter = 30;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({}),
        headers: new Headers({ 'Retry-After': retryAfter.toString() }),
      });

      const request: ScriptUpdateRequest = {
        content_blocks: mockContentBlocks,
        base_version: 5,
        op_id: 'test-op-id',
        updated_at_client: '2025-10-26T11:59:00Z',
      };

      await expect(
        saveScript(mockScriptId, request, mockAuthToken)
      ).rejects.toThrow(ScriptRateLimitError);

      try {
        await saveScript(mockScriptId, request, mockAuthToken);
      } catch (err) {
        expect(err).toBeInstanceOf(ScriptRateLimitError);
        expect((err as ScriptRateLimitError).retryAfter).toBe(retryAfter);
        expect((err as ScriptRateLimitError).status).toBe(429);
      }
    });

    it('should use default retry-after if header missing on 429', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({}),
        headers: new Headers(),
      });

      const request: ScriptUpdateRequest = {
        content_blocks: mockContentBlocks,
        base_version: 5,
        op_id: 'test-op-id',
        updated_at_client: '2025-10-26T11:59:00Z',
      };

      try {
        await saveScript(mockScriptId, request, mockAuthToken);
      } catch (err) {
        expect(err).toBeInstanceOf(ScriptRateLimitError);
        expect((err as ScriptRateLimitError).retryAfter).toBe(60); // Default
      }
    });

    it('should throw ScriptAutosaveApiError on 403 forbidden', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ detail: 'Permission denied' }),
        headers: new Headers(),
      });

      const request: ScriptUpdateRequest = {
        content_blocks: mockContentBlocks,
        base_version: 5,
        op_id: 'test-op-id',
        updated_at_client: '2025-10-26T11:59:00Z',
      };

      await expect(
        saveScript(mockScriptId, request, mockAuthToken)
      ).rejects.toThrow(ScriptAutosaveApiError);

      try {
        await saveScript(mockScriptId, request, mockAuthToken);
      } catch (err) {
        expect(err).toBeInstanceOf(ScriptAutosaveApiError);
        expect((err as ScriptAutosaveApiError).status).toBe(403);
        expect((err as ScriptAutosaveApiError).message).toContain('Permission denied');
      }
    });

    it('should throw ScriptAutosaveApiError on network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new TypeError('Failed to fetch')
      );

      const request: ScriptUpdateRequest = {
        content_blocks: mockContentBlocks,
        base_version: 5,
        op_id: 'test-op-id',
        updated_at_client: '2025-10-26T11:59:00Z',
      };

      await expect(
        saveScript(mockScriptId, request, mockAuthToken)
      ).rejects.toThrow(ScriptAutosaveApiError);

      try {
        await saveScript(mockScriptId, request, mockAuthToken);
      } catch (err) {
        expect(err).toBeInstanceOf(ScriptAutosaveApiError);
        expect((err as ScriptAutosaveApiError).message).toContain('Network error');
        expect((err as ScriptAutosaveApiError).status).toBe(0);
      }
    });
  });

  describe('generateOpId', () => {
    it('should generate valid UUID v4', () => {
      const opId = generateOpId();

      expect(opId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should generate unique IDs', () => {
      const id1 = generateOpId();
      const id2 = generateOpId();
      const id3 = generateOpId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });
  });

  describe('slateToContentBlocks', () => {
    it('should return array as-is for valid input', () => {
      const input = [
        { type: 'paragraph', children: [{ text: 'Test' }] },
        { type: 'heading', children: [{ text: 'Title' }] },
      ];

      const result = slateToContentBlocks(input);

      expect(result).toEqual(input);
      expect(result).not.toBe(input); // Should be a copy
    });

    it('should return empty array for invalid input', () => {
      expect(slateToContentBlocks(null as any)).toEqual([]);
      expect(slateToContentBlocks(undefined as any)).toEqual([]);
      expect(slateToContentBlocks('not an array' as any)).toEqual([]);
      expect(slateToContentBlocks({} as any)).toEqual([]);
    });

    it('should create shallow copy to prevent mutation', () => {
      const input = [{ type: 'paragraph', children: [{ text: 'Test' }] }];
      const result = slateToContentBlocks(input);

      // Modify result
      result.push({ type: 'new', children: [] });

      // Original should be unchanged
      expect(input.length).toBe(1);
      expect(result.length).toBe(2);
    });
  });

  describe('Type guards', () => {
    it('isScriptConflictError should correctly identify ScriptConflictError', () => {
      const conflictError = new ScriptConflictError({
        latest: { version: 7, content_blocks: [], updated_at: '2025-10-26' },
        your_base_version: 5,
        conflict: true,
      });
      const otherError = new Error('Regular error');
      const rateLimitError = new ScriptRateLimitError(30);

      expect(isScriptConflictError(conflictError)).toBe(true);
      expect(isScriptConflictError(otherError)).toBe(false);
      expect(isScriptConflictError(rateLimitError)).toBe(false);
      expect(isScriptConflictError(null)).toBe(false);
      expect(isScriptConflictError(undefined)).toBe(false);
    });

    it('isScriptRateLimitError should correctly identify ScriptRateLimitError', () => {
      const rateLimitError = new ScriptRateLimitError(30);
      const otherError = new Error('Regular error');
      const conflictError = new ScriptConflictError({
        latest: { version: 7, content_blocks: [], updated_at: '2025-10-26' },
        your_base_version: 5,
        conflict: true,
      });

      expect(isScriptRateLimitError(rateLimitError)).toBe(true);
      expect(isScriptRateLimitError(otherError)).toBe(false);
      expect(isScriptRateLimitError(conflictError)).toBe(false);
      expect(isScriptRateLimitError(null)).toBe(false);
      expect(isScriptRateLimitError(undefined)).toBe(false);
    });
  });

  describe('Error classes', () => {
    it('ScriptConflictError should maintain proper inheritance', () => {
      const error = new ScriptConflictError({
        latest: { version: 7, content_blocks: [], updated_at: '2025-10-26' },
        your_base_version: 5,
        conflict: true,
      });

      expect(error).toBeInstanceOf(ScriptConflictError);
      expect(error).toBeInstanceOf(ScriptAutosaveApiError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('ScriptConflictError');
      expect(error.status).toBe(409);
      expect(error.message).toBe('Version conflict detected');
    });

    it('ScriptRateLimitError should maintain proper inheritance', () => {
      const error = new ScriptRateLimitError(30);

      expect(error).toBeInstanceOf(ScriptRateLimitError);
      expect(error).toBeInstanceOf(ScriptAutosaveApiError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('ScriptRateLimitError');
      expect(error.status).toBe(429);
      expect(error.retryAfter).toBe(30);
      expect(error.message).toContain('30s');
    });

    it('ScriptAutosaveApiError should store response data', () => {
      const responseData = { detail: 'Custom error', code: 'ERR_001' };
      const error = new ScriptAutosaveApiError('Test error', 500, responseData);

      expect(error.response).toEqual(responseData);
      expect(error.status).toBe(500);
      expect(error.message).toBe('Test error');
    });
  });
});
