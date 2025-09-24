/**
 * Global setup for Playwright E2E tests
 *
 * Runs once before all tests to prepare the environment
 */

import { FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

async function globalSetup(config: FullConfig) {
  console.log('\n========== PLAYWRIGHT GLOBAL SETUP ==========');

  // Create test data directory
  const testDataDir = path.join(__dirname, 'test-data');
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
    console.log(`Created test data directory: ${testDataDir}`);
  }

  // Create mock FDX files for testing
  createMockFDXFiles(testDataDir);

  // Set environment variables
  process.env.TEST_ENV = 'e2e';
  process.env.BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
  process.env.API_URL = process.env.API_URL || 'http://localhost:3001';

  console.log('Environment variables set:');
  console.log(`  BASE_URL: ${process.env.BASE_URL}`);
  console.log(`  API_URL: ${process.env.API_URL}`);

  // Check if servers are running
  const serversReady = await checkServers();
  if (!serversReady && !process.env.CI) {
    console.warn('⚠️  Servers not running. Please start them manually or tests will fail.');
  }

  console.log('Global setup complete\n');

  return async () => {
    // This function will be called as global teardown
    console.log('Running global teardown...');
  };
}

/**
 * Create mock FDX files for testing
 */
function createMockFDXFiles(dir: string): void {
  // 53-scene test file
  const fdx53Scenes = generateMockFDX(53, 'sr_first_look_final');
  fs.writeFileSync(
    path.join(dir, 'test_53_scenes.fdx'),
    fdx53Scenes
  );

  // Small test file
  const fdxSmall = generateMockFDX(10, 'small_test');
  fs.writeFileSync(
    path.join(dir, 'test_small.fdx'),
    fdxSmall
  );

  // Large test file
  const fdxLarge = generateMockFDX(100, 'large_test', true);
  fs.writeFileSync(
    path.join(dir, 'test_large.fdx'),
    fdxLarge
  );

  console.log('Mock FDX files created');
}

/**
 * Generate mock FDX content
 */
function generateMockFDX(
  sceneCount: number,
  projectName: string,
  large: boolean = false
): string {
  const scenes = Array.from({ length: sceneCount }, (_, i) => {
    const content = large
      ? `This is a very long scene content that simulates a large FDX file. `.repeat(100)
      : `Scene ${i + 1} action content.`;

    return `
      <Paragraph Type="Scene Heading">
        <Text>${i === 0 ? 'FADE IN:' : `INT. LOCATION ${i + 1} - DAY`}</Text>
      </Paragraph>
      <Paragraph Type="Action">
        <Text>${content}</Text>
      </Paragraph>
      ${i % 3 === 0 ? `
      <Paragraph Type="Character">
        <Text>CHARACTER ${i}</Text>
      </Paragraph>
      <Paragraph Type="Dialogue">
        <Text>This is dialogue for scene ${i + 1}.</Text>
      </Paragraph>
      ` : ''}
    `;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <HeaderAndFooter>
    <Header>
      <Center>${projectName.toUpperCase()}</Center>
    </Header>
  </HeaderAndFooter>
  <Content>${scenes}</Content>
</FinalDraft>`;
}

/**
 * Check if required servers are running
 */
async function checkServers(): Promise<boolean> {
  const checkUrl = async (url: string): Promise<boolean> => {
    try {
      const response = await fetch(url);
      return response.ok;
    } catch {
      return false;
    }
  };

  const frontendReady = await checkUrl(process.env.BASE_URL || 'http://localhost:3000');
  const backendReady = await checkUrl(`${process.env.API_URL || 'http://localhost:3001'}/health`);

  console.log(`Frontend server: ${frontendReady ? '✅ Running' : '❌ Not running'}`);
  console.log(`Backend server: ${backendReady ? '✅ Running' : '❌ Not running'}`);

  return frontendReady && backendReady;
}

export default globalSetup;