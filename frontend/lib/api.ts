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
  options: RequestInit = {}
): Promise<Response> {
  const token = await getCurrentUserToken();
  if (process.env.NODE_ENV === 'development') {
    console.log('[api] requesting', `${API_BASE_URL}${endpoint}`, 'token?', !!token)
  }
  
  if (!token) {
    throw new Error('No authentication token available');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...options.headers,
  };

  return fetchWithTimeout(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
    timeoutMs: 15000,
  });
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
