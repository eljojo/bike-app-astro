import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'capture-production.spec.ts',
  workers: 3,
  use: {
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  timeout: 60000,
});
