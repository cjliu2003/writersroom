/**
 * Global teardown for Playwright E2E tests
 *
 * Runs once after all tests to clean up
 */

import { FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

async function globalTeardown(config: FullConfig) {
  console.log('\n========== PLAYWRIGHT GLOBAL TEARDOWN ==========');

  // Clean up test data if not in CI
  if (!process.env.CI) {
    const testDataDir = path.join(__dirname, 'test-data');
    if (fs.existsSync(testDataDir)) {
      console.log('Cleaning up test data directory...');
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  }

  // Generate performance report
  await generatePerformanceReport();

  console.log('Global teardown complete\n');
}

/**
 * Generate a performance report from test results
 */
async function generatePerformanceReport() {
  const resultsPath = path.join(__dirname, '../../test-results/results.json');

  if (!fs.existsSync(resultsPath)) {
    console.log('No test results found for performance report');
    return;
  }

  try {
    const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
    const report: string[] = [
      '# E2E Performance Test Report',
      '',
      `## Test Run: ${new Date().toISOString()}`,
      '',
      '### Summary',
      `- Total Tests: ${results.stats?.total || 0}`,
      `- Passed: ${results.stats?.passed || 0}`,
      `- Failed: ${results.stats?.failed || 0}`,
      `- Skipped: ${results.stats?.skipped || 0}`,
      `- Duration: ${results.stats?.duration || 0}ms`,
      '',
      '### Performance Tests',
    ];

    // Extract performance test results
    const perfTests = results.suites?.filter((suite: any) =>
      suite.title.toLowerCase().includes('performance')
    );

    if (perfTests && perfTests.length > 0) {
      perfTests.forEach((suite: any) => {
        report.push(`\n#### ${suite.title}`);
        suite.tests?.forEach((test: any) => {
          const status = test.status === 'passed' ? '✅' : '❌';
          report.push(`- ${status} ${test.title} (${test.duration}ms)`);
        });
      });
    }

    // Check for 53-scene regression
    const regressionTests = results.suites?.flatMap((suite: any) =>
      suite.tests?.filter((test: any) =>
        test.title.includes('53') || test.title.toLowerCase().includes('regression')
      )
    );

    if (regressionTests && regressionTests.length > 0) {
      report.push('', '### 53-Scene Regression Tests');
      regressionTests.forEach((test: any) => {
        const status = test.status === 'passed' ? '✅ PASSING' : '❌ FAILED';
        report.push(`- ${test.title}: ${status}`);
      });
    }

    // Write report
    const reportPath = path.join(__dirname, '../../performance-report.md');
    fs.writeFileSync(reportPath, report.join('\n'));
    console.log(`Performance report generated: ${reportPath}`);

    // Check for regressions
    const hasRegression = regressionTests?.some((test: any) => test.status !== 'passed');
    if (hasRegression) {
      console.error('⚠️  REGRESSION DETECTED IN 53-SCENE TESTS!');
    }

  } catch (error) {
    console.error('Failed to generate performance report:', error);
  }
}

export default globalTeardown;