/**
 * Shared Playwright config factory for admin E2E tests.
 *
 * Calls prepareFixture() at import time to guarantee the fixture content
 * directory exists before the webServer command evaluates astro.config.mjs.
 * The guard inside prepareFixture() ensures it only runs once per process
 * even though Playwright imports config files twice.
 */
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import {
  PROJECT_ROOT,
  FIXTURE_DIR,
  DB_PATH,
  UPLOADS_DIR,
  prepareFixture,
} from './fixture-setup.ts';

// Re-export for tests that need these paths
export { PROJECT_ROOT, FIXTURE_DIR, DB_PATH, UPLOADS_DIR };

// Create fixture before the webServer starts
prepareFixture();

/**
 * Return a Playwright config for an admin E2E test suite.
 * Each suite gets its own port to avoid collisions.
 */
export function adminConfig(testMatch: string, port: number) {
  const baseURL = `http://localhost:${port}`;
  return defineConfig({
    testDir: '.',
    testMatch,
    fullyParallel: false,
    workers: 1,
    outputDir: '../test-results',
    use: {
      viewport: { width: 1280, height: 900 },
      baseURL,
    },
    projects: [
      { name: 'chromium', use: { browserName: 'chromium' } },
    ],
    webServer: {
      command: `RUNTIME=local CONTENT_DIR="${FIXTURE_DIR}" R2_PUBLIC_URL="${baseURL}/dev-uploads" npx astro build && RUNTIME=local CONTENT_DIR="${FIXTURE_DIR}" LOCAL_DB_PATH="${DB_PATH}" LOCAL_UPLOADS_DIR="${UPLOADS_DIR}" R2_PUBLIC_URL="${baseURL}/dev-uploads" npx astro preview --port ${port}`,
      port,
      cwd: '../..',
      reuseExistingServer: false,
      timeout: 180000,
    },
  });
}
