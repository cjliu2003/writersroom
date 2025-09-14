/**
 * Backend Memory Service
 * 
 * Centralized service for managing scene memory in the backend.
 * Handles all memory operations with project namespacing and future database integration.
 */

import { SceneMemory, MemoryStats } from '../../shared/types';

// In-memory storage (future: replace with database)
// Structure: Map<projectId, SceneMemory[]>
const projectMemories = new Map<string, SceneMemory[]>();

/**
 * Memory Service Class
 */
export class MemoryService {
  
  /**
   * Get or initialize memory for a project
   */
  private static getProjectMemory(projectId: string): SceneMemory[] {
    if (!projectMemories.has(projectId)) {
      projectMemories.set(projectId, []);
    }
    return projectMemories.get(projectId)!;
  }

  /**
   * Add or update a scene in memory by slugline
   * If scene exists, it updates the existing entry. If not, creates a new one.
   */
  static updateSceneMemory(
    projectId: string, 
    slugline: string, 
    data: Partial<Omit<SceneMemory, 'projectId' | 'slugline'>>
  ): SceneMemory {
    const memory = this.getProjectMemory(projectId);
    const existingIndex = memory.findIndex(scene => scene.slugline === slugline);
    
    if (existingIndex !== -1) {
      // Update existing scene
      memory[existingIndex] = {
        ...memory[existingIndex],
        ...data,
        projectId,
        slugline, // Ensure slugline stays consistent
        timestamp: new Date() // Update timestamp
      };
      return memory[existingIndex];
    } else {
      // Create new scene entry
      const newScene: SceneMemory = {
        projectId,
        slugline,
        characters: data.characters || [],
        summary: data.summary || '',
        tone: data.tone,
        themeTags: data.themeTags,
        tokens: data.tokens,
        timestamp: new Date(),
        wordCount: data.wordCount,
        fullContent: data.fullContent,
        projectTitle: data.projectTitle
      };
      memory.push(newScene);
      return newScene;
    }
  }

  /**
   * Get the N most recent scenes for a project
   * Useful for providing recent context to GPT prompts
   */
  static getRecentScenes(projectId: string, count: number = 3): SceneMemory[] {
    const memory = this.getProjectMemory(projectId);
    return memory
      .sort((a, b) => {
        const timeA = a.timestamp?.getTime() || 0;
        const timeB = b.timestamp?.getTime() || 0;
        return timeB - timeA; // Most recent first
      })
      .slice(0, count);
  }

  /**
   * Find a scene by its slugline
   */
  static getSceneBySlugline(projectId: string, slugline: string): SceneMemory | undefined {
    const memory = this.getProjectMemory(projectId);
    return memory.find(scene => scene.slugline === slugline);
  }

  /**
   * Get all scenes involving specific characters
   * Useful for character-focused prompts
   */
  static getScenesByCharacter(projectId: string, characterName: string): SceneMemory[] {
    const memory = this.getProjectMemory(projectId);
    return memory.filter(scene => 
      scene.characters.some(char => 
        char.toLowerCase().includes(characterName.toLowerCase())
      )
    );
  }

  /**
   * Get scenes by theme tags
   * Useful for thematic analysis and prompt context
   */
  static getScenesByTheme(projectId: string, theme: string): SceneMemory[] {
    const memory = this.getProjectMemory(projectId);
    return memory.filter(scene => 
      scene.themeTags?.some(tag => 
        tag.toLowerCase().includes(theme.toLowerCase())
      )
    );
  }

  /**
   * Get total token count for recent scenes (for prompt budget management)
   */
  static getTotalRecentTokens(projectId: string, sceneCount: number = 3): number {
    return this.getRecentScenes(projectId, sceneCount)
      .reduce((total, scene) => total + (scene.tokens || 0), 0);
  }

  /**
   * Get all scenes for a project
   */
  static getAllScenes(projectId: string): SceneMemory[] {
    return this.getProjectMemory(projectId);
  }

  /**
   * Clear all scene memory for a project
   */
  static clearSceneMemory(projectId: string): void {
    projectMemories.set(projectId, []);
  }

  /**
   * Clear all memory for all projects (useful for testing)
   */
  static clearAllMemory(): void {
    projectMemories.clear();
  }

  /**
   * Get memory stats for a project
   */
  static getMemoryStats(projectId: string): MemoryStats {
    const memory = this.getProjectMemory(projectId);
    const totalTokens = memory.reduce((sum, scene) => sum + (scene.tokens || 0), 0);
    const totalWords = memory.reduce((sum, scene) => sum + (scene.wordCount || 0), 0);
    const uniqueCharacters = Array.from(new Set(
      memory.flatMap(scene => scene.characters)
    ));
    const allThemes = Array.from(new Set(
      memory.flatMap(scene => scene.themeTags || [])
    ));

    return {
      totalScenes: memory.length,
      totalTokens,
      averageWordsPerScene: memory.length > 0 ? Math.round(totalWords / memory.length) : 0,
      uniqueCharacters,
      allThemes
    };
  }

  /**
   * Get global stats across all projects (for admin/debugging)
   */
  static getGlobalStats(): {
    totalProjects: number;
    totalScenesAllProjects: number;
    projectIds: string[];
  } {
    const projectIds = Array.from(projectMemories.keys());
    const totalScenesAllProjects = projectIds.reduce((total, projectId) => {
      return total + this.getProjectMemory(projectId).length;
    }, 0);

    return {
      totalProjects: projectIds.length,
      totalScenesAllProjects,
      projectIds
    };
  }

  /**
   * Delete a specific scene by slugline
   */
  static deleteScene(projectId: string, slugline: string): boolean {
    const memory = this.getProjectMemory(projectId);
    const index = memory.findIndex(scene => scene.slugline === slugline);
    
    if (index !== -1) {
      memory.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Delete all scenes for a project
   */
  static deleteProject(projectId: string): boolean {
    return projectMemories.delete(projectId);
  }

  /**
   * Check if a project has any scenes
   */
  static hasScenes(projectId: string): boolean {
    const memory = this.getProjectMemory(projectId);
    return memory.length > 0;
  }

  /**
   * Get scene count for a project
   */
  static getSceneCount(projectId: string): number {
    return this.getProjectMemory(projectId).length;
  }
}

// Export the service class as default
export default MemoryService;