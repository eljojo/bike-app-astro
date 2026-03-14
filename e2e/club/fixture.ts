/**
 * Playwright config for club E2E tests.
 * Builds with CITY=demo-club (club instance) on port 4327.
 */
import { defineConfig } from '@playwright/test';
import {
  FIXTURE_DIR,
  DB_PATH,
  UPLOADS_DIR,
  prepareFixture,
} from './fixture-setup.ts';

export { FIXTURE_DIR, DB_PATH, UPLOADS_DIR };

prepareFixture();

const port = 4327;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 2,
  retries: 2,
  outputDir: '../test-results-club',
  snapshotPathTemplate: '{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}-chromium-{platform}{ext}',
  use: {
    viewport: { width: 1280, height: 900 },
    baseURL,
    browserName: 'chromium',
  },
  webServer: {
    command: `RUNTIME=local CITY=demo-club CONTENT_DIR="${FIXTURE_DIR}" R2_PUBLIC_URL="${baseURL}/dev-uploads" npx astro build && RUNTIME=local CITY=demo-club CONTENT_DIR="${FIXTURE_DIR}" LOCAL_DB_PATH="${DB_PATH}" LOCAL_UPLOADS_DIR="${UPLOADS_DIR}" R2_PUBLIC_URL="${baseURL}/dev-uploads" npx astro preview --port ${port}`,
    port,
    cwd: '../..',
    reuseExistingServer: false,
    timeout: 180000,
  },
});
