/**
 * Ground Truth Validation for sr_first_look_final.fdx
 *
 * This test specifically validates that the sr_first_look_final.fdx file,
 * which previously lost 18.9% of scenes (10 out of 53) due to duplicate sluglines,
 * now preserves all 53 scenes correctly with the composite key storage fix.
 *
 * Known issues in the old system:
 * - Lost 3 "EXT. SILK ROAD - NIGHT" scenes
 * - Lost 2 "INT. TATTOO ROOM" scenes
 * - Lost 2 "INT. ROSS'S HOUSE - DAY" scenes
 * - Lost 2 "INT. FBI OFFICE - DAY" scenes
 * - Lost 1 "INT. COURTHOUSE - DAY" scene
 */

import { parseFDX } from '@/lib/fdx-parser';
import { MemoryService } from '../../../backend/services/memoryService';
import { extractScenesFromEditor } from '@/utils/scene-extraction';
import * as fs from 'fs';
import * as path from 'path';

describe('SR First Look Final - Ground Truth Validation', () => {
  const TEST_PROJECT_ID = 'sr-first-look-validation';
  const FDX_FILE_PATH = path.join(process.cwd(), '..', 'sr_first_look_final.fdx');

  // Expected scene counts based on manual analysis
  const GROUND_TRUTH = {
    totalScenes: 53,
    duplicateGroups: {
      'EXT. SILK ROAD - NIGHT': 3,
      'INT. TATTOO ROOM': 2,
      'INT. ROSS\'S HOUSE - DAY': 2,
      'INT. FBI OFFICE - DAY': 2,
      'INT. COURTHOUSE - DAY': 1 // Not actually a duplicate but was lost
    },
    uniqueScenes: 43,
    totalDuplicateScenes: 10
  };

  beforeEach(() => {
    MemoryService.clearAllMemory();
  });

  afterEach(() => {
    MemoryService.clearAllMemory();
  });

  describe('File Parsing Validation', () => {
    it('should successfully parse sr_first_look_final.fdx', async () => {
      // Skip if file doesn't exist
      if (!fs.existsSync(FDX_FILE_PATH)) {
        console.warn(`Skipping test: ${FDX_FILE_PATH} not found`);
        return;
      }

      const fdxContent = await fs.promises.readFile(FDX_FILE_PATH, 'utf-8');
      expect(fdxContent).toBeTruthy();
      expect(fdxContent).toContain('<?xml');
      expect(fdxContent).toContain('FinalDraft');

      const parsedContent = await parseFDX(fdxContent);
      expect(parsedContent).toBeTruthy();
    });

    it('should extract exactly 53 scenes from sr_first_look_final.fdx', async () => {
      if (!fs.existsSync(FDX_FILE_PATH)) {
        console.warn(`Skipping test: ${FDX_FILE_PATH} not found`);
        return;
      }

      const fdxContent = await fs.promises.readFile(FDX_FILE_PATH, 'utf-8');
      const parsedContent = await parseFDX(fdxContent);
      const scenes = extractScenesFromEditor(parsedContent);

      // CRITICAL ASSERTION: Must have all 53 scenes
      expect(scenes).toHaveLength(GROUND_TRUTH.totalScenes);

      // Verify scene IDs are sequential
      scenes.forEach((scene, index) => {
        expect(scene.id).toBe(index + 1);
      });
    });
  });

  describe('Duplicate Scene Preservation', () => {
    it('should preserve all duplicate SILK ROAD scenes', async () => {
      if (!fs.existsSync(FDX_FILE_PATH)) {
        console.warn(`Skipping test: ${FDX_FILE_PATH} not found`);
        return;
      }

      const fdxContent = await fs.promises.readFile(FDX_FILE_PATH, 'utf-8');
      const parsedContent = await parseFDX(fdxContent);
      const scenes = extractScenesFromEditor(parsedContent);

      const silkRoadScenes = scenes.filter(s =>
        s.slugline.includes('SILK ROAD') && s.slugline.includes('NIGHT')
      );

      // Must have all 3 Silk Road scenes
      expect(silkRoadScenes).toHaveLength(GROUND_TRUTH.duplicateGroups['EXT. SILK ROAD - NIGHT']);

      // Each should have unique content
      const sceneTexts = silkRoadScenes.map(s => s.sceneText);
      const uniqueTexts = new Set(sceneTexts);
      expect(uniqueTexts.size).toBe(3); // All three should be different
    });

    it('should preserve all duplicate TATTOO ROOM scenes', async () => {
      if (!fs.existsSync(FDX_FILE_PATH)) {
        console.warn(`Skipping test: ${FDX_FILE_PATH} not found`);
        return;
      }

      const fdxContent = await fs.promises.readFile(FDX_FILE_PATH, 'utf-8');
      const parsedContent = await parseFDX(fdxContent);
      const scenes = extractScenesFromEditor(parsedContent);

      const tattooScenes = scenes.filter(s =>
        s.slugline.includes('TATTOO ROOM')
      );

      // Must have all 2 Tattoo Room scenes
      expect(tattooScenes).toHaveLength(GROUND_TRUTH.duplicateGroups['INT. TATTOO ROOM']);

      // Verify they have different content
      expect(tattooScenes[0].sceneText).not.toBe(tattooScenes[1].sceneText);
    });

    it('should preserve all duplicate ROSS\'S HOUSE scenes', async () => {
      if (!fs.existsSync(FDX_FILE_PATH)) {
        console.warn(`Skipping test: ${FDX_FILE_PATH} not found`);
        return;
      }

      const fdxContent = await fs.promises.readFile(FDX_FILE_PATH, 'utf-8');
      const parsedContent = await parseFDX(fdxContent);
      const scenes = extractScenesFromEditor(parsedContent);

      const rossHouseScenes = scenes.filter(s =>
        s.slugline.includes('ROSS') && s.slugline.includes('HOUSE')
      );

      // Must have all Ross's House scenes
      expect(rossHouseScenes.length).toBeGreaterThanOrEqual(
        GROUND_TRUTH.duplicateGroups['INT. ROSS\'S HOUSE - DAY']
      );
    });

    it('should preserve all duplicate FBI OFFICE scenes', async () => {
      if (!fs.existsSync(FDX_FILE_PATH)) {
        console.warn(`Skipping test: ${FDX_FILE_PATH} not found`);
        return;
      }

      const fdxContent = await fs.promises.readFile(FDX_FILE_PATH, 'utf-8');
      const parsedContent = await parseFDX(fdxContent);
      const scenes = extractScenesFromEditor(parsedContent);

      const fbiScenes = scenes.filter(s =>
        s.slugline.includes('FBI') && s.slugline.includes('OFFICE')
      );

      // Must have all FBI Office scenes
      expect(fbiScenes.length).toBeGreaterThanOrEqual(
        GROUND_TRUTH.duplicateGroups['INT. FBI OFFICE - DAY']
      );
    });
  });

  describe('Memory Storage Validation', () => {
    it('should store all 53 scenes in memory without loss', async () => {
      if (!fs.existsSync(FDX_FILE_PATH)) {
        console.warn(`Skipping test: ${FDX_FILE_PATH} not found`);
        return;
      }

      const fdxContent = await fs.promises.readFile(FDX_FILE_PATH, 'utf-8');
      const parsedContent = await parseFDX(fdxContent);
      const scenes = extractScenesFromEditor(parsedContent);

      // Store all scenes with composite keys
      for (const scene of scenes) {
        await MemoryService.updateSceneMemory(
          TEST_PROJECT_ID,
          scene.slugline,
          {
            summary: scene.summary || '',
            fullContent: scene.sceneText,
            tokens: scene.tokenCount,
            wordCount: scene.sceneText.split(/\s+/).length
          },
          scene.id - 1 // Use 0-based index
        );
      }

      // Retrieve all stored scenes
      const storedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);

      // CRITICAL: Must have all 53 scenes in storage
      expect(storedScenes).toHaveLength(GROUND_TRUTH.totalScenes);

      // Verify scene preservation by slugline groups
      const storedSilkRoad = storedScenes.filter(s =>
        s.slugline.includes('SILK ROAD')
      );
      const storedTattoo = storedScenes.filter(s =>
        s.slugline.includes('TATTOO ROOM')
      );

      expect(storedSilkRoad.length).toBeGreaterThanOrEqual(
        GROUND_TRUTH.duplicateGroups['EXT. SILK ROAD - NIGHT']
      );
      expect(storedTattoo.length).toBeGreaterThanOrEqual(
        GROUND_TRUTH.duplicateGroups['INT. TATTOO ROOM']
      );
    });

    it('should maintain unique sceneIds for all 53 scenes', async () => {
      if (!fs.existsSync(FDX_FILE_PATH)) {
        console.warn(`Skipping test: ${FDX_FILE_PATH} not found`);
        return;
      }

      const fdxContent = await fs.promises.readFile(FDX_FILE_PATH, 'utf-8');
      const parsedContent = await parseFDX(fdxContent);
      const scenes = extractScenesFromEditor(parsedContent);

      // Store all scenes
      for (const scene of scenes) {
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

      const storedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);

      // Extract all sceneIds
      const sceneIds = storedScenes.map(s => s.sceneId);
      const uniqueSceneIds = new Set(sceneIds);

      // All sceneIds must be unique
      expect(uniqueSceneIds.size).toBe(GROUND_TRUTH.totalScenes);

      // Verify sceneId format
      storedScenes.forEach((scene, index) => {
        expect(scene.sceneId).toBe(`${TEST_PROJECT_ID}_${index}`);
        expect(scene.sceneIndex).toBe(index);
      });
    });
  });

  describe('Scene Loss Prevention', () => {
    it('should achieve 0% scene loss (previously 18.9%)', async () => {
      if (!fs.existsSync(FDX_FILE_PATH)) {
        console.warn(`Skipping test: ${FDX_FILE_PATH} not found`);
        return;
      }

      const fdxContent = await fs.promises.readFile(FDX_FILE_PATH, 'utf-8');
      const parsedContent = await parseFDX(fdxContent);
      const extractedScenes = extractScenesFromEditor(parsedContent);

      // Store all scenes
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

      const storedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);

      // Calculate scene loss
      const expectedScenes = GROUND_TRUTH.totalScenes;
      const actualScenes = storedScenes.length;
      const sceneLoss = expectedScenes - actualScenes;
      const sceneLossPercentage = (sceneLoss / expectedScenes) * 100;

      // CRITICAL ASSERTION: 0% scene loss
      expect(sceneLossPercentage).toBe(0);
      expect(actualScenes).toBe(expectedScenes);

      console.info(`Scene preservation: ${actualScenes}/${expectedScenes} (${100 - sceneLossPercentage}%)`);
      console.info(`Previously lost: 10 scenes (18.9%)`);
      console.info(`Currently lost: ${sceneLoss} scenes (${sceneLossPercentage}%)`);
    });

    it('should preserve all 10 previously lost scenes', async () => {
      if (!fs.existsSync(FDX_FILE_PATH)) {
        console.warn(`Skipping test: ${FDX_FILE_PATH} not found`);
        return;
      }

      const fdxContent = await fs.promises.readFile(FDX_FILE_PATH, 'utf-8');
      const parsedContent = await parseFDX(fdxContent);
      const scenes = extractScenesFromEditor(parsedContent);

      // Store all scenes
      for (const scene of scenes) {
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

      const storedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);

      // Verify the 10 previously lost duplicate scenes are now preserved
      const duplicateCounts = {
        silkRoad: storedScenes.filter(s => s.slugline.includes('SILK ROAD')).length,
        tattoo: storedScenes.filter(s => s.slugline.includes('TATTOO ROOM')).length,
        ross: storedScenes.filter(s => s.slugline.includes('ROSS') && s.slugline.includes('HOUSE')).length,
        fbi: storedScenes.filter(s => s.slugline.includes('FBI') && s.slugline.includes('OFFICE')).length,
        courthouse: storedScenes.filter(s => s.slugline.includes('COURTHOUSE')).length
      };

      // All duplicate groups should be fully preserved
      expect(duplicateCounts.silkRoad).toBeGreaterThanOrEqual(3);
      expect(duplicateCounts.tattoo).toBeGreaterThanOrEqual(2);
      expect(duplicateCounts.ross).toBeGreaterThanOrEqual(2);
      expect(duplicateCounts.fbi).toBeGreaterThanOrEqual(2);
      expect(duplicateCounts.courthouse).toBeGreaterThanOrEqual(1);

      const totalDuplicates = Object.values(duplicateCounts).reduce((a, b) => a + b, 0);
      expect(totalDuplicates).toBeGreaterThanOrEqual(GROUND_TRUTH.totalDuplicateScenes);
    });
  });

  describe('Chronological Integrity', () => {
    it('should maintain scene order from original script', async () => {
      if (!fs.existsSync(FDX_FILE_PATH)) {
        console.warn(`Skipping test: ${FDX_FILE_PATH} not found`);
        return;
      }

      const fdxContent = await fs.promises.readFile(FDX_FILE_PATH, 'utf-8');
      const parsedContent = await parseFDX(fdxContent);
      const originalScenes = extractScenesFromEditor(parsedContent);

      // Store in order
      for (const scene of originalScenes) {
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

      const storedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);

      // Verify order is maintained
      expect(storedScenes).toHaveLength(originalScenes.length);

      storedScenes.forEach((stored, index) => {
        const original = originalScenes[index];
        expect(stored.slugline).toBe(original.slugline);
        expect(stored.sceneIndex).toBe(index);
        expect(stored.fullContent).toBe(original.sceneText);
      });
    });
  });

  describe('Comparison Report', () => {
    it('should generate before/after comparison showing improvement', async () => {
      if (!fs.existsSync(FDX_FILE_PATH)) {
        console.warn(`Skipping test: ${FDX_FILE_PATH} not found`);
        return;
      }

      const fdxContent = await fs.promises.readFile(FDX_FILE_PATH, 'utf-8');
      const parsedContent = await parseFDX(fdxContent);
      const scenes = extractScenesFromEditor(parsedContent);

      // Simulate old system (slugline-only keys)
      const oldSystemStorage = new Map<string, any>();
      scenes.forEach(scene => {
        // Old system would overwrite duplicates
        oldSystemStorage.set(scene.slugline, scene);
      });

      // New system with composite keys
      for (const scene of scenes) {
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

      const newSystemStorage = MemoryService.getAllScenes(TEST_PROJECT_ID);

      // Generate comparison report
      const report = {
        'System': ['Old (Slugline-Only)', 'New (Composite Keys)'],
        'Total Scenes Parsed': [scenes.length, scenes.length],
        'Scenes Stored': [oldSystemStorage.size, newSystemStorage.length],
        'Scenes Lost': [scenes.length - oldSystemStorage.size, scenes.length - newSystemStorage.length],
        'Loss Percentage': [
          `${((scenes.length - oldSystemStorage.size) / scenes.length * 100).toFixed(1)}%`,
          `${((scenes.length - newSystemStorage.length) / scenes.length * 100).toFixed(1)}%`
        ],
        'Improvement': `${oldSystemStorage.size} → ${newSystemStorage.length} scenes (+${newSystemStorage.length - oldSystemStorage.size})`
      };

      console.table(report);

      // Assertions
      expect(oldSystemStorage.size).toBeLessThan(scenes.length); // Old system loses scenes
      expect(newSystemStorage.length).toBe(scenes.length); // New system preserves all
      expect(newSystemStorage.length - oldSystemStorage.size).toBe(GROUND_TRUTH.totalDuplicateScenes);
    });
  });

  describe('Specific Scene Validation', () => {
    it('should preserve key story moments that were previously lost', async () => {
      if (!fs.existsSync(FDX_FILE_PATH)) {
        console.warn(`Skipping test: ${FDX_FILE_PATH} not found`);
        return;
      }

      const fdxContent = await fs.promises.readFile(FDX_FILE_PATH, 'utf-8');
      const parsedContent = await parseFDX(fdxContent);
      const scenes = extractScenesFromEditor(parsedContent);

      // Store all scenes
      for (const scene of scenes) {
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

      const storedScenes = MemoryService.getAllScenes(TEST_PROJECT_ID);

      // Check for key narrative elements that should be preserved
      const hasMultipleSilkRoadMoments = storedScenes.filter(s =>
        s.slugline.includes('SILK ROAD')
      ).length >= 3;

      const hasMultipleTattooScenes = storedScenes.filter(s =>
        s.slugline.includes('TATTOO')
      ).length >= 2;

      const hasMultipleRossHouseScenes = storedScenes.filter(s =>
        s.slugline.includes('ROSS') && s.slugline.includes('HOUSE')
      ).length >= 2;

      expect(hasMultipleSilkRoadMoments).toBe(true);
      expect(hasMultipleTattooScenes).toBe(true);
      expect(hasMultipleRossHouseScenes).toBe(true);

      console.info('Key story moments preserved:');
      console.info('- Multiple Silk Road marketplace scenes');
      console.info('- Multiple tattoo parlor confrontations');
      console.info('- Multiple scenes at Ross\'s house');
      console.info('All narrative threads maintained!');
    });
  });
});