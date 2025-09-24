/**
 * Snapshot Service for Atomic Project Storage
 *
 * Provides atomic storage and retrieval of complete project snapshots
 * to replace the unreliable per-scene memory writes.
 */

import { SceneMemory } from '../../shared/types';

// Project snapshot structure
export interface ProjectSnapshot {
  projectId: string;
  version: number;
  title: string;
  scenes: SceneMemory[];
  elements?: any[];
  metadata: {
    createdAt: string;
    updatedAt: string;
    sceneCount: number;
    totalWords: number;
    totalTokens: number;
  };
}

// In-memory storage for snapshots (future: replace with database)
const projectSnapshots = new Map<string, ProjectSnapshot>();

export class SnapshotService {
  /**
   * Store a complete project snapshot atomically
   * This replaces the entire project state in a single operation
   */
  static storeSnapshot(
    projectId: string,
    data: {
      version: number;
      title?: string;
      scenes: SceneMemory[];
      elements?: any[];
      metadata?: any;
    }
  ): ProjectSnapshot {
    console.log(`\n📸 ATOMIC SNAPSHOT WRITE:`);
    console.log(`   Project ID: ${projectId}`);
    console.log(`   Version: ${data.version}`);
    console.log(`   Scene Count: ${data.scenes.length}`);
    console.log(`   Elements Count: ${data.elements?.length || 0}`);

    // Enhanced debug logging for scene preservation
    if (data.scenes.length > 0) {
      console.log(`   First Scene: ${data.scenes[0].slugline || 'No slugline'}`);
      console.log(`   Last Scene: ${data.scenes[data.scenes.length - 1].slugline || 'No slugline'}`);

      // Check for duplicate sluglines
      const sluglines = data.scenes.map(s => s.slugline);
      const uniqueSlugs = new Set(sluglines);
      if (uniqueSlugs.size < sluglines.length) {
        console.log(`   ⚠️ Duplicate sluglines detected: ${sluglines.length - uniqueSlugs.size} duplicates`);
      }
    }

    // Calculate aggregate metrics
    const totalWords = data.scenes.reduce((sum, scene) => sum + (scene.wordCount || 0), 0);
    const totalTokens = data.scenes.reduce((sum, scene) => sum + (scene.tokens || 0), 0);

    // Ensure scenes have proper indexing
    const indexedScenes = data.scenes.map((scene, index) => ({
      ...scene,
      projectId,
      sceneIndex: scene.sceneIndex !== undefined ? scene.sceneIndex : index,
      sceneId: scene.sceneId || `${projectId}_${scene.sceneIndex !== undefined ? scene.sceneIndex : index}`,
      timestamp: scene.timestamp || new Date()
    }));

    // Create the snapshot
    const snapshot: ProjectSnapshot = {
      projectId,
      version: data.version,
      title: data.title || 'Untitled Project',
      scenes: indexedScenes,
      elements: data.elements,
      metadata: {
        createdAt: data.metadata?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sceneCount: indexedScenes.length,
        totalWords,
        totalTokens,
        ...data.metadata
      }
    };

    // Store atomically (replaces entire previous snapshot)
    projectSnapshots.set(projectId, snapshot);

    console.log(`   ✅ SNAPSHOT STORED SUCCESSFULLY`);
    console.log(`   Total scenes: ${snapshot.scenes.length}`);
    console.log(`   Total words: ${totalWords}`);
    console.log(`   Total tokens: ${totalTokens}`);
    console.log(`   ✅ Snapshot upload complete. Scenes saved: ${snapshot.scenes.length}`);

    // Verify storage integrity
    const verification = projectSnapshots.get(projectId);
    if (verification && verification.scenes.length === data.scenes.length) {
      console.log(`   🔍 VERIFIED: All ${data.scenes.length} scenes persisted`);
    } else {
      console.error(`   ❌ VERIFICATION FAILED: Expected ${data.scenes.length} scenes, got ${verification?.scenes.length || 0}`);
    }

    return snapshot;
  }

  /**
   * Retrieve a complete project snapshot
   */
  static getSnapshot(projectId: string): ProjectSnapshot | null {
    console.log(`\n📸 ATOMIC SNAPSHOT READ:`);
    console.log(`   Project ID: ${projectId}`);

    const snapshot = projectSnapshots.get(projectId);

    if (!snapshot) {
      console.log(`   ⚠️ No snapshot found for project`);
      return null;
    }

    console.log(`   ✅ SNAPSHOT RETRIEVED`);
    console.log(`   Version: ${snapshot.version}`);
    console.log(`   Scene Count: ${snapshot.scenes.length}`);
    console.log(`   Last Updated: ${snapshot.metadata.updatedAt}`);
    console.log(`   ✅ Snapshot loaded. Scenes retrieved: ${snapshot.scenes.length}`);

    return snapshot;
  }

  /**
   * Update snapshot metadata without changing scenes
   */
  static updateMetadata(projectId: string, metadata: Partial<ProjectSnapshot['metadata']>): boolean {
    const snapshot = projectSnapshots.get(projectId);

    if (!snapshot) {
      return false;
    }

    snapshot.metadata = {
      ...snapshot.metadata,
      ...metadata,
      updatedAt: new Date().toISOString()
    };

    projectSnapshots.set(projectId, snapshot);
    return true;
  }

  /**
   * Check if a snapshot exists
   */
  static hasSnapshot(projectId: string): boolean {
    return projectSnapshots.has(projectId);
  }

  /**
   * Delete a project snapshot
   */
  static deleteSnapshot(projectId: string): boolean {
    console.log(`\n🗑️ DELETING SNAPSHOT for project: ${projectId}`);
    return projectSnapshots.delete(projectId);
  }

  /**
   * Get snapshot statistics
   */
  static getStats(projectId: string): any {
    const snapshot = projectSnapshots.get(projectId);

    if (!snapshot) {
      return null;
    }

    return {
      projectId,
      version: snapshot.version,
      sceneCount: snapshot.scenes.length,
      totalWords: snapshot.metadata.totalWords,
      totalTokens: snapshot.metadata.totalTokens,
      createdAt: snapshot.metadata.createdAt,
      updatedAt: snapshot.metadata.updatedAt,
      memoryUsage: JSON.stringify(snapshot).length // Approximate bytes
    };
  }

  /**
   * List all project IDs with snapshots
   */
  static listProjects(): string[] {
    return Array.from(projectSnapshots.keys());
  }

  /**
   * Get global statistics across all snapshots
   */
  static getGlobalStats(): any {
    const projects = Array.from(projectSnapshots.values());

    return {
      totalProjects: projects.length,
      totalScenes: projects.reduce((sum, p) => sum + p.scenes.length, 0),
      totalWords: projects.reduce((sum, p) => sum + p.metadata.totalWords, 0),
      totalMemoryUsage: projects.reduce((sum, p) => sum + JSON.stringify(p).length, 0),
      projects: projects.map(p => ({
        projectId: p.projectId,
        title: p.title,
        sceneCount: p.scenes.length,
        version: p.version
      }))
    };
  }
}

export default SnapshotService;