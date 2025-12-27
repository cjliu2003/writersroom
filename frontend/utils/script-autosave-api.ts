/**
 * API client functions for script-level autosave functionality
 *
 * Handles script updates with optimistic concurrency control (CAS).
 * Provides error handling for conflicts, rate limiting, and transient failures.
 *
 * @module script-autosave-api
 */

/**
 * Request body for script autosave with CAS semantics
 */
export interface ScriptUpdateRequest {
  /** Full script content blocks (Slate JSON array) */
  content_blocks: Array<{
    type: string;
    children: Array<{ text: string; [key: string]: any }>;
    [key: string]: any;
  }>;

  /** Optimistic locking version for compare-and-swap */
  base_version: number;

  /** Idempotency key (UUID v4) for retry deduplication */
  op_id: string;

  /** Client-side timestamp for audit trail */
  updated_at_client: string;
}

/**
 * Successful save response from backend
 */
export interface ScriptUpdateResponse {
  script: {
    script_id: string;
    version: number;
    updated_at: string;
  };
  /** New version after successful update */
  new_version: number;
  /** Always false on success (true only in conflict response) */
  conflict: boolean;
}

/**
 * Conflict response when version mismatch detected (HTTP 409)
 */
export interface ScriptConflictResponse {
  latest: {
    /** Current server version */
    version: number;
    /** Current server content */
    content_blocks: Array<any>;
    /** Server update timestamp */
    updated_at: string;
    /** User who last updated (optional) */
    updated_by?: string;
  };
  /** Version client was trying to update from */
  your_base_version: number;
  /** Always true in conflict response */
  conflict: boolean;
}

/**
 * Base error class for script autosave API errors
 */
export class ScriptAutosaveApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: any
  ) {
    super(message);
    this.name = 'ScriptAutosaveApiError';

    // Maintain proper stack trace in V8 engines
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ScriptAutosaveApiError);
    }
  }
}

/**
 * Error thrown when version conflict detected (HTTP 409)
 *
 * Indicates that another user or client has updated the script
 * since this client's last fetch, requiring conflict resolution.
 */
export class ScriptConflictError extends ScriptAutosaveApiError {
  constructor(public conflictData: ScriptConflictResponse) {
    super('Version conflict detected', 409, conflictData);
    this.name = 'ScriptConflictError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ScriptConflictError);
    }
  }
}

/**
 * Error thrown when rate limit exceeded (HTTP 429)
 *
 * Backend enforces rate limits:
 * - 10 requests per 10 seconds per user+script
 * - 100 requests per minute per user
 */
export class ScriptRateLimitError extends ScriptAutosaveApiError {
  constructor(public retryAfter: number) {
    super(`Rate limit exceeded. Retry after ${retryAfter}s`, 429);
    this.name = 'ScriptRateLimitError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ScriptRateLimitError);
    }
  }
}

/**
 * Save script content to backend with optimistic concurrency control
 *
 * @param scriptId - Script UUID
 * @param request - Update request with content_blocks and base_version
 * @param authToken - Firebase JWT authentication token
 * @param idempotencyKey - Optional UUID for retry deduplication (uses op_id if omitted)
 * @returns Response with new version on success
 *
 * @throws {ScriptConflictError} Version mismatch detected (HTTP 409)
 * @throws {ScriptRateLimitError} Rate limit exceeded (HTTP 429)
 * @throws {ScriptAutosaveApiError} Other HTTP errors (403, 404, 500, etc.)
 *
 * @example
 * ```typescript
 * try {
 *   const response = await saveScript(
 *     scriptId,
 *     {
 *       content_blocks: editorContent,
 *       base_version: currentVersion,
 *       op_id: generateOpId(),
 *       updated_at_client: new Date().toISOString()
 *     },
 *     authToken
 *   );
 *   console.log('Saved! New version:', response.new_version);
 * } catch (err) {
 *   if (err instanceof ScriptConflictError) {
 *     // Handle conflict resolution
 *   } else if (err instanceof ScriptRateLimitError) {
 *     // Schedule retry after err.retryAfter seconds
 *   }
 * }
 * ```
 */
export async function saveScript(
  scriptId: string,
  request: ScriptUpdateRequest,
  authToken: string,
  idempotencyKey?: string
): Promise<ScriptUpdateResponse> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  const url = `${apiUrl}/api/scripts/${scriptId}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
  };

  // Use provided idempotency key or fall back to op_id
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(request),
    });

    // Handle 409 Conflict - version mismatch
    if (response.status === 409) {
      const errorData = await response.json();

      // Backend returns conflict data in 'detail' field
      const conflictData = errorData.detail || errorData;

      throw new ScriptConflictError(conflictData);
    }

    // Handle 429 Rate Limit
    if (response.status === 429) {
      // Parse Retry-After header (seconds)
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfter = retryAfterHeader
        ? parseInt(retryAfterHeader, 10)
        : 60; // Default to 60 seconds if header missing

      throw new ScriptRateLimitError(retryAfter);
    }

    // Handle other HTTP errors
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      throw new ScriptAutosaveApiError(
        errorData.detail || errorData.message || `HTTP ${response.status}`,
        response.status,
        errorData
      );
    }

    // Success - parse and return response
    const data: ScriptUpdateResponse = await response.json();
    return data;

  } catch (err) {
    // Re-throw our custom errors as-is
    if (err instanceof ScriptAutosaveApiError) {
      throw err;
    }

    // Wrap network errors
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new ScriptAutosaveApiError(
        'Network error - check connection',
        0,
        err
      );
    }

    // Wrap other errors
    throw new ScriptAutosaveApiError(
      err instanceof Error ? err.message : 'Unknown error',
      0,
      err
    );
  }
}

/**
 * Generate unique operation ID for idempotency
 *
 * Uses crypto.randomUUID() (available in modern browsers and Node.js 15+).
 * Falls back to manual UUID v4 generation for older environments.
 *
 * @returns UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 *
 * @example
 * ```typescript
 * const opId = generateOpId();
 * // Use same opId for retries to ensure idempotency
 * await saveScript(scriptId, request, authToken, opId);
 * ```
 */
export function generateOpId(): string {
  // Use native crypto.randomUUID if available
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback: Manual UUID v4 generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Convert Slate editor value to content_blocks array
 *
 * This is primarily a type-safety wrapper since Slate values
 * are already in the correct format for the backend API.
 *
 * @param slateValue - Slate editor value (array of block objects)
 * @returns Validated content blocks array
 *
 * @example
 * ```typescript
 * const editorValue = editor.children;
 * const contentBlocks = slateToContentBlocks(editorValue);
 *
 * await saveScript(scriptId, {
 *   content_blocks: contentBlocks,
 *   base_version: currentVersion,
 *   op_id: generateOpId(),
 *   updated_at_client: new Date().toISOString()
 * }, authToken);
 * ```
 */
export function slateToContentBlocks(slateValue: any[]): any[] {
  // Validate input is an array
  if (!Array.isArray(slateValue)) {
    console.warn('[slateToContentBlocks] Invalid input - expected array, got:', typeof slateValue);
    return [];
  }

  // Slate value is already in the correct format
  // Just return a shallow copy to prevent mutation issues
  return [...slateValue];
}

/**
 * Type guard to check if an error is a ScriptConflictError
 *
 * @param error - Error to check
 * @returns True if error is ScriptConflictError
 *
 * @example
 * ```typescript
 * try {
 *   await saveScript(...);
 * } catch (err) {
 *   if (isScriptConflictError(err)) {
 *     console.log('Latest version:', err.conflictData.latest.version);
 *   }
 * }
 * ```
 */
export function isScriptConflictError(error: unknown): error is ScriptConflictError {
  return error instanceof ScriptConflictError;
}

/**
 * Type guard to check if an error is a ScriptRateLimitError
 *
 * @param error - Error to check
 * @returns True if error is ScriptRateLimitError
 *
 * @example
 * ```typescript
 * try {
 *   await saveScript(...);
 * } catch (err) {
 *   if (isScriptRateLimitError(err)) {
 *     console.log('Retry after', err.retryAfter, 'seconds');
 *   }
 * }
 * ```
 */
export function isScriptRateLimitError(error: unknown): error is ScriptRateLimitError {
  return error instanceof ScriptRateLimitError;
}
