/**
 * Content Blocks Converter Tests
 *
 * Comprehensive unit tests for bidirectional conversion between
 * backend content_blocks format and TipTap/ProseMirror JSON.
 */

import {
  contentBlocksToTipTap,
  tipTapToContentBlocks,
  validateContentBlocks,
  validateTipTapDocument,
  safeContentBlocksToTipTap,
  safeTipTapToContentBlocks,
  getContentBlocksStats,
  ContentBlock
} from '../content-blocks-converter';
import { JSONContent } from '@tiptap/core';

describe('Content Blocks Converter', () => {

  describe('contentBlocksToTipTap', () => {

    test('converts simple scene heading', () => {
      const blocks: ContentBlock[] = [
        {
          type: 'scene_heading',
          text: 'INT. COFFEE SHOP - DAY',
          metadata: {}
        }
      ];

      const result = contentBlocksToTipTap(blocks);

      expect(result).toEqual({
        type: 'doc',
        content: [
          {
            type: 'sceneHeading',
            content: [
              { type: 'text', text: 'INT. COFFEE SHOP - DAY' }
            ]
          }
        ]
      });
    });

    test('converts multiple screenplay elements', () => {
      const blocks: ContentBlock[] = [
        { type: 'scene_heading', text: 'INT. COFFEE SHOP - DAY', metadata: {} },
        { type: 'action', text: 'John sits at a table.', metadata: {} },
        { type: 'character', text: 'JOHN', metadata: {} },
        { type: 'dialogue', text: 'I need more coffee.', metadata: {} }
      ];

      const result = contentBlocksToTipTap(blocks);

      expect(result.type).toBe('doc');
      expect(result.content).toHaveLength(4);
      expect(result.content![0].type).toBe('sceneHeading');
      expect(result.content![1].type).toBe('action');
      expect(result.content![2].type).toBe('character');
      expect(result.content![3].type).toBe('dialogue');
    });

    test('handles empty blocks array - returns sceneHeading (screenplay convention)', () => {
      const result = contentBlocksToTipTap([]);

      // Screenplay convention: new empty document starts with scene heading, not paragraph
      expect(result).toEqual({
        type: 'doc',
        content: [
          {
            type: 'sceneHeading',
            content: []
          }
        ]
      });
    });

    test('handles empty text in blocks', () => {
      const blocks: ContentBlock[] = [
        { type: 'action', text: '', metadata: {} }
      ];

      const result = contentBlocksToTipTap(blocks);

      expect(result.content![0]).toEqual({
        type: 'action',
        content: []
      });
    });

    test('handles unknown block types', () => {
      const blocks: ContentBlock[] = [
        { type: 'unknown_type', text: 'Some text', metadata: {} }
      ];

      const result = contentBlocksToTipTap(blocks);

      expect(result.content![0].type).toBe('paragraph');
    });

    test('converts all screenplay element types', () => {
      const blocks: ContentBlock[] = [
        { type: 'scene_heading', text: 'Scene', metadata: {} },
        { type: 'action', text: 'Action', metadata: {} },
        { type: 'character', text: 'Character', metadata: {} },
        { type: 'dialogue', text: 'Dialogue', metadata: {} },
        { type: 'parenthetical', text: 'beat', metadata: {} },
        { type: 'transition', text: 'CUT TO', metadata: {} }
      ];

      const result = contentBlocksToTipTap(blocks);

      expect(result.content).toHaveLength(6);
      expect(result.content!.map(n => n.type)).toEqual([
        'sceneHeading',
        'action',
        'character',
        'dialogue',
        'parenthetical',
        'transition'
      ]);
    });
  });

  describe('tipTapToContentBlocks', () => {

    test('converts simple TipTap document', () => {
      const doc: JSONContent = {
        type: 'doc',
        content: [
          {
            type: 'sceneHeading',
            content: [
              { type: 'text', text: 'INT. COFFEE SHOP - DAY' }
            ]
          }
        ]
      };

      const result = tipTapToContentBlocks(doc);

      expect(result).toEqual([
        {
          type: 'scene_heading',
          text: 'INT. COFFEE SHOP - DAY',
          metadata: {}
        }
      ]);
    });

    test('converts multiple elements', () => {
      const doc: JSONContent = {
        type: 'doc',
        content: [
          {
            type: 'sceneHeading',
            content: [{ type: 'text', text: 'INT. COFFEE SHOP - DAY' }]
          },
          {
            type: 'action',
            content: [{ type: 'text', text: 'John sits at a table.' }]
          },
          {
            type: 'character',
            content: [{ type: 'text', text: 'JOHN' }]
          },
          {
            type: 'dialogue',
            content: [{ type: 'text', text: 'I need more coffee.' }]
          }
        ]
      };

      const result = tipTapToContentBlocks(doc);

      expect(result).toHaveLength(4);
      expect(result[0].type).toBe('scene_heading');
      expect(result[1].type).toBe('action');
      expect(result[2].type).toBe('character');
      expect(result[3].type).toBe('dialogue');
    });

    test('handles empty document', () => {
      const doc: JSONContent = {
        type: 'doc',
        content: []
      };

      const result = tipTapToContentBlocks(doc);

      expect(result).toEqual([]);
    });

    test('handles nodes with no content', () => {
      const doc: JSONContent = {
        type: 'doc',
        content: [
          {
            type: 'action',
            content: []
          }
        ]
      };

      const result = tipTapToContentBlocks(doc);

      expect(result[0]).toEqual({
        type: 'action',
        text: '',
        metadata: {}
      });
    });

    test('filters out doc nodes', () => {
      const doc: JSONContent = {
        type: 'doc',
        content: [
          {
            type: 'doc', // Nested doc (should be filtered)
            content: [{ type: 'text', text: 'Should not appear' }]
          },
          {
            type: 'action',
            content: [{ type: 'text', text: 'Valid action' }]
          }
        ]
      };

      const result = tipTapToContentBlocks(doc);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Valid action');
    });

    test('converts all TipTap element types', () => {
      const doc: JSONContent = {
        type: 'doc',
        content: [
          { type: 'sceneHeading', content: [{ type: 'text', text: 'Scene' }] },
          { type: 'action', content: [{ type: 'text', text: 'Action' }] },
          { type: 'character', content: [{ type: 'text', text: 'Character' }] },
          { type: 'dialogue', content: [{ type: 'text', text: 'Dialogue' }] },
          { type: 'parenthetical', content: [{ type: 'text', text: 'beat' }] },
          { type: 'transition', content: [{ type: 'text', text: 'CUT TO' }] }
        ]
      };

      const result = tipTapToContentBlocks(doc);

      expect(result.map(b => b.type)).toEqual([
        'scene_heading',
        'action',
        'character',
        'dialogue',
        'parenthetical',
        'transition'
      ]);
    });
  });

  describe('bidirectional conversion', () => {

    test('round-trip conversion preserves data', () => {
      const originalBlocks: ContentBlock[] = [
        { type: 'scene_heading', text: 'INT. OFFICE - DAY', metadata: {} },
        { type: 'action', text: 'Sarah walks in.', metadata: {} },
        { type: 'character', text: 'SARAH', metadata: {} },
        { type: 'dialogue', text: 'Hello everyone!', metadata: {} }
      ];

      const tipTapDoc = contentBlocksToTipTap(originalBlocks);
      const convertedBack = tipTapToContentBlocks(tipTapDoc);

      expect(convertedBack).toEqual(originalBlocks);
    });

    test('round-trip with empty blocks', () => {
      const originalBlocks: ContentBlock[] = [
        { type: 'action', text: '', metadata: {} }
      ];

      const tipTapDoc = contentBlocksToTipTap(originalBlocks);
      const convertedBack = tipTapToContentBlocks(tipTapDoc);

      expect(convertedBack[0].text).toBe('');
    });
  });

  describe('validation functions', () => {

    test('validateContentBlocks accepts valid array', () => {
      const blocks = [
        { type: 'action', text: 'Some text', metadata: {} }
      ];

      expect(validateContentBlocks(blocks)).toBe(true);
    });

    test('validateContentBlocks rejects invalid array', () => {
      expect(validateContentBlocks(null as any)).toBe(false);
      expect(validateContentBlocks({} as any)).toBe(false);
      expect(validateContentBlocks([{ text: 'missing type' }] as any)).toBe(false);
      expect(validateContentBlocks([{ type: 'action' }] as any)).toBe(false);
    });

    test('validateTipTapDocument accepts valid document', () => {
      const doc = {
        type: 'doc',
        content: [{ type: 'action', content: [] }]
      };

      expect(validateTipTapDocument(doc)).toBe(true);
    });

    test('validateTipTapDocument rejects invalid document', () => {
      expect(validateTipTapDocument(null)).toBe(false);
      expect(validateTipTapDocument({})).toBe(false);
      expect(validateTipTapDocument({ type: 'doc' })).toBe(false);
      expect(validateTipTapDocument({ content: [] })).toBe(false);
    });
  });

  describe('safe conversion functions', () => {

    test('safeContentBlocksToTipTap returns null for invalid input', () => {
      expect(safeContentBlocksToTipTap(null as any)).toBeNull();
      expect(safeContentBlocksToTipTap({} as any)).toBeNull();
      expect(safeContentBlocksToTipTap([{ invalid: 'block' }] as any)).toBeNull();
    });

    test('safeContentBlocksToTipTap returns document for valid input', () => {
      const blocks = [{ type: 'action', text: 'Text', metadata: {} }];
      const result = safeContentBlocksToTipTap(blocks);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('doc');
    });

    test('safeTipTapToContentBlocks returns null for invalid input', () => {
      expect(safeTipTapToContentBlocks(null)).toBeNull();
      expect(safeTipTapToContentBlocks({})).toBeNull();
      expect(safeTipTapToContentBlocks({ type: 'doc' })).toBeNull();
    });

    test('safeTipTapToContentBlocks returns blocks for valid input', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'action', content: [{ type: 'text', text: 'Text' }] }
        ]
      };
      const result = safeTipTapToContentBlocks(doc);

      expect(result).not.toBeNull();
      expect(result!).toHaveLength(1);
    });
  });

  describe('getContentBlocksStats', () => {

    test('calculates statistics correctly', () => {
      const blocks: ContentBlock[] = [
        { type: 'scene_heading', text: 'INT. OFFICE - DAY', metadata: {} },
        { type: 'action', text: 'Sarah walks in.', metadata: {} },
        { type: 'action', text: 'She sits down.', metadata: {} }
      ];

      const stats = getContentBlocksStats(blocks);

      expect(stats.totalBlocks).toBe(3);
      expect(stats.typeCounts).toEqual({
        'scene_heading': 1,
        'action': 2
      });
      expect(stats.totalCharacters).toBeGreaterThan(0);
      expect(stats.totalWords).toBeGreaterThan(0);
      expect(stats.averageWordsPerBlock).toBeGreaterThan(0);
    });

    test('handles empty blocks array', () => {
      const stats = getContentBlocksStats([]);

      expect(stats.totalBlocks).toBe(0);
      expect(stats.totalCharacters).toBe(0);
      expect(stats.totalWords).toBe(0);
      expect(stats.averageWordsPerBlock).toBe(0);
    });
  });

  describe('edge cases', () => {

    test('handles very long text', () => {
      const longText = 'A'.repeat(10000);
      const blocks: ContentBlock[] = [
        { type: 'action', text: longText, metadata: {} }
      ];

      const result = contentBlocksToTipTap(blocks);

      expect(result.content![0].content![0].text).toBe(longText);
    });

    test('handles special characters', () => {
      const specialText = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~';
      const blocks: ContentBlock[] = [
        { type: 'dialogue', text: specialText, metadata: {} }
      ];

      const tipTapDoc = contentBlocksToTipTap(blocks);
      const convertedBack = tipTapToContentBlocks(tipTapDoc);

      expect(convertedBack[0].text).toBe(specialText);
    });

    test('handles Unicode and emojis', () => {
      const unicodeText = '你好世界 🎬 🎭 📽️';
      const blocks: ContentBlock[] = [
        { type: 'action', text: unicodeText, metadata: {} }
      ];

      const tipTapDoc = contentBlocksToTipTap(blocks);
      const convertedBack = tipTapToContentBlocks(tipTapDoc);

      expect(convertedBack[0].text).toBe(unicodeText);
    });
  });
});
