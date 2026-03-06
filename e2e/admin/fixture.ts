/**
 * Single Playwright config for all admin E2E tests.
 *
 * Calls prepareFixture() at import time to guarantee the fixture content
 * directory exists before the webServer command evaluates astro.config.mjs.
 * The guard inside prepareFixture() ensures it only runs once per process
 * even though Playwright imports config files twice.
 */
import { defineConfig } from '@playwright/test';
import {
  FIXTURE_DIR,
  DB_PATH,
  UPLOADS_DIR,
  prepareFixture,
} from './fixture-setup.ts';

// Re-export for tests that need these paths
export { FIXTURE_DIR, DB_PATH, UPLOADS_DIR };

// Create fixture before the webServer starts
prepareFixture();

const port = 4323;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
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
