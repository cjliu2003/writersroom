/**
 * End-to-End Pipeline Validation Tests
 *
 * These tests validate the complete pipeline from FDX parsing through memory storage
 * to editor display, ensuring no scenes are lost at any stage. Special focus on
 * sr_first_look_final.fdx which previously lost 18.9% of scenes.
 */

import { parseFDX } from '@/lib/fdx-parser';
import { MemoryService } from '../../../backend/services/memoryService';
import { extractScenesFromEditor } from '@/utils/scene-extraction';
import * as fs from 'fs';
import * as path from 'path';

// Mock console for cleaner test output
const originalConsoleLog = console.log;
beforeAll(() => {
  console.log = jest.fn();
});
afterAll(() => {
  console.log = originalConsoleLog;
});

describe('End-to-End Pipeline Validation', () => {
  const TEST_PROJECT_ID = 'test-e2e-pipeline';

  beforeEach(() => {
    MemoryService.clearAllMemory();
  });

  afterEach(() => {
    MemoryService.clearAllMemory();
  });

  describe('Complete Pipeline Flow', () => {
    it('should preserve all scenes from FDX to memory to editor', async () => {
      // Test with a complex FDX containing duplicate sluglines
      const fdxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>INT. APARTMENT - MORNING</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Scene 1: Morning routine.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>EXT. STREET - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Scene 2: Walking to work.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. OFFICE - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Scene 3: At the office.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. APARTMENT - EVENING</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Scene 4: Back home in evening.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. APARTMENT - NIGHT</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Scene 5: Late night.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      // Stage 1: Parse FDX
      const parsedContent = await parseFDX(fdxContent);
      expect(parsedContent).toBeDefined();

      // Stage 2: Extract scenes
      const extractedScenes = extractScenesFromEditor(parsedContent);
      expect(extractedScenes).toHaveLength(5);

      // Stage 3: Store in memory with composite keys
      for (const scene of extractedScenes) {
        const sceneIndex = scene.id - 1; // Convert 1-based to 0-based index
        await MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          scene.slugline,
          {
            summary: scene.summary || `Summary for scene ${scene.id}`,
            fullContent: scene.sceneText,
            tokens: scene.tokenCount,
            wordCount: scene.sceneText.split(/\s+/).length
          },
          sceneIndex
        );
      }

      // Stage 4: Retrieve from memory
      const storedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(storedScenes).toHaveLength(5);

      // Validate scene preservation
      extractedScenes.forEach((originalScene, index) => {
        const storedScene = storedScenes[index];
        expect(storedScene.slugline).toBe(originalScene.slugline);
        expect(storedScene.fullContent).toBe(originalScene.sceneText);
        expect(storedScene.sceneIndex).toBe(index);
        expect(storedScene.sceneId).toBe(`${TEST_PROJECT_ID}_${index}`);
      });
    });

    it('should handle pipeline with heavy duplicate sluglines', async () => {
      // Create FDX with multiple duplicate sluglines
      const duplicateScenes = [
        { slugline: 'INT. ROOM - DAY', content: 'First room scene' },
        { slugline: 'INT. ROOM - DAY', content: 'Second room scene' },
        { slugline: 'EXT. STREET - NIGHT', content: 'Street scene' },
        { slugline: 'INT. ROOM - DAY', content: 'Third room scene' },
        { slugline: 'INT. OFFICE - DAY', content: 'Office scene' },
        { slugline: 'EXT. STREET - NIGHT', content: 'Another street scene' },
        { slugline: 'INT. ROOM - DAY', content: 'Fourth room scene' }
      ];

      let fdxBody = '';
      duplicateScenes.forEach(scene => {
        fdxBody += `
          <Paragraph Type="Scene Heading">
            <Text>${scene.slugline}</Text>
          </Paragraph>
          <Paragraph Type="Action">
            <Text>${scene.content}</Text>
          </Paragraph>`;
      });

      const fdxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>${fdxBody}
            </Body>
          </Content>
        </FinalDraft>`;

      // Process through pipeline
      const parsedContent = await parseFDX(fdxContent);
      const extractedScenes = extractScenesFromEditor(parsedContent);

      expect(extractedScenes).toHaveLength(7);

      // Store with composite keys
      for (const scene of extractedScenes) {
        await MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          scene.slugline,
          {
            summary: scene.summary || '',
            fullContent: scene.sceneText,
            tokens: scene.tokenCount
          },
          scene.id - 1
        );
      }

      // Verify all scenes preserved
      const storedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(storedScenes).toHaveLength(7);

      // Count duplicate preservation
      const roomScenes = storedScenes.filter(s => s.slugline === 'INT. ROOM - DAY');
      const streetScenes = storedScenes.filter(s => s.slugline === 'EXT. STREET - NIGHT');

      expect(roomScenes).toHaveLength(4);
      expect(streetScenes).toHaveLength(2);
    });
  });

  describe('Sr_First_Look_Final Validation', () => {
    it('should preserve all 53 scenes from sr_first_look_final pattern', async () => {
      // Recreate the pattern from sr_first_look_final.fdx
      // This file has 53 total scenes with these duplicates:
      const scenePattern = [
        // Unique scenes (43)
        ...Array(43).fill(null).map((_, i) => ({
          slugline: `INT. UNIQUE SCENE ${i + 1} - DAY`,
          content: `Unique scene ${i + 1} content`
        })),
        // Duplicate scenes (10 scenes across 5 locations)
        { slugline: 'EXT. SILK ROAD - NIGHT', content: 'First Silk Road scene' },
        { slugline: 'EXT. SILK ROAD - NIGHT', content: 'Second Silk Road scene' },
        { slugline: 'EXT. SILK ROAD - NIGHT', content: 'Third Silk Road scene' },
        { slugline: 'INT. TATTOO ROOM', content: 'First tattoo room scene' },
        { slugline: 'INT. TATTOO ROOM', content: 'Second tattoo room scene' },
        { slugline: 'INT. ROSS\'S HOUSE - DAY', content: 'First Ross house scene' },
        { slugline: 'INT. ROSS\'S HOUSE - DAY', content: 'Second Ross house scene' },
        { slugline: 'INT. FBI OFFICE - DAY', content: 'First FBI office scene' },
        { slugline: 'INT. FBI OFFICE - DAY', content: 'Second FBI office scene' },
        { slugline: 'INT. COURTHOUSE - DAY', content: 'Courthouse scene' }
      ];

      // Shuffle to simulate real script order
      const shuffled = [...scenePattern].sort(() => Math.random() - 0.5);

      let fdxBody = '';
      shuffled.forEach((scene, index) => {
        fdxBody += `
          <Paragraph Type="Scene Heading">
            <Text>${scene.slugline}</Text>
          </Paragraph>
          <Paragraph Type="Action">
            <Text>${scene.content}</Text>
          </Paragraph>`;
      });

      const fdxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>${fdxBody}
            </Body>
          </Content>
        </FinalDraft>`;

      // Parse FDX
      const parsedContent = await parseFDX(fdxContent);
      const extractedScenes = extractScenesFromEditor(parsedContent);

      // Critical: Should have all 53 scenes
      expect(extractedScenes).toHaveLength(53);

      // Store in memory with composite keys
      const storedPromises = extractedScenes.map((scene, index) => {
        return MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          scene.slugline,
          {
            summary: `Scene ${index + 1}`,
            fullContent: scene.sceneText,
            tokens: scene.tokenCount
          },
          index
        );
      });

      await Promise.all(storedPromises);

      // Verify memory storage
      const storedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(storedScenes).toHaveLength(53);

      // Verify duplicate scenes are preserved
      const silkRoadScenes = storedScenes.filter(s => s.slugline === 'EXT. SILK ROAD - NIGHT');
      const tattooScenes = storedScenes.filter(s => s.slugline === 'INT. TATTOO ROOM');
      const rossHouseScenes = storedScenes.filter(s => s.slugline.includes('ROSS\'S HOUSE'));
      const fbiScenes = storedScenes.filter(s => s.slugline === 'INT. FBI OFFICE - DAY');

      expect(silkRoadScenes).toHaveLength(3);
      expect(tattooScenes).toHaveLength(2);
      expect(rossHouseScenes).toHaveLength(2);
      expect(fbiScenes).toHaveLength(2);

      // Verify scene loss percentage is 0%
      const sceneLossPercentage = ((53 - storedScenes.length) / 53) * 100;
      expect(sceneLossPercentage).toBe(0);
    });

    it('should maintain chronological order for all 53 scenes', async () => {
      const scenes = [];
      for (let i = 1; i <= 53; i++) {
        // Mix unique and duplicate sluglines
        const isDuplicate = i > 43;
        const slugline = isDuplicate
          ? `INT. DUPLICATE LOCATION ${(i - 43) % 5} - DAY`
          : `INT. SCENE ${i} - DAY`;

        scenes.push({
          slugline,
          content: `Scene ${i} content`,
          order: i
        });
      }

      let fdxBody = '';
      scenes.forEach(scene => {
        fdxBody += `
          <Paragraph Type="Scene Heading">
            <Text>${scene.slugline}</Text>
          </Paragraph>
          <Paragraph Type="Action">
            <Text>${scene.content}</Text>
          </Paragraph>`;
      });

      const fdxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>${fdxBody}
            </Body>
          </Content>
        </FinalDraft>`;

      // Process through pipeline
      const parsedContent = await parseFDX(fdxContent);
      const extractedScenes = extractScenesFromEditor(parsedContent);

      expect(extractedScenes).toHaveLength(53);

      // Store with proper indices
      for (let i = 0; i < extractedScenes.length; i++) {
        await MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          extractedScenes[i].slugline,
          {
            summary: extractedScenes[i].summary || '',
            fullContent: extractedScenes[i].sceneText
          },
          i
        );
      }

      // Retrieve and verify order
      const storedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(storedScenes).toHaveLength(53);

      // Verify chronological order is maintained
      storedScenes.forEach((scene, index) => {
        expect(scene.sceneIndex).toBe(index);
        expect(scene.fullContent).toContain(`Scene ${index + 1} content`);
      });
    });
  });

  describe('Pipeline Error Recovery', () => {
    it('should handle malformed FDX without losing valid scenes', async () => {
      const fdxWithErrors = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>INT. VALID SCENE 1 - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Valid content 1</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text></Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Content with empty slugline</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. VALID SCENE 2 - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Valid content 2</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>   </Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Content with whitespace slugline</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. VALID SCENE 3 - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Valid content 3</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(fdxWithErrors);
      const extractedScenes = extractScenesFromEditor(parsedContent);

      // Should handle malformed scenes gracefully
      expect(extractedScenes.length).toBeGreaterThanOrEqual(3);

      // Store all extracted scenes
      for (let i = 0; i < extractedScenes.length; i++) {
        await MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          extractedScenes[i].slugline || `UNTITLED_${i}`,
          {
            summary: `Scene ${i + 1}`,
            fullContent: extractedScenes[i].sceneText
          },
          i
        );
      }

      const storedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(storedScenes.length).toBeGreaterThanOrEqual(3);

      // Verify valid scenes are preserved
      const validScenes = storedScenes.filter(s =>
        s.slugline.includes('VALID SCENE')
      );
      expect(validScenes.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle concurrent scene storage without data loss', async () => {
      const sceneCount = 20;
      const scenes = Array(sceneCount).fill(null).map((_, i) => ({
        id: i,
        slugline: i % 3 === 0 ? 'INT. DUPLICATE - DAY' : `INT. SCENE ${i} - DAY`,
        content: `Concurrent scene ${i}`
      }));

      // Parse mock FDX
      let fdxBody = '';
      scenes.forEach(scene => {
        fdxBody += `
          <Paragraph Type="Scene Heading">
            <Text>${scene.slugline}</Text>
          </Paragraph>
          <Paragraph Type="Action">
            <Text>${scene.content}</Text>
          </Paragraph>`;
      });

      const fdxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>${fdxBody}
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(fdxContent);
      const extractedScenes = extractScenesFromEditor(parsedContent);

      // Store all scenes concurrently
      const storagePromises = extractedScenes.map((scene, index) =>
        MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          scene.slugline,
          {
            summary: `Concurrent ${index}`,
            fullContent: scene.sceneText
          },
          index
        )
      );

      await Promise.all(storagePromises);

      // Verify no scenes were lost
      const storedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(storedScenes).toHaveLength(sceneCount);

      // Verify all content is preserved
      for (let i = 0; i < sceneCount; i++) {
        const scene = storedScenes[i];
        expect(scene.fullContent).toContain(`Concurrent scene ${i}`);
      }
    });
  });

  describe('Migration Path', () => {
    it('should migrate legacy stored scenes to composite keys', () => {
      // Simulate legacy storage (without sceneId/sceneIndex)
      const projectMemory = [];
      for (let i = 0; i < 5; i++) {
        projectMemory.push({
          projectId: TEST_PROJECT_ID,
          slugline: `INT. LEGACY SCENE ${i} - DAY`,
          summary: `Legacy scene ${i}`,
          tokens: 100,
          characters: [],
          timestamp: new Date(Date.now() - (5 - i) * 60000) // Older timestamps for earlier scenes
        });
      }

      // Directly set memory to simulate legacy state
      // Note: In production, this would be loaded from database
      const memory = MemoryService['getProjectMemory'](TEST_PROJECT_ID);
      projectMemory.forEach(scene => memory.push(scene as any));

      // Run migration
      MemoryService.migrateProjectScenes(TEST_PROJECT_ID);

      // Verify migration
      const migratedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(migratedScenes).toHaveLength(5);

      migratedScenes.forEach((scene, index) => {
        expect(scene.sceneId).toBe(`${TEST_PROJECT_ID}_${index}`);
        expect(scene.sceneIndex).toBe(index);
        expect(scene.summary).toBe(`Legacy scene ${index}`);
      });
    });

    it('should handle mixed legacy and new scenes during migration', () => {
      const memory = MemoryService['getProjectMemory'](TEST_PROJECT_ID);

      // Add legacy scenes (without sceneId)
      memory.push({
        projectId: TEST_PROJECT_ID,
        slugline: 'INT. LEGACY 1 - DAY',
        summary: 'Legacy 1',
        characters: [],
        timestamp: new Date(Date.now() - 30000)
      } as any);

      memory.push({
        projectId: TEST_PROJECT_ID,
        slugline: 'INT. LEGACY 2 - DAY',
        summary: 'Legacy 2',
        characters: [],
        timestamp: new Date(Date.now() - 20000)
      } as any);

      // Add new scene (with sceneId)
      memory.push({
        projectId: TEST_PROJECT_ID,
        slugline: 'INT. NEW SCENE - DAY',
        summary: 'New scene',
        sceneId: `${TEST_PROJECT_ID}_10`,
        sceneIndex: 10,
        characters: [],
        timestamp: new Date()
      } as any);

      // Run migration
      MemoryService.migrateProjectScenes(TEST_PROJECT_ID);

      const scenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      expect(scenes).toHaveLength(3);

      // Legacy scenes should be migrated
      const legacy1 = scenes.find(s => s.slugline === 'INT. LEGACY 1 - DAY');
      const legacy2 = scenes.find(s => s.slugline === 'INT. LEGACY 2 - DAY');
      expect(legacy1?.sceneId).toBeDefined();
      expect(legacy2?.sceneId).toBeDefined();

      // New scene should remain unchanged
      const newScene = scenes.find(s => s.slugline === 'INT. NEW SCENE - DAY');
      expect(newScene?.sceneId).toBe(`${TEST_PROJECT_ID}_10`);
      expect(newScene?.sceneIndex).toBe(10);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should handle 100+ scenes efficiently', async () => {
      const sceneCount = 100;
      let fdxBody = '';

      for (let i = 0; i < sceneCount; i++) {
        const slugline = i % 10 === 0
          ? 'INT. REPEATED LOCATION - DAY'
          : `INT. SCENE ${i} - DAY`;

        fdxBody += `
          <Paragraph Type="Scene Heading">
            <Text>${slugline}</Text>
          </Paragraph>
          <Paragraph Type="Action">
            <Text>Content for scene ${i + 1}</Text>
          </Paragraph>`;
      }

      const fdxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>${fdxBody}
            </Body>
          </Content>
        </FinalDraft>`;

      const startTime = Date.now();

      // Parse
      const parsedContent = await parseFDX(fdxContent);
      const parseTime = Date.now() - startTime;

      // Extract
      const extractStart = Date.now();
      const extractedScenes = extractScenesFromEditor(parsedContent);
      const extractTime = Date.now() - extractStart;

      expect(extractedScenes).toHaveLength(sceneCount);

      // Store
      const storeStart = Date.now();
      for (let i = 0; i < extractedScenes.length; i++) {
        await MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          extractedScenes[i].slugline,
          {
            summary: `Scene ${i + 1}`,
            fullContent: extractedScenes[i].sceneText
          },
          i
        );
      }
      const storeTime = Date.now() - storeStart;

      // Retrieve
      const retrieveStart = Date.now();
      const storedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);
      const retrieveTime = Date.now() - retrieveStart;

      expect(storedScenes).toHaveLength(sceneCount);

      // Performance assertions
      expect(parseTime).toBeLessThan(2000); // Parse in under 2s
      expect(extractTime).toBeLessThan(1000); // Extract in under 1s
      expect(storeTime).toBeLessThan(2000); // Store in under 2s
      expect(retrieveTime).toBeLessThan(100); // Retrieve in under 100ms

      console.info(`Performance for ${sceneCount} scenes:
        Parse: ${parseTime}ms
        Extract: ${extractTime}ms
        Store: ${storeTime}ms
        Retrieve: ${retrieveTime}ms
        Total: ${parseTime + extractTime + storeTime + retrieveTime}ms`);
    });
  });
});