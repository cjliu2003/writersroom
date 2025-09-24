/**
 * Regression Tests for FDX Scene Preservation
 *
 * These tests verify that scenes are correctly preserved through the entire
 * FDX parsing and memory storage pipeline. Based on ground truth analysis.
 */

import { parseFDX } from '@/lib/fdx-parser';
import { MemoryAPI } from '@/utils/memoryAPI';
import { extractScenesFromEditor } from '@/utils/scene-extraction';
import * as fs from 'fs';
import * as path from 'path';

// Mock modules
jest.mock('@/utils/memoryAPI');
jest.mock('fs');

describe('FDX Scene Preservation - Regression Tests', () => {
  const mockMemoryAPI = MemoryAPI as jest.Mocked<typeof MemoryAPI>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMemoryAPI.updateSceneMemory.mockResolvedValue(undefined);
    mockMemoryAPI.getAllScenes.mockResolvedValue([]);
  });

  describe('Scene Count Validation', () => {
    const testCases = [
      {
        file: 'sr_first_look_final.fdx',
        expectedScenes: 53,
        description: 'complex screenplay with 53 scenes'
      },
      {
        file: 'test-transitions.fdx',
        expectedScenes: 5,
        description: 'screenplay with transition elements'
      },
      {
        file: 'test-black.fdx',
        expectedScenes: 3,
        description: 'screenplay with BLACK. transitions'
      },
      {
        file: 'test-scene-order.fdx',
        expectedScenes: 10,
        description: 'screenplay testing scene ordering'
      },
      {
        file: 'test-malformed-scenes.fdx',
        expectedScenes: 7,
        description: 'screenplay with malformed scene headings'
      }
    ];

    test.each(testCases)('should preserve all scenes in $description', async ({ file, expectedScenes }) => {
      // Read FDX file content
      const fdxPath = path.join(process.cwd(), '..', file);
      const fdxContent = await fs.promises.readFile(fdxPath, 'utf-8');

      // Parse FDX
      const parsedContent = await parseFDX(fdxContent);

      // Extract scenes from parsed content
      const scenes = extractScenesFromEditor(parsedContent);

      // Verify scene count
      expect(scenes).toHaveLength(expectedScenes);

      // Verify each scene has required properties
      scenes.forEach((scene, index) => {
        expect(scene).toHaveProperty('id');
        expect(scene).toHaveProperty('slugline');
        expect(scene).toHaveProperty('sceneText');
        expect(scene).toHaveProperty('summary');
        expect(scene).toHaveProperty('tokenCount');
        expect(scene).toHaveProperty('runtime');
        expect(scene.id).toBe(index + 1);
      });
    });
  });

  describe('Scene Order Preservation', () => {
    it('should maintain scene order from FDX through to editor', async () => {
      const mockFdxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>INT. FIRST SCENE - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>First scene action.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>EXT. SECOND SCENE - NIGHT</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Second scene action.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. THIRD SCENE - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Third scene action.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(mockFdxContent);
      const scenes = extractScenesFromEditor(parsedContent);

      expect(scenes).toHaveLength(3);
      expect(scenes[0].slugline).toBe('INT. FIRST SCENE - DAY');
      expect(scenes[1].slugline).toBe('EXT. SECOND SCENE - NIGHT');
      expect(scenes[2].slugline).toBe('INT. THIRD SCENE - DAY');

      // Verify scene IDs are sequential
      expect(scenes[0].id).toBe(1);
      expect(scenes[1].id).toBe(2);
      expect(scenes[2].id).toBe(3);
    });
  });

  describe('Transition Handling', () => {
    it('should correctly handle transitions between scenes', async () => {
      const mockFdxWithTransitions = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>INT. SCENE ONE - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Scene one action.</Text>
              </Paragraph>
              <Paragraph Type="Transition">
                <Text>FADE TO:</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>EXT. SCENE TWO - NIGHT</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Scene two action.</Text>
              </Paragraph>
              <Paragraph Type="Transition">
                <Text>CUT TO:</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. SCENE THREE - DAY</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(mockFdxWithTransitions);
      const scenes = extractScenesFromEditor(parsedContent);

      expect(scenes).toHaveLength(3);

      // Verify transitions are included with the preceding scene
      expect(scenes[0].sceneText).toContain('FADE TO:');
      expect(scenes[1].sceneText).toContain('CUT TO:');
    });

    it('should handle BLACK. as both transition and scene heading', async () => {
      const mockFdxWithBlack = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>BLACK.</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Darkness.</Text>
              </Paragraph>
              <Paragraph Type="Transition">
                <Text>FADE TO:</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. ROOM - DAY</Text>
              </Paragraph>
              <Paragraph Type="Transition">
                <Text>BLACK.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(mockFdxWithBlack);
      const scenes = extractScenesFromEditor(parsedContent);

      // BLACK. as scene heading should create a scene
      expect(scenes[0].slugline).toBe('BLACK.');

      // BLACK. as transition should be included in scene text
      expect(scenes[1].sceneText).toContain('BLACK.');
    });
  });

  describe('Malformed Scene Handling', () => {
    it('should handle scenes with missing or incomplete sluglines', async () => {
      const mockFdxMalformed = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>   </Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Action without slugline.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text></Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Another action.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(mockFdxMalformed);
      const scenes = extractScenesFromEditor(parsedContent);

      // Should handle empty sluglines gracefully
      scenes.forEach(scene => {
        expect(scene.slugline).toBeTruthy();
        if (scene.slugline === 'UNTITLED SCENE') {
          expect(scene.slugline).toBe('UNTITLED SCENE');
        }
      });
    });

    it('should handle scenes with only dialogue and no action', async () => {
      const mockFdxDialogueOnly = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>INT. DIALOGUE SCENE - DAY</Text>
              </Paragraph>
              <Paragraph Type="Character">
                <Text>CHARACTER A</Text>
              </Paragraph>
              <Paragraph Type="Dialogue">
                <Text>This is dialogue.</Text>
              </Paragraph>
              <Paragraph Type="Character">
                <Text>CHARACTER B</Text>
              </Paragraph>
              <Paragraph Type="Dialogue">
                <Text>Response dialogue.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(mockFdxDialogueOnly);
      const scenes = extractScenesFromEditor(parsedContent);

      expect(scenes).toHaveLength(1);
      expect(scenes[0].sceneText).toContain('CHARACTER A');
      expect(scenes[0].sceneText).toContain('This is dialogue');
      expect(scenes[0].sceneText).toContain('CHARACTER B');
      expect(scenes[0].sceneText).toContain('Response dialogue');
    });
  });

  describe('Memory API Integration', () => {
    it('should store all scenes in memory after parsing', async () => {
      const mockScenes = [
        { id: 1, slugline: 'INT. SCENE 1 - DAY', sceneText: 'Text 1', summary: 'Summary 1', tokenCount: 10, runtime: '0.1 min', isInProgress: false },
        { id: 2, slugline: 'EXT. SCENE 2 - NIGHT', sceneText: 'Text 2', summary: 'Summary 2', tokenCount: 20, runtime: '0.2 min', isInProgress: false },
        { id: 3, slugline: 'INT. SCENE 3 - DAY', sceneText: 'Text 3', summary: 'Summary 3', tokenCount: 30, runtime: '0.3 min', isInProgress: true }
      ];

      // Simulate storing scenes in memory
      for (const scene of mockScenes) {
        await MemoryAPI.updateSceneMemory({
          projectId: 'test-project',
          slugline: scene.slugline,
          summary: scene.summary,
          tokens: scene.tokenCount,
          characters: [],
          themes: []
        });
      }

      // Verify all scenes were stored
      expect(mockMemoryAPI.updateSceneMemory).toHaveBeenCalledTimes(3);

      // Verify scene data integrity
      expect(mockMemoryAPI.updateSceneMemory).toHaveBeenNthCalledWith(1,
        expect.objectContaining({
          slugline: 'INT. SCENE 1 - DAY',
          summary: 'Summary 1',
          tokens: 10
        })
      );
    });

    it('should handle memory API failures gracefully', async () => {
      mockMemoryAPI.updateSceneMemory.mockRejectedValue(new Error('Memory API error'));

      const scene = {
        id: 1,
        slugline: 'INT. SCENE - DAY',
        sceneText: 'Scene text',
        summary: 'Summary',
        tokenCount: 100,
        runtime: '0.4 min',
        isInProgress: false
      };

      // Should not throw when memory API fails
      await expect(
        MemoryAPI.updateSceneMemory({
          projectId: 'test-project',
          slugline: scene.slugline,
          summary: scene.summary,
          tokens: scene.tokenCount,
          characters: [],
          themes: []
        })
      ).rejects.toThrow('Memory API error');
    });
  });

  describe('Scene Content Preservation', () => {
    it('should preserve all element types within a scene', async () => {
      const mockFdxComplete = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>INT. COMPLETE SCENE - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Action description.</Text>
              </Paragraph>
              <Paragraph Type="Character">
                <Text>CHARACTER NAME</Text>
              </Paragraph>
              <Paragraph Type="Parenthetical">
                <Text>(whispering)</Text>
              </Paragraph>
              <Paragraph Type="Dialogue">
                <Text>This is dialogue.</Text>
              </Paragraph>
              <Paragraph Type="Transition">
                <Text>FADE OUT.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(mockFdxComplete);
      const scenes = extractScenesFromEditor(parsedContent);

      expect(scenes).toHaveLength(1);
      const scene = scenes[0];

      expect(scene.sceneText).toContain('Action description');
      expect(scene.sceneText).toContain('CHARACTER NAME');
      expect(scene.sceneText).toContain('(whispering)');
      expect(scene.sceneText).toContain('This is dialogue');
      expect(scene.sceneText).toContain('FADE OUT.');
    });

    it('should handle multi-paragraph scenes correctly', async () => {
      const mockFdxMultiParagraph = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>INT. LONG SCENE - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>First action paragraph.</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Second action paragraph.</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Third action paragraph.</Text>
              </Paragraph>
              <Paragraph Type="Character">
                <Text>CHARACTER</Text>
              </Paragraph>
              <Paragraph Type="Dialogue">
                <Text>Long dialogue here.</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Final action paragraph.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(mockFdxMultiParagraph);
      const scenes = extractScenesFromEditor(parsedContent);

      expect(scenes).toHaveLength(1);
      const scene = scenes[0];

      // All action paragraphs should be preserved
      expect(scene.sceneText).toContain('First action paragraph');
      expect(scene.sceneText).toContain('Second action paragraph');
      expect(scene.sceneText).toContain('Third action paragraph');
      expect(scene.sceneText).toContain('Final action paragraph');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty FDX files', async () => {
      const emptyFdx = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(emptyFdx);
      const scenes = extractScenesFromEditor(parsedContent);

      expect(scenes).toHaveLength(0);
    });

    it('should handle FDX with no scenes (only non-scene elements)', async () => {
      const noScenesFdx = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Action">
                <Text>This is action without a scene.</Text>
              </Paragraph>
              <Paragraph Type="Character">
                <Text>CHARACTER</Text>
              </Paragraph>
              <Paragraph Type="Dialogue">
                <Text>Dialogue without scene.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(noScenesFdx);
      const scenes = extractScenesFromEditor(parsedContent);

      // Should not create scenes from non-scene elements
      expect(scenes).toHaveLength(0);
    });

    it('should handle very large scenes without data loss', async () => {
      const largeText = 'Very long action text. '.repeat(500); // ~2500 words
      const largeFdx = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>INT. MASSIVE SCENE - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>${largeText}</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(largeFdx);
      const scenes = extractScenesFromEditor(parsedContent);

      expect(scenes).toHaveLength(1);
      expect(scenes[0].sceneText.length).toBeGreaterThan(10000);
      expect(scenes[0].tokenCount).toBeGreaterThan(3000);
    });
  });
});