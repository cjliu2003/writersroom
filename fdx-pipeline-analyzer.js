#!/usr/bin/env node

/**
 * FDX Pipeline Ground Truth Analyzer
 *
 * This script performs comprehensive analysis of the FDX parsing pipeline
 * by comparing expected vs actual results at each stage:
 *
 * 1. Raw XML Analysis - Extract expected scenes from FDX structure
 * 2. Parser Output - Run parser and capture all elements with sequence indices
 * 3. Memory Storage - Test storage pipeline and verify scene persistence
 * 4. Pipeline Tracing - Track exactly where scenes are lost/misclassified
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes for better output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}⚠️ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  section: (msg) => console.log(`\n${colors.bright}${colors.magenta}🎯 ${msg}${colors.reset}`),
  diagnostic: (msg) => console.log(`${colors.cyan}🔍 ${msg}${colors.reset}`)
};

class FDXGroundTruthAnalyzer {
  constructor() {
    this.testFiles = [
      '/Users/ltw/Documents/GitHub/writersroom/sr_first_look_final.fdx',
      '/Users/ltw/Documents/GitHub/writersroom/test-transitions.fdx',
      '/Users/ltw/Documents/GitHub/writersroom/test-black.fdx',
      '/Users/ltw/Documents/GitHub/writersroom/test-scene-order.fdx',
      '/Users/ltw/Documents/GitHub/writersroom/test-malformed-scenes.fdx'
    ];

    this.results = {
      groundTruth: {},
      parserOutput: {},
      memoryStorage: {},
      discrepancies: [],
      pipelineTrace: []
    };
  }

  /**
   * Extract ground truth scene data from raw FDX XML
   */
  extractGroundTruth(fdxContent, filename) {
    log.section(`GROUND TRUTH EXTRACTION: ${filename}`);

    const scenes = [];
    const allParagraphs = [];

    // Extract all paragraphs with their raw XML context
    const paragraphRegex = /<Paragraph[^>]*Type="([^"]*)"[^>]*>([\s\S]*?)<\/Paragraph>/gi;
    let match;
    let sequenceIndex = 0;

    while ((match = paragraphRegex.exec(fdxContent)) !== null) {
      const type = match[1];
      const fullXML = match[0];

      // Extract text content from nested <Text> elements
      const textMatches = fullXML.matchAll(/<Text[^>]*>([\s\S]*?)<\/Text>/g);
      let text = '';
      for (const textMatch of textMatches) {
        text += textMatch[1];
      }

      // Clean text
      text = text
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .trim();

      if (text) {
        allParagraphs.push({
          type: type,
          text: text,
          sequenceIndex: sequenceIndex++,
          rawXML: fullXML
        });

        log.diagnostic(`Para ${sequenceIndex}: [${type}] "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      }
    }

    // Group into scenes
    let currentScene = null;
    let sceneIndex = 0;

    allParagraphs.forEach(para => {
      if (para.type === 'Scene Heading') {
        // Save previous scene
        if (currentScene) {
          scenes.push(currentScene);
        }

        // Start new scene
        currentScene = {
          sceneIndex: sceneIndex++,
          slugline: para.text,
          elements: [para],
          sequenceStart: para.sequenceIndex,
          sequenceEnd: para.sequenceIndex
        };
        log.info(`Ground Truth Scene ${sceneIndex}: "${para.text}"`);
      } else if (currentScene) {
        currentScene.elements.push(para);
        currentScene.sequenceEnd = para.sequenceIndex;
      }
    });

    // Add final scene
    if (currentScene) {
      scenes.push(currentScene);
    }

    const groundTruth = {
      filename: filename,
      totalParagraphs: allParagraphs.length,
      totalScenes: scenes.length,
      scenes: scenes,
      firstScene: scenes[0]?.slugline || 'NONE',
      lastScene: scenes[scenes.length - 1]?.slugline || 'NONE',
      sceneHeadings: scenes.map(s => s.slugline)
    };

    log.success(`Ground Truth: ${groundTruth.totalScenes} scenes, ${groundTruth.totalParagraphs} total paragraphs`);
    log.diagnostic(`First scene: "${groundTruth.firstScene}"`);
    log.diagnostic(`Last scene: "${groundTruth.lastScene}"`);

    return groundTruth;
  }

  /**
   * Test the parser using the actual parsing logic from route.ts
   */
  async testParser(fdxContent, filename) {
    log.section(`PARSER TESTING: ${filename}`);

    try {
      // Import the parser logic (we'll simulate it here since we can't directly import the module)
      const xml2js = require('xml2js');

      const allParagraphs = [];
      let blockIndex = 0;

      // Parse XML to JSON structure first
      const parser = new xml2js.Parser({
        explicitArray: false,
        mergeAttrs: true,
        trim: false,
        normalize: false
      });

      const xmlData = await parser.parseStringPromise(fdxContent);

      // Extract paragraphs from parsed structure
      const content = xmlData?.FinalDraft?.Content;
      if (!content) {
        throw new Error('No Content section found in FDX file');
      }

      // Handle both single paragraph and array of paragraphs
      let paragraphs = content.Paragraph;
      if (!Array.isArray(paragraphs)) {
        paragraphs = paragraphs ? [paragraphs] : [];
      }

      log.info(`Parser found ${paragraphs.length} paragraphs to process`);

      // Process each paragraph using simplified parsing logic
      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];

        const result = this.parseIndividualParagraph(paragraph);

        if (result) {
          allParagraphs.push({
            ...result,
            sequenceIndex: blockIndex++,
            originalIndex: i
          });
        }
      }

      // Group into scenes
      const scenes = this.groupIntoScenes(allParagraphs);

      const parserResult = {
        filename: filename,
        totalParagraphs: allParagraphs.length,
        totalScenes: scenes.length,
        scenes: scenes,
        elements: allParagraphs,
        firstScene: scenes[0]?.slugline || 'NONE',
        lastScene: scenes[scenes.length - 1]?.slugline || 'NONE',
        sceneHeadings: scenes.map(s => s.slugline)
      };

      log.success(`Parser Result: ${parserResult.totalScenes} scenes, ${parserResult.totalParagraphs} total elements`);
      log.diagnostic(`First scene: "${parserResult.firstScene}"`);
      log.diagnostic(`Last scene: "${parserResult.lastScene}"`);

      return parserResult;

    } catch (error) {
      log.error(`Parser failed: ${error.message}`);
      return {
        filename: filename,
        error: error.message,
        totalParagraphs: 0,
        totalScenes: 0,
        scenes: []
      };
    }
  }

  /**
   * Simplified version of parseIndividualParagraph from route.ts
   */
  parseIndividualParagraph(paragraph) {
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

      if (!text) return null;

      // Apply content-based classification
      const classifiedType = this.classifyElement(type, text);

      return {
        type: classifiedType,
        text: text,
        originalType: type
      };

    } catch (error) {
      log.warning(`Failed to parse paragraph: ${error.message}`);
      return null;
    }
  }

  /**
   * Element classification logic from route.ts
   */
  classifyElement(originalType, text) {
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
        return 'transition';
      }
    }

    // Scene heading validation
    if (originalType === 'Scene Heading') {
      // Allow visual states
      if (text.match(/^(BLACK|WHITE|DARKNESS|SILENCE)\.?$/i)) {
        return 'scene_heading';
      }

      // Reject incomplete sluglines
      if (text.match(/^(INT|EXT|INTERIOR|EXTERIOR)\.?$/i)) {
        return null; // Invalid
      }

      // Must contain location info OR be a visual state
      if (!text.match(/^(INT|EXT|INTERIOR|EXTERIOR)[\.\s]+.+/i) && !text.match(/^(BLACK|WHITE|DARKNESS|SILENCE)\.?$/i)) {
        return null; // Invalid
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

    return typeMap[originalType] || originalType.toLowerCase().replace(/\s+/g, '_');
  }

  /**
   * Group elements into scenes
   */
  groupIntoScenes(elements) {
    const scenes = [];
    let currentScene = null;
    let sceneIndex = 0;

    elements.forEach(element => {
      if (element.type === 'scene_heading') {
        // Save previous scene
        if (currentScene) {
          scenes.push(currentScene);
        }

        // Start new scene
        currentScene = {
          sceneIndex: sceneIndex++,
          slugline: element.text,
          elements: [element],
          sequenceStart: element.sequenceIndex,
          sequenceEnd: element.sequenceIndex
        };
      } else if (currentScene) {
        currentScene.elements.push(element);
        currentScene.sequenceEnd = element.sequenceIndex;
      }
    });

    if (currentScene) {
      scenes.push(currentScene);
    }

    return scenes;
  }

  /**
   * Compare ground truth vs parser results
   */
  compareResults(groundTruth, parserResult) {
    log.section(`COMPARISON: ${groundTruth.filename}`);

    const discrepancies = [];

    // Scene count comparison
    if (groundTruth.totalScenes !== parserResult.totalScenes) {
      const discrepancy = {
        type: 'SCENE_COUNT_MISMATCH',
        expected: groundTruth.totalScenes,
        actual: parserResult.totalScenes,
        difference: parserResult.totalScenes - groundTruth.totalScenes
      };
      discrepancies.push(discrepancy);
      log.error(`Scene count mismatch: Expected ${groundTruth.totalScenes}, got ${parserResult.totalScenes}`);
    } else {
      log.success(`Scene count matches: ${groundTruth.totalScenes}`);
    }

    // Scene-by-scene comparison
    const maxScenes = Math.max(groundTruth.scenes.length, parserResult.scenes.length);
    for (let i = 0; i < maxScenes; i++) {
      const gtScene = groundTruth.scenes[i];
      const prScene = parserResult.scenes[i];

      if (!gtScene && prScene) {
        discrepancies.push({
          type: 'EXTRA_SCENE',
          sceneIndex: i,
          actual: prScene.slugline,
          message: `Parser found extra scene: "${prScene.slugline}"`
        });
        log.warning(`Extra scene ${i + 1}: "${prScene.slugline}"`);
      } else if (gtScene && !prScene) {
        discrepancies.push({
          type: 'MISSING_SCENE',
          sceneIndex: i,
          expected: gtScene.slugline,
          message: `Parser missing scene: "${gtScene.slugline}"`
        });
        log.error(`Missing scene ${i + 1}: "${gtScene.slugline}"`);
      } else if (gtScene && prScene) {
        if (gtScene.slugline !== prScene.slugline) {
          discrepancies.push({
            type: 'SCENE_SLUGLINE_MISMATCH',
            sceneIndex: i,
            expected: gtScene.slugline,
            actual: prScene.slugline,
            message: `Scene ${i + 1} slugline mismatch`
          });
          log.warning(`Scene ${i + 1} mismatch: Expected "${gtScene.slugline}", got "${prScene.slugline}"`);
        } else {
          log.success(`Scene ${i + 1} matches: "${gtScene.slugline}"`);
        }
      }
    }

    // Detailed element analysis for first few scenes
    log.diagnostic(`\nDetailed analysis of first 3 scenes:`);
    for (let i = 0; i < Math.min(3, maxScenes); i++) {
      const gtScene = groundTruth.scenes[i];
      const prScene = parserResult.scenes[i];

      if (gtScene && prScene) {
        log.diagnostic(`Scene ${i + 1}: "${gtScene.slugline}"`);
        log.diagnostic(`  Ground truth: ${gtScene.elements.length} elements`);
        log.diagnostic(`  Parser result: ${prScene.elements.length} elements`);

        if (gtScene.elements.length !== prScene.elements.length) {
          discrepancies.push({
            type: 'SCENE_ELEMENT_COUNT_MISMATCH',
            sceneIndex: i,
            expected: gtScene.elements.length,
            actual: prScene.elements.length,
            message: `Scene ${i + 1} element count mismatch`
          });
        }
      }
    }

    return discrepancies;
  }

  /**
   * Generate detailed diagnostic report
   */
  generateDiagnosticReport(groundTruth, parserResult, discrepancies) {
    log.section(`DIAGNOSTIC REPORT: ${groundTruth.filename}`);

    const report = {
      timestamp: new Date().toISOString(),
      filename: groundTruth.filename,
      summary: {
        groundTruthScenes: groundTruth.totalScenes,
        parserScenes: parserResult.totalScenes,
        sceneDifference: parserResult.totalScenes - groundTruth.totalScenes,
        discrepancyCount: discrepancies.length,
        successRate: discrepancies.length === 0 ? 100 : Math.max(0, 100 - (discrepancies.length / groundTruth.totalScenes * 100))
      },
      discrepancies: discrepancies,
      sceneComparison: {
        groundTruth: groundTruth.sceneHeadings,
        parserResult: parserResult.sceneHeadings
      },
      rawAnalysis: {
        firstScenes: {
          groundTruth: groundTruth.scenes.slice(0, 3).map(s => ({
            slugline: s.slugline,
            elementCount: s.elements.length,
            sequenceRange: `${s.sequenceStart}-${s.sequenceEnd}`
          })),
          parserResult: parserResult.scenes.slice(0, 3).map(s => ({
            slugline: s.slugline,
            elementCount: s.elements.length,
            sequenceRange: `${s.sequenceStart}-${s.sequenceEnd}`
          }))
        },
        lastScenes: {
          groundTruth: groundTruth.scenes.slice(-3).map(s => ({
            slugline: s.slugline,
            elementCount: s.elements.length,
            sequenceRange: `${s.sequenceStart}-${s.sequenceEnd}`
          })),
          parserResult: parserResult.scenes.slice(-3).map(s => ({
            slugline: s.slugline,
            elementCount: s.elements.length,
            sequenceRange: `${s.sequenceStart}-${s.sequenceEnd}`
          }))
        }
      }
    };

    log.info(`Analysis complete: ${report.summary.successRate.toFixed(1)}% success rate`);
    log.info(`Discrepancies found: ${report.summary.discrepancyCount}`);

    if (discrepancies.length > 0) {
      log.warning(`Major issues detected:`);
      discrepancies.forEach((disc, i) => {
        log.warning(`  ${i + 1}. ${disc.type}: ${disc.message || disc.expected || disc.actual}`);
      });
    }

    return report;
  }

  /**
   * Run complete analysis on a single file
   */
  async analyzeFile(filePath) {
    const filename = path.basename(filePath);

    try {
      const fdxContent = fs.readFileSync(filePath, 'utf-8');

      // Step 1: Extract ground truth
      const groundTruth = this.extractGroundTruth(fdxContent, filename);

      // Step 2: Test parser
      const parserResult = await this.testParser(fdxContent, filename);

      // Step 3: Compare results
      const discrepancies = this.compareResults(groundTruth, parserResult);

      // Step 4: Generate report
      const report = this.generateDiagnosticReport(groundTruth, parserResult, discrepancies);

      return {
        filename,
        groundTruth,
        parserResult,
        discrepancies,
        report
      };

    } catch (error) {
      log.error(`Failed to analyze ${filename}: ${error.message}`);
      return {
        filename,
        error: error.message
      };
    }
  }

  /**
   * Run comprehensive analysis on all test files
   */
  async runComprehensiveAnalysis() {
    log.section('FDX PIPELINE GROUND TRUTH ANALYSIS');
    log.info(`Analyzing ${this.testFiles.length} test files...`);

    const results = [];

    for (const filePath of this.testFiles) {
      if (!fs.existsSync(filePath)) {
        log.warning(`File not found: ${filePath}`);
        continue;
      }

      const result = await this.analyzeFile(filePath);
      results.push(result);
    }

    // Generate summary report
    this.generateSummaryReport(results);

    return results;
  }

  /**
   * Generate overall summary report
   */
  generateSummaryReport(results) {
    log.section('SUMMARY REPORT');

    const validResults = results.filter(r => !r.error);
    const totalFiles = validResults.length;
    const totalIssues = validResults.reduce((sum, r) => sum + r.discrepancies.length, 0);

    log.info(`Files analyzed: ${totalFiles}`);
    log.info(`Total discrepancies: ${totalIssues}`);

    // Find most problematic files
    const problematicFiles = validResults
      .filter(r => r.discrepancies.length > 0)
      .sort((a, b) => b.discrepancies.length - a.discrepancies.length);

    if (problematicFiles.length > 0) {
      log.warning(`Files with issues:`);
      problematicFiles.forEach(file => {
        log.warning(`  ${file.filename}: ${file.discrepancies.length} issues`);
        file.discrepancies.slice(0, 3).forEach(disc => {
          log.warning(`    - ${disc.type}: ${disc.message || disc.expected || disc.actual}`);
        });
      });
    } else {
      log.success('All files passed analysis!');
    }

    // Focus on sr_first_look_final.fdx
    const mainResult = validResults.find(r => r.filename === 'sr_first_look_final.fdx');
    if (mainResult) {
      log.section('MAIN TEST FILE ANALYSIS: sr_first_look_final.fdx');
      log.info(`Ground truth scenes: ${mainResult.groundTruth.totalScenes}`);
      log.info(`Parser result scenes: ${mainResult.parserResult.totalScenes}`);
      log.info(`Success rate: ${mainResult.report.summary.successRate.toFixed(1)}%`);

      if (mainResult.discrepancies.length > 0) {
        log.error('Critical issues found in main test file:');
        mainResult.discrepancies.forEach(disc => {
          log.error(`  ${disc.type}: ${disc.message || disc.expected || disc.actual}`);
        });
      }

      // Show last 3 scenes comparison
      log.diagnostic('Last 3 scenes comparison:');
      log.diagnostic('Ground truth:');
      mainResult.report.rawAnalysis.lastScenes.groundTruth.forEach((scene, i) => {
        log.diagnostic(`  ${i + 1}. "${scene.slugline}" (${scene.elementCount} elements, seq: ${scene.sequenceRange})`);
      });
      log.diagnostic('Parser result:');
      mainResult.report.rawAnalysis.lastScenes.parserResult.forEach((scene, i) => {
        log.diagnostic(`  ${i + 1}. "${scene.slugline}" (${scene.elementCount} elements, seq: ${scene.sequenceRange})`);
      });
    }

    // Save detailed report
    const reportPath = '/Users/ltw/Documents/GitHub/writersroom/fdx_ground_truth_analysis.json';
    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        totalFiles,
        totalIssues,
        analysisResults: results
      }
    }, null, 2));

    log.success(`Detailed report saved to: ${reportPath}`);
  }
}

// Main execution
async function main() {
  const analyzer = new FDXGroundTruthAnalyzer();
  await analyzer.runComprehensiveAnalysis();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = FDXGroundTruthAnalyzer;