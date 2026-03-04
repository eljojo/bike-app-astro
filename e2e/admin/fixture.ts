/**
 * Shared fixture setup for admin E2E tests.
 *
 * Creates a self-contained content directory with one route (carp),
 * git-inits it, and cleans the local DB. Setup runs via Playwright's
 * globalSetup so it executes exactly once before the web server starts.
 */
import { defineConfig } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const FIXTURE_DIR = path.resolve(PROJECT_ROOT, '.data', 'e2e-content');
export const DB_PATH = path.resolve(PROJECT_ROOT, '.data', 'local.db');
export const UPLOADS_DIR = path.resolve(PROJECT_ROOT, '.data', 'uploads');

/**
 * Return a Playwright config for an admin E2E test suite.
 * Each suite gets its own port to avoid collisions.
 * Uses globalSetup to run fixture preparation exactly once,
 * before the web server starts.
 */
export function adminConfig(testMatch: string, port: number) {
  const baseURL = `http://localhost:${port}`;
  return defineConfig({
    globalSetup: path.resolve(__dirname, 'fixture-setup.ts'),
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
