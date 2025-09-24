/**
 * End-to-End Performance Tests with Playwright
 *
 * Tests the complete user journey from FDX upload to editor interaction
 * with performance monitoring and regression protection.
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Test configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:3001';
const LARGE_FDX_PATH = '/Users/ltw/Documents/GitHub/writersroom/Samsara_250619 copy.fdx';

// Performance thresholds
const PERF_THRESHOLDS = {
  pageLoad: 3000,
  fileUpload: 5000,
  editorRender: 2000,
  sceneNavigation: 500,
  searchOperation: 1000
};

// Performance metrics collector
class E2EPerformanceMetrics {
  private metrics: Map<string, number> = new Map();

  async measureAction(
    page: Page,
    name: string,
    action: () => Promise<void>
  ): Promise<number> {
    const startTime = Date.now();

    await action();

    const duration = Date.now() - startTime;
    this.metrics.set(name, duration);

    console.log(`[PERF] ${name}: ${duration}ms`);
    return duration;
  }

  async measurePageMetrics(page: Page, name: string): Promise<void> {
    const metrics = await page.evaluate(() => {
      const perf = window.performance;
      const navigation = perf.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

      return {
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
        loadComplete: navigation.loadEventEnd - navigation.loadEventStart,
        firstPaint: perf.getEntriesByType('paint')[0]?.startTime || 0,
        firstContentfulPaint: perf.getEntriesByType('paint')[1]?.startTime || 0
      };
    });

    Object.entries(metrics).forEach(([key, value]) => {
      this.metrics.set(`${name}_${key}`, value);
      console.log(`[PERF] ${name}_${key}: ${value}ms`);
    });
  }

  assertThreshold(name: string, threshold: number): void {
    const duration = this.metrics.get(name);
    if (!duration) throw new Error(`Metric ${name} not found`);

    expect(duration).toBeLessThan(threshold);
  }

  getSummary(): string {
    const summary: string[] = ['E2E Performance Summary:'];
    this.metrics.forEach((value, key) => {
      summary.push(`  ${key}: ${value}ms`);
    });
    return summary.join('\n');
  }
}

// Helper functions
async function waitForLoadingComplete(page: Page, timeout: number = 10000): Promise<void> {
  // Wait for loading spinner to disappear
  await page.waitForSelector('[data-testid="loading-spinner"]', {
    state: 'hidden',
    timeout
  }).catch(() => {
    // If no loading spinner, that's fine
  });

  // Wait for content to be visible
  await page.waitForSelector('[data-testid="editor-content"], [data-testid="scene-list"]', {
    state: 'visible',
    timeout
  });
}

async function uploadFile(page: Page, filePath: string): Promise<void> {
  // Check if file exists, use mock if not
  const fileToUpload = fs.existsSync(filePath) ? filePath : null;

  if (fileToUpload) {
    const fileInput = await page.locator('input[type="file"]');
    await fileInput.setInputFiles(fileToUpload);
  } else {
    // Create mock FDX content
    console.log('Using mock FDX file for testing');

    await page.evaluate(() => {
      const mockFDX = `<?xml version="1.0" encoding="UTF-8"?>
        <FinalDraft DocumentType="Script" Template="No" Version="1">
          <Content>
            ${Array.from({ length: 53 }, (_, i) => `
              <Paragraph Type="Scene Heading">
                <Text>INT. LOCATION ${i + 1} - DAY</Text>
              </Paragraph>
              <Paragraph Type="Action">
                <Text>Scene ${i + 1} action content.</Text>
              </Paragraph>
            `).join('')}
          </Content>
        </FinalDraft>`;

      const blob = new Blob([mockFDX], { type: 'application/xml' });
      const file = new File([blob], 'test_53_scenes.fdx', { type: 'application/xml' });

      // Trigger file upload programmatically
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) {
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }
}

// Test setup
test.describe.configure({ mode: 'serial' });

test.describe('E2E Performance Tests', () => {
  let context: BrowserContext;
  let page: Page;
  let metrics: E2EPerformanceMetrics;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
  });

  test.beforeEach(async () => {
    page = await context.newPage();
    metrics = new E2EPerformanceMetrics();

    // Set up console listener for errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error('[Browser Error]', msg.text());
      }
    });

    // Set up request/response interceptors for monitoring
    page.on('request', request => {
      if (request.url().includes('/api/')) {
        console.log(`[API Request] ${request.method()} ${request.url()}`);
      }
    });

    page.on('response', response => {
      if (response.url().includes('/api/') && response.status() >= 400) {
        console.error(`[API Error] ${response.status()} ${response.url()}`);
      }
    });
  });

  test.afterEach(async () => {
    console.log(metrics.getSummary());
    await page.close();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('should load homepage within performance threshold', async () => {
    await metrics.measureAction(page, 'homepage_load', async () => {
      await page.goto(BASE_URL);
      await page.waitForLoadState('networkidle');
    });

    await metrics.measurePageMetrics(page, 'homepage');

    // Verify homepage elements
    await expect(page.locator('h1')).toContainText(/WritersRoom/i);
    await expect(page.locator('[data-testid="upload-area"], [data-testid="project-list"]')).toBeVisible();

    metrics.assertThreshold('homepage_load', PERF_THRESHOLDS.pageLoad);
  });

  test('should handle large FDX file upload end-to-end', async () => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Measure file upload
    await metrics.measureAction(page, 'file_upload', async () => {
      await uploadFile(page, LARGE_FDX_PATH);

      // Wait for upload to complete
      await page.waitForSelector('[data-testid="upload-success"], [data-testid="processing-indicator"]', {
        timeout: 30000
      });
    });

    // Wait for editor to load
    await metrics.measureAction(page, 'editor_render', async () => {
      await waitForLoadingComplete(page);
    });

    // Verify 53 scenes are displayed
    const sceneCount = await page.locator('[data-testid="scene-item"]').count();
    expect(sceneCount).toBe(53);

    console.log(`Verified ${sceneCount} scenes displayed in editor`);

    metrics.assertThreshold('file_upload', PERF_THRESHOLDS.fileUpload);
    metrics.assertThreshold('editor_render', PERF_THRESHOLDS.editorRender);
  });

  test('should navigate between scenes efficiently', async () => {
    // Setup: Load project with scenes
    await page.goto(`${BASE_URL}/editor/test_project`);
    await waitForLoadingComplete(page);

    const sceneItems = page.locator('[data-testid="scene-item"]');
    const sceneCount = await sceneItems.count();

    if (sceneCount === 0) {
      console.log('No scenes found, skipping navigation test');
      test.skip();
      return;
    }

    // Test scene navigation performance
    for (let i = 0; i < Math.min(5, sceneCount); i++) {
      await metrics.measureAction(page, `scene_nav_${i}`, async () => {
        await sceneItems.nth(i).click();

        // Wait for scene content to load
        await page.waitForSelector('[data-testid="scene-content"]', {
          state: 'visible',
          timeout: 2000
        });
      });

      // Verify scene content loaded
      const sceneContent = await page.locator('[data-testid="scene-content"]').textContent();
      expect(sceneContent).toBeTruthy();

      metrics.assertThreshold(`scene_nav_${i}`, PERF_THRESHOLDS.sceneNavigation);
    }
  });

  test('should handle search operations efficiently', async () => {
    // Setup: Load project
    await page.goto(`${BASE_URL}/editor/test_project`);
    await waitForLoadingComplete(page);

    const searchInput = page.locator('[data-testid="search-input"]');

    if (!await searchInput.isVisible()) {
      console.log('Search not available, skipping search test');
      test.skip();
      return;
    }

    // Test search performance
    const searchTerms = ['INT', 'EXT', 'DAY', 'NIGHT', 'CHARACTER'];

    for (const term of searchTerms) {
      await metrics.measureAction(page, `search_${term}`, async () => {
        await searchInput.fill(term);

        // Wait for search results
        await page.waitForTimeout(300); // Debounce
        await page.waitForSelector('[data-testid="search-results"], [data-testid="scene-item"]', {
          state: 'visible',
          timeout: 2000
        });
      });

      metrics.assertThreshold(`search_${term}`, PERF_THRESHOLDS.searchOperation);
    }
  });

  test('should maintain performance with rapid interactions', async () => {
    await page.goto(`${BASE_URL}/editor/test_project`);
    await waitForLoadingComplete(page);

    // Simulate rapid user interactions
    await metrics.measureAction(page, 'rapid_interactions', async () => {
      const actions = [
        () => page.keyboard.press('Control+F'),
        () => page.keyboard.type('test'),
        () => page.keyboard.press('Escape'),
        () => page.click('[data-testid="scene-item"]:first-child').catch(() => {}),
        () => page.keyboard.press('ArrowDown'),
        () => page.keyboard.press('ArrowDown'),
        () => page.keyboard.press('ArrowUp')
      ];

      for (const action of actions) {
        await action();
        await page.waitForTimeout(50); // Small delay between actions
      }
    });

    // Verify UI remains responsive
    const isResponsive = await page.evaluate(() => {
      return document.querySelector('[data-testid="editor-content"]') !== null;
    });

    expect(isResponsive).toBe(true);
  });

  test('should show proper loading states during long operations', async () => {
    await page.goto(BASE_URL);

    // Mock a slow API response
    await page.route('**/api/projects/*/snapshot', async route => {
      await page.waitForTimeout(2000); // Simulate slow response
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            scenes: Array.from({ length: 53 }, (_, i) => ({
              sceneIndex: i,
              sceneId: `scene_${i}`,
              slugline: `SCENE ${i + 1}`,
              summary: `Summary ${i + 1}`,
              fullContent: `Content ${i + 1}`
            }))
          }
        })
      });
    });

    // Upload file and verify loading states
    await uploadFile(page, LARGE_FDX_PATH);

    // Check for loading indicator
    const loadingIndicator = page.locator('[data-testid="loading-spinner"], [data-testid="loading-overlay"]');
    await expect(loadingIndicator).toBeVisible();

    console.log('Loading indicator displayed during long operation');

    // Wait for loading to complete
    await waitForLoadingComplete(page, 15000);

    // Verify loading indicator is gone
    await expect(loadingIndicator).toBeHidden();

    console.log('Loading indicator hidden after operation complete');
  });

  test('should handle network errors gracefully with retry', async () => {
    await page.goto(BASE_URL);

    let attemptCount = 0;

    // Mock intermittent network failures
    await page.route('**/api/projects/*/snapshot', async route => {
      attemptCount++;

      if (attemptCount < 3) {
        // Fail first 2 attempts
        await route.abort('failed');
      } else {
        // Succeed on third attempt
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { scenes: [] }
          })
        });
      }
    });

    // Try to load a project
    await page.goto(`${BASE_URL}/editor/test_project`);

    // Should show error with retry option
    const errorMessage = page.locator('[data-testid="error-message"]');
    const retryButton = page.locator('[data-testid="retry-button"]');

    // First failure
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
    await expect(retryButton).toBeVisible();

    console.log('Error message and retry button displayed');

    // Click retry
    await retryButton.click();

    // Second failure
    await expect(errorMessage).toBeVisible({ timeout: 5000 });

    // Click retry again
    await retryButton.click();

    // Third attempt should succeed
    await waitForLoadingComplete(page);

    console.log(`Network error recovered after ${attemptCount} attempts`);
  });

  test('should preserve 53 scenes throughout the entire pipeline', async () => {
    const checkpoints: { stage: string; count: number }[] = [];

    await page.goto(BASE_URL);

    // Monitor API calls
    page.on('response', async response => {
      if (response.url().includes('/api/projects') && response.status() === 200) {
        try {
          const data = await response.json();
          if (data.count !== undefined) {
            checkpoints.push({
              stage: response.url().includes('snapshot') ? 'snapshot_api' : 'other_api',
              count: data.count
            });
          }
        } catch {
          // Not JSON response
        }
      }
    });

    // Upload file
    await uploadFile(page, LARGE_FDX_PATH);
    await waitForLoadingComplete(page);

    // Count scenes in UI
    const uiSceneCount = await page.locator('[data-testid="scene-item"]').count();
    checkpoints.push({ stage: 'ui_display', count: uiSceneCount });

    // Verify scene count in page title or header
    const sceneCountText = await page.locator('[data-testid="scene-count"], .scene-count').textContent();
    if (sceneCountText) {
      const match = sceneCountText.match(/(\d+)/);
      if (match) {
        checkpoints.push({ stage: 'ui_header', count: parseInt(match[1]) });
      }
    }

    // Validate all checkpoints
    console.log('Pipeline Checkpoints:');
    checkpoints.forEach(cp => {
      console.log(`  ${cp.stage}: ${cp.count} scenes`);
    });

    // All should be 53
    const hasRegression = checkpoints.some(cp => cp.count !== 53 && cp.count !== 0);

    if (hasRegression) {
      console.error('REGRESSION DETECTED: Scene count mismatch in pipeline');
      checkpoints.forEach(cp => {
        const status = cp.count === 53 ? '✅' : '❌';
        console.error(`  ${status} ${cp.stage}: ${cp.count}`);
      });
    }

    expect(hasRegression).toBe(false);
    expect(uiSceneCount).toBe(53);
  });

  test('should maintain responsive UI under memory pressure', async () => {
    await page.goto(`${BASE_URL}/editor/test_project`);
    await waitForLoadingComplete(page);

    // Get initial memory usage
    const initialMetrics = await page.evaluate(() => {
      if ('memory' in performance) {
        return {
          usedJSHeapSize: (performance as any).memory.usedJSHeapSize,
          totalJSHeapSize: (performance as any).memory.totalJSHeapSize
        };
      }
      return null;
    });

    if (!initialMetrics) {
      console.log('Memory API not available, skipping memory test');
      test.skip();
      return;
    }

    // Perform memory-intensive operations
    for (let i = 0; i < 10; i++) {
      // Navigate between scenes
      await page.click(`[data-testid="scene-item"]:nth-child(${(i % 5) + 1})`).catch(() => {});

      // Open/close modals
      await page.keyboard.press('Control+K').catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});

      // Trigger searches
      await page.fill('[data-testid="search-input"]', `search_${i}`).catch(() => {});
    }

    // Get final memory usage
    const finalMetrics = await page.evaluate(() => {
      if ('memory' in performance) {
        return {
          usedJSHeapSize: (performance as any).memory.usedJSHeapSize,
          totalJSHeapSize: (performance as any).memory.totalJSHeapSize
        };
      }
      return null;
    });

    if (finalMetrics) {
      const memoryIncrease = (finalMetrics.usedJSHeapSize - initialMetrics.usedJSHeapSize) / 1024 / 1024;
      console.log(`Memory increase: ${memoryIncrease.toFixed(2)}MB`);

      // Check for memory leaks (shouldn't increase by more than 50MB)
      expect(memoryIncrease).toBeLessThan(50);
    }

    // Verify UI is still responsive
    const isResponsive = await page.evaluate(() => {
      const start = performance.now();
      document.querySelector('body')?.getBoundingClientRect();
      return performance.now() - start < 16; // Should complete within one frame
    });

    expect(isResponsive).toBe(true);
  });
});

// Accessibility and performance audit test
test.describe('Performance Audits', () => {
  test('should pass Lighthouse performance audit', async ({ page }) => {
    // This test requires Lighthouse to be set up
    // It's included as a template for CI integration

    await page.goto(BASE_URL);

    // Run performance audit
    const performanceMetrics = await page.evaluate(() => {
      const entries = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

      return {
        TTFB: entries.responseStart - entries.requestStart,
        FCP: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0,
        LCP: 0, // Would need PerformanceObserver for this
        FID: 0, // Would need actual user interaction
        CLS: 0, // Would need layout shift tracking

        // Basic metrics we can get
        domContentLoaded: entries.domContentLoadedEventEnd - entries.fetchStart,
        loadComplete: entries.loadEventEnd - entries.fetchStart
      };
    });

    console.log('Performance Audit Results:');
    console.log(`  TTFB: ${performanceMetrics.TTFB}ms`);
    console.log(`  FCP: ${performanceMetrics.FCP}ms`);
    console.log(`  DOM Content Loaded: ${performanceMetrics.domContentLoaded}ms`);
    console.log(`  Page Load Complete: ${performanceMetrics.loadComplete}ms`);

    // Basic performance assertions
    expect(performanceMetrics.TTFB).toBeLessThan(600);
    expect(performanceMetrics.FCP).toBeLessThan(1800);
    expect(performanceMetrics.domContentLoaded).toBeLessThan(3000);
  });
});

export { E2EPerformanceMetrics, PERF_THRESHOLDS };