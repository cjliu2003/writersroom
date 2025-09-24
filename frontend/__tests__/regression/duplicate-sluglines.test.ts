/**
 * Regression Tests for Duplicate Slugline Handling
 *
 * These tests validate that the system correctly handles scripts with multiple scenes
 * that share the same slugline (location), ensuring all scenes are preserved.
 *
 * Issue: Previously, the system lost 18.9% of scenes (10/53) in sr_first_look_final.fdx
 * due to duplicate sluglines overwriting each other in memory storage.
 *
 * Solution: Use composite keys (sceneId + slugline) for storage instead of slugline alone.
 */

import { parseFDX } from '@/lib/fdx-parser';
import { MemoryService } from '../../../backend/services/memoryService';
import { extractScenesFromEditor } from '@/utils/scene-extraction';
import * as fs from 'fs';
import * as path from 'path';

describe('Duplicate Slugline Regression Tests', () => {
  const TEST_PROJECT_ID = 'test-duplicate-sluglines';

  beforeEach(() => {
    // Clear memory before each test
    MemoryService.clearAllMemory();
  });

  afterEach(() => {
    // Clean up after each test
    MemoryService.clearAllMemory();
  });

  describe('Multiple Identical Sluglines', () => {
    it('should preserve all scenes with identical sluglines', async () => {
      // Create FDX with three identical "INT. TATTOO ROOM" scenes
      const fdxWithDuplicates = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>INT. TATTOO ROOM - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>First tattoo room scene. Ross enters.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>EXT. STREET - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Street scene between tattoo scenes.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. TATTOO ROOM - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Second tattoo room scene. Different action.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. OFFICE - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Office scene.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. TATTOO ROOM - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Third tattoo room scene. Final confrontation.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      // Parse the FDX
      const parsedContent = await parseFDX(fdxWithDuplicates);
      const scenes = extractScenesFromEditor(parsedContent);

      // Should have all 5 scenes
      expect(scenes).toHaveLength(5);

      // Filter for tattoo room scenes
      const tattooRoomScenes = scenes.filter(s => s.slugline === 'INT. TATTOO ROOM - DAY');
      expect(tattooRoomScenes).toHaveLength(3);

      // Each should have unique content
      expect(tattooRoomScenes[0].sceneText).toContain('First tattoo room scene');
      expect(tattooRoomScenes[1].sceneText).toContain('Second tattoo room scene');
      expect(tattooRoomScenes[2].sceneText).toContain('Third tattoo room scene');

      // Each should have a unique scene ID
      const sceneIds = tattooRoomScenes.map(s => s.id);
      expect(new Set(sceneIds).size).toBe(3); // All IDs should be unique
    });

    it('should handle back-to-back identical scenes', async () => {
      const fdxBackToBack = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>EXT. SILK ROAD - NIGHT</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>First Silk Road scene.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>EXT. SILK ROAD - NIGHT</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Second Silk Road scene, immediately following.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>EXT. SILK ROAD - NIGHT</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Third Silk Road scene, still consecutive.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(fdxBackToBack);
      const scenes = extractScenesFromEditor(parsedContent);

      // All three scenes should be preserved
      expect(scenes).toHaveLength(3);
      expect(scenes.every(s => s.slugline === 'EXT. SILK ROAD - NIGHT')).toBe(true);

      // Verify chronological order
      expect(scenes[0].sceneText).toContain('First Silk Road');
      expect(scenes[1].sceneText).toContain('Second Silk Road');
      expect(scenes[2].sceneText).toContain('Third Silk Road');

      // Verify scene IDs are sequential
      expect(scenes[0].id).toBe(1);
      expect(scenes[1].id).toBe(2);
      expect(scenes[2].id).toBe(3);
    });

    it('should preserve all 10 duplicate scenes from sr_first_look_final.fdx pattern', async () => {
      // Recreate the duplicate pattern from sr_first_look_final.fdx
      const duplicatePatterns = [
        { slugline: 'EXT. SILK ROAD - NIGHT', count: 3 },
        { slugline: 'INT. TATTOO ROOM', count: 2 },
        { slugline: 'INT. ROSS\'S HOUSE - DAY', count: 2 },
        { slugline: 'INT. FBI OFFICE - DAY', count: 2 },
        { slugline: 'INT. COURTHOUSE - DAY', count: 1 }
      ];

      let fdxBody = '';
      let expectedTotal = 0;

      // Generate scenes with duplicates
      for (const pattern of duplicatePatterns) {
        for (let i = 0; i < pattern.count; i++) {
          fdxBody += `
            <Paragraph Type="Scene Heading">
              <Text>${pattern.slugline}</Text>
            </Paragraph>
            <Paragraph Type="Action">
              <Text>Scene ${expectedTotal + 1}: ${pattern.slugline} occurrence ${i + 1}</Text>
            </Paragraph>`;
          expectedTotal++;
        }
      }

      const fdxDuplicatePattern = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>${fdxBody}
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(fdxDuplicatePattern);
      const scenes = extractScenesFromEditor(parsedContent);

      // Should have all 10 scenes
      expect(scenes).toHaveLength(expectedTotal);

      // Verify each duplicate group
      for (const pattern of duplicatePatterns) {
        const matchingScenes = scenes.filter(s => s.slugline === pattern.slugline);
        expect(matchingScenes).toHaveLength(pattern.count);
      }
    });
  });

  describe('Memory Storage with Composite Keys', () => {
    it('should use composite key (sceneId + slugline) for storage', async () => {
      // Store multiple scenes with same slugline
      const slugline = 'INT. RECURRING LOCATION - DAY';

      for (let i = 1; i <= 3; i++) {
        const sceneData = {
          sceneId: i,
          summary: `Scene ${i} at recurring location`,
          tokens: 100 * i,
          characters: [`Character${i}`],
          themeTags: ['recurring']
        };

        // Use composite key for storage
        const compositeKey = `scene_${i}_${slugline}`;
        MemoryService.updateSceneMemory(TEST_PROJECT_ID, compositeKey, sceneData);
      }

      // Retrieve all scenes
      const allScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);

      // Should have all 3 scenes stored
      expect(allScenes).toHaveLength(3);

      // Each should have unique data
      expect(allScenes[0].summary).toContain('Scene 1');
      expect(allScenes[1].summary).toContain('Scene 2');
      expect(allScenes[2].summary).toContain('Scene 3');
    });

    it('should maintain unique storage even with identical sluglines', async () => {
      const scenes = [
        { id: 1, slugline: 'INT. ROOM - DAY', text: 'First room scene' },
        { id: 2, slugline: 'INT. ROOM - DAY', text: 'Second room scene' },
        { id: 3, slugline: 'INT. ROOM - DAY', text: 'Third room scene' }
      ];

      // Store using composite keys
      for (const scene of scenes) {
        const compositeKey = `scene_${scene.id}_${scene.slugline}`;
        MemoryService.updateSceneMemory(TEST_PROJECT_ID, compositeKey, {
          sceneId: scene.id,
          fullContent: scene.text,
          summary: `Summary for scene ${scene.id}`,
          tokens: 100
        });
      }

      const stored = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(stored).toHaveLength(3);

      // Verify no overwriting occurred
      const summaries = stored.map(s => s.summary);
      expect(summaries).toContain('Summary for scene 1');
      expect(summaries).toContain('Summary for scene 2');
      expect(summaries).toContain('Summary for scene 3');
    });

    it('should handle retrieval by original slugline pattern', async () => {
      // Store with composite keys
      const baseSlugline = 'INT. LOCATION - DAY';
      const scenes = [
        { id: 1, key: `scene_1_${baseSlugline}` },
        { id: 2, key: `scene_2_${baseSlugline}` },
        { id: 3, key: `scene_3_${baseSlugline}` }
      ];

      for (const scene of scenes) {
        MemoryService.updateSceneMemory(TEST_PROJECT_ID, scene.key, {
          sceneId: scene.id,
          summary: `Scene ${scene.id}`,
          tokens: 100
        });
      }

      // Should be able to find all scenes with the base slugline
      const allScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      const matchingScenes = allScenes.filter(s =>
        s.slugline.includes(baseSlugline)
      );

      expect(matchingScenes).toHaveLength(3);
    });
  });

  describe('Chronological Order Preservation', () => {
    it('should maintain document order despite duplicate sluglines', async () => {
      const fdxWithMixedDuplicates = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>INT. APARTMENT - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Scene 1: First apartment scene.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>EXT. STREET - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Scene 2: Street scene.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. APARTMENT - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Scene 3: Return to apartment.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. OFFICE - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Scene 4: Office scene.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. APARTMENT - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Scene 5: Final apartment scene.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(fdxWithMixedDuplicates);
      const scenes = extractScenesFromEditor(parsedContent);

      // All 5 scenes should be present
      expect(scenes).toHaveLength(5);

      // Verify order is preserved
      expect(scenes[0].sceneText).toContain('Scene 1');
      expect(scenes[1].sceneText).toContain('Scene 2');
      expect(scenes[2].sceneText).toContain('Scene 3');
      expect(scenes[3].sceneText).toContain('Scene 4');
      expect(scenes[4].sceneText).toContain('Scene 5');

      // Scene IDs should be sequential
      scenes.forEach((scene, index) => {
        expect(scene.id).toBe(index + 1);
      });
    });

    it('should preserve narrative flow with recurring locations', async () => {
      const narrativeFlow = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>INT. COFFEE SHOP - MORNING</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Character enters for the first time.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>EXT. PARK - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Walk in the park.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. COFFEE SHOP - AFTERNOON</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Returns to coffee shop later.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. COFFEE SHOP - EVENING</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Final coffee shop scene.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(narrativeFlow);
      const scenes = extractScenesFromEditor(parsedContent);

      // All scenes preserved
      expect(scenes).toHaveLength(4);

      // Coffee shop scenes should maintain their temporal progression
      const coffeeScenes = scenes.filter(s => s.slugline.includes('COFFEE SHOP'));
      expect(coffeeScenes).toHaveLength(3);

      expect(coffeeScenes[0].slugline).toContain('MORNING');
      expect(coffeeScenes[1].slugline).toContain('AFTERNOON');
      expect(coffeeScenes[2].slugline).toContain('EVENING');
    });
  });

  describe('Edge Cases with Duplicates', () => {
    it('should handle empty or whitespace-only sluglines without duplication', async () => {
      const fdxWithEmptySlugs = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>   </Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>First empty slugline scene.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>   </Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Second empty slugline scene.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text></Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Third empty slugline scene.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(fdxWithEmptySlugs);
      const scenes = extractScenesFromEditor(parsedContent);

      // Should create distinct scenes even with empty sluglines
      expect(scenes.length).toBeGreaterThanOrEqual(3);

      // Each should have unique content
      const sceneTexts = scenes.map(s => s.sceneText);
      expect(sceneTexts.some(text => text.includes('First empty'))).toBe(true);
      expect(sceneTexts.some(text => text.includes('Second empty'))).toBe(true);
      expect(sceneTexts.some(text => text.includes('Third empty'))).toBe(true);
    });

    it('should handle case variations as distinct scenes', async () => {
      const fdxWithCaseVariations = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>INT. ROOM - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Uppercase version.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>int. room - day</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Lowercase version.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>Int. Room - Day</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Mixed case version.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(fdxWithCaseVariations);
      const scenes = extractScenesFromEditor(parsedContent);

      // Should preserve all variations
      expect(scenes).toHaveLength(3);

      // Verify each variation is preserved
      expect(scenes[0].sceneText).toContain('Uppercase version');
      expect(scenes[1].sceneText).toContain('Lowercase version');
      expect(scenes[2].sceneText).toContain('Mixed case version');
    });

    it('should handle very long duplicate sequences', async () => {
      const DUPLICATE_COUNT = 20;
      let fdxBody = '';

      for (let i = 1; i <= DUPLICATE_COUNT; i++) {
        fdxBody += `
          <Paragraph Type="Scene Heading">
            <Text>INT. REPEATED LOCATION - DAY</Text>
          </Paragraph>
          <Paragraph Type="Action">
            <Text>Occurrence number ${i} of the repeated location.</Text>
          </Paragraph>`;
      }

      const fdxManyDuplicates = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>${fdxBody}
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(fdxManyDuplicates);
      const scenes = extractScenesFromEditor(parsedContent);

      // All duplicates should be preserved
      expect(scenes).toHaveLength(DUPLICATE_COUNT);

      // Verify each has unique content
      for (let i = 1; i <= DUPLICATE_COUNT; i++) {
        const scene = scenes[i - 1];
        expect(scene.sceneText).toContain(`Occurrence number ${i}`);
        expect(scene.id).toBe(i);
      }
    });
  });

  describe('Storage System Validation', () => {
    it('should generate stable composite keys', () => {
      const testCases = [
        { sceneId: 1, slugline: 'INT. ROOM - DAY' },
        { sceneId: 2, slugline: 'INT. ROOM - DAY' },
        { sceneId: 3, slugline: 'INT. ROOM - DAY' }
      ];

      const keys = testCases.map(tc => `scene_${tc.sceneId}_${tc.slugline}`);

      // All keys should be unique
      expect(new Set(keys).size).toBe(3);

      // Keys should be consistent
      expect(keys[0]).toBe('scene_1_INT. ROOM - DAY');
      expect(keys[1]).toBe('scene_2_INT. ROOM - DAY');
      expect(keys[2]).toBe('scene_3_INT. ROOM - DAY');
    });

    it('should prevent data loss with composite key system', async () => {
      const scenes = [];
      const SCENE_COUNT = 10;
      const SLUGLINE = 'INT. COMMON LOCATION - DAY';

      // Store scenes with same slugline
      for (let i = 1; i <= SCENE_COUNT; i++) {
        const compositeKey = `scene_${i}_${SLUGLINE}`;
        const sceneData = {
          sceneId: i,
          summary: `Scene ${i} summary`,
          fullContent: `Unique content for scene ${i}`,
          tokens: 100 + i,
          characters: [`Character${i}`]
        };

        MemoryService.updateSceneMemory(TEST_PROJECT_ID, compositeKey, sceneData);
        scenes.push({ key: compositeKey, data: sceneData });
      }

      // Retrieve and validate
      const stored = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(stored).toHaveLength(SCENE_COUNT);

      // Verify no data was lost or overwritten
      for (let i = 1; i <= SCENE_COUNT; i++) {
        const scene = stored.find(s => s.summary === `Scene ${i} summary`);
        expect(scene).toBeDefined();
        expect(scene?.tokens).toBe(100 + i);
      }
    });

    it('should maintain referential integrity with composite keys', async () => {
      const slugline = 'INT. LOCATION - DAY';

      // Store original scene
      const originalKey = `scene_1_${slugline}`;
      MemoryService.updateSceneMemory(TEST_PROJECT_ID, originalKey, {
        sceneId: 1,
        summary: 'Original scene',
        tokens: 100
      });

      // Update the same scene
      MemoryService.updateSceneMemory(TEST_PROJECT_ID, originalKey, {
        summary: 'Updated scene',
        tokens: 150
      });

      const stored = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(stored).toHaveLength(1);
      expect(stored[0].summary).toBe('Updated scene');
      expect(stored[0].tokens).toBe(150);

      // Add a different scene with same base slugline
      const newKey = `scene_2_${slugline}`;
      MemoryService.updateSceneMemory(TEST_PROJECT_ID, newKey, {
        sceneId: 2,
        summary: 'New scene',
        tokens: 200
      });

      const allStored = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(allStored).toHaveLength(2);
    });
  });
});