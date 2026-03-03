import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'admin-*.spec.ts',
  fullyParallel: false,
  workers: 1,
  outputDir: './test-results',
  use: {
    viewport: { width: 1280, height: 900 },
    baseURL: 'http://localhost:4323',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npx astro build && npx astro preview --port 4323',
    port: 4323,
    cwd: '..',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
