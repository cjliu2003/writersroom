/**
 * FDX Parser Module
 * Provides functions for parsing FDX files into Slate editor elements
 */

import { ScreenplayElement, ScreenplayBlockType } from '@/types/screenplay';
import * as xml2js from 'xml2js';

interface ParsedResult {
  elements: ScreenplayElement[];
  title: string;
}

interface SceneData {
  slugline: string;
  summary: string;
  tokens: number;
  characters: string[];
  themes: string[];
}

interface MemoryData {
  scenes: SceneData[];
}

/**
 * Parse an uploaded FDX file into Slate elements
 */
export async function parseUploadedFile(file: File): Promise<ParsedResult> {
  const content = await file.text();
  return parseFDXContent(content, file.name);
}

/**
 * Parse FDX content string into Slate elements
 */
export async function parseFDXContent(fdxContent: string, filename?: string): Promise<ParsedResult> {
  const elements: ScreenplayElement[] = [];
  let title = 'Untitled Script';

  // Extract title from filename or XML
  if (filename) {
    title = filename.replace(/\.fdx$/i, '').trim();
  } else {
    const titleMatch = fdxContent.match(/<Title>(.*?)<\/Title>/i);
    title = titleMatch ? titleMatch[1].trim() : 'Untitled Script';
  }

  try {
    // Parse XML
    const parser = new xml2js.Parser({
      explicitArray: false,
      mergeAttrs: true,
      trim: false,
      normalize: false
    });

    const xmlData = await parser.parseStringPromise(fdxContent);
    const content = xmlData?.FinalDraft?.Content;

    if (!content) {
      throw new Error('No Content section found in FDX file');
    }

    // Handle both single paragraph and array of paragraphs
    // Check for Body element first (some FDX files have Content > Body > Paragraph)
    let paragraphs = content.Body?.Paragraph || content.Paragraph;
    if (!Array.isArray(paragraphs)) {
      paragraphs = paragraphs ? [paragraphs] : [];
    }

    // Process each paragraph
    for (const paragraph of paragraphs) {
      const element = parseParagraph(paragraph);
      if (element) {
        elements.push(element);
      }
    }

  } catch (error) {
    console.error('Error parsing FDX:', error);
    throw new Error(`Invalid FDX format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return { elements, title };
}

/**
 * Parse a single FDX paragraph into a Slate element
 */
function parseParagraph(paragraph: any): ScreenplayElement | null {
  const type = paragraph.Type || 'Action';
  let text = '';

  // Extract text content
  if (typeof paragraph.Text === 'string') {
    text = paragraph.Text;
  } else if (Array.isArray(paragraph.Text)) {
    text = paragraph.Text.map((item: any) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        return item._ || item.text || item.content || '';
      }
      return String(item);
    }).join(' ');
  } else if (paragraph.Text && typeof paragraph.Text === 'object') {
    text = paragraph.Text._ || paragraph.Text.text || paragraph.Text.content || '';
  }

  text = text.trim();
  if (!text) return null;

  // Content-based classification
  const element = classifyElement(type, text);
  if (!element) return null;

  return {
    type: element.type as ScreenplayBlockType,
    children: [{ text: element.text }]
  };
}

/**
 * Classify element based on XML type and content
 */
function classifyElement(xmlType: string, text: string): { type: string; text: string } | null {
  // TRANSITION DETECTION - Content-based classification overrides XML type
  const transitionPatterns = [
    /^(FADE IN|FADE OUT|FADE TO BLACK|SMASH CUT TO|CUT TO|MATCH CUT TO|JUMP CUT TO|DISSOLVE TO|FLASH TO|FLASH CUT TO|FREEZE FRAME|TIME CUT|MONTAGE|END MONTAGE|SPLIT SCREEN|IRIS IN|IRIS OUT|WIPE TO|FLIP TO)[\.\:\;]?$/i,
    /^(FADE IN\:|FADE OUT\.|CUT TO\:|DISSOLVE TO\:|FLASH TO\:)$/i,
    /^(LATER|CONTINUOUS|MEANWHILE|SIMULTANEOUSLY)$/i,
    /^(THE END|END OF FILM|END OF EPISODE|ROLL CREDITS)$/i,
    /^(BLACK\.|WHITE\.|DARKNESS\.|SILENCE\.)$/i
  ];

  // Check for transitions regardless of XML type
  for (const pattern of transitionPatterns) {
    if (pattern.test(text)) {
      const formattedText = text.toUpperCase() + (text.endsWith(':') || text.endsWith('.') ? '' : ':');
      return { type: 'transition', text: formattedText };
    }
  }

  // Handle Scene Headings
  if (xmlType === 'Scene Heading') {
    // BLACK., WHITE., etc. can be scene headings when explicitly marked as such in the XML
    // Don't reclassify them as transitions if the XML says Scene Heading
    if (text.match(/^(BLACK|WHITE|DARKNESS|SILENCE)\.?$/i)) {
      // Respect the XML type - these are valid scene headings
      return { type: 'scene_heading', text: text.toUpperCase() + (text.endsWith('.') ? '' : '.') };
    }

    // Reject incomplete sluglines
    if (text.match(/^(INT|EXT|INTERIOR|EXTERIOR)\.?$/i)) {
      return null; // Incomplete slugline
    }

    // Reject single words that aren't valid locations
    if (text.match(/^[A-Z]+\.?$/) && !text.match(/^(BLACK|WHITE|DARKNESS|SILENCE)\.?$/i)) {
      return null;
    }

    // Valid scene heading must have location info
    if (!text.match(/^(INT|EXT|INTERIOR|EXTERIOR)[\.\s]+.+/i)) {
      return null; // Not a proper slugline
    }

    // Preserve original case for scene headings (some scripts use mixed case)
    return { type: 'scene_heading', text: text };
  }

  // Handle other element types
  switch (xmlType) {
    case 'Action':
      return { type: 'action', text };
    case 'Character':
      return { type: 'character', text: text.toUpperCase() };
    case 'Dialogue':
      return { type: 'dialogue', text };
    case 'Parenthetical':
      const formattedText = text.startsWith('(') && text.endsWith(')') ? text : `(${text})`;
      return { type: 'parenthetical', text: formattedText };
    case 'Transition':
      return { type: 'transition', text: text.toUpperCase() + (text.endsWith(':') ? '' : ':') };
    default:
      const elementType = xmlType.toLowerCase().replace(/\s+/g, '_');
      return { type: elementType, text };
  }
}

/**
 * Hydrate memory data from FDX elements
 */
export async function hydrateMemoryFromFDX(
  elements: ScreenplayElement[],
  projectId: string
): Promise<MemoryData> {
  const scenes: SceneData[] = [];
  let currentScene: SceneData | null = null;
  let currentContent: string[] = [];
  let currentCharacters: Set<string> = new Set();

  for (const element of elements) {
    const text = element.children[0]?.text || '';

    if (element.type === 'scene_heading') {
      // Save previous scene if exists
      if (currentScene) {
        currentScene.summary = generateSummary(currentContent);
        currentScene.tokens = estimateTokens(currentContent.join(' '));
        currentScene.characters = Array.from(currentCharacters);
        currentScene.themes = extractThemes(currentContent);
        scenes.push(currentScene);
      }

      // Start new scene
      currentScene = {
        slugline: text,
        summary: '',
        tokens: 0,
        characters: [],
        themes: []
      };
      currentContent = [text];
      currentCharacters = new Set();
    } else if (currentScene) {
      // Add content to current scene
      currentContent.push(text);

      // Track characters
      if (element.type === 'character') {
        currentCharacters.add(text);
      }
    }
  }

  // Save last scene
  if (currentScene) {
    currentScene.summary = generateSummary(currentContent);
    currentScene.tokens = estimateTokens(currentContent.join(' '));
    currentScene.characters = Array.from(currentCharacters);
    currentScene.themes = extractThemes(currentContent);
    scenes.push(currentScene);
  }

  return { scenes };
}

/**
 * Generate a summary from scene content
 */
function generateSummary(content: string[]): string {
  if (content.length === 0) return 'Empty scene';

  // Take first few lines of action/dialogue for summary
  const meaningful = content.slice(1, 4).filter(line => line.trim().length > 0);
  if (meaningful.length === 0) return 'Scene with minimal content';

  return meaningful.join(' ').substring(0, 150) + (meaningful.join(' ').length > 150 ? '...' : '');
}

/**
 * Estimate token count for content
 */
function estimateTokens(text: string): number {
  // Rough estimate: 1 token per 4 characters
  return Math.ceil(text.length / 4);
}

/**
 * Extract themes from content
 */
function extractThemes(content: string[]): string[] {
  const themes: string[] = [];
  const text = content.join(' ').toLowerCase();

  // Simple theme detection
  if (text.includes('love') || text.includes('kiss') || text.includes('heart')) {
    themes.push('romance');
  }
  if (text.includes('fight') || text.includes('gun') || text.includes('kill')) {
    themes.push('action');
  }
  if (text.includes('dark') || text.includes('night') || text.includes('shadow')) {
    themes.push('suspense');
  }
  if (text.includes('laugh') || text.includes('joke') || text.includes('funny')) {
    themes.push('comedy');
  }

  return themes;
}

// Export parseFDX as a simpler version that returns just elements for compatibility with tests
export async function parseFDX(fdxContent: string): Promise<ScreenplayElement[]> {
  const result = await parseFDXContent(fdxContent);
  return result.elements;
}