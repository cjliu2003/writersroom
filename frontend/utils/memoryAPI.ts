/**
 * Frontend Memory API Client
 * 
 * Client-side API interface for scene memory operations.
 * Replaces direct memory access with HTTP calls to the backend.
 */

import { 
  SceneMemory,
  MemoryStats,
  UpdateSceneMemoryRequest,
  SceneMemoryResponse,
  SingleSceneResponse,
  TokensResponse,
  StatsResponse,
  APIResponse
} from '../../shared/types';

// API configuration
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

/**
 * Generic API request handler with error handling
 */
async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const defaultOptions: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, { ...defaultOptions, ...options });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.message || 'API request failed');
    }
    
    return data;
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
}

/**
 * Memory API Client Class
 */
export class MemoryAPI {
  
  /**
   * Update or add a scene in memory
   */
  static async updateSceneMemory(
    projectId: string, 
    slugline: string, 
    data: Partial<Omit<SceneMemory, 'projectId' | 'slugline'>>
  ): Promise<SceneMemory> {
    const requestData: UpdateSceneMemoryRequest = {
      projectId,
      slugline,
      data
    };

    const response = await apiRequest<SingleSceneResponse>('/memory/update', {
      method: 'POST',
      body: JSON.stringify(requestData),
    });

    if (!response.data) {
      throw new Error('No scene data returned from update');
    }

    return response.data;
  }

  /**
   * Get recent scenes for a project
   */
  static async getRecentScenes(projectId: string, count: number = 3): Promise<SceneMemory[]> {
    const response = await apiRequest<SceneMemoryResponse>(
      `/memory/recent?projectId=${encodeURIComponent(projectId)}&count=${count}`
    );

    return response.data || [];
  }

  /**
   * Get a scene by slugline
   */
  static async getSceneBySlugline(projectId: string, slugline: string): Promise<SceneMemory | undefined> {
    const response = await apiRequest<SingleSceneResponse>(
      `/memory/by-slugline?projectId=${encodeURIComponent(projectId)}&slugline=${encodeURIComponent(slugline)}`
    );

    return response.data;
  }

  /**
   * Get scenes by character
   */
  static async getScenesByCharacter(projectId: string, characterName: string): Promise<SceneMemory[]> {
    const response = await apiRequest<SceneMemoryResponse>(
      `/memory/by-character?projectId=${encodeURIComponent(projectId)}&name=${encodeURIComponent(characterName)}`
    );

    return response.data || [];
  }

  /**
   * Get scenes by theme
   */
  static async getScenesByTheme(projectId: string, theme: string): Promise<SceneMemory[]> {
    const response = await apiRequest<SceneMemoryResponse>(
      `/memory/by-theme?projectId=${encodeURIComponent(projectId)}&theme=${encodeURIComponent(theme)}`
    );

    return response.data || [];
  }

  /**
   * Get total token count for recent scenes
   */
  static async getTotalRecentTokens(projectId: string, sceneCount: number = 3): Promise<number> {
    const response = await apiRequest<TokensResponse>(
      `/memory/tokens?projectId=${encodeURIComponent(projectId)}&sceneCount=${sceneCount}`
    );

    return response.data || 0;
  }

  /**
   * Get all scenes for a project
   */
  static async getAllScenes(projectId: string): Promise<SceneMemory[]> {
    const response = await apiRequest<SceneMemoryResponse>(
      `/memory/all?projectId=${encodeURIComponent(projectId)}`
    );

    return response.data || [];
  }

  /**
   * Get memory statistics for a project
   */
  static async getMemoryStats(projectId: string): Promise<MemoryStats> {
    const response = await apiRequest<StatsResponse>(
      `/memory/stats?projectId=${encodeURIComponent(projectId)}`
    );

    if (!response.data) {
      throw new Error('No stats data returned');
    }

    return response.data;
  }

  /**
   * Clear all memory for a project
   */
  static async clearSceneMemory(projectId: string): Promise<void> {
    await apiRequest<SceneMemoryResponse>(
      `/memory/clear?projectId=${encodeURIComponent(projectId)}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Delete a specific scene
   */
  static async deleteScene(projectId: string, slugline: string): Promise<void> {
    await apiRequest<SceneMemoryResponse>(
      `/memory/scene?projectId=${encodeURIComponent(projectId)}&slugline=${encodeURIComponent(slugline)}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Check if API is available (health check)
   */
  static async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * React hooks for memory operations (optional - for easier React integration)
 */

export const useMemoryAPI = (projectId: string) => {
  const updateScene = async (slugline: string, data: Partial<Omit<SceneMemory, 'projectId' | 'slugline'>>) => {
    return MemoryAPI.updateSceneMemory(projectId, slugline, data);
  };

  const getRecent = async (count: number = 3) => {
    return MemoryAPI.getRecentScenes(projectId, count);
  };

  const getByCharacter = async (characterName: string) => {
    return MemoryAPI.getScenesByCharacter(projectId, characterName);
  };

  const getByTheme = async (theme: string) => {
    return MemoryAPI.getScenesByTheme(projectId, theme);
  };

  const getStats = async () => {
    return MemoryAPI.getMemoryStats(projectId);
  };

  return {
    updateScene,
    getRecent,
    getByCharacter,
    getByTheme,
    getStats,
    clearMemory: () => MemoryAPI.clearSceneMemory(projectId),
    deleteScene: (slugline: string) => MemoryAPI.deleteScene(projectId, slugline),
  };
};

export default MemoryAPI;