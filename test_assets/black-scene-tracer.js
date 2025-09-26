#!/usr/bin/env node

/**
 * Black Scene Tracer - Debug the missing "Black." scene
 *
 * This script traces exactly what happens to the "Black." scene heading
 * in the sr_first_look_final.fdx file during parsing.
 */

const fs = require('fs');
const xml2js = require('xml2js');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}⚠️ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  section: (msg) => console.log(`\n${colors.bright}${colors.magenta}🎯 ${msg}${colors.reset}`),
  trace: (msg) => console.log(`${colors.cyan}🔍 ${msg}${colors.reset}`)
};

class BlackSceneTracer {

  /**
   * Enhanced version of parseIndividualParagraph with detailed tracing
   */
  parseIndividualParagraphWithTrace(paragraph, originalIndex) {
    try {
      const type = paragraph.Type || 'Action';
      let text = '';

      // Handle different text structures
      if (typeof paragraph.Text === 'string') {
        text = paragraph.Text;
      } else if (Array.isArray(paragraph.Text)) {
        text = paragraph.Text.map(item => {
          if (typeof item === 'string') {
            return item;
          } else if (item && typeof item === 'object') {
            return item._ || item.text || item.content || '';
          }
          return String(item);
        }).join(' ');
      } else if (paragraph.Text && typeof paragraph.Text === 'object') {
        text = paragraph.Text._ || paragraph.Text.text || paragraph.Text.content || '';

        if (!text) {
          const values = Object.values(paragraph.Text);
          text = values.filter(v => typeof v === 'string').join(' ');
        }
      }

      text = String(text).trim();

      if (!text) {
        log.trace(`Para ${originalIndex}: [${type}] SKIPPED - empty text`);
        return null;
      }

      // Special tracking for "Black." and similar
      const isBlackScene = text.match(/^(BLACK|WHITE|DARKNESS|SILENCE)\.?$/i);
      if (isBlackScene) {
        log.section(`FOUND BLACK-TYPE SCENE: Para ${originalIndex}`);
        log.trace(`  Original Type: "${type}"`);
        log.trace(`  Text: "${text}"`);
        log.trace(`  Raw paragraph: ${JSON.stringify(paragraph, null, 2)}`);
      }

      // Apply enhanced content-based logic WITH DETAILED TRACING
      const classifiedType = this.classifyElementWithTrace(type, text, originalIndex, isBlackScene);

      if (isBlackScene) {
        log.trace(`  Final Classification: "${classifiedType}"`);
        log.trace(`  Will be ${classifiedType ? 'INCLUDED' : 'REJECTED'}`);
      }

      return classifiedType ? {
        type: classifiedType,
        text: text,
        originalType: type
      } : null;

    } catch (error) {
      log.warning(`Failed to parse paragraph ${originalIndex}: ${error.message}`);
      return null;
    }
  }

  /**
   * Enhanced element classification with detailed tracing
   */
  classifyElementWithTrace(originalType, text, paraIndex, isBlackScene = false) {
    if (isBlackScene) {
      log.trace(`  🔍 CLASSIFYING BLACK-TYPE SCENE:`);
    }

    // Transition detection patterns
    const transitionPatterns = [
      /^(FADE IN|FADE OUT|FADE TO BLACK|SMASH CUT TO|CUT TO|MATCH CUT TO|JUMP CUT TO|DISSOLVE TO|FLASH TO|FLASH CUT TO|FREEZE FRAME|TIME CUT|MONTAGE|END MONTAGE|SPLIT SCREEN|IRIS IN|IRIS OUT|WIPE TO|FLIP TO)[\.\:\;]?$/i,
      /^(FADE IN\:|FADE OUT\.|CUT TO\:|DISSOLVE TO\:|FLASH TO\:)$/i,
      /^(LATER|CONTINUOUS|MEANWHILE|SIMULTANEOUSLY)$/i,
      /^(THE END|END OF FILM|END OF EPISODE|ROLL CREDITS)$/i,
      /^(BLACK\.|WHITE\.|DARKNESS\.|SILENCE\.)$/i
    ];

    // Check for transitions
    for (const pattern of transitionPatterns) {
      if (pattern.test(text)) {
        if (isBlackScene) {
          log.warning(`    ❌ MATCHED TRANSITION PATTERN: ${pattern}`);
          log.warning(`    ❌ BEING RECLASSIFIED AS TRANSITION`);
        }
        return 'transition';
      }
    }

    // Scene heading validation
    if (originalType === 'Scene Heading') {
      if (isBlackScene) {
        log.trace(`    ✅ Original type is Scene Heading`);
      }

      // Allow visual states
      if (text.match(/^(BLACK|WHITE|DARKNESS|SILENCE)\.?$/i)) {
        if (isBlackScene) {
          log.success(`    ✅ MATCHES VISUAL STATE PATTERN - KEEPING AS SCENE HEADING`);
        }
        return 'scene_heading';
      }

      // Reject incomplete sluglines
      if (text.match(/^(INT|EXT|INTERIOR|EXTERIOR)\.?$/i)) {
        if (isBlackScene) {
          log.warning(`    ❌ INCOMPLETE SLUGLINE - REJECTING`);
        }
        return null; // Invalid
      }

      // Must contain location info OR be a visual state
      if (!text.match(/^(INT|EXT|INTERIOR|EXTERIOR)[\.\s]+.+/i) && !text.match(/^(BLACK|WHITE|DARKNESS|SILENCE)\.?$/i)) {
        if (isBlackScene) {
          log.warning(`    ❌ MALFORMED SLUGLINE - REJECTING`);
        }
        return null; // Invalid
      }

      if (isBlackScene) {
        log.success(`    ✅ VALID SCENE HEADING - KEEPING`);
      }
      return 'scene_heading';
    }

    // Return original type for other elements
    const typeMap = {
      'Action': 'action',
      'Character': 'character',
      'Dialogue': 'dialogue',
      'Parenthetical': 'parenthetical',
      'Transition': 'transition'
    };

    const finalType = typeMap[originalType] || originalType.toLowerCase().replace(/\s+/g, '_');
    if (isBlackScene) {
      log.trace(`    📝 NON-SCENE-HEADING ELEMENT: ${originalType} → ${finalType}`);
    }
    return finalType;
  }

  /**
   * Trace the complete parsing pipeline for sr_first_look_final.fdx
   */
  async traceBlackScene() {
    log.section('BLACK SCENE TRACER - DETAILED ANALYSIS');

    const filePath = '/Users/ltw/Documents/GitHub/writersroom/sr_first_look_final.fdx';
    const fdxContent = fs.readFileSync(filePath, 'utf-8');

    log.info('Analyzing sr_first_look_final.fdx for "Black." scene...');

    // Parse XML to JSON structure
    const parser = new xml2js.Parser({
      explicitArray: false,
      mergeAttrs: true,
      trim: false,
      normalize: false
    });

    const xmlData = await parser.parseStringPromise(fdxContent);
    const content = xmlData?.FinalDraft?.Content;

    let paragraphs = content.Paragraph;
    if (!Array.isArray(paragraphs)) {
      paragraphs = paragraphs ? [paragraphs] : [];
    }

    log.info(`Processing ${paragraphs.length} paragraphs...`);

    // Track all scene headings and specifically look for Black.
    const allSceneHeadings = [];
    const allParsedElements = [];
    let blackSceneFound = false;
    let blackSceneParagraphIndex = -1;

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i];

      // Check if this is the Black. paragraph
      const type = paragraph.Type || 'Action';
      let text = '';

      if (typeof paragraph.Text === 'string') {
        text = paragraph.Text;
      } else if (Array.isArray(paragraph.Text)) {
        text = paragraph.Text.map(item => {
          if (typeof item === 'string') {
            return item;
          } else if (item && typeof item === 'object') {
            return item._ || item.text || item.content || '';
          }
          return String(item);
        }).join(' ');
      } else if (paragraph.Text && typeof paragraph.Text === 'object') {
        text = paragraph.Text._ || paragraph.Text.text || paragraph.Text.content || '';
      }

      text = String(text).trim();

      if (text === 'Black.' && type === 'Scene Heading') {
        blackSceneFound = true;
        blackSceneParagraphIndex = i;
        log.section(`FOUND BLACK SCENE AT PARAGRAPH ${i}`);
        log.trace(`Raw paragraph: ${JSON.stringify(paragraph, null, 2)}`);
      }

      // Parse this paragraph
      const result = this.parseIndividualParagraphWithTrace(paragraph, i);

      if (result) {
        allParsedElements.push({
          ...result,
          originalIndex: i,
          sequenceIndex: allParsedElements.length
        });

        if (result.type === 'scene_heading') {
          allSceneHeadings.push({
            slugline: result.text,
            originalIndex: i,
            sequenceIndex: allParsedElements.length - 1
          });
        }
      }
    }

    // Analyze the results
    log.section('ANALYSIS RESULTS');
    log.info(`Total paragraphs processed: ${paragraphs.length}`);
    log.info(`Total elements parsed: ${allParsedElements.length}`);
    log.info(`Total scene headings found: ${allSceneHeadings.length}`);

    if (blackSceneFound) {
      log.success(`Black. scene found at paragraph ${blackSceneParagraphIndex}`);

      // Check if it made it through parsing
      const blackInParsed = allSceneHeadings.find(s => s.slugline === 'BLACK.' || s.slugline === 'Black.');
      if (blackInParsed) {
        log.success(`Black. scene successfully parsed as scene heading at sequence index ${blackInParsed.sequenceIndex}`);
      } else {
        log.error(`Black. scene was NOT parsed as scene heading!`);

        // Check if it was parsed as something else
        const blackElement = allParsedElements.find(e => e.originalIndex === blackSceneParagraphIndex);
        if (blackElement) {
          log.error(`Black. was classified as: ${blackElement.type} with text: "${blackElement.text}"`);
        } else {
          log.error(`Black. paragraph was completely filtered out!`);
        }
      }
    } else {
      log.error('Black. scene not found in the FDX file!');
    }

    // Show last few scene headings for context
    log.section('LAST 5 SCENE HEADINGS FOUND');
    allSceneHeadings.slice(-5).forEach((scene, index) => {
      const position = allSceneHeadings.length - 5 + index + 1;
      log.info(`${position}. "${scene.slugline}" (para ${scene.originalIndex}, seq ${scene.sequenceIndex})`);
    });

    // Show context around Black. scene
    if (blackSceneFound) {
      log.section('CONTEXT AROUND BLACK SCENE');
      const startIndex = Math.max(0, blackSceneParagraphIndex - 3);
      const endIndex = Math.min(paragraphs.length - 1, blackSceneParagraphIndex + 3);

      for (let i = startIndex; i <= endIndex; i++) {
        const para = paragraphs[i];
        const type = para.Type || 'Action';
        let text = '';

        if (typeof para.Text === 'string') {
          text = para.Text;
        } else if (Array.isArray(para.Text)) {
          text = para.Text.join(' ');
        } else if (para.Text && typeof para.Text === 'object') {
          text = para.Text._ || para.Text.text || para.Text.content || '';
        }

        text = String(text).trim();

        const marker = i === blackSceneParagraphIndex ? '>>> ' : '    ';
        log.info(`${marker}Para ${i}: [${type}] "${text}"`);
      }
    }

    return {
      totalParagraphs: paragraphs.length,
      totalParsedElements: allParsedElements.length,
      totalSceneHeadings: allSceneHeadings.length,
      blackSceneFound,
      blackSceneParagraphIndex,
      sceneHeadings: allSceneHeadings.map(s => s.slugline)
    };
  }

  /**
   * Test the exact classification logic for "Black."
   */
  testBlackClassification() {
    log.section('BLACK CLASSIFICATION UNIT TEST');

    const testCases = [
      {
        name: 'Black. as Scene Heading',
        type: 'Scene Heading',
        text: 'Black.',
        expected: 'scene_heading'
      },
      {
        name: 'BLACK. as Scene Heading',
        type: 'Scene Heading',
        text: 'BLACK.',
        expected: 'scene_heading'
      },
      {
        name: 'Black as Scene Heading (no period)',
        type: 'Scene Heading',
        text: 'Black',
        expected: 'scene_heading'
      },
      {
        name: 'FADE TO BLACK as Scene Heading (should be transition)',
        type: 'Scene Heading',
        text: 'FADE TO BLACK',
        expected: 'transition'
      },
      {
        name: 'Black. as Action (wrong type)',
        type: 'Action',
        text: 'Black.',
        expected: 'action'
      }
    ];

    testCases.forEach((testCase, index) => {
      log.info(`\nTest ${index + 1}: ${testCase.name}`);
      log.trace(`  Input: Type="${testCase.type}", Text="${testCase.text}"`);
      log.trace(`  Expected: "${testCase.expected}"`);

      const result = this.classifyElementWithTrace(testCase.type, testCase.text, index, true);
      log.trace(`  Actual: "${result}"`);

      if (result === testCase.expected) {
        log.success(`  ✅ PASS`);
      } else {
        log.error(`  ❌ FAIL - Expected "${testCase.expected}", got "${result}"`);
      }
    });
  }
}

// Main execution
async function main() {
  const tracer = new BlackSceneTracer();

  // First run unit tests
  tracer.testBlackClassification();

  // Then trace the actual file
  const results = await tracer.traceBlackScene();

  log.section('SUMMARY');
  log.info(`File analysis complete:`);
  log.info(`  Total paragraphs: ${results.totalParagraphs}`);
  log.info(`  Parsed elements: ${results.totalParsedElements}`);
  log.info(`  Scene headings: ${results.totalSceneHeadings}`);
  log.info(`  Black scene found: ${results.blackSceneFound}`);

  if (results.blackSceneFound) {
    log.info(`  Black scene at paragraph: ${results.blackSceneParagraphIndex}`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = BlackSceneTracer;