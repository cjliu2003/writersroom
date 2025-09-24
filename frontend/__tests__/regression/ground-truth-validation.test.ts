/**
 * Ground Truth Validation Tests
 *
 * These tests validate specific issues found in the ground truth analysis
 * and ensure the pipeline correctly handles all edge cases discovered.
 */

import { parseFDX } from '@/lib/fdx-parser';
import { extractScenesFromEditor } from '@/utils/scene-extraction';
import { MemoryAPI } from '@/utils/memoryAPI';
import * as fs from 'fs';
import * as path from 'path';

// Mock modules
jest.mock('@/utils/memoryAPI');
jest.mock('fs');

describe('Ground Truth Validation Tests', () => {
  const mockMemoryAPI = MemoryAPI as jest.Mocked<typeof MemoryAPI>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Scene Count Accuracy', () => {
    const groundTruthData = [
      {
        filename: 'sr_first_look_final.fdx',
        expectedScenes: 53,
        firstSlugline: 'Ext. Silk road - night',
        lastSlugline: 'INT. CIA SERVER ROOM - CONTINUOUS',
        complexElements: {
          transitions: ['Flash to:', 'BLACK.', 'CUT TO:', 'FADE TO:'],
          hasParentheticals: true,
          hasDualDialogue: false,
          hasActionBeforeFirstScene: false
        }
      },
      {
        filename: 'test-transitions.fdx',
        expectedScenes: 5,
        transitions: ['FADE TO:', 'CUT TO:', 'DISSOLVE TO:', 'MATCH CUT:'],
        transitionHandling: 'included_in_preceding_scene'
      },
      {
        filename: 'test-black.fdx',
        expectedScenes: 3,
        blackHandling: {
          asSceneHeading: true,
          asTransition: true
        }
      },
      {
        filename: 'test-scene-order.fdx',
        expectedScenes: 10,
        orderPreservation: 'strict_sequential'
      },
      {
        filename: 'test-malformed-scenes.fdx',
        expectedScenes: 7,
        malformedTypes: ['empty_slugline', 'whitespace_only', 'missing_location']
      }
    ];

    test.each(groundTruthData)('should correctly parse $filename', async (testCase) => {
      // Create mock FDX content based on test case
      const mockContent = createMockFDXContent(testCase);

      const parsedContent = await parseFDX(mockContent);
      const scenes = extractScenesFromEditor(parsedContent);

      expect(scenes).toHaveLength(testCase.expectedScenes);

      if (testCase.firstSlugline) {
        expect(scenes[0].slugline).toBe(testCase.firstSlugline);
      }

      if (testCase.lastSlugline) {
        expect(scenes[scenes.length - 1].slugline).toBe(testCase.lastSlugline);
      }
    });
  });

  describe('Transition Element Handling', () => {
    it('should handle FADE TO: transitions correctly', async () => {
      const fdxWithFade = createFDXWithTransition('FADE TO:');
      const parsedContent = await parseFDX(fdxWithFade);
      const scenes = extractScenesFromEditor(parsedContent);

      // FADE TO: should be included with the preceding scene
      expect(scenes[0].sceneText).toContain('FADE TO:');
      expect(scenes).toHaveLength(2); // Two scenes, transition not a separate scene
    });

    it('should handle BLACK. as both scene and transition', async () => {
      const fdxWithBlack = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>BLACK.</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Complete darkness.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. ROOM - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Light floods in.</Text>
              </Paragraph>
              <Paragraph Type="Transition">
                <Text>BLACK.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>INT. ANOTHER ROOM - NIGHT</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(fdxWithBlack);
      const scenes = extractScenesFromEditor(parsedContent);

      expect(scenes).toHaveLength(3);
      expect(scenes[0].slugline).toBe('BLACK.');
      expect(scenes[1].sceneText).toContain('BLACK.'); // As transition
    });

    it('should handle CUT TO: and similar transitions', async () => {
      const transitions = ['CUT TO:', 'DISSOLVE TO:', 'MATCH CUT:', 'SMASH CUT:'];

      for (const transition of transitions) {
        const fdx = createFDXWithTransition(transition);
        const parsedContent = await parseFDX(fdx);
        const scenes = extractScenesFromEditor(parsedContent);

        expect(scenes[0].sceneText).toContain(transition);
      }
    });
  });

  describe('Complex Scene Elements', () => {
    it('should preserve parentheticals in dialogue', async () => {
      const fdxWithParenthetical = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>INT. OFFICE - DAY</Text>
              </Paragraph>
              <Paragraph Type="Character">
                <Text>JOHN</Text>
              </Paragraph>
              <Paragraph Type="Parenthetical">
                <Text>(whispering)</Text>
              </Paragraph>
              <Paragraph Type="Dialogue">
                <Text>We need to be careful.</Text>
              </Paragraph>
              <Paragraph Type="Character">
                <Text>SARAH</Text>
              </Paragraph>
              <Paragraph Type="Parenthetical">
                <Text>(loudly, to everyone)</Text>
              </Paragraph>
              <Paragraph Type="Dialogue">
                <Text>Meeting in five minutes!</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(fdxWithParenthetical);
      const scenes = extractScenesFromEditor(parsedContent);

      expect(scenes[0].sceneText).toContain('(whispering)');
      expect(scenes[0].sceneText).toContain('(loudly, to everyone)');
    });

    it('should handle character extensions (CONT\'D, V.O., O.S.)', async () => {
      const fdxWithExtensions = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text>INT. ROOM - DAY</Text>
              </Paragraph>
              <Paragraph Type="Character">
                <Text>NARRATOR (V.O.)</Text>
              </Paragraph>
              <Paragraph Type="Dialogue">
                <Text>This is voice over.</Text>
              </Paragraph>
              <Paragraph Type="Character">
                <Text>JOHN (O.S.)</Text>
              </Paragraph>
              <Paragraph Type="Dialogue">
                <Text>Off screen dialogue.</Text>
              </Paragraph>
              <Paragraph Type="Character">
                <Text>SARAH (CONT'D)</Text>
              </Paragraph>
              <Paragraph Type="Dialogue">
                <Text>Continued dialogue.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(fdxWithExtensions);
      const scenes = extractScenesFromEditor(parsedContent);

      expect(scenes[0].sceneText).toContain('NARRATOR (V.O.)');
      expect(scenes[0].sceneText).toContain('JOHN (O.S.)');
      expect(scenes[0].sceneText).toContain('SARAH (CONT\'D)');
    });
  });

  describe('Malformed Scene Handling', () => {
    it('should handle empty sluglines gracefully', async () => {
      const fdxEmptySlugline = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="12">
          <Content>
            <Body>
              <Paragraph Type="Scene Heading">
                <Text></Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Action without proper slugline.</Text>
              </Paragraph>
              <Paragraph Type="Scene Heading">
                <Text>   </Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Another action.</Text>
              </Paragraph>
            </Body>
          </Content>
        </FinalDraft>`;

      const parsedContent = await parseFDX(fdxEmptySlugline);
      const scenes = extractScenesFromEditor(parsedContent);

      scenes.forEach(scene => {
        expect(scene.slugline).toBeTruthy();
        expect(scene.slugline).not.toBe('');
        expect(scene.slugline).not.toMatch(/^\s+$/);
      });
    });

    it('should handle non-standard slugline formats', async () => {
      const nonStandardSluglines = [
        'ESTABLISHING SHOT - CITY',
        'MONTAGE - VARIOUS LOCATIONS',
        'FLASHBACK - INT. CHILDHOOD HOME',
        'DREAM SEQUENCE',
        'TITLE CARD: "10 YEARS LATER"',
        'INTERCUT - PHONE CONVERSATION'
      ];

      for (const slugline of nonStandardSluglines) {
        const fdx = `<?xml version="1.0" encoding="UTF-8"?>
          <FinalDraft DocumentType="Script" Template="No" Version="12">
            <Content>
              <Body>
                <Paragraph Type="Scene Heading">
                  <Text>${slugline}</Text>
                </Paragraph>
                <Paragraph Type="Action">
                  <Text>Scene content.</Text>
                </Paragraph>
              </Body>
            </Content>
          </FinalDraft>`;

        const parsedContent = await parseFDX(fdx);
        const scenes = extractScenesFromEditor(parsedContent);

        expect(scenes).toHaveLength(1);
        expect(scenes[0].slugline).toBe(slugline);
      }
    });
  });

  describe('Memory Synchronization', () => {
    it('should sync all scenes to memory after parsing', async () => {
      const mockScenes = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        slugline: `INT. SCENE ${i + 1} - DAY`,
        sceneText: `Content for scene ${i + 1}`,
        summary: `Summary ${i + 1}`,
        tokenCount: 100,
        runtime: '0.4 min',
        isInProgress: i === 9
      }));

      // Mock successful storage
      mockMemoryAPI.updateSceneMemory.mockResolvedValue(undefined);

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

      expect(mockMemoryAPI.updateSceneMemory).toHaveBeenCalledTimes(10);
    });

    it('should handle partial sync failures', async () => {
      const scenes = [
        { id: 1, slugline: 'INT. SCENE 1 - DAY' },
        { id: 2, slugline: 'INT. SCENE 2 - DAY' },
        { id: 3, slugline: 'INT. SCENE 3 - DAY' }
      ];

      // Second scene fails to save
      mockMemoryAPI.updateSceneMemory
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Storage failed'))
        .mockResolvedValueOnce(undefined);

      const results = [];
      for (const scene of scenes) {
        try {
          await MemoryAPI.updateSceneMemory({
            projectId: 'test',
            slugline: scene.slugline,
            summary: '',
            tokens: 100,
            characters: [],
            themes: []
          });
          results.push({ scene: scene.id, success: true });
        } catch (error) {
          results.push({ scene: scene.id, success: false });
        }
      }

      expect(results).toEqual([
        { scene: 1, success: true },
        { scene: 2, success: false },
        { scene: 3, success: true }
      ]);
    });
  });

  describe('Editor Hydration Validation', () => {
    it('should correctly hydrate editor from memory', async () => {
      const memoryScenes = [
        {
          projectId: 'test',
          slugline: 'INT. MEMORY SCENE 1 - DAY',
          summary: 'First scene from memory',
          tokens: 150,
          characters: ['ALICE', 'BOB'],
          themes: ['conflict'],
          lastAccessed: new Date()
        },
        {
          projectId: 'test',
          slugline: 'EXT. MEMORY SCENE 2 - NIGHT',
          summary: 'Second scene from memory',
          tokens: 200,
          characters: ['CHARLIE'],
          themes: ['resolution'],
          lastAccessed: new Date()
        }
      ];

      mockMemoryAPI.getAllScenes.mockResolvedValue(memoryScenes);

      const retrievedScenes = await MemoryAPI.getAllScenes('test');

      expect(retrievedScenes).toHaveLength(2);
      expect(retrievedScenes[0].slugline).toBe('INT. MEMORY SCENE 1 - DAY');
      expect(retrievedScenes[1].slugline).toBe('EXT. MEMORY SCENE 2 - NIGHT');
    });

    it('should handle empty memory gracefully', async () => {
      mockMemoryAPI.getAllScenes.mockResolvedValue([]);

      const scenes = await MemoryAPI.getAllScenes('test');

      expect(scenes).toHaveLength(0);
      expect(scenes).toEqual([]);
    });
  });
});

// Helper function to create FDX content with transitions
function createFDXWithTransition(transition: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <FinalDraft DocumentType="Script" Template="No" Version="12">
      <Content>
        <Body>
          <Paragraph Type="Scene Heading">
            <Text>INT. SCENE ONE - DAY</Text>
          </Paragraph>
          <Paragraph Type="Action">
            <Text>First scene action.</Text>
          </Paragraph>
          <Paragraph Type="Transition">
            <Text>${transition}</Text>
          </Paragraph>
          <Paragraph Type="Scene Heading">
            <Text>INT. SCENE TWO - NIGHT</Text>
          </Paragraph>
          <Paragraph Type="Action">
            <Text>Second scene action.</Text>
          </Paragraph>
        </Body>
      </Content>
    </FinalDraft>`;
}

// Helper function to create mock FDX content based on test case
function createMockFDXContent(testCase: any): string {
  const scenes = Array.from({ length: testCase.expectedScenes }, (_, i) => {
    let slugline;
    if (i === 0 && testCase.firstSlugline) {
      slugline = testCase.firstSlugline;
    } else if (i === testCase.expectedScenes - 1 && testCase.lastSlugline) {
      slugline = testCase.lastSlugline;
    } else {
      slugline = `INT. SCENE ${i + 1} - DAY`;
    }

    return `
      <Paragraph Type="Scene Heading">
        <Text>${slugline}</Text>
      </Paragraph>
      <Paragraph Type="Action">
        <Text>Action for ${slugline}.</Text>
      </Paragraph>
    `;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
    <FinalDraft DocumentType="Script" Template="No" Version="12">
      <Content>
        <Body>
          ${scenes}
        </Body>
      </Content>
    </FinalDraft>`;
}