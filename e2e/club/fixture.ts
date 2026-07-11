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

// Blank secret-shaped env vars so a developer's local .env can't leak into the
// test server (see PLAUSIBLE_API_KEY incident) — fixtures set their own
// non-secret vars explicitly and never rely on ambient credentials.
const BLANK_SECRETS =
  'STRAVA_CLIENT_SECRET= WEBHOOK_SECRET= GITHUB_TOKEN= R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY= ' +
  'RWGPS_API_KEY= RWGPS_AUTH_TOKEN= THUNDERFOREST_API_KEY= GOOGLE_PLACES_API_KEY= GOOGLE_MAPS_STATIC_API_KEY= ' +
  'PLAUSIBLE_API_KEY=';

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
    command: `RUNTIME=local CITY=demo-club CONTENT_DIR="${FIXTURE_DIR}" R2_PUBLIC_URL="${baseURL}/dev-uploads" npx astro build && RUNTIME=local CITY=demo-club ${BLANK_SECRETS} CONTENT_DIR="${FIXTURE_DIR}" LOCAL_DB_PATH="${DB_PATH}" LOCAL_UPLOADS_DIR="${UPLOADS_DIR}" R2_PUBLIC_URL="${baseURL}/dev-uploads" npx astro preview --port ${port}`,
    port,
    cwd: '../..',
    reuseExistingServer: false,
    timeout: 180000,
  },
});
