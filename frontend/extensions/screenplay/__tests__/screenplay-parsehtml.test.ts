/**
 * Screenplay Extensions ParseHTML Tests
 *
 * Tests for the parseHTML behavior of screenplay node extensions.
 * Critical for ensuring element types are preserved during:
 * - New script creation
 * - Content pasting
 * - FDX import
 * - Yjs synchronization
 *
 * IMPORTANT FIX TESTED:
 * action.ts previously had `{ tag: 'p:not([data-type])' }` which claimed
 * ALL plain <p> tags as action blocks. This was removed to fix new scripts
 * starting with action instead of sceneHeading.
 */

import { generateHTML, generateJSON } from '@tiptap/html';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Paragraph from '@tiptap/extension-paragraph';

import { SceneHeading } from '../nodes/scene-heading';
import { Action } from '../nodes/action';
import { Character } from '../nodes/character';
import { Dialogue } from '../nodes/dialogue';
import { Parenthetical } from '../nodes/parenthetical';
import { Transition } from '../nodes/transition';

// All screenplay extensions for testing
const screenplayExtensions = [
  Document,
  Text,
  Paragraph, // Keep paragraph as fallback for untyped <p> tags
  SceneHeading,
  Action,
  Character,
  Dialogue,
  Parenthetical,
  Transition,
];

describe('Screenplay Extensions ParseHTML', () => {
  describe('Scene Heading', () => {
    test('parses p[data-type="scene-heading"] as sceneHeading', () => {
      const html = '<p data-type="scene-heading">INT. COFFEE SHOP - DAY</p>';
      const json = generateJSON(html, screenplayExtensions);

      expect(json.content).toHaveLength(1);
      expect(json.content[0].type).toBe('sceneHeading');
      expect(json.content[0].content[0].text).toBe('INT. COFFEE SHOP - DAY');
    });

    test('does NOT parse plain <p> as sceneHeading', () => {
      const html = '<p>Plain paragraph text</p>';
      const json = generateJSON(html, screenplayExtensions);

      expect(json.content).toHaveLength(1);
      // Should be paragraph (fallback), NOT sceneHeading
      expect(json.content[0].type).not.toBe('sceneHeading');
    });
  });

  describe('Action', () => {
    test('parses p[data-type="action"] as action', () => {
      const html = '<p data-type="action">Sarah walks into the room.</p>';
      const json = generateJSON(html, screenplayExtensions);

      expect(json.content).toHaveLength(1);
      expect(json.content[0].type).toBe('action');
      expect(json.content[0].content[0].text).toBe('Sarah walks into the room.');
    });

    test('does NOT parse plain <p> as action (CRITICAL FIX)', () => {
      // This is the critical test for the fix we made
      // Previously action.ts had: { tag: 'p:not([data-type])' }
      // which would claim ANY plain <p> tag as action
      const html = '<p>Plain paragraph text</p>';
      const json = generateJSON(html, screenplayExtensions);

      expect(json.content).toHaveLength(1);
      // Should be paragraph (StarterKit fallback), NOT action
      expect(json.content[0].type).not.toBe('action');
      expect(json.content[0].type).toBe('paragraph');
    });

    test('does NOT claim other data-type paragraphs', () => {
      const html = '<p data-type="scene-heading">INT. OFFICE - DAY</p>';
      const json = generateJSON(html, screenplayExtensions);

      expect(json.content[0].type).toBe('sceneHeading');
      expect(json.content[0].type).not.toBe('action');
    });
  });

  describe('Character', () => {
    test('parses p[data-type="character"] as character', () => {
      const html = '<p data-type="character">JOHN</p>';
      const json = generateJSON(html, screenplayExtensions);

      expect(json.content).toHaveLength(1);
      expect(json.content[0].type).toBe('character');
      expect(json.content[0].content[0].text).toBe('JOHN');
    });
  });

  describe('Dialogue', () => {
    test('parses p[data-type="dialogue"] as dialogue', () => {
      const html = '<p data-type="dialogue">I need more coffee.</p>';
      const json = generateJSON(html, screenplayExtensions);

      expect(json.content).toHaveLength(1);
      expect(json.content[0].type).toBe('dialogue');
    });
  });

  describe('Parenthetical', () => {
    test('parses p[data-type="parenthetical"] as parenthetical', () => {
      const html = '<p data-type="parenthetical">(beat)</p>';
      const json = generateJSON(html, screenplayExtensions);

      expect(json.content).toHaveLength(1);
      expect(json.content[0].type).toBe('parenthetical');
    });
  });

  describe('Transition', () => {
    test('parses p[data-type="transition"] as transition', () => {
      const html = '<p data-type="transition">CUT TO</p>';
      const json = generateJSON(html, screenplayExtensions);

      expect(json.content).toHaveLength(1);
      expect(json.content[0].type).toBe('transition');
    });
  });

  describe('Mixed Content', () => {
    test('parses multiple typed paragraphs correctly', () => {
      const html = `
        <p data-type="scene-heading">INT. COFFEE SHOP - DAY</p>
        <p data-type="action">Sarah walks in.</p>
        <p data-type="character">SARAH</p>
        <p data-type="dialogue">Hello everyone!</p>
      `;
      const json = generateJSON(html, screenplayExtensions);

      expect(json.content).toHaveLength(4);
      expect(json.content[0].type).toBe('sceneHeading');
      expect(json.content[1].type).toBe('action');
      expect(json.content[2].type).toBe('character');
      expect(json.content[3].type).toBe('dialogue');
    });

    test('untyped paragraphs fall through to paragraph extension', () => {
      const html = `
        <p data-type="scene-heading">INT. OFFICE - DAY</p>
        <p>This is just a plain paragraph.</p>
        <p data-type="action">Actual action text.</p>
      `;
      const json = generateJSON(html, screenplayExtensions);

      expect(json.content).toHaveLength(3);
      expect(json.content[0].type).toBe('sceneHeading');
      expect(json.content[1].type).toBe('paragraph'); // Falls through to paragraph
      expect(json.content[2].type).toBe('action');
    });
  });

  describe('Plain Text Paste Behavior', () => {
    test('pasted plain text becomes paragraph, not action', () => {
      // Simulates what happens when user pastes plain text
      const html = '<p>Some pasted text from clipboard</p>';
      const json = generateJSON(html, screenplayExtensions);

      expect(json.content).toHaveLength(1);
      // Critical: should NOT become action
      expect(json.content[0].type).toBe('paragraph');
    });

    test('multiple plain paragraphs become paragraphs', () => {
      const html = `
        <p>First paragraph</p>
        <p>Second paragraph</p>
        <p>Third paragraph</p>
      `;
      const json = generateJSON(html, screenplayExtensions);

      expect(json.content).toHaveLength(3);
      // All should be paragraph, not action
      json.content.forEach((node: any) => {
        expect(node.type).toBe('paragraph');
      });
    });
  });

  describe('RenderHTML / GenerateHTML', () => {
    test('sceneHeading renders with correct data-type', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'sceneHeading',
            content: [{ type: 'text', text: 'INT. OFFICE - DAY' }]
          }
        ]
      };
      const html = generateHTML(json, screenplayExtensions);

      expect(html).toContain('data-type="scene-heading"');
      expect(html).toContain('class="screenplay-scene-heading"');
    });

    test('action renders with correct data-type', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'action',
            content: [{ type: 'text', text: 'She walks in.' }]
          }
        ]
      };
      const html = generateHTML(json, screenplayExtensions);

      expect(html).toContain('data-type="action"');
      expect(html).toContain('class="screenplay-action"');
    });

    test('roundtrip: sceneHeading → HTML → sceneHeading', () => {
      const originalJson = {
        type: 'doc',
        content: [
          {
            type: 'sceneHeading',
            content: [{ type: 'text', text: 'EXT. BEACH - SUNSET' }]
          }
        ]
      };

      const html = generateHTML(originalJson, screenplayExtensions);
      const parsedJson = generateJSON(html, screenplayExtensions);

      expect(parsedJson.content[0].type).toBe('sceneHeading');
      expect(parsedJson.content[0].content[0].text).toBe('EXT. BEACH - SUNSET');
    });

    test('roundtrip: action → HTML → action', () => {
      const originalJson = {
        type: 'doc',
        content: [
          {
            type: 'action',
            content: [{ type: 'text', text: 'The sun sets over the ocean.' }]
          }
        ]
      };

      const html = generateHTML(originalJson, screenplayExtensions);
      const parsedJson = generateJSON(html, screenplayExtensions);

      expect(parsedJson.content[0].type).toBe('action');
      expect(parsedJson.content[0].content[0].text).toBe('The sun sets over the ocean.');
    });
  });

  describe('New Script Creation', () => {
    test('empty content blocks should create sceneHeading document', () => {
      // This tests the contentBlocksToTipTap behavior
      // which is critical for new script creation
      const { contentBlocksToTipTap } = require('@/utils/content-blocks-converter');

      const result = contentBlocksToTipTap([]);

      expect(result.type).toBe('doc');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('sceneHeading');
    });

    test('null content blocks should create sceneHeading document', () => {
      const { contentBlocksToTipTap } = require('@/utils/content-blocks-converter');

      const result = contentBlocksToTipTap(null as any);

      expect(result.type).toBe('doc');
      expect(result.content[0].type).toBe('sceneHeading');
    });
  });
});
