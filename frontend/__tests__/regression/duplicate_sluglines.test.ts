/**
 * Duplicate Sluglines Test
 *
 * Tests that identical sluglines get distinct indices and IDs.
 * This ensures that scenes with duplicate sluglines are properly preserved
 * and not overwritten or merged.
 */

import { MemoryService } from '../../../backend/services/memoryService';
import * as xml2js from 'xml2js';

interface SceneData {
  slugline: string;
  characters: string[];
  summary: string;
  tokens: number;
  wordCount: number;
  sceneIndex: number;
  sceneId: string;
  originalSlugline: string;
}

describe('Duplicate Sluglines Test', () => {
  const TEST_PROJECT_ID = 'duplicate-sluglines-test';
  const BACKEND_API_URL = process.env.TEST_API_URL || 'http://localhost:3001/api';

  beforeEach(() => {
    // Clear memory before each test
    MemoryService.clearAllMemory();
  });

  afterEach(() => {
    MemoryService.clearAllMemory();
  });

  describe('Test FDX with Identical Sluglines', () => {
    it('should create test FDX with 3 identical INT. APARTMENT - DAY scenes', async () => {
      const testFDX = createTestFDXWithDuplicates();

      // Parse the test FDX
      const result = await parseTestFDX(testFDX);

      expect(result.success).toBe(true);
      expect(result.scenes).toBeDefined();
      expect(result.scenes.length).toBe(5); // 3 duplicates + 2 unique

      // Verify sluglines
      const sluglines = result.scenes.map(s => s.slugline);
      expect(sluglines).toEqual([
        'INT. APARTMENT - DAY',
        'EXT. STREET - NIGHT',
        'INT. APARTMENT - DAY',
        'INT. OFFICE - MORNING',
        'INT. APARTMENT - DAY'
      ]);

      console.log(`✅ Created test FDX with duplicate sluglines`);
    });

    it('should assign distinct sceneIndex values to duplicate sluglines', async () => {
      const testFDX = createTestFDXWithDuplicates();
      const result = await parseTestFDX(testFDX);

      // Group scenes by slugline
      const apartmentScenes = result.scenes.filter(s => s.slugline === 'INT. APARTMENT - DAY');

      expect(apartmentScenes.length).toBe(3);

      // Check that each has a unique sceneIndex
      const indices = apartmentScenes.map(s => s.sceneIndex);
      expect(indices).toEqual([0, 2, 4]); // Based on their position in the array

      // Ensure indices are unique
      const uniqueIndices = new Set(indices);
      expect(uniqueIndices.size).toBe(3);

      console.log(`✅ Duplicate sluglines have distinct indices: ${indices.join(', ')}`);
    });

    it('should assign distinct sceneId values to duplicate sluglines', async () => {
      const testFDX = createTestFDXWithDuplicates();
      const result = await parseTestFDX(testFDX);

      const apartmentScenes = result.scenes.filter(s => s.slugline === 'INT. APARTMENT - DAY');

      // Check that each has a unique sceneId
      const sceneIds = apartmentScenes.map(s => s.sceneId);

      // All IDs should be unique
      const uniqueIds = new Set(sceneIds);
      expect(uniqueIds.size).toBe(3);

      // IDs should follow the pattern projectId:sceneIndex
      expect(sceneIds[0]).toMatch(/.*:0$/);
      expect(sceneIds[1]).toMatch(/.*:2$/);
      expect(sceneIds[2]).toMatch(/.*:4$/);

      console.log(`✅ Duplicate sluglines have distinct IDs: ${sceneIds.join(', ')}`);
    });
  });

  describe('Storage and Retrieval', () => {
    it('should store duplicate scenes without overwriting', async () => {
      const testFDX = createTestFDXWithDuplicates();
      const result = await parseTestFDX(testFDX);

      // Store scenes via snapshot
      const response = await fetch(`${BACKEND_API_URL}/memory/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: TEST_PROJECT_ID,
          scenes: result.scenes
        })
      });

      expect(response.ok).toBe(true);
      const storeResult = await response.json();
      expect(storeResult.storedCount).toBe(5);

      console.log(`✅ All 5 scenes stored including duplicates`);
    });

    it('should retrieve all duplicate scenes distinctly', async () => {
      const testFDX = createTestFDXWithDuplicates();
      const result = await parseTestFDX(testFDX);

      // Store scenes
      await fetch(`${BACKEND_API_URL}/memory/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: TEST_PROJECT_ID,
          scenes: result.scenes
        })
      });

      // Retrieve scenes
      const getResponse = await fetch(`${BACKEND_API_URL}/memory/snapshot?projectId=${TEST_PROJECT_ID}`);
      expect(getResponse.ok).toBe(true);

      const retrieved = await getResponse.json();
      expect(retrieved.scenes.length).toBe(5);

      // Check duplicate apartment scenes are all present
      const apartmentScenes = retrieved.scenes.filter((s: SceneData) =>
        s.slugline === 'INT. APARTMENT - DAY'
      );
      expect(apartmentScenes.length).toBe(3);

      // Verify they have different content
      expect(apartmentScenes[0].summary).toContain('morning routine');
      expect(apartmentScenes[1].summary).toContain('tense conversation');
      expect(apartmentScenes[2].summary).toContain('packing belongings');

      console.log(`✅ All duplicate scenes retrieved with unique content`);
    });

    it('should handle edge case of ALL scenes having same slugline', async () => {
      const extremeFDX = createExtremeDuplicateFDX();
      const result = await parseTestFDX(extremeFDX);

      expect(result.scenes.length).toBe(4);

      // All should have same slugline but different indices
      const sluglines = result.scenes.map(s => s.slugline);
      expect(new Set(sluglines).size).toBe(1); // Only one unique slugline

      const indices = result.scenes.map(s => s.sceneIndex);
      expect(indices).toEqual([0, 1, 2, 3]); // Contiguous indices

      const ids = result.scenes.map(s => s.sceneId);
      expect(new Set(ids).size).toBe(4); // All IDs unique

      console.log(`✅ Extreme case handled: 4 scenes with identical sluglines`);
    });
  });

  describe('Invariant Checks', () => {
    it('should never merge or lose duplicate scenes', async () => {
      const testFDX = createTestFDXWithDuplicates();
      const parsed = await parseTestFDX(testFDX);

      // Store via snapshot
      await fetch(`${BACKEND_API_URL}/memory/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: TEST_PROJECT_ID,
          scenes: parsed.scenes
        })
      });

      // Retrieve
      const response = await fetch(`${BACKEND_API_URL}/memory/snapshot?projectId=${TEST_PROJECT_ID}`);
      const stored = await response.json();

      // Invariant: No scenes lost
      expect(stored.scenes.length).toBe(parsed.scenes.length);

      // Invariant: All original content preserved
      parsed.scenes.forEach((parsedScene, index) => {
        const storedScene = stored.scenes[index];
        expect(storedScene.slugline).toBe(parsedScene.slugline);
        expect(storedScene.sceneIndex).toBe(parsedScene.sceneIndex);
        expect(storedScene.sceneId).toBe(parsedScene.sceneId);
      });

      console.log(`✅ Invariant maintained: No duplicate scenes merged or lost`);
    });
  });
});

/**
 * Creates a test FDX with duplicate sluglines
 */
function createTestFDXWithDuplicates(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>
    <Paragraph Type="Scene Heading">
      <Text>INT. APARTMENT - DAY</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>JOHN wakes up and starts his morning routine. Coffee brewing, toast popping.</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>EXT. STREET - NIGHT</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Rain pours down on empty streets.</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>INT. APARTMENT - DAY</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Later. SARAH enters. They have a tense conversation about the future.</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>INT. OFFICE - MORNING</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>The boss reviews quarterly reports.</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>INT. APARTMENT - DAY</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Evening. John is alone, packing his belongings into boxes.</Text>
    </Paragraph>
  </Content>
</FinalDraft>`;
}

/**
 * Creates an extreme test case where ALL scenes have the same slugline
 */
function createExtremeDuplicateFDX(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>
    <Paragraph Type="Scene Heading">
      <Text>INT. ROOM - CONTINUOUS</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Scene 1 action.</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>INT. ROOM - CONTINUOUS</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Scene 2 action.</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>INT. ROOM - CONTINUOUS</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Scene 3 action.</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>INT. ROOM - CONTINUOUS</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Scene 4 action.</Text>
    </Paragraph>
  </Content>
</FinalDraft>`;
}

/**
 * Parse test FDX content
 */
async function parseTestFDX(fdxContent: string): Promise<any> {
  // Simplified parsing for testing
  const parser = new xml2js.Parser({
    explicitArray: false,
    mergeAttrs: true,
    trim: false,
    normalize: false
  });

  const xmlData = await parser.parseStringPromise(fdxContent);
  const paragraphs = xmlData?.FinalDraft?.Content?.Paragraph || [];

  const scenes: SceneData[] = [];
  let currentSceneIndex = 0;
  const projectId = `test_${Date.now()}`;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = Array.isArray(paragraphs) ? paragraphs[i] : paragraphs;

    if (para.Type === 'Scene Heading') {
      const slugline = para.Text;
      const nextPara = Array.isArray(paragraphs) ? paragraphs[i + 1] : null;
      const summary = nextPara?.Type === 'Action'
        ? `${slugline}\\n${nextPara.Text}`.substring(0, 200)
        : slugline;

      scenes.push({
        slugline,
        characters: [],
        summary,
        tokens: 100,
        wordCount: 50,
        sceneIndex: currentSceneIndex,
        sceneId: `${projectId}:${currentSceneIndex}`,
        originalSlugline: slugline
      });

      currentSceneIndex++;
    }
  }

  return {
    success: true,
    scenes,
    projectId
  };
}