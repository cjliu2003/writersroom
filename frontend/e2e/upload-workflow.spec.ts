/**
 * End-to-End Tests for FDX Upload Workflow
 *
 * Tests the complete user journey from uploading an FDX file
 * to viewing and editing the screenplay in the editor.
 */

import { test, expect, Page } from '@playwright/test';
import path from 'path';

test.describe('FDX Upload Workflow', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/');
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('should upload and parse a valid FDX file', async () => {
    // Navigate to editor page
    await page.goto('/editor');

    // Wait for the upload area to be visible
    await expect(page.locator('[data-testid="upload-area"]')).toBeVisible();

    // Upload a test FDX file
    const fileInput = page.locator('input[type="file"]');
    const testFilePath = path.join(__dirname, '../__tests__/fixtures/fdx/valid/standard-screenplay.fdx');
    await fileInput.setInputFiles(testFilePath);

    // Wait for parsing to complete
    await expect(page.locator('[data-testid="loading-overlay"]')).toBeVisible();
    await expect(page.locator('[data-testid="loading-overlay"]')).toBeHidden({ timeout: 10000 });

    // Verify the editor has loaded with content
    await expect(page.locator('[data-testid="screenplay-editor"]')).toBeVisible();

    // Check that scenes are displayed in the sidebar
    const sceneSidebar = page.locator('[data-testid="scene-sidebar"]');
    await expect(sceneSidebar).toBeVisible();

    // Verify at least one scene is present
    const firstScene = sceneSidebar.locator('[data-testid="scene-item"]').first();
    await expect(firstScene).toBeVisible();
  });

  test('should display error for invalid FDX file', async () => {
    await page.goto('/editor');

    // Upload an invalid file (non-XML)
    const fileInput = page.locator('input[type="file"]');
    const invalidFile = path.join(__dirname, '../__tests__/fixtures/invalid-file.txt');
    await fileInput.setInputFiles(invalidFile);

    // Wait for and verify error message
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="error-message"]')).toContainText(/invalid|error/i);
  });

  test('should preserve scene order from FDX file', async () => {
    await page.goto('/editor');

    // Upload FDX with multiple scenes
    const fileInput = page.locator('input[type="file"]');
    const testFilePath = path.join(__dirname, '../__tests__/fixtures/fdx/valid/multiple-scenes.fdx');
    await fileInput.setInputFiles(testFilePath);

    // Wait for parsing
    await expect(page.locator('[data-testid="loading-overlay"]')).toBeHidden({ timeout: 10000 });

    // Get all scenes from sidebar
    const scenes = page.locator('[data-testid="scene-item"]');
    const sceneCount = await scenes.count();

    expect(sceneCount).toBeGreaterThan(1);

    // Verify scene order
    for (let i = 0; i < sceneCount; i++) {
      const sceneNumber = await scenes.nth(i).locator('[data-testid="scene-number"]').textContent();
      expect(sceneNumber).toBe(`${i + 1}`);
    }
  });

  test('should handle large FDX files', async () => {
    test.slow(); // Mark as slow test

    await page.goto('/editor');

    // Upload a large FDX file
    const fileInput = page.locator('input[type="file"]');
    const largeFilePath = path.join(__dirname, '../__tests__/fixtures/fdx/large/feature-film.fdx');
    await fileInput.setInputFiles(largeFilePath);

    // Wait for parsing with extended timeout
    await expect(page.locator('[data-testid="loading-overlay"]')).toBeVisible();
    await expect(page.locator('[data-testid="loading-overlay"]')).toBeHidden({ timeout: 30000 });

    // Verify the file loaded successfully
    await expect(page.locator('[data-testid="screenplay-editor"]')).toBeVisible();

    // Check memory usage indicator if available
    const memoryIndicator = page.locator('[data-testid="memory-usage"]');
    if (await memoryIndicator.isVisible()) {
      const memoryText = await memoryIndicator.textContent();
      expect(memoryText).toBeTruthy();
    }
  });

  test('should support drag and drop upload', async () => {
    await page.goto('/editor');

    const dropZone = page.locator('[data-testid="upload-area"]');
    await expect(dropZone).toBeVisible();

    // Create a DataTransfer to simulate drag and drop
    const testFilePath = path.join(__dirname, '../__tests__/fixtures/fdx/valid/standard-screenplay.fdx');

    // Simulate drag enter
    await dropZone.dispatchEvent('dragenter', {
      dataTransfer: {
        effectAllowed: 'all',
        dropEffect: 'copy',
      },
    });

    // Verify drag state UI change
    await expect(dropZone).toHaveClass(/drag-over|dragging/);

    // Simulate drop
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await page.evaluate(
      ({ dropZone, dataTransfer, filePath }) => {
        const file = new File(['test content'], 'test.fdx', { type: 'text/xml' });
        dataTransfer.items.add(file);
        const dropEvent = new DragEvent('drop', {
          dataTransfer,
          bubbles: true,
          cancelable: true,
        });
        dropZone.dispatchEvent(dropEvent);
      },
      { dropZone: await dropZone.elementHandle(), dataTransfer, filePath: testFilePath }
    );

    // Wait for file to process
    await expect(page.locator('[data-testid="loading-overlay"]')).toBeVisible();
  });

  test('should maintain editor state after page refresh', async () => {
    await page.goto('/editor');

    // Upload a file
    const fileInput = page.locator('input[type="file"]');
    const testFilePath = path.join(__dirname, '../__tests__/fixtures/fdx/valid/standard-screenplay.fdx');
    await fileInput.setInputFiles(testFilePath);

    // Wait for parsing
    await expect(page.locator('[data-testid="loading-overlay"]')).toBeHidden({ timeout: 10000 });

    // Get the first scene's slugline
    const firstSceneSlugline = await page
      .locator('[data-testid="scene-item"]')
      .first()
      .locator('[data-testid="scene-slugline"]')
      .textContent();

    // Refresh the page
    await page.reload();

    // Wait for editor to reload
    await expect(page.locator('[data-testid="screenplay-editor"]')).toBeVisible({ timeout: 10000 });

    // Verify the same content is still present
    const reloadedSlugline = await page
      .locator('[data-testid="scene-item"]')
      .first()
      .locator('[data-testid="scene-slugline"]')
      .textContent();

    expect(reloadedSlugline).toBe(firstSceneSlugline);
  });

  test('should navigate between scenes via sidebar', async () => {
    await page.goto('/editor');

    // Upload file with multiple scenes
    const fileInput = page.locator('input[type="file"]');
    const testFilePath = path.join(__dirname, '../__tests__/fixtures/fdx/valid/multiple-scenes.fdx');
    await fileInput.setInputFiles(testFilePath);

    // Wait for parsing
    await expect(page.locator('[data-testid="loading-overlay"]')).toBeHidden({ timeout: 10000 });

    // Click on the second scene in sidebar
    const secondScene = page.locator('[data-testid="scene-item"]').nth(1);
    await secondScene.click();

    // Verify the editor scrolled to the selected scene
    const editorViewport = page.locator('[data-testid="editor-viewport"]');
    const secondSceneHeading = page.locator('[data-testid="scene-heading"]').nth(1);

    // Check if the second scene heading is in viewport
    await expect(secondSceneHeading).toBeInViewport();
  });

  test('should show scene summaries in sidebar', async () => {
    await page.goto('/editor');

    // Upload file
    const fileInput = page.locator('input[type="file"]');
    const testFilePath = path.join(__dirname, '../__tests__/fixtures/fdx/valid/standard-screenplay.fdx');
    await fileInput.setInputFiles(testFilePath);

    // Wait for parsing
    await expect(page.locator('[data-testid="loading-overlay"]')).toBeHidden({ timeout: 10000 });

    // Check that scenes have summaries
    const firstSceneSummary = page
      .locator('[data-testid="scene-item"]')
      .first()
      .locator('[data-testid="scene-summary"]');

    await expect(firstSceneSummary).toBeVisible();
    const summaryText = await firstSceneSummary.textContent();
    expect(summaryText).toBeTruthy();
    expect(summaryText?.length).toBeGreaterThan(10);
  });

  test('should display scene metadata correctly', async () => {
    await page.goto('/editor');

    // Upload file
    const fileInput = page.locator('input[type="file"]');
    const testFilePath = path.join(__dirname, '../__tests__/fixtures/fdx/valid/standard-screenplay.fdx');
    await fileInput.setInputFiles(testFilePath);

    // Wait for parsing
    await expect(page.locator('[data-testid="loading-overlay"]')).toBeHidden({ timeout: 10000 });

    // Check scene metadata
    const firstScene = page.locator('[data-testid="scene-item"]').first();

    // Check for runtime display
    const runtime = firstScene.locator('[data-testid="scene-runtime"]');
    await expect(runtime).toBeVisible();
    const runtimeText = await runtime.textContent();
    expect(runtimeText).toMatch(/\d+\.\d+ min/);

    // Check for token count if displayed
    const tokenCount = firstScene.locator('[data-testid="scene-tokens"]');
    if (await tokenCount.isVisible()) {
      const tokenText = await tokenCount.textContent();
      expect(tokenText).toMatch(/\d+/);
    }
  });
});

test.describe('Upload Error Handling', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/editor');
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('should reject non-FDX files', async () => {
    const fileInput = page.locator('input[type="file"]');

    // Try uploading a PDF
    const pdfPath = path.join(__dirname, '../__tests__/fixtures/test-document.pdf');
    await fileInput.setInputFiles(pdfPath);

    // Should show error
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-message"]')).toContainText(/unsupported|fdx/i);
  });

  test('should handle empty FDX files gracefully', async () => {
    const fileInput = page.locator('input[type="file"]');

    // Upload empty FDX
    const emptyFDXPath = path.join(__dirname, '../__tests__/fixtures/fdx/edge-cases/empty.fdx');
    await fileInput.setInputFiles(emptyFDXPath);

    // Should either show warning or load empty editor
    const warning = page.locator('[data-testid="empty-file-warning"]');
    const editor = page.locator('[data-testid="screenplay-editor"]');

    await expect(warning.or(editor)).toBeVisible({ timeout: 5000 });
  });

  test('should handle malformed FDX XML', async () => {
    const fileInput = page.locator('input[type="file"]');

    // Upload malformed FDX
    const malformedPath = path.join(__dirname, '../__tests__/fixtures/fdx/edge-cases/malformed.fdx');
    await fileInput.setInputFiles(malformedPath);

    // Should show parsing error
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-message"]')).toContainText(/parse|invalid|xml/i);
  });

  test('should provide retry option on upload failure', async () => {
    // Simulate network failure by intercepting request
    await page.route('**/api/upload', route => {
      route.abort('failed');
    });

    const fileInput = page.locator('input[type="file"]');
    const testFilePath = path.join(__dirname, '../__tests__/fixtures/fdx/valid/standard-screenplay.fdx');
    await fileInput.setInputFiles(testFilePath);

    // Should show error with retry button
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
    const retryButton = page.locator('[data-testid="retry-button"]');
    await expect(retryButton).toBeVisible();

    // Remove route interception
    await page.unroute('**/api/upload');

    // Click retry
    await retryButton.click();

    // Should attempt upload again
    await expect(page.locator('[data-testid="loading-overlay"]')).toBeVisible();
  });
});