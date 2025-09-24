/**
 * Unit Tests for Scene Extraction Utilities
 *
 * Tests the extraction of scenes from screenplay editor content,
 * scene boundary detection, token counting, and memory conversion.
 */

import {
  extractScenesFromEditor,
  sceneMemoryToDescription,
  parseEditorContent,
  SceneDescription,
} from '@/utils/scene-extraction';
import { ScreenplayElement } from '@/types/screenplay';
import { SceneMemory } from '../../../shared/types';

describe('Scene Extraction Utilities', () => {
  describe('extractScenesFromEditor', () => {
    it('should extract single scene correctly', () => {
      const editorValue: ScreenplayElement[] = [
        {
          type: 'scene_heading',
          children: [{ text: 'INT. APARTMENT - NIGHT' }],
        },
        {
          type: 'action',
          children: [{ text: 'The room is dark and quiet.' }],
        },
        {
          type: 'character',
          children: [{ text: 'ALICE' }],
        },
        {
          type: 'dialogue',
          children: [{ text: 'Is anyone there?' }],
        },
      ];

      const scenes = extractScenesFromEditor(editorValue);

      expect(scenes).toHaveLength(1);
      expect(scenes[0].slugline).toBe('INT. APARTMENT - NIGHT');
      expect(scenes[0].sceneText).toContain('The room is dark');
      expect(scenes[0].sceneText).toContain('ALICE');
      expect(scenes[0].sceneText).toContain('Is anyone there?');
      expect(scenes[0].isInProgress).toBe(true); // Last scene is always in progress
    });

    it('should extract multiple scenes with correct boundaries', () => {
      const editorValue: ScreenplayElement[] = [
        {
          type: 'scene_heading',
          children: [{ text: 'INT. OFFICE - DAY' }],
        },
        {
          type: 'action',
          children: [{ text: 'John sits at his desk.' }],
        },
        {
          type: 'scene_heading',
          children: [{ text: 'EXT. STREET - DAY' }],
        },
        {
          type: 'action',
          children: [{ text: 'John walks down the street.' }],
        },
        {
          type: 'scene_heading',
          children: [{ text: 'INT. COFFEE SHOP - DAY' }],
        },
        {
          type: 'action',
          children: [{ text: 'John orders coffee.' }],
        },
      ];

      const scenes = extractScenesFromEditor(editorValue);

      expect(scenes).toHaveLength(3);
      expect(scenes[0].slugline).toBe('INT. OFFICE - DAY');
      expect(scenes[0].sceneText).toBe('John sits at his desk.');
      expect(scenes[0].isInProgress).toBe(false);

      expect(scenes[1].slugline).toBe('EXT. STREET - DAY');
      expect(scenes[1].sceneText).toBe('John walks down the street.');
      expect(scenes[1].isInProgress).toBe(false);

      expect(scenes[2].slugline).toBe('INT. COFFEE SHOP - DAY');
      expect(scenes[2].sceneText).toBe('John orders coffee.');
      expect(scenes[2].isInProgress).toBe(true);
    });

    it('should handle empty scenes (slugline only)', () => {
      const editorValue: ScreenplayElement[] = [
        {
          type: 'scene_heading',
          children: [{ text: 'INT. EMPTY ROOM - DAY' }],
        },
        {
          type: 'scene_heading',
          children: [{ text: 'EXT. PARKING LOT - NIGHT' }],
        },
      ];

      const scenes = extractScenesFromEditor(editorValue);

      expect(scenes).toHaveLength(2);
      expect(scenes[0].sceneText).toBe('');
      expect(scenes[0].summary).toBe('Scene in progress...');
      expect(scenes[0].tokenCount).toBe(0);
      expect(scenes[0].runtime).toBe('0.0 min');
    });

    it('should ignore content before first scene heading', () => {
      const editorValue: ScreenplayElement[] = [
        {
          type: 'action',
          children: [{ text: 'This content should be ignored.' }],
        },
        {
          type: 'character',
          children: [{ text: 'NARRATOR' }],
        },
        {
          type: 'dialogue',
          children: [{ text: 'This too.' }],
        },
        {
          type: 'scene_heading',
          children: [{ text: 'INT. ACTUAL SCENE - DAY' }],
        },
        {
          type: 'action',
          children: [{ text: 'This is the actual scene content.' }],
        },
      ];

      const scenes = extractScenesFromEditor(editorValue);

      expect(scenes).toHaveLength(1);
      expect(scenes[0].slugline).toBe('INT. ACTUAL SCENE - DAY');
      expect(scenes[0].sceneText).toBe('This is the actual scene content.');
    });

    it('should handle transition elements correctly', () => {
      const editorValue: ScreenplayElement[] = [
        {
          type: 'scene_heading',
          children: [{ text: 'INT. ROOM - DAY' }],
        },
        {
          type: 'action',
          children: [{ text: 'Something happens.' }],
        },
        {
          type: 'transition',
          children: [{ text: 'FADE OUT.' }],
        },
        {
          type: 'scene_heading',
          children: [{ text: 'INT. ANOTHER ROOM - NIGHT' }],
        },
        {
          type: 'action',
          children: [{ text: 'Something else happens.' }],
        },
      ];

      const scenes = extractScenesFromEditor(editorValue);

      expect(scenes).toHaveLength(2);
      expect(scenes[0].sceneText).toContain('FADE OUT.');
      expect(scenes[1].sceneText).toBe('Something else happens.');
    });

    it('should calculate token count correctly', () => {
      const editorValue: ScreenplayElement[] = [
        {
          type: 'scene_heading',
          children: [{ text: 'INT. ROOM - DAY' }],
        },
        {
          type: 'action',
          children: [{ text: 'This is a test sentence with eight words.' }], // 8 words
        },
      ];

      const scenes = extractScenesFromEditor(editorValue);

      // Token count should be words * 1.3
      expect(scenes[0].tokenCount).toBe(Math.ceil(8 * 1.3)); // 11
    });

    it('should calculate runtime correctly', () => {
      const editorValue: ScreenplayElement[] = [
        {
          type: 'scene_heading',
          children: [{ text: 'INT. ROOM - DAY' }],
        },
        {
          type: 'action',
          children: [{ text: 'A'.repeat(192) + ' words' }], // ~193 words for 250 tokens
        },
      ];

      const scenes = extractScenesFromEditor(editorValue);

      // Runtime should be tokens / 250 minutes
      // 193 words * 1.3 = 250.9 tokens, / 250 = 1.0 minutes
      expect(scenes[0].runtime).toMatch(/^1\.\d min$/);
    });

    it('should handle empty editor value', () => {
      expect(extractScenesFromEditor([])).toEqual([]);
      expect(extractScenesFromEditor(null as any)).toEqual([]);
      expect(extractScenesFromEditor(undefined as any)).toEqual([]);
    });

    it('should handle untitled scenes', () => {
      const editorValue: ScreenplayElement[] = [
        {
          type: 'scene_heading',
          children: [{ text: '   ' }], // Only whitespace
        },
        {
          type: 'action',
          children: [{ text: 'Some action.' }],
        },
      ];

      const scenes = extractScenesFromEditor(editorValue);

      expect(scenes[0].slugline).toBe('UNTITLED SCENE');
    });

    it('should preserve scene order and assign correct IDs', () => {
      const editorValue: ScreenplayElement[] = [
        {
          type: 'scene_heading',
          children: [{ text: 'SCENE 1' }],
        },
        {
          type: 'scene_heading',
          children: [{ text: 'SCENE 2' }],
        },
        {
          type: 'scene_heading',
          children: [{ text: 'SCENE 3' }],
        },
      ];

      const scenes = extractScenesFromEditor(editorValue);

      expect(scenes[0].id).toBe(1);
      expect(scenes[0].slugline).toBe('SCENE 1');
      expect(scenes[1].id).toBe(2);
      expect(scenes[1].slugline).toBe('SCENE 2');
      expect(scenes[2].id).toBe(3);
      expect(scenes[2].slugline).toBe('SCENE 3');
    });
  });

  describe('sceneMemoryToDescription', () => {
    it('should convert SceneMemory to SceneDescription correctly', () => {
      const memory: SceneMemory = {
        projectId: 'test-project',
        slugline: 'INT. OFFICE - DAY',
        summary: 'A tense meeting in the office.',
        tokens: 250,
        characters: ['JOHN', 'SARAH'],
        themes: ['conflict', 'business'],
        lastAccessed: new Date(),
      };

      const description = sceneMemoryToDescription(memory, 1, false);

      expect(description.id).toBe(1);
      expect(description.slugline).toBe('INT. OFFICE - DAY');
      expect(description.summary).toBe('A tense meeting in the office.');
      expect(description.tokenCount).toBe(250);
      expect(description.runtime).toBe('1.0 min');
      expect(description.isInProgress).toBe(false);
      expect(description.sceneText).toBe(''); // Not stored in memory
    });

    it('should handle missing tokens in memory', () => {
      const memory: SceneMemory = {
        projectId: 'test-project',
        slugline: 'INT. ROOM - NIGHT',
        summary: 'Scene summary',
        characters: [],
        themes: [],
        lastAccessed: new Date(),
      };

      const description = sceneMemoryToDescription(memory, 2, true);

      expect(description.tokenCount).toBe(0);
      expect(description.runtime).toBe('0.0 min');
      expect(description.isInProgress).toBe(true);
    });
  });

  describe('parseEditorContent', () => {
    it('should parse valid JSON string to ScreenplayElement array', () => {
      const content = JSON.stringify([
        {
          type: 'scene_heading',
          children: [{ text: 'INT. ROOM - DAY' }],
        },
        {
          type: 'action',
          children: [{ text: 'Action text' }],
        },
      ]);

      const result = parseEditorContent(content);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('scene_heading');
      expect(result[1].type).toBe('action');
    });

    it('should handle empty or invalid content', () => {
      expect(parseEditorContent('')).toEqual([]);
      expect(parseEditorContent(null as any)).toEqual([]);
      expect(parseEditorContent(undefined as any)).toEqual([]);
      expect(parseEditorContent('invalid json')).toEqual([]);
      expect(parseEditorContent('{}')).toEqual([]);
      expect(parseEditorContent('123')).toEqual([]);
    });

    it('should handle malformed JSON gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = parseEditorContent('{ invalid: json }');

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to parse editor content:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('should handle complex dialogue sequences', () => {
      const editorValue: ScreenplayElement[] = [
        {
          type: 'scene_heading',
          children: [{ text: 'INT. RESTAURANT - NIGHT' }],
        },
        {
          type: 'character',
          children: [{ text: 'WAITER' }],
        },
        {
          type: 'parenthetical',
          children: [{ text: '(to customer)' }],
        },
        {
          type: 'dialogue',
          children: [{ text: 'What would you like?' }],
        },
        {
          type: 'character',
          children: [{ text: 'CUSTOMER' }],
        },
        {
          type: 'parenthetical',
          children: [{ text: '(thinking)' }],
        },
        {
          type: 'dialogue',
          children: [{ text: 'The special, please.' }],
        },
      ];

      const scenes = extractScenesFromEditor(editorValue);

      expect(scenes).toHaveLength(1);
      expect(scenes[0].sceneText).toContain('WAITER');
      expect(scenes[0].sceneText).toContain('(to customer)');
      expect(scenes[0].sceneText).toContain('What would you like?');
      expect(scenes[0].sceneText).toContain('CUSTOMER');
      expect(scenes[0].sceneText).toContain('(thinking)');
      expect(scenes[0].sceneText).toContain('The special, please.');
    });

    it('should handle various slugline formats', () => {
      const sluglines = [
        'INT./EXT. HOUSE - DAY',
        'I/E CAR - MOVING - NIGHT',
        'EXT. BEACH - SUNSET',
        'INT. SUBMARINE - UNDERWATER - CONTINUOUS',
        'FLASHBACK - INT. CLASSROOM - 1985',
        'BLACK.',
      ];

      sluglines.forEach((slugline) => {
        const editorValue: ScreenplayElement[] = [
          {
            type: 'scene_heading',
            children: [{ text: slugline }],
          },
        ];

        const scenes = extractScenesFromEditor(editorValue);
        expect(scenes[0].slugline).toBe(slugline);
      });
    });

    it('should handle special transitions', () => {
      const transitions = ['FADE OUT.', 'BLACK.', 'CUT TO:', 'DISSOLVE TO:', 'MATCH CUT TO:'];

      transitions.forEach((transition) => {
        const editorValue: ScreenplayElement[] = [
          {
            type: 'scene_heading',
            children: [{ text: 'INT. ROOM - DAY' }],
          },
          {
            type: 'transition',
            children: [{ text: transition }],
          },
        ];

        const scenes = extractScenesFromEditor(editorValue);
        expect(scenes[0].sceneText).toContain(transition);
      });
    });

    it('should handle very long scene content', () => {
      const longText = 'Very long action text. '.repeat(100); // ~400 words
      const editorValue: ScreenplayElement[] = [
        {
          type: 'scene_heading',
          children: [{ text: 'INT. LONG SCENE - DAY' }],
        },
        {
          type: 'action',
          children: [{ text: longText }],
        },
      ];

      const scenes = extractScenesFromEditor(editorValue);

      expect(scenes[0].tokenCount).toBeGreaterThan(500); // 400 * 1.3 = 520
      expect(parseFloat(scenes[0].runtime)).toBeGreaterThan(2); // 520 / 250 = 2.08 min
    });
  });
});