import { getCurrentUserToken } from './firebase';

const API_BASE_URL = 'http://localhost:8000/api';

// Small fetch helper with timeout to avoid indefinite hangs in UI
async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 15000, ...rest } = init
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(input, { ...rest, signal: controller.signal })
    return res
  } finally {
    clearTimeout(id)
  }
}

// Helper function to make authenticated API requests
export async function authenticatedFetch(
  endpoint: string,
  options: RequestInit & { timeoutMs?: number; _retryCount?: number } = {}
): Promise<Response> {
  const { _retryCount = 0, timeoutMs = 15000, ...requestOptions } = options;

  // Try to get cached token first, then force refresh if this is a retry
  const token = await getCurrentUserToken(_retryCount > 0);
  if (process.env.NODE_ENV === 'development') {
    console.log('[api] requesting', `${API_BASE_URL}${endpoint}`, 'token?', !!token, 'retry:', _retryCount)
  }

  if (!token) {
    throw new Error('No authentication token available');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...requestOptions.headers,
  };

  const response = await fetchWithTimeout(`${API_BASE_URL}${endpoint}`, {
    ...requestOptions,
    headers,
    timeoutMs,
  });

  // If we get 401 Unauthorized and haven't retried yet, refresh token and try again
  if (response.status === 401 && _retryCount === 0) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[api] Got 401, retrying with fresh token...')
    }
    return authenticatedFetch(endpoint, { ...options, _retryCount: 1 });
  }

  return response;
}

// API functions for user scripts
export interface ScriptSummary {
  script_id: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export async function getUserScripts(): Promise<ScriptSummary[]> {
  const response = await authenticatedFetch('/users/me/scripts');

  if (!response.ok) {
    throw new Error('Failed to fetch user scripts');
  }

  return response.json();
}

export async function getSharedScripts(): Promise<ScriptSummary[]> {
  const response = await authenticatedFetch('/users/me/collaborations');

  if (!response.ok) {
    throw new Error('Failed to fetch shared scripts');
  }

  return response.json();
}

export async function createScript(data: {
  title: string;
  description?: string;
}): Promise<ScriptSummary> {
  const response = await authenticatedFetch('/scripts/', {
    method: 'POST',
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to create script');
  }

  return response.json();
}

export async function updateScript(
  scriptId: string,
  updates: { title?: string; description?: string }
): Promise<ScriptSummary> {
  const response = await authenticatedFetch(`/scripts/${scriptId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to update script');
  }

  return response.json();
}

export async function deleteScript(scriptId: string): Promise<void> {
  const response = await authenticatedFetch(`/scripts/${scriptId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to delete script');
  }
}

// Scenes for a specific script
export interface BackendScene {
  projectId: string;
  slugline: string;
  sceneId: string;
  sceneIndex: number;
  characters: string[];
  summary: string;
  tokens: number;
  timestamp?: string | null;
  wordCount: number;
  fullContent?: string | null;
  projectTitle?: string | null;
  contentBlocks?: Array<{
    type: string;
    text: string;
    metadata?: Record<string, any> | null;
  }> | null;
}

export async function getScriptScenes(scriptId: string): Promise<BackendScene[]> {
  const response = await authenticatedFetch(`/scripts/${scriptId}/scenes`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to fetch scenes for script ${scriptId}`);
  }
  return response.json();
}

// Script content with full content blocks for script-level editing
export interface ScriptWithContent {
  script_id: string;
  owner_id: string;
  title: string;
  description: string | null;
  current_version: number;
  created_at: string;
  updated_at: string;
  content_blocks: Array<any> | null;
  scene_summaries?: Record<string, string> | null; // scene_heading -> summary mapping
  version: number;
  updated_by: string | null;
  content_source: 'script' | 'scenes' | 'empty';
  has_yjs_updates: boolean; // Whether Yjs updates exist (Yjs is source of truth)
}

export async function getScriptContent(scriptId: string): Promise<ScriptWithContent> {
  const response = await authenticatedFetch(`/scripts/${scriptId}/content`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to fetch content for script ${scriptId}`);
  }
  return response.json();
}

// API function for FDX upload
export interface FDXUploadResponse {
  success: boolean;
  script_id: string;
  title: string;
  scene_count: number;
  scenes: Array<{
    slugline: string;
    summary: string;
    tokens: number;
    characters: string[];
    themes: string[];
    word_count: number;
    full_content: string;
    content_blocks: Array<{
      type: string;
      text: string;
      metadata: Record<string, any>;
    }>;
  }>;
  file_info: {
    file_path: string;
    file_size: number;
    content_type: string;
  };
}

export async function uploadFDXFile(
  file: File
): Promise<FDXUploadResponse> {
  const token = await getCurrentUserToken();

  if (!token) {
    throw new Error('No authentication token available');
  }

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetchWithTimeout(`${API_BASE_URL}/fdx/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData,
    timeoutMs: 30000,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to upload FDX file');
  }

  return response.json();
}

// API function for FDX export
export async function exportFDXFile(scriptId: string): Promise<Blob> {
  const token = await getCurrentUserToken();

  if (!token) {
    throw new Error('No authentication token available');
  }

  const response = await fetchWithTimeout(`${API_BASE_URL}/fdx/export/${scriptId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    timeoutMs: 30000,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to export FDX file');
  }

  return response.blob();
}

// AI-related API functions
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface SceneSummaryRequest {
  script_id: string;
  scene_index: number;
  slugline: string;
  scene_text: string;
}

export interface SceneSummaryResponse {
  success: boolean;
  summary?: string;
  error?: string;
}

// OLD chat interface (deprecated - kept for compatibility)
export interface ChatRequest {
  script_id: string;
  messages: ChatMessage[];
  include_scenes?: boolean;
}

export interface ChatResponse {
  success: boolean;
  message?: ChatMessage;
  error?: string;
}

// NEW chat interfaces with RAG support and optional tool support (Phase 6)
export interface ChatMessageRequest {
  script_id: string;
  conversation_id?: string;
  current_scene_id?: string;
  message: string;
  intent_hint?: 'scene_specific' | 'character' | 'global_context' | 'general';
  max_tokens?: number;
  budget_tier?: 'quick' | 'standard' | 'deep';

  // Phase 6: Hybrid mode support (optional)
  enable_tools?: boolean;        // Enable MCP tool calling (default: true on backend)
  max_iterations?: number;       // Maximum tool calling iterations (default: 5)
}

export interface TokenUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

export interface ContextUsed {
  intent: string;
  budget_tier: string;
  tokens_breakdown: Record<string, number>;
  cache_hit: boolean;
  cache_savings_pct: number;
}

// Phase 6: Tool usage metadata (only present if tools were used)
export interface ToolCallMetadata {
  tool_calls_made: number;       // Number of tool calling iterations
  tools_used: string[];           // Names of tools called (e.g., ['get_scene', 'analyze_pacing'])
  stop_reason: string;            // 'end_turn' (natural) or 'max_iterations' (limit reached)
}

export interface ChatMessageResponse {
  message: string;
  conversation_id: string;
  usage: TokenUsage;
  context_used: ContextUsed;

  // Phase 6: Tool usage metadata (optional - only present if tools were used)
  tool_metadata?: ToolCallMetadata;
}

export async function generateSceneSummary(request: SceneSummaryRequest): Promise<SceneSummaryResponse> {
  const response = await authenticatedFetch('/ai/scene-summary', {
    method: 'POST',
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to generate scene summary');
  }

  return response.json();
}

// DEPRECATED: Old chat endpoint without RAG
export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  const response = await authenticatedFetch('/ai/chat', {
    method: 'POST',
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to send chat message');
  }

  return response.json();
}

// NEW: RAG-enabled chat endpoint with intelligent context retrieval
export async function sendChatMessageWithRAG(request: ChatMessageRequest): Promise<ChatMessageResponse> {
  // Increase timeout for chat requests (AI generation can take 15-30 seconds)
  const response = await authenticatedFetch('/ai/chat/message', {
    method: 'POST',
    body: JSON.stringify(request),
    timeoutMs: 45000, // 45 seconds for AI chat
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to send chat message');
  }

  return response.json();
}

// Collaborator API functions
export interface Collaborator {
  user_id: string;
  display_name: string | null;
  role: 'editor' | 'viewer';
  joined_at: string;
}

export async function getCollaborators(scriptId: string): Promise<Collaborator[]> {
  const response = await authenticatedFetch(`/scripts/${scriptId}/collaborators`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to fetch collaborators');
  }

  return response.json();
}

export async function addCollaborator(
  scriptId: string,
  email: string,
  role: 'editor' | 'viewer' = 'editor'
): Promise<Collaborator> {
  const response = await authenticatedFetch(`/scripts/${scriptId}/collaborators`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to add collaborator');
  }

  return response.json();
}

export async function removeCollaborator(
  scriptId: string,
  userId: string
): Promise<void> {
  const response = await authenticatedFetch(`/scripts/${scriptId}/collaborators/${userId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to remove collaborator');
  }
}
