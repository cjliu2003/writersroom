/**
 * Unit Tests for FDX Format Utilities
 *
 * Tests the conversion, calculation, and export functions for FDX screenplay format.
 * Ensures accurate element type mapping, line counting, pagination, and XML generation.
 */

import {
  FDX_ELEMENT_TYPES,
  LINES_PER_PAGE,
  CHARACTERS_PER_LINE,
  convertToFDX,
  exportToFDXXML,
  calculatePageBreaks,
} from '@/utils/fdx-format';
import { ScreenplayElement, ScreenplayBlockType } from '@/types/screenplay';

describe('FDX Format Utilities', () => {
  describe('FDX_ELEMENT_TYPES', () => {
    it('should map all screenplay block types to FDX types', () => {
      const requiredTypes: ScreenplayBlockType[] = [
        'scene_heading',
        'action',
        'character',
        'parenthetical',
        'dialogue',
        'transition',
        'shot',
        'general',
        'cast_list',
        'new_act',
        'end_of_act',
        'summary',
      ];

      requiredTypes.forEach((type) => {
        expect(FDX_ELEMENT_TYPES[type]).toBeDefined();
        expect(typeof FDX_ELEMENT_TYPES[type]).toBe('string');
      });
    });
  });

  describe('convertToFDX', () => {
    it('should convert simple screenplay elements to FDX format', () => {
      const elements: ScreenplayElement[] = [
        {
          type: 'scene_heading',
          children: [{ text: 'INT. COFFEE SHOP - DAY' }],
        },
        {
          type: 'action',
          children: [{ text: 'John enters the coffee shop.' }],
        },
        {
          type: 'character',
          children: [{ text: 'JOHN' }],
        },
        {
          type: 'dialogue',
          children: [{ text: 'Can I get a coffee, please?' }],
        },
      ];

      const result = convertToFDX(elements);

      expect(result.paragraphs).toHaveLength(4);
      expect(result.paragraphs[0]).toEqual({
        Type: 'Scene Heading',
        Text: 'INT. COFFEE SHOP - DAY',
        Number: 1,
        DualDialogue: undefined,
      });
      expect(result.paragraphs[3]).toEqual({
        Type: 'Dialogue',
        Text: 'Can I get a coffee, please?',
        Number: 4,
        DualDialogue: undefined,
      });
      expect(result.pages).toBeGreaterThan(0);
      expect(result.wordCount).toBeGreaterThan(0);
    });

    it('should handle dual dialogue elements', () => {
      const elements: ScreenplayElement[] = [
        {
          type: 'character',
          children: [{ text: 'JOHN' }],
          isDualDialogue: true,
        },
        {
          type: 'dialogue',
          children: [{ text: 'Hello there!' }],
          isDualDialogue: true,
        },
      ];

      const result = convertToFDX(elements);

      expect(result.paragraphs[0].DualDialogue).toBe(true);
      expect(result.paragraphs[1].DualDialogue).toBe(true);
    });

    it('should calculate word count correctly', () => {
      const elements: ScreenplayElement[] = [
        {
          type: 'action',
          children: [{ text: 'This is a test action with eight words.' }],
        },
      ];

      const result = convertToFDX(elements);
      expect(result.wordCount).toBe(8);
    });

    it('should handle empty text elements', () => {
      const elements: ScreenplayElement[] = [
        {
          type: 'action',
          children: [{ text: '' }],
        },
        {
          type: 'scene_heading',
          children: [{ text: '   ' }], // Only whitespace
        },
      ];

      const result = convertToFDX(elements);
      expect(result.paragraphs).toHaveLength(2);
      expect(result.wordCount).toBe(0);
    });

    it('should handle page breaks correctly', () => {
      // Create enough elements to span multiple pages
      const elements: ScreenplayElement[] = [];
      for (let i = 0; i < 30; i++) {
        elements.push({
          type: 'action',
          children: [{ text: 'This is a long action paragraph that will take up multiple lines on the page.' }],
        });
      }

      const result = convertToFDX(elements);
      expect(result.pages).toBeGreaterThan(1);
    });
  });

  describe('exportToFDXXML', () => {
    it('should generate valid FDX XML structure', () => {
      const elements: ScreenplayElement[] = [
        {
          type: 'scene_heading',
          children: [{ text: 'INT. ROOM - DAY' }],
        },
        {
          type: 'action',
          children: [{ text: 'The room is empty.' }],
        },
      ];

      const xml = exportToFDXXML(elements, 'Test Screenplay');

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<FinalDraft DocumentType="Script"');
      expect(xml).toContain('<TitlePage>');
      expect(xml).toContain('<Text>Test Screenplay</Text>');
      expect(xml).toContain('<Paragraph Type="Scene Heading">');
      expect(xml).toContain('<Text>INT. ROOM - DAY</Text>');
      expect(xml).toContain('<Paragraph Type="Action">');
      expect(xml).toContain('<Text>The room is empty.</Text>');
    });

    it('should escape XML special characters', () => {
      const elements: ScreenplayElement[] = [
        {
          type: 'dialogue',
          children: [{ text: 'He said "Hello" & waved <goodbye>.' }],
        },
      ];

      const xml = exportToFDXXML(elements, "Test's Title");

      expect(xml).toContain('&quot;Hello&quot;');
      expect(xml).toContain('&amp;');
      expect(xml).toContain('&lt;goodbye&gt;');
      expect(xml).toContain('Test&#39;s Title');
    });

    it('should handle dual dialogue in XML', () => {
      const elements: ScreenplayElement[] = [
        {
          type: 'character',
          children: [{ text: 'JOHN' }],
          isDualDialogue: true,
        },
        {
          type: 'dialogue',
          children: [{ text: 'Hello!' }],
          isDualDialogue: true,
        },
      ];

      const xml = exportToFDXXML(elements);

      expect(xml).toContain('DualDialogue="true"');
    });

    it('should use default title when not provided', () => {
      const elements: ScreenplayElement[] = [];
      const xml = exportToFDXXML(elements);

      expect(xml).toContain('<Text>Untitled</Text>');
    });
  });

  describe('calculatePageBreaks', () => {
    it('should calculate page breaks for empty screenplay', () => {
      const result = calculatePageBreaks([]);

      expect(result.pages).toHaveLength(1);
      expect(result.pages[0]).toEqual({
        number: 1,
        elements: [],
        lines: 0,
      });
    });

    it('should keep scene heading with following action on same page', () => {
      const elements: ScreenplayElement[] = [
        {
          type: 'scene_heading',
          children: [{ text: 'INT. OFFICE - DAY' }],
        },
        {
          type: 'action',
          children: [{ text: 'A brief action.' }],
        },
      ];

      const result = calculatePageBreaks(elements);

      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].elements).toHaveLength(2);
    });

    it('should break pages when exceeding line limit', () => {
      const elements: ScreenplayElement[] = [];

      // Add enough elements to exceed one page
      for (let i = 0; i < 20; i++) {
        elements.push({
          type: 'action',
          children: [{ text: 'This is a long action paragraph that spans multiple lines and will eventually cause a page break.' }],
        });
      }

      const result = calculatePageBreaks(elements);

      expect(result.pages.length).toBeGreaterThan(1);
      expect(result.pages[0].lines).toBeLessThanOrEqual(LINES_PER_PAGE);
    });

    it('should correctly number pages', () => {
      const elements: ScreenplayElement[] = [];

      // Create content for 3 pages
      for (let i = 0; i < 50; i++) {
        elements.push({
          type: 'action',
          children: [{ text: 'Action paragraph that takes up space on the page.' }],
        });
      }

      const result = calculatePageBreaks(elements);

      result.pages.forEach((page, index) => {
        expect(page.number).toBe(index + 1);
      });
    });

    it('should handle transitions with proper spacing', () => {
      const elements: ScreenplayElement[] = [
        {
          type: 'action',
          children: [{ text: 'Some action happens.' }],
        },
        {
          type: 'transition',
          children: [{ text: 'FADE OUT.' }],
        },
        {
          type: 'scene_heading',
          children: [{ text: 'INT. NEW LOCATION - NIGHT' }],
        },
      ];

      const result = calculatePageBreaks(elements);

      // All elements should be on the same page if they fit
      expect(result.pages[0].elements).toHaveLength(3);
    });

    it('should handle dialogue blocks correctly', () => {
      const elements: ScreenplayElement[] = [
        {
          type: 'character',
          children: [{ text: 'SARAH' }],
        },
        {
          type: 'parenthetical',
          children: [{ text: '(whispering)' }],
        },
        {
          type: 'dialogue',
          children: [{ text: 'I think we should leave.' }],
        },
        {
          type: 'character',
          children: [{ text: 'JOHN' }],
        },
        {
          type: 'dialogue',
          children: [{ text: 'Not yet. We need to wait.' }],
        },
      ];

      const result = calculatePageBreaks(elements);

      // Dialogue blocks should stay together on the same page if possible
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].elements).toHaveLength(5);
    });

    it('should handle very long single elements', () => {
      const veryLongText = 'A'.repeat(CHARACTERS_PER_LINE * 10); // 10 lines worth of text
      const elements: ScreenplayElement[] = [
        {
          type: 'action',
          children: [{ text: veryLongText }],
        },
      ];

      const result = calculatePageBreaks(elements);

      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].lines).toBeGreaterThan(10);
    });
  });

  describe('Edge Cases and Special Scenarios', () => {
    it('should handle unicode characters correctly', () => {
      const elements: ScreenplayElement[] = [
        {
          type: 'dialogue',
          children: [{ text: 'Café, naïve, 你好, مرحبا, 🎬' }],
        },
      ];

      const result = convertToFDX(elements);
      const xml = exportToFDXXML(elements);

      expect(result.paragraphs[0].Text).toBe('Café, naïve, 你好, مرحبا, 🎬');
      expect(xml).toContain('Café, naïve, 你好, مرحبا, 🎬');
    });

    it('should handle elements with multiple text children', () => {
      const elements: ScreenplayElement[] = [
        {
          type: 'action',
          children: [
            { text: 'Part one ' },
            { text: 'part two ' },
            { text: 'part three' },
          ],
        },
      ];

      const result = convertToFDX(elements);

      expect(result.paragraphs[0].Text).toBe('Part one part two part three');
    });

    it('should handle all transition types correctly', () => {
      const transitions = ['CUT TO:', 'FADE OUT.', 'BLACK.', 'DISSOLVE TO:', 'MATCH CUT TO:'];
      const elements: ScreenplayElement[] = transitions.map(t => ({
        type: 'transition' as ScreenplayBlockType,
        children: [{ text: t }],
      }));

      const result = convertToFDX(elements);

      result.paragraphs.forEach((p, index) => {
        expect(p.Type).toBe('Transition');
        expect(p.Text).toBe(transitions[index]);
      });
    });

    it('should handle mixed case element types', () => {
      const elements: ScreenplayElement[] = [
        {
          type: 'new_act',
          children: [{ text: 'ACT ONE' }],
        },
        {
          type: 'end_of_act',
          children: [{ text: 'END OF ACT ONE' }],
        },
      ];

      const result = convertToFDX(elements);

      expect(result.paragraphs[0].Type).toBe('New Act');
      expect(result.paragraphs[1].Type).toBe('End of Act');
    });
  });
});