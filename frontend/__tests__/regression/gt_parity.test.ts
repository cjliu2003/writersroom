/**
 * Ground Truth Parity Test
 *
 * This test validates complete scene preservation by:
 * 1. Parsing sr_first_look_final.fdx
 * 2. POSTing to new /snapshot endpoint
 * 3. GETting from /snapshot endpoint
 * 4. Asserting deepEqual(parsed.scenes, stored.scenes)
 * 5. Validating scenes.length === 53 at every stage
 * 6. Ensuring all scene properties are preserved
 */

import { parseFDX } from '@/lib/fdx-parser';
import * as fs from 'fs';
import * as path from 'path';

// Mock fetch for testing
import fetch from 'node-fetch';
(global as any).fetch = fetch;

interface SceneData {
  slugline: string;
  characters: string[];
  summary: string;
  tokens: number;
  wordCount: number;
  fullContent?: string;
  sceneIndex: number;
  sceneId: string;
  originalSlugline: string;
}

interface ParsedResult {
  success: boolean;
  title: string;
  sceneCount: number;
  sluglines: string[];
  scenes: SceneData[];
  projectId: string;
}

describe('Ground Truth Parity Test - SR First Look Final', () => {
  const TEST_PROJECT_ID = 'gt-parity-test';
  const FDX_FILE_PATH = path.join(process.cwd(), '..', 'sr_first_look_final.fdx');
  const BACKEND_API_URL = process.env.TEST_API_URL || 'http://localhost:3001/api';

  // Ground truth constants
  const EXPECTED_SCENE_COUNT = 53;
  const EXPECTED_DUPLICATES = {
    'EXT. SILK ROAD - NIGHT': 3,
    'INT. TATTOO ROOM': 2,
    'INT. ROSS\'S HOUSE - DAY': 2,
    'INT. FBI OFFICE - DAY': 2,
    'INT. COURTHOUSE - DAY': 1
  };

  let parsedScenes: SceneData[] = [];
  let storedScenes: SceneData[] = [];

  beforeAll(async () => {
    // Ensure FDX file exists
    if (!fs.existsSync(FDX_FILE_PATH)) {
      throw new Error(`Required test file not found: ${FDX_FILE_PATH}`);
    }
  });

  describe('Stage 1: FDX Parsing', () => {
    it('should parse FDX and extract exactly 53 scenes', async () => {
      const fdxContent = await fs.promises.readFile(FDX_FILE_PATH, 'utf-8');

      // Parse using the same logic as the API route
      const result = await parseFDXContent(fdxContent, 'sr_first_look_final.fdx');

      expect(result.success).toBe(true);
      expect(result.scenes).toBeDefined();
      expect(result.scenes.length).toBe(EXPECTED_SCENE_COUNT);

      parsedScenes = result.scenes;

      // Validate scene structure
      parsedScenes.forEach((scene, index) => {
        expect(scene.sceneIndex).toBe(index);
        expect(scene.sceneId).toBe(`${result.projectId}:${index}`);
        expect(scene.originalSlugline).toBe(scene.slugline);
        expect(typeof scene.summary).toBe('string');
        expect(Array.isArray(scene.characters)).toBe(true);
        expect(typeof scene.tokens).toBe('number');
        expect(typeof scene.wordCount).toBe('number');
      });

      console.log(`✅ Stage 1: Parsed ${parsedScenes.length} scenes`);
    });

    it('should maintain distinct indices for duplicate sluglines', () => {
      const sluglineCounts: Record<string, number[]> = {};

      parsedScenes.forEach((scene) => {
        if (!sluglineCounts[scene.slugline]) {
          sluglineCounts[scene.slugline] = [];
        }
        sluglineCounts[scene.slugline].push(scene.sceneIndex);
      });

      // Verify duplicates have distinct indices
      Object.entries(EXPECTED_DUPLICATES).forEach(([slugline, expectedCount]) => {
        const indices = sluglineCounts[slugline] || [];
        if (expectedCount > 1) {
          expect(indices.length).toBeGreaterThanOrEqual(expectedCount);
          // All indices should be unique
          const uniqueIndices = new Set(indices);
          expect(uniqueIndices.size).toBe(indices.length);
        }
      });

      console.log(`✅ All duplicate sluglines have unique indices`);
    });
  });

  describe('Stage 2: Snapshot Storage', () => {
    it('should POST all scenes to snapshot endpoint atomically', async () => {
      const snapshotPayload = {
        projectId: TEST_PROJECT_ID,
        scenes: parsedScenes,
        metadata: {
          title: 'sr_first_look_final',
          totalScenes: parsedScenes.length,
          timestamp: new Date().toISOString()
        }
      };

      const response = await fetch(`${BACKEND_API_URL}/memory/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshotPayload)
      });

      expect(response.ok).toBe(true);
      const result = await response.json();

      expect(result.success).toBe(true);
      expect(result.storedCount).toBe(EXPECTED_SCENE_COUNT);

      console.log(`✅ Stage 2: Stored ${result.storedCount} scenes atomically`);
    });
  });

  describe('Stage 3: Snapshot Retrieval', () => {
    it('should GET all scenes from snapshot endpoint', async () => {
      const response = await fetch(`${BACKEND_API_URL}/memory/snapshot?projectId=${TEST_PROJECT_ID}`);

      expect(response.ok).toBe(true);
      const result = await response.json();

      expect(result.success).toBe(true);
      expect(result.scenes).toBeDefined();
      expect(result.scenes.length).toBe(EXPECTED_SCENE_COUNT);

      storedScenes = result.scenes;

      console.log(`✅ Stage 3: Retrieved ${storedScenes.length} scenes`);
    });
  });

  describe('Stage 4: Deep Equality Validation', () => {
    it('should have perfect parity between parsed and stored scenes', () => {
      expect(storedScenes.length).toBe(parsedScenes.length);

      // Deep equality check for each scene
      parsedScenes.forEach((parsedScene, index) => {
        const storedScene = storedScenes[index];

        // Core properties must match exactly
        expect(storedScene.sceneIndex).toBe(parsedScene.sceneIndex);
        expect(storedScene.sceneId).toBe(parsedScene.sceneId);
        expect(storedScene.originalSlugline).toBe(parsedScene.originalSlugline);
        expect(storedScene.slugline).toBe(parsedScene.slugline);

        // Content properties must match
        expect(storedScene.summary).toBe(parsedScene.summary);
        expect(storedScene.tokens).toBe(parsedScene.tokens);
        expect(storedScene.wordCount).toBe(parsedScene.wordCount);

        // Arrays must match (order may differ for characters)
        expect(new Set(storedScene.characters)).toEqual(new Set(parsedScene.characters));

        // Full content if present
        if (parsedScene.fullContent) {
          expect(storedScene.fullContent).toBe(parsedScene.fullContent);
        }
      });

      console.log(`✅ Stage 4: Perfect parity confirmed - all properties preserved`);
    });

    it('should preserve scene ordering exactly', () => {
      const parsedSlugs = parsedScenes.map(s => s.slugline);
      const storedSlugs = storedScenes.map(s => s.slugline);

      expect(storedSlugs).toEqual(parsedSlugs);

      console.log(`✅ Scene ordering preserved exactly`);
    });
  });

  describe('Stage 5: Invariant Validation', () => {
    it('should maintain scene count invariant at every stage', () => {
      // Invariant: Scene count must be 53 at every stage
      const invariant = {
        parsed: parsedScenes.length,
        stored: storedScenes.length,
        expected: EXPECTED_SCENE_COUNT
      };

      expect(invariant.parsed).toBe(invariant.expected);
      expect(invariant.stored).toBe(invariant.expected);

      // No scenes lost
      const lostScenes = invariant.parsed - invariant.stored;
      expect(lostScenes).toBe(0);

      console.log(`✅ Invariant maintained: ${invariant.parsed} → ${invariant.stored} = ${invariant.expected}`);
    });

    it('should have unique sceneId for every scene', () => {
      const sceneIds = new Set(storedScenes.map(s => s.sceneId));
      expect(sceneIds.size).toBe(storedScenes.length);

      console.log(`✅ All ${sceneIds.size} sceneIds are unique`);
    });

    it('should have contiguous sceneIndex from 0 to N-1', () => {
      const indices = storedScenes.map(s => s.sceneIndex).sort((a, b) => a - b);

      indices.forEach((index, position) => {
        expect(index).toBe(position);
      });

      console.log(`✅ Scene indices are contiguous from 0 to ${indices.length - 1}`);
    });
  });
});

/**
 * Helper function to parse FDX content (mirrors API logic)
 */
async function parseFDXContent(fdxContent: string, filename: string): Promise<ParsedResult> {
  // This would use the actual FDX parser from the API
  // For testing, we'll import and use the same logic
  const { parseFDX } = await import('@/app/api/fdx/import/route');
  return parseFDX(fdxContent, filename);
}