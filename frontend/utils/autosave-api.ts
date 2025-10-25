/**
 * API client functions for autosave functionality
 * Handles scene updates with optimistic concurrency control
 */

export interface SceneUpdateRequest {
  position: number;
  scene_heading: string;
  blocks: Array<{
    type: string;
    text: string;
    [key: string]: any;
  }>;
  full_content?: string; // DEPRECATED: Plain text for search/analysis (set by FDX parser only, NOT by autosave)
  updated_at_client: string;
  base_version: number;
  op_id: string;
}

export interface SceneUpdateResponse {
  scene: {
    scene_id: string;
    version: number;
    updated_at: string;
  };
  new_version: number;
  conflict: boolean;
}

export interface ConflictResponse {
  latest: {
    version: number;
    blocks: Array<any>;
    scene_heading: string;
    position: number;
    updated_at: string;
  };
  your_base_version: number;
  conflict: boolean;
}

export class AutosaveApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: any
  ) {
    super(message);
    this.name = 'AutosaveApiError';
  }
}

export class ConflictError extends AutosaveApiError {
  constructor(public conflictData: ConflictResponse) {
    super('Version conflict detected', 409, conflictData);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends AutosaveApiError {
  constructor(public retryAfter: number) {
    super(`Rate limit exceeded. Retry after ${retryAfter}s`, 429);
    this.name = 'RateLimitError';
  }
}

/**
 * Save scene content to the backend with optimistic concurrency control
 */
export async function saveScene(
  sceneId: string,
  request: SceneUpdateRequest,
  authToken: string,
  idempotencyKey?: string
): Promise<SceneUpdateResponse> {
  const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/scenes/${sceneId}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
  };
  
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(request),
    });

    if (response.status === 409) {
      const conflictData = await response.json();
      throw new ConflictError(conflictData.detail);
    }

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
      throw new RateLimitError(retryAfter);
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new AutosaveApiError(
        errorData.detail || `HTTP ${response.status}`,
        response.status,
        errorData
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof AutosaveApiError) {
      throw error;
    }
    
    // Network or other errors
    throw new AutosaveApiError(
      error instanceof Error ? error.message : 'Unknown error',
      0
    );
  }
}

/**
 * Generate a UUID v4 for operation IDs
 */
export function generateOpId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Convert screenplay content to blocks format expected by backend
 */
export function contentToBlocks(content: string): Array<{type: string, text: string}> {
  // Try to parse as JSON first (rich screenplay elements)
  try {
    const elements = JSON.parse(content);
    if (Array.isArray(elements)) {
      return elements.map((element: any) => {
        // Extract text from children array if present
        let text = '';
        if (element.children && Array.isArray(element.children)) {
          text = element.children.map((child: any) => child.text || '').join('');
        } else if (element.text) {
          text = element.text;
        }
        
        return {
          type: element.type || 'action',
          text: text
        };
      });
    }
  } catch (e) {
    // Not JSON, fall back to plain text parsing
  }
  
  // Plain text parsing (fallback)
  const lines = content.split('\n');
  const blocks: Array<{type: string, text: string}> = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (!trimmed) {
      blocks.push({ type: 'action', text: '' });
      continue;
    }
    
    // Scene heading detection
    if (trimmed.match(/^(INT\.|EXT\.)/i)) {
      blocks.push({ type: 'scene_heading', text: trimmed });
    }
    // Character name detection (all caps, centered-ish)
    else if (trimmed.match(/^[A-Z][A-Z\s]+$/) && trimmed.length < 30) {
      blocks.push({ type: 'character', text: trimmed });
    }
    // Parenthetical detection
    else if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      blocks.push({ type: 'parenthetical', text: trimmed });
    }
    // Transition detection
    else if (trimmed.match(/^(FADE IN:|FADE OUT|CUT TO:|DISSOLVE TO:)/i)) {
      blocks.push({ type: 'transition', text: trimmed });
    }
    // Default to action
    else {
      blocks.push({ type: 'action', text: trimmed });
    }
  }
  
  return blocks;
}

/**
 * Extract the scene slice (elements, heading, position) for a given scene UUID from the full editor content.
 */
export function extractSceneSlice(
  content: string,
  sceneUuid: string,
  scenePosition?: number
): { elements: any[]; heading: string; position: number } {
  try {
    const elements = JSON.parse(content);
    if (Array.isArray(elements)) {
      const headingIndexes: number[] = [];
      const headingUuids: Array<string | undefined> = [];
      const headingSceneIds: Array<string | undefined> = [];
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (el && el.type === 'scene_heading') {
          headingIndexes.push(i);
          headingUuids.push(el?.metadata?.uuid);
          headingSceneIds.push(el?.metadata?.sceneId);  // Database scene_id
        }
      }

      console.log('🔍 [extractSceneSlice] Searching for scene UUID:', sceneUuid);
      console.log('🔍 [extractSceneSlice] Provided scene position:', scenePosition);
      console.log('🔍 [extractSceneSlice] Available metadata.uuid values:', headingUuids.slice(0, 5));
      console.log('🔍 [extractSceneSlice] Available metadata.sceneId values:', headingSceneIds.slice(0, 5));
      console.log('🔍 [extractSceneSlice] Total scenes:', headingUuids.length);

      let headingPos = -1;

      // PRIMARY: Use scenePosition if provided and valid
      if (typeof scenePosition === 'number' && scenePosition >= 0 && scenePosition < headingIndexes.length) {
        headingPos = scenePosition;
        console.log('✅ [extractSceneSlice] Using provided scene position:', headingPos);
      }
      // FALLBACK 1: Try matching by metadata.uuid
      else {
        headingPos = headingUuids.findIndex(u => u === sceneUuid);
        if (headingPos !== -1) {
          console.log('✅ [extractSceneSlice] Found scene by metadata.uuid at position:', headingPos);
        }
      }

      // FALLBACK 2: Try matching by metadata.sceneId
      if (headingPos === -1) {
        console.warn('⚠️ [extractSceneSlice] UUID not found in metadata.uuid, trying metadata.sceneId...');
        headingPos = headingSceneIds.findIndex(sid => sid === sceneUuid);
        if (headingPos !== -1) {
          console.log('✅ [extractSceneSlice] Found scene by metadata.sceneId at position:', headingPos);
        }
      }

      // FALLBACK 3: Use first scene as last resort
      if (headingPos === -1) {
        console.error('❌ [extractSceneSlice] Scene UUID NOT FOUND in any field!');
        console.error('  Searched for:', sceneUuid);
        console.error('  Available UUIDs:', headingUuids.slice(0, 3));
        console.error('  Available sceneIds:', headingSceneIds.slice(0, 3));
        headingPos = 0;
        console.warn('⚠️ [extractSceneSlice] Falling back to position 0 (first scene)');
      }

      const start = headingIndexes[headingPos] ?? 0;
      const end = headingIndexes[headingPos + 1] ?? elements.length;
      const slice = elements.slice(start, end);

      console.log('🔍 [extractSceneSlice] Slice:', { start, end, sliceLength: slice.length });

      const headingEl = slice.find((el: any) => el?.type === 'scene_heading');
      const headingText =
        (headingEl?.children?.[0]?.text as string | undefined)?.trim() || 'UNTITLED SCENE';
      return { elements: slice, heading: headingText, position: headingPos };
    }
  } catch {
    // Not JSON, fall through
  }
  // Plain text fallback
  const headingText = extractSceneHeading(content);
  return { elements: [], heading: headingText, position: 0 };
}

/**
 * Replace the screenplay elements for a given scene UUID inside the full script content.
 * If the scene is not present, the new elements are appended to preserve edits.
 */
export function replaceSceneSlice(
  content: string,
  sceneUuid: string,
  newElements: any[]
): string {
  if (!Array.isArray(newElements)) {
    return JSON.stringify(newElements ?? []);
  }

  try {
    const elements = JSON.parse(content);
    if (!Array.isArray(elements)) {
      return JSON.stringify(newElements);
    }

    const headingIndexes: number[] = [];
    const headingUuids: Array<string | undefined> = [];

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (el && el.type === 'scene_heading') {
        headingIndexes.push(i);
        headingUuids.push(el?.metadata?.uuid);
      }
    }

    const headingPos = headingUuids.findIndex((uuid) => uuid === sceneUuid);
    const updated = elements.slice();

    if (headingPos === -1) {
      return JSON.stringify([...updated, ...newElements]);
    }

    const start = headingIndexes[headingPos] ?? updated.length;
    const end = headingIndexes[headingPos + 1] ?? updated.length;
    const deleteCount = Math.max(0, end - start);

    updated.splice(start, deleteCount, ...newElements);
    return JSON.stringify(updated);
  } catch {
    // Fall back to returning just the scene payload so offline autosave still works.
    return JSON.stringify(newElements);
  }
}

/**
 * Extract scene heading from content
 */
export function extractSceneHeading(content: string): string {
  // Try JSON-based content first
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      const headingEl = parsed.find((el: any) => el?.type === 'scene_heading');
      const text = headingEl?.children?.[0]?.text;
      if (typeof text === 'string' && text.trim().length > 0) {
        return text.trim();
      }
    }
  } catch {
    // Not JSON, fall through to plain text parsing
  }
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^(INT\.|EXT\.)/i)) {
      return trimmed;
    }
  }
  return 'UNTITLED SCENE';
}
