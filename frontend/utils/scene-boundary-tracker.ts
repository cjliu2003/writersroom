/**
 * Scene Boundary Tracker
 *
 * Tracks scene boundaries within full script Yjs document.
 * Maintains mapping between scene UUIDs and their positions in the script.
 *
 * This utility is designed for script-level collaboration where a single Y.Doc
 * contains the entire screenplay, but we still need to identify individual scenes
 * for navigation, editing, and metadata operations.
 *
 * Key Responsibilities:
 * - Extract scene boundaries from Slate document nodes
 * - Map scene UUIDs to their start/end positions in the document
 * - Support scene-based navigation and node extraction
 * - Enable scene-level operations within script-level architecture
 */

import { Node } from 'slate';
import { ScreenplayElement } from '@/types/screenplay';

/**
 * Represents the boundaries of a single scene within the full script.
 */
export interface SceneBoundary {
  /** Unique identifier for the scene (from metadata or generated) */
  uuid: string;
  /** Starting node index in the document array */
  startIndex: number;
  /** Ending node index in the document array (inclusive) */
  endIndex: number;
  /** Scene heading text (e.g., "INT. OFFICE - DAY") */
  heading: string;
  /** Sequential position of scene in script (0-indexed) */
  position: number;
}

/**
 * Tracks and manages scene boundaries within a full script document.
 *
 * Usage:
 * ```typescript
 * const tracker = new SceneBoundaryTracker();
 * const boundaries = tracker.extractBoundaries(editorValue);
 * tracker.updateBoundaries(boundaries);
 *
 * // Find scene containing cursor position
 * const scene = tracker.getSceneAtIndex(cursorIndex);
 *
 * // Get nodes for a specific scene
 * const sceneNodes = tracker.getSceneNodes(sceneUuid, editorValue);
 * ```
 */
export class SceneBoundaryTracker {
  private boundaries: Map<string, SceneBoundary> = new Map();

  /**
   * Extract scene boundaries from Slate document value.
   *
   * Iterates through the document nodes and identifies scene boundaries based on
   * 'scene_heading' type nodes. Each scene starts with a scene_heading and continues
   * until the next scene_heading or end of document.
   *
   * @param nodes - Array of Slate nodes representing the screenplay
   * @returns Array of scene boundaries in document order
   */
  extractBoundaries(nodes: ScreenplayElement[]): SceneBoundary[] {
    const boundaries: SceneBoundary[] = [];
    let currentScene: Partial<SceneBoundary> | null = null;
    let scenePosition = 0;

    nodes.forEach((node, index) => {
      if (node.type === 'scene_heading') {
        // Close previous scene
        if (currentScene && currentScene.startIndex !== undefined) {
          boundaries.push({
            uuid: currentScene.uuid!,
            startIndex: currentScene.startIndex,
            endIndex: index - 1,
            heading: currentScene.heading!,
            position: scenePosition - 1
          });
        }

        // Start new scene
        currentScene = {
          uuid: node.metadata?.uuid || crypto.randomUUID(),
          startIndex: index,
          heading: Node.string(node),
          position: scenePosition
        };
        scenePosition++;
      }
    });

    // Close last scene
    if (currentScene && currentScene.startIndex !== undefined) {
      boundaries.push({
        uuid: currentScene.uuid!,
        startIndex: currentScene.startIndex,
        endIndex: nodes.length - 1,
        heading: currentScene.heading!,
        position: scenePosition - 1
      });
    }

    return boundaries;
  }

  /**
   * Update internal boundary map with new boundaries.
   *
   * Clears existing boundaries and replaces them with the provided array.
   * This should be called after extractBoundaries() to update the tracker's state.
   *
   * @param boundaries - Array of scene boundaries to store
   */
  updateBoundaries(boundaries: SceneBoundary[]) {
    this.boundaries.clear();
    boundaries.forEach(boundary => {
      this.boundaries.set(boundary.uuid, boundary);
    });
  }

  /**
   * Get scene containing a specific node index.
   *
   * Searches through all tracked boundaries to find which scene contains
   * the given node index. Useful for cursor-based scene detection.
   *
   * @param index - Node index to search for
   * @returns Scene boundary containing the index, or null if not found
   */
  getSceneAtIndex(index: number): SceneBoundary | null {
    for (const boundary of this.boundaries.values()) {
      if (index >= boundary.startIndex && index <= boundary.endIndex) {
        return boundary;
      }
    }
    return null;
  }

  /**
   * Get all scenes as ordered array.
   *
   * Returns all tracked scenes sorted by their position in the script.
   * Useful for rendering scene lists, navigation menus, or table of contents.
   *
   * @returns Array of scene boundaries ordered by position
   */
  getAllScenes(): SceneBoundary[] {
    return Array.from(this.boundaries.values())
      .sort((a, b) => a.position - b.position);
  }

  /**
   * Get nodes for a specific scene.
   *
   * Extracts the array slice of nodes belonging to a specific scene based on
   * its start and end indices. Returns empty array if scene UUID not found.
   *
   * @param sceneUuid - UUID of the scene to extract
   * @param allNodes - Complete array of screenplay nodes
   * @returns Array of nodes belonging to the scene
   */
  getSceneNodes(sceneUuid: string, allNodes: ScreenplayElement[]): ScreenplayElement[] {
    const boundary = this.boundaries.get(sceneUuid);
    if (!boundary) return [];

    return allNodes.slice(boundary.startIndex, boundary.endIndex + 1);
  }

  /**
   * Get scene boundary by UUID.
   *
   * Direct lookup of scene boundary by its UUID.
   *
   * @param sceneUuid - UUID of the scene to retrieve
   * @returns Scene boundary or undefined if not found
   */
  getSceneBoundary(sceneUuid: string): SceneBoundary | undefined {
    return this.boundaries.get(sceneUuid);
  }

  /**
   * Check if a scene UUID is tracked.
   *
   * @param sceneUuid - UUID to check
   * @returns True if scene is tracked
   */
  hasScene(sceneUuid: string): boolean {
    return this.boundaries.has(sceneUuid);
  }

  /**
   * Get total number of scenes tracked.
   *
   * @returns Number of scenes in the tracker
   */
  getSceneCount(): number {
    return this.boundaries.size;
  }

  /**
   * Clear all tracked boundaries.
   *
   * Useful for resetting the tracker state.
   */
  clear() {
    this.boundaries.clear();
  }
}
