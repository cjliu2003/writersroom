/**
 * Backend Memory Service
 * 
 * Centralized service for managing scene memory in the backend.
 * Handles all memory operations with project namespacing and future database integration.
 */

import { SceneMemory, MemoryStats } from '../../shared/types';
import SnapshotService from './snapshotService';

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
   * Add or update a scene in memory using composite key (projectId + sceneIndex)
   * This prevents duplicate sluglines from overwriting each other.
   */
  static updateSceneMemory(
    projectId: string,
    slugline: string,
    data: Partial<Omit<SceneMemory, 'projectId' | 'slugline' | 'sceneId' | 'sceneIndex'>>,
    sceneIndex?: number
  ): SceneMemory {
    const memory = this.getProjectMemory(projectId);

    // Log incoming write request
    console.log(`\n📝 MEMORY WRITE REQUEST:`);
    console.log(`   Project: ${projectId}`);
    console.log(`   Scene Index: ${sceneIndex}`);
    console.log(`   Slugline: "${slugline}"`);
    console.log(`   Current memory size: ${memory.length} scenes`);

    // Generate composite sceneId if sceneIndex is provided
    const sceneId = sceneIndex !== undefined ? `${projectId}_${sceneIndex}` : undefined;

    if (sceneId) {
      console.log(`   Generated Scene ID: ${sceneId}`);
    }

    // Find existing scene by sceneId only (no slugline fallback to prevent duplicate scene overwrites)
    const existingIndex = sceneId
      ? memory.findIndex(scene => scene.sceneId === sceneId)
      : -1; // Always create new scene if no sceneId provided

    if (existingIndex !== -1) {
      // Update existing scene
      console.log(`   ⚠️ UPDATING existing scene at index ${existingIndex}`);
      console.log(`   Previous slugline: "${memory[existingIndex].slugline}"`);
      console.log(`   Previous sceneId: ${memory[existingIndex].sceneId}`);

      memory[existingIndex] = {
        ...memory[existingIndex],
        ...data,
        projectId,
        slugline,
        sceneId: sceneId || memory[existingIndex].sceneId,
        sceneIndex: sceneIndex !== undefined ? sceneIndex : memory[existingIndex].sceneIndex,
        timestamp: new Date()
      };

      console.log(`   ✅ Scene UPDATED successfully`);
      return memory[existingIndex];
    } else {
      // Create new scene entry with unique sceneId
      const newSceneIndex = sceneIndex !== undefined ? sceneIndex : memory.length;
      const newScene: SceneMemory = {
        projectId,
        slugline,
        sceneId: `${projectId}_${newSceneIndex}`,
        sceneIndex: newSceneIndex,
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

      // Check for duplicate sluglines in memory (for diagnostics)
      const duplicateSlugs = memory.filter(s => s.slugline === slugline);
      if (duplicateSlugs.length > 0) {
        console.log(`   📋 DUPLICATE SLUGLINE DETECTED: "${slugline}"`);
        console.log(`   Existing scenes with same slugline: ${duplicateSlugs.length}`);
        duplicateSlugs.forEach(s => {
          console.log(`      - SceneId: ${s.sceneId}, Index: ${s.sceneIndex}`);
        });
      }

      memory.push(newScene);
      console.log(`   ✅ NEW scene CREATED with ID: ${newScene.sceneId}`);
      console.log(`   Memory now has ${memory.length} scenes`);

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
        // Sort by sceneIndex first to maintain chronological order
        if (a.sceneIndex !== undefined && b.sceneIndex !== undefined) {
          return b.sceneIndex - a.sceneIndex; // Most recent scenes (higher index) first
        }
        // Fallback to timestamp for scenes without index
        const timeA = a.timestamp?.getTime() || 0;
        const timeB = b.timestamp?.getTime() || 0;
        return timeB - timeA;
      })
      .slice(0, count);
  }

  /**
   * Find a scene by its slugline and optional index
   * With sceneIndex, can retrieve specific instance of duplicate sluglines
   */
  static getSceneBySlugline(projectId: string, slugline: string, sceneIndex?: number): SceneMemory | undefined {
    const memory = this.getProjectMemory(projectId);

    if (sceneIndex !== undefined) {
      // Use composite key for precise lookup
      const sceneId = `${projectId}_${sceneIndex}`;
      return memory.find(scene => scene.sceneId === sceneId);
    }

    // Fallback to slugline lookup (returns first match)
    return memory.find(scene => scene.slugline === slugline);
  }

  /**
   * Find a scene by its composite sceneId
   */
  static getSceneById(projectId: string, sceneId: string): SceneMemory | undefined {
    const memory = this.getProjectMemory(projectId);
    return memory.find(scene => scene.sceneId === sceneId);
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
   * Get all scenes for a project, sorted by scene index
   * Also creates a snapshot if one doesn't exist (migration)
   */
  static getAllScenes(projectId: string): SceneMemory[] {
    const memory = this.getProjectMemory(projectId);

    console.log(`\n📊 MEMORY RETRIEVAL for project: ${projectId}`);
    console.log(`   Total scenes in memory: ${memory.length}`);

    // Count duplicate sluglines
    const sluglineCounts: { [key: string]: number } = {};
    memory.forEach(scene => {
      sluglineCounts[scene.slugline] = (sluglineCounts[scene.slugline] || 0) + 1;
    });

    const duplicates = Object.entries(sluglineCounts)
      .filter(([_, count]) => count > 1)
      .map(([slugline, count]) => `"${slugline}" (${count}x)`);

    if (duplicates.length > 0) {
      console.log(`   📋 Duplicate sluglines found: ${duplicates.length}`);
      duplicates.forEach(d => console.log(`      - ${d}`));
    }

    // Log scenes with their IDs
    console.log(`   Scene IDs in memory:`);
    memory.slice(0, 5).forEach(scene => {
      console.log(`      - ${scene.sceneId}: "${scene.slugline}"`);
    });
    if (memory.length > 10) {
      console.log(`      ... ${memory.length - 10} more scenes ...`);
    }
    memory.slice(-5).forEach(scene => {
      console.log(`      - ${scene.sceneId}: "${scene.slugline}"`);
    });

    // Sort by sceneIndex to maintain chronological order
    const sorted = [...memory].sort((a, b) => {
      if (a.sceneIndex !== undefined && b.sceneIndex !== undefined) {
        return a.sceneIndex - b.sceneIndex;
      }
      // Fallback for scenes without index
      return 0;
    });

    console.log(`   ✅ Returning ${sorted.length} scenes (sorted by index)`);

    // AUTO-MIGRATION: Create snapshot if memory exists but snapshot doesn't
    if (sorted.length > 0 && !SnapshotService.hasSnapshot(projectId)) {
      console.log(`\n🔄 AUTO-MIGRATION: Creating snapshot from memory for project ${projectId}`);

      // Extract title from first scene
      const title = sorted[0].projectTitle || 'Migrated Project';

      // Create snapshot from memory
      try {
        SnapshotService.storeSnapshot(projectId, {
          version: Date.now(),
          title,
          scenes: sorted,
          metadata: {
            createdAt: new Date().toISOString(),
            migratedFromMemory: true
          }
        });
        console.log(`   ✅ Migration successful: Created snapshot with ${sorted.length} scenes`);
      } catch (error) {
        console.error(`   ❌ Migration failed:`, error);
      }
    }

    return sorted;
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
   * Delete a specific scene by slugline or sceneId
   */
  static deleteScene(projectId: string, slugline: string, sceneIndex?: number): boolean {
    const memory = this.getProjectMemory(projectId);

    let index = -1;
    if (sceneIndex !== undefined) {
      // Delete by composite key
      const sceneId = `${projectId}_${sceneIndex}`;
      index = memory.findIndex(scene => scene.sceneId === sceneId);
    } else {
      // Fallback to slugline (deletes first match)
      index = memory.findIndex(scene => scene.slugline === slugline);
    }

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

  /**
   * Migrate existing scenes to use composite keys
   * This ensures backward compatibility for projects stored before the fix
   */
  static migrateProjectScenes(projectId: string): void {
    const memory = this.getProjectMemory(projectId);

    // Check if migration is needed (any scenes without sceneId)
    const needsMigration = memory.some(scene => !scene.sceneId);

    if (!needsMigration) {
      return; // Already migrated
    }

    console.log(`Migrating ${memory.length} scenes for project ${projectId}`);

    // Sort scenes by timestamp to maintain chronological order
    memory.sort((a, b) => {
      const timeA = a.timestamp?.getTime() || 0;
      const timeB = b.timestamp?.getTime() || 0;
      return timeA - timeB; // Oldest first
    });

    // Assign sequential indices and composite IDs
    memory.forEach((scene, index) => {
      if (!scene.sceneId) {
        scene.sceneIndex = index;
        scene.sceneId = `${projectId}_${index}`;
      }
    });

    console.log(`Migration complete for project ${projectId}`);
  }
}

// Export the service class as default
export default MemoryService;