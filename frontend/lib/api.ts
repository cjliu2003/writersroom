import { getCurrentUserToken } from './firebase';

const API_BASE_URL = 'http://localhost:8000/api';

// Helper function to make authenticated API requests
export async function authenticatedFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getCurrentUserToken();
  
  if (!token) {
    throw new Error('No authentication token available');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...options.headers,
  };

  return fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
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

export async function uploadFDXFile(file: File): Promise<FDXUploadResponse> {
  const token = await getCurrentUserToken();
  
  if (!token) {
    throw new Error('No authentication token available');
  }

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/fdx/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to upload FDX file');
  }

  return response.json();
}
