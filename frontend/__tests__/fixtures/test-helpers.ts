/**
 * Test Helper Utilities and Fixtures
 *
 * Provides utilities for generating test data, mock objects,
 * and common test scenarios for WritersRoom testing.
 */

import { ScreenplayElement, ScreenplayBlockType } from '@/types/screenplay';
import { SceneMemory } from '../../shared/types';

/**
 * Factory Functions for Test Data Generation
 */

export interface SceneOptions {
  slugline?: string;
  hasAction?: boolean;
  hasDialogue?: boolean;
  characterCount?: number;
  transitionType?: string;
  isEmpty?: boolean;
}

/**
 * Creates a mock scene with configurable content
 */
export function createMockScene(options: SceneOptions = {}): ScreenplayElement[] {
  const {
    slugline = 'INT. TEST SCENE - DAY',
    hasAction = true,
    hasDialogue = false,
    characterCount = 0,
    transitionType = null,
    isEmpty = false,
  } = options;

  const elements: ScreenplayElement[] = [
    {
      type: 'scene_heading',
      children: [{ text: slugline }],
    },
  ];

  if (isEmpty) {
    return elements;
  }

  if (hasAction) {
    elements.push({
      type: 'action',
      children: [{ text: 'Test action occurs in the scene.' }],
    });
  }

  if (hasDialogue && characterCount > 0) {
    for (let i = 1; i <= characterCount; i++) {
      elements.push(
        {
          type: 'character',
          children: [{ text: `CHARACTER_${i}` }],
        },
        {
          type: 'dialogue',
          children: [{ text: `Dialogue line for character ${i}.` }],
        }
      );
    }
  }

  if (transitionType) {
    elements.push({
      type: 'transition',
      children: [{ text: transitionType }],
    });
  }

  return elements;
}

/**
 * Creates a mock SceneMemory object
 */
export function createMockSceneMemory(
  projectId: string,
  slugline: string,
  overrides: Partial<SceneMemory> = {}
): SceneMemory {
  return {
    projectId,
    slugline,
    summary: overrides.summary || 'Default test summary',
    tokens: overrides.tokens || 100,
    characters: overrides.characters || [],
    themes: overrides.themes || [],
    lastAccessed: overrides.lastAccessed || new Date(),
    ...overrides,
  };
}

/**
 * Generates a complete FDX XML string for testing
 */
export function generateFDXXML(scenes: Array<{ slugline: string; content: string[] }>): string {
  const paragraphs = scenes.flatMap(scene => {
    const sceneParagraphs = [`
      <Paragraph Type="Scene Heading">
        <Text>${escapeXML(scene.slugline)}</Text>
      </Paragraph>`];

    scene.content.forEach(line => {
      // Simple heuristic for element type detection
      let type = 'Action';
      if (line === line.toUpperCase() && line.length < 30) {
        type = 'Character';
      } else if (line.startsWith('(') && line.endsWith(')')) {
        type = 'Parenthetical';
      } else if (line.endsWith(':') || line === 'FADE OUT.' || line === 'BLACK.') {
        type = 'Transition';
      }

      sceneParagraphs.push(`
      <Paragraph Type="${type}">
        <Text>${escapeXML(line)}</Text>
      </Paragraph>`);
    });

    return sceneParagraphs;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="12">
  <Content>
    <TitlePage>
      <Content>
        <Paragraph Type="Title">
          <Text>Test Screenplay</Text>
        </Paragraph>
      </Content>
    </TitlePage>
    <Body>${paragraphs.join('')}
    </Body>
  </Content>
</FinalDraft>`;
}

function escapeXML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Creates a Slate editor state with scenes
 */
export function buildEditorState(scenes: SceneOptions[]): ScreenplayElement[] {
  return scenes.flatMap(scene => createMockScene(scene));
}

/**
 * Test Data Sets
 */

export const testScenes = {
  minimal: {
    slugline: 'INT. MINIMAL - DAY',
    content: ['A minimal scene.'],
  },
  standard: {
    slugline: 'INT. OFFICE - DAY',
    content: [
      'The office is busy with activity.',
      'JOHN',
      'We need to talk about the project.',
      'SARAH',
      '(sighing)',
      "I know. Let's meet after lunch.",
    ],
  },
  complex: {
    slugline: 'INT./EXT. CAR - MOVING - NIGHT',
    content: [
      'Rain pelts the windshield as the car speeds through the night.',
      'Thunder CRASHES overhead.',
      'DRIVER',
      '(shouting over the storm)',
      "We're not going to make it!",
      'PASSENGER',
      '(calmly)',
      'We have to try.',
      'The car SWERVES to avoid an obstacle.',
      'CUT TO:',
    ],
  },
  transition: {
    slugline: 'INT. ROOM - NIGHT',
    content: [
      'The room goes dark.',
      'FADE OUT.',
    ],
  },
  black: {
    slugline: 'INT. DARKNESS - UNKNOWN',
    content: [
      'Complete darkness.',
      'BLACK.',
    ],
  },
};

/**
 * Edge Case Test Scenarios
 */

export const edgeCases = {
  emptySlugline: {
    slugline: '',
    content: ['Content without a proper slugline.'],
  },
  unicodeContent: {
    slugline: 'INT. CAFÉ - DAY',
    content: [
      'José enters the café.',
      'JOSÉ',
      '¿Cómo estás, María?',
      'MARÍA',
      'Très bien, merci! 你好!',
    ],
  },
  veryLongSlugline: {
    slugline: 'INT./EXT. VERY LONG LOCATION NAME THAT EXCEEDS NORMAL LENGTH LIMITS - DAY/NIGHT - CONTINUOUS',
    content: ['Action in a location with an unusually long name.'],
  },
  specialCharacters: {
    slugline: 'INT. "SPECIAL" & \'UNUSUAL\' LOCATION - DAY',
    content: [
      'Text with <special> & "unusual" characters.',
      'CHARACTER',
      'Dialogue with "quotes" & ampersands.',
    ],
  },
  multilineAction: {
    slugline: 'EXT. FIELD - DAY',
    content: [
      `A very long action paragraph that spans multiple lines and contains
      various formatting challenges including line breaks and special
      characters that need to be preserved correctly during parsing and
      conversion to different formats.`,
    ],
  },
};

/**
 * Performance Test Data Generators
 */

export function generateLargeScreenplay(sceneCount: number): ScreenplayElement[] {
  const elements: ScreenplayElement[] = [];

  for (let i = 1; i <= sceneCount; i++) {
    elements.push(
      {
        type: 'scene_heading',
        children: [{ text: `INT. LOCATION ${i} - DAY` }],
      },
      {
        type: 'action',
        children: [{ text: `Action description for scene ${i}.` }],
      },
      {
        type: 'character',
        children: [{ text: `CHARACTER_${i}` }],
      },
      {
        type: 'dialogue',
        children: [{ text: `Dialogue for scene ${i}.` }],
      }
    );

    // Add transitions between scenes
    if (i < sceneCount) {
      elements.push({
        type: 'transition',
        children: [{ text: 'CUT TO:' }],
      });
    }
  }

  return elements;
}

/**
 * Mock File Creation
 */

export function createMockFDXFile(content: string, filename = 'test.fdx'): File {
  return new File([content], filename, { type: 'text/xml' });
}

/**
 * Validation Helpers
 */

export function isValidSlugline(slugline: string): boolean {
  const sluglinePatterns = [
    /^INT\./i,
    /^EXT\./i,
    /^INT\.\/EXT\./i,
    /^I\/E/i,
    /^FLASHBACK/i,
    /^DREAM/i,
    /^BLACK\.?$/i,
  ];

  return sluglinePatterns.some(pattern => pattern.test(slugline.trim()));
}

export function isTransition(text: string): boolean {
  const transitions = [
    'CUT TO:',
    'FADE IN:',
    'FADE OUT.',
    'FADE TO:',
    'DISSOLVE TO:',
    'MATCH CUT TO:',
    'JUMP CUT TO:',
    'SMASH CUT TO:',
    'BLACK.',
    'FADE TO BLACK.',
  ];

  return transitions.includes(text.trim().toUpperCase());
}

/**
 * Assertion Helpers
 */

export function assertSceneStructure(
  scene: ScreenplayElement[],
  expectedSlugline: string,
  expectedElementCount: number
) {
  expect(scene[0].type).toBe('scene_heading');
  expect(scene[0].children[0].text).toBe(expectedSlugline);
  expect(scene.length).toBe(expectedElementCount);
}

export function assertMemoryStructure(memory: SceneMemory) {
  expect(memory).toHaveProperty('projectId');
  expect(memory).toHaveProperty('slugline');
  expect(memory).toHaveProperty('summary');
  expect(memory).toHaveProperty('tokens');
  expect(memory).toHaveProperty('characters');
  expect(memory).toHaveProperty('themes');
  expect(memory).toHaveProperty('lastAccessed');
  expect(Array.isArray(memory.characters)).toBe(true);
  expect(Array.isArray(memory.themes)).toBe(true);
}

/**
 * Time and Performance Helpers
 */

export function measureExecutionTime<T>(
  fn: () => T,
  label = 'Execution'
): { result: T; time: number } {
  const start = performance.now();
  const result = fn();
  const time = performance.now() - start;
  console.log(`${label} took ${time.toFixed(2)}ms`);
  return { result, time };
}

export async function measureAsyncExecutionTime<T>(
  fn: () => Promise<T>,
  label = 'Async Execution'
): Promise<{ result: T; time: number }> {
  const start = performance.now();
  const result = await fn();
  const time = performance.now() - start;
  console.log(`${label} took ${time.toFixed(2)}ms`);
  return { result, time };
}

/**
 * Mock API Response Builders
 */

export function mockSuccessResponse<T>(data: T) {
  return {
    success: true,
    data,
    message: 'Success',
  };
}

export function mockErrorResponse(message: string, code = 500) {
  return {
    success: false,
    message,
    error: {
      code,
      details: message,
    },
  };
}

/**
 * Wait Utilities
 */

export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForCondition(
  condition: () => boolean,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();
  while (!condition() && Date.now() - start < timeout) {
    await wait(interval);
  }
  if (!condition()) {
    throw new Error('Condition not met within timeout');
  }
}

/**
 * Cleanup Utilities
 */

export function cleanupMocks() {
  jest.clearAllMocks();
  jest.restoreAllMocks();
}

export function resetLocalStorage() {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.clear();
  }
}

export function resetSessionStorage() {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    window.sessionStorage.clear();
  }
}