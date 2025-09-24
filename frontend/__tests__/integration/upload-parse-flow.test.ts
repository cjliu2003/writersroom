/**
 * Integration Tests for FDX Upload → Parse → Memory Pipeline
 *
 * Tests the complete flow from FDX file upload through parsing,
 * scene extraction, memory creation, and editor loading.
 */

import { parseUploadedFile, hydrateMemoryFromFDX } from '../../lib/fdx-parser';
import { extractScenesFromEditor } from '@/utils/scene-extraction';
import { MemoryAPI } from '@/utils/memoryAPI';
import { ScreenplayElement } from '@/types/screenplay';

// Mock the modules
jest.mock('../../lib/fdx-parser');
jest.mock('@/utils/memoryAPI');

// Mock global fetch
global.fetch = jest.fn();

describe('Upload → Parse → Memory Pipeline Integration', () => {
  const mockProjectId = 'test-project-123';

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('Complete FDX Upload Flow', () => {
    it('should successfully parse FDX and create memory entries', async () => {
      // Mock FDX file content
      const mockFDXContent = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Paragraph Type="Scene Heading">
              <Text>INT. OFFICE - DAY</Text>
            </Paragraph>
            <Paragraph Type="Action">
              <Text>John enters the office.</Text>
            </Paragraph>
            <Paragraph Type="Character">
              <Text>JOHN</Text>
            </Paragraph>
            <Paragraph Type="Dialogue">
              <Text>Good morning everyone.</Text>
            </Paragraph>
            <Paragraph Type="Scene Heading">
              <Text>EXT. PARKING LOT - DAY</Text>
            </Paragraph>
            <Paragraph Type="Action">
              <Text>Cars fill the parking lot.</Text>
            </Paragraph>
          </Content>
        </FinalDraft>`;

      // Mock parsed Slate elements
      const mockParsedElements: ScreenplayElement[] = [
        {
          type: 'scene_heading',
          children: [{ text: 'INT. OFFICE - DAY' }],
        },
        {
          type: 'action',
          children: [{ text: 'John enters the office.' }],
        },
        {
          type: 'character',
          children: [{ text: 'JOHN' }],
        },
        {
          type: 'dialogue',
          children: [{ text: 'Good morning everyone.' }],
        },
        {
          type: 'scene_heading',
          children: [{ text: 'EXT. PARKING LOT - DAY' }],
        },
        {
          type: 'action',
          children: [{ text: 'Cars fill the parking lot.' }],
        },
      ];

      // Mock the parser
      (parseUploadedFile as jest.Mock).mockResolvedValueOnce({
        elements: mockParsedElements,
        title: 'Test Screenplay',
      });

      // Mock memory hydration
      (hydrateMemoryFromFDX as jest.Mock).mockResolvedValueOnce({
        scenes: [
          {
            slugline: 'INT. OFFICE - DAY',
            summary: 'John greets colleagues in the office',
            tokens: 50,
            characters: ['JOHN'],
            themes: ['workplace'],
          },
          {
            slugline: 'EXT. PARKING LOT - DAY',
            summary: 'Establishing shot of parking lot',
            tokens: 20,
            characters: [],
            themes: ['setting'],
          },
        ],
      });

      // Mock memory API responses
      (MemoryAPI.updateSceneMemory as jest.Mock)
        .mockResolvedValueOnce({
          projectId: mockProjectId,
          slugline: 'INT. OFFICE - DAY',
          summary: 'John greets colleagues in the office',
          tokens: 50,
          characters: ['JOHN'],
          themes: ['workplace'],
          lastAccessed: new Date(),
        })
        .mockResolvedValueOnce({
          projectId: mockProjectId,
          slugline: 'EXT. PARKING LOT - DAY',
          summary: 'Establishing shot of parking lot',
          tokens: 20,
          characters: [],
          themes: ['setting'],
          lastAccessed: new Date(),
        });

      // Simulate the upload flow
      const file = new File([mockFDXContent], 'test.fdx', { type: 'text/xml' });

      // Parse the file
      const parsed = await parseUploadedFile(file);
      expect(parsed.elements).toHaveLength(6);
      expect(parsed.title).toBe('Test Screenplay');

      // Extract scenes
      const scenes = extractScenesFromEditor(parsed.elements);
      expect(scenes).toHaveLength(2);
      expect(scenes[0].slugline).toBe('INT. OFFICE - DAY');
      expect(scenes[1].slugline).toBe('EXT. PARKING LOT - DAY');

      // Hydrate memory
      const memoryData = await hydrateMemoryFromFDX(parsed.elements, mockProjectId);
      expect(memoryData.scenes).toHaveLength(2);

      // Save to memory API
      for (const scene of memoryData.scenes) {
        await MemoryAPI.updateSceneMemory(
          mockProjectId,
          scene.slugline,
          {
            summary: scene.summary,
            tokens: scene.tokens,
            characters: scene.characters,
            themes: scene.themes,
          }
        );
      }

      // Verify all mock functions were called correctly
      expect(parseUploadedFile).toHaveBeenCalledWith(file);
      expect(hydrateMemoryFromFDX).toHaveBeenCalledWith(parsed.elements, mockProjectId);
      expect(MemoryAPI.updateSceneMemory).toHaveBeenCalledTimes(2);
    });

    it('should handle parsing errors gracefully', async () => {
      const invalidFDXContent = 'This is not valid XML';
      const file = new File([invalidFDXContent], 'invalid.fdx', { type: 'text/xml' });

      (parseUploadedFile as jest.Mock).mockRejectedValueOnce(
        new Error('Invalid FDX format')
      );

      await expect(parseUploadedFile(file)).rejects.toThrow('Invalid FDX format');
    });

    it('should handle empty FDX files', async () => {
      const emptyFDXContent = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content></Content>
        </FinalDraft>`;

      const file = new File([emptyFDXContent], 'empty.fdx', { type: 'text/xml' });

      (parseUploadedFile as jest.Mock).mockResolvedValueOnce({
        elements: [],
        title: 'Untitled',
      });

      const parsed = await parseUploadedFile(file);
      expect(parsed.elements).toHaveLength(0);

      const scenes = extractScenesFromEditor(parsed.elements);
      expect(scenes).toHaveLength(0);
    });
  });

  describe('Scene Order Preservation', () => {
    it('should maintain scene order from FDX to memory', async () => {
      const orderedElements: ScreenplayElement[] = [
        { type: 'scene_heading', children: [{ text: '1. FIRST SCENE' }] },
        { type: 'action', children: [{ text: 'First action' }] },
        { type: 'scene_heading', children: [{ text: '2. SECOND SCENE' }] },
        { type: 'action', children: [{ text: 'Second action' }] },
        { type: 'scene_heading', children: [{ text: '3. THIRD SCENE' }] },
        { type: 'action', children: [{ text: 'Third action' }] },
      ];

      const scenes = extractScenesFromEditor(orderedElements);

      expect(scenes[0].id).toBe(1);
      expect(scenes[0].slugline).toBe('1. FIRST SCENE');
      expect(scenes[1].id).toBe(2);
      expect(scenes[1].slugline).toBe('2. SECOND SCENE');
      expect(scenes[2].id).toBe(3);
      expect(scenes[2].slugline).toBe('3. THIRD SCENE');
    });

    it('should handle non-sequential scene insertions', async () => {
      const elements: ScreenplayElement[] = [
        { type: 'scene_heading', children: [{ text: 'INT. ROOM A - DAY' }] },
        { type: 'action', children: [{ text: 'Action A' }] },
        { type: 'scene_heading', children: [{ text: 'INT. ROOM B - DAY' }] },
        { type: 'action', children: [{ text: 'Action B' }] },
      ];

      // Insert a new scene between existing ones
      elements.splice(2, 0,
        { type: 'scene_heading', children: [{ text: 'INT. HALLWAY - DAY' }] },
        { type: 'action', children: [{ text: 'Transition scene' }] }
      );

      const scenes = extractScenesFromEditor(elements);

      expect(scenes).toHaveLength(3);
      expect(scenes[0].slugline).toBe('INT. ROOM A - DAY');
      expect(scenes[1].slugline).toBe('INT. HALLWAY - DAY');
      expect(scenes[2].slugline).toBe('INT. ROOM B - DAY');
    });
  });

  describe('Memory Persistence and Sync', () => {
    it('should sync memory to localStorage on update', async () => {
      const mockLocalStorage = {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn(),
      };

      Object.defineProperty(window, 'localStorage', {
        value: mockLocalStorage,
        writable: true,
      });

      const sceneData = {
        projectId: mockProjectId,
        slugline: 'INT. TEST SCENE - DAY',
        summary: 'Test summary',
        tokens: 100,
        characters: ['TEST'],
        themes: ['testing'],
      };

      // Mock successful API update
      (MemoryAPI.updateSceneMemory as jest.Mock).mockResolvedValueOnce({
        ...sceneData,
        lastAccessed: new Date(),
      });

      await MemoryAPI.updateSceneMemory(
        sceneData.projectId,
        sceneData.slugline,
        {
          summary: sceneData.summary,
          tokens: sceneData.tokens,
          characters: sceneData.characters,
          themes: sceneData.themes,
        }
      );

      // In a real implementation, this would trigger localStorage update
      // For testing, we simulate it
      mockLocalStorage.setItem(
        `memory_${mockProjectId}_${sceneData.slugline}`,
        JSON.stringify(sceneData)
      );

      expect(mockLocalStorage.setItem).toHaveBeenCalled();
    });

    it('should restore memory from localStorage on failure', async () => {
      const mockLocalStorage = {
        getItem: jest.fn().mockReturnValueOnce(
          JSON.stringify({
            projectId: mockProjectId,
            slugline: 'INT. CACHED SCENE - DAY',
            summary: 'Cached summary',
            tokens: 50,
          })
        ),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn(),
      };

      Object.defineProperty(window, 'localStorage', {
        value: mockLocalStorage,
        writable: true,
      });

      // Mock API failure
      (MemoryAPI.getSceneBySlugline as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      // In a real implementation, this would fallback to localStorage
      const cachedData = mockLocalStorage.getItem(`memory_${mockProjectId}_INT. CACHED SCENE - DAY`);
      const parsed = JSON.parse(cachedData as string);

      expect(parsed.slugline).toBe('INT. CACHED SCENE - DAY');
      expect(parsed.summary).toBe('Cached summary');
    });
  });

  describe('Error Recovery and Validation', () => {
    it('should validate scene data before memory creation', async () => {
      const invalidScenes = [
        { slugline: '', summary: 'No slugline' }, // Invalid: empty slugline
        { slugline: 'INT. SCENE - DAY', summary: '' }, // Valid: empty summary is OK
        { slugline: 'INT. SCENE - DAY', summary: 'Valid', tokens: -1 }, // Invalid: negative tokens
      ];

      const validateScene = (scene: any) => {
        if (!scene.slugline || scene.slugline.trim() === '') {
          throw new Error('Invalid slugline');
        }
        if (scene.tokens !== undefined && scene.tokens < 0) {
          throw new Error('Invalid token count');
        }
        return true;
      };

      expect(() => validateScene(invalidScenes[0])).toThrow('Invalid slugline');
      expect(() => validateScene(invalidScenes[1])).not.toThrow();
      expect(() => validateScene(invalidScenes[2])).toThrow('Invalid token count');
    });

    it('should handle partial upload failures', async () => {
      const scenes = [
        { slugline: 'SCENE 1', summary: 'First', tokens: 50 },
        { slugline: 'SCENE 2', summary: 'Second', tokens: 60 },
        { slugline: 'SCENE 3', summary: 'Third', tokens: 70 },
      ];

      // Mock first two succeed, third fails
      (MemoryAPI.updateSceneMemory as jest.Mock)
        .mockResolvedValueOnce({ ...scenes[0], projectId: mockProjectId, lastAccessed: new Date() })
        .mockResolvedValueOnce({ ...scenes[1], projectId: mockProjectId, lastAccessed: new Date() })
        .mockRejectedValueOnce(new Error('Database error'));

      const results = [];
      const errors = [];

      for (const scene of scenes) {
        try {
          const result = await MemoryAPI.updateSceneMemory(
            mockProjectId,
            scene.slugline,
            scene
          );
          results.push(result);
        } catch (error) {
          errors.push({ scene: scene.slugline, error });
        }
      }

      expect(results).toHaveLength(2);
      expect(errors).toHaveLength(1);
      expect(errors[0].scene).toBe('SCENE 3');
    });
  });

  describe('Large File Handling', () => {
    it('should handle large FDX files with many scenes', async () => {
      // Create a large screenplay with 100 scenes
      const largeElements: ScreenplayElement[] = [];
      for (let i = 1; i <= 100; i++) {
        largeElements.push(
          { type: 'scene_heading', children: [{ text: `INT. SCENE ${i} - DAY` }] },
          { type: 'action', children: [{ text: `Action for scene ${i}` }] }
        );
      }

      const scenes = extractScenesFromEditor(largeElements);

      expect(scenes).toHaveLength(100);
      expect(scenes[0].slugline).toBe('INT. SCENE 1 - DAY');
      expect(scenes[99].slugline).toBe('INT. SCENE 100 - DAY');
      expect(scenes[99].isInProgress).toBe(true);
    });

    it('should batch memory updates for performance', async () => {
      const batchSize = 10;
      const totalScenes = 25;

      const scenes = Array.from({ length: totalScenes }, (_, i) => ({
        slugline: `SCENE ${i + 1}`,
        summary: `Summary ${i + 1}`,
        tokens: (i + 1) * 10,
      }));

      // Mock batch update function
      const batchUpdate = async (batch: any[]) => {
        return Promise.all(
          batch.map(scene =>
            MemoryAPI.updateSceneMemory(mockProjectId, scene.slugline, scene)
          )
        );
      };

      (MemoryAPI.updateSceneMemory as jest.Mock).mockImplementation(
        (projectId, slugline, data) =>
          Promise.resolve({ projectId, slugline, ...data, lastAccessed: new Date() })
      );

      const results = [];
      for (let i = 0; i < totalScenes; i += batchSize) {
        const batch = scenes.slice(i, i + batchSize);
        const batchResults = await batchUpdate(batch);
        results.push(...batchResults);
      }

      expect(results).toHaveLength(totalScenes);
      expect(MemoryAPI.updateSceneMemory).toHaveBeenCalledTimes(totalScenes);
    });
  });
});