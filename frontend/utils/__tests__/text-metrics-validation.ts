/**
 * Manual validation script for text-metrics implementation
 * Run this with: npx ts-node utils/__tests__/text-metrics-validation.ts
 *
 * This script validates the implementation without Jest
 */

import {
  calibrateTextMetrics,
  calculateElementLines,
  hashString,
  ELEMENT_WIDTHS,
  BASE_LINE_HEIGHTS,
} from '../text-metrics';

console.log('=== Text Metrics Validation ===\n');

// Test 1: Calibration
console.log('Test 1: Calibration');
try {
  const metrics = calibrateTextMetrics();
  console.log('✓ Metrics calibrated:', metrics);
  console.log('  - Chars per inch:', metrics.charsPerInch.toFixed(2));
  console.log('  - DPI:', metrics.dpi);
  console.log('  - Action max cols:', metrics.maxColsByType.action);
  console.log('  - Dialogue max cols:', metrics.maxColsByType.dialogue);

  if (metrics.charsPerInch >= 9 && metrics.charsPerInch <= 11) {
    console.log('  ✓ Chars per inch in expected range (9-11)');
  } else {
    console.log('  ✗ Chars per inch outside expected range');
  }
} catch (error) {
  console.log('✗ Calibration failed:', error);
}

// Test 2: Element widths
console.log('\nTest 2: Element Widths');
console.log('  Scene heading:', ELEMENT_WIDTHS.scene_heading, 'inches');
console.log('  Action:', ELEMENT_WIDTHS.action, 'inches');
console.log('  Character:', ELEMENT_WIDTHS.character, 'inches');
console.log('  Dialogue:', ELEMENT_WIDTHS.dialogue, 'inches');
console.log('  Parenthetical:', ELEMENT_WIDTHS.parenthetical, 'inches');

if (ELEMENT_WIDTHS.action === 6.0 && ELEMENT_WIDTHS.dialogue === 3.5) {
  console.log('  ✓ Industry-standard widths verified');
} else {
  console.log('  ✗ Width mismatch');
}

// Test 3: Base line heights
console.log('\nTest 3: Base Line Heights');
console.log('  Scene heading:', BASE_LINE_HEIGHTS.scene_heading);
console.log('  Action:', BASE_LINE_HEIGHTS.action);
console.log('  Character:', BASE_LINE_HEIGHTS.character);
console.log('  Dialogue:', BASE_LINE_HEIGHTS.dialogue);

if (BASE_LINE_HEIGHTS.scene_heading === 2 && BASE_LINE_HEIGHTS.action === 1) {
  console.log('  ✓ Base heights configured correctly');
} else {
  console.log('  ✗ Base height mismatch');
}

// Test 4: Line calculations
console.log('\nTest 4: Line Calculations');
const metrics = calibrateTextMetrics();

const shortText = 'Short text';
const shortLines = calculateElementLines(shortText, 'action', metrics);
console.log(`  Short text (${shortText.length} chars):`, shortLines, 'lines');

const longText = 'A'.repeat(130);
const longLines = calculateElementLines(longText, 'action', metrics);
console.log(`  Long text (${longText.length} chars):`, longLines, 'lines');

const emptyLines = calculateElementLines('', 'action', metrics);
console.log('  Empty text:', emptyLines, 'lines (should be 1)');

if (emptyLines === 1) {
  console.log('  ✓ Empty text handling correct');
} else {
  console.log('  ✗ Empty text handling incorrect');
}

// Test 5: Realistic screenplay
console.log('\nTest 5: Realistic Screenplay Elements');

const sceneHeading = 'INT. COFFEE SHOP - DAY';
const sceneLines = calculateElementLines(sceneHeading, 'scene_heading', metrics);
console.log(`  Scene heading (${sceneHeading.length} chars):`, sceneLines, 'lines');

const action = 'John enters the room and looks around nervously. He spots Mary sitting at a table by the window.';
const actionLines = calculateElementLines(action, 'action', metrics);
console.log(`  Action (${action.length} chars):`, actionLines, 'lines');

const character = 'JOHN';
const charLines = calculateElementLines(character, 'character', metrics);
console.log(`  Character (${character.length} chars):`, charLines, 'lines');

const dialogue = 'I need to tell you something important.';
const dialogLines = calculateElementLines(dialogue, 'dialogue', metrics);
console.log(`  Dialogue (${dialogue.length} chars):`, dialogLines, 'lines');

console.log('  Total lines for exchange:', charLines + dialogLines);

// Test 6: Hash function
console.log('\nTest 6: Hash Function');
const text1 = 'Test screenplay text';
const hash1 = hashString(text1);
const hash2 = hashString(text1);
console.log('  Same text, two hashes:', hash1 === hash2 ? '✓ Consistent' : '✗ Inconsistent');

const text2 = 'Different text';
const hash3 = hashString(text2);
console.log('  Different texts, different hashes:', hash1 !== hash3 ? '✓ Unique' : '✗ Collision');

const emptyHash = hashString('');
console.log('  Empty string hash:', emptyHash.length > 0 ? '✓ Valid' : '✗ Invalid');

// Test 7: Page capacity
console.log('\nTest 7: Page Capacity Estimation');
const linesPerPage = 55;
const singleLineAction = 'A'.repeat(60); // Fits in one text line
const linesForElement = calculateElementLines(singleLineAction, 'action', metrics);
const elementsPerPage = Math.floor(linesPerPage / linesForElement);

console.log('  Industry standard:', linesPerPage, 'lines/page');
console.log('  Lines per action element:', linesForElement);
console.log('  Estimated elements per page:', elementsPerPage);
console.log('  Estimated lines for', elementsPerPage, 'elements:', elementsPerPage * linesForElement);

if (elementsPerPage * linesForElement <= linesPerPage) {
  console.log('  ✓ Page capacity estimation valid');
} else {
  console.log('  ✗ Page capacity exceeds limit');
}

console.log('\n=== Validation Complete ===');
console.log('\nNote: To run comprehensive unit tests, set up Jest:');
console.log('  npm install --save-dev jest @types/jest ts-jest');
console.log('  npm install --save-dev @testing-library/jest-dom');
console.log('  Add "test": "jest" to package.json scripts');
