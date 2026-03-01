import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PRODUCTION_URL = 'https://ottawabybike.ca';
const GOLDEN_DIR = path.resolve(
  process.env.GOLDEN_TESTS_DIR || '../bike-routes-golden-tests',
  'screenshots'
);

// All published route slugs
const routes = [
  'easy-loop-around-the-canal',
  'lake-leamy',
  'britannia-by-ottawa-river-pathway',
  'vincent-massey',
  'experimental-farm-and-carlington-woods',
  'east-end-petrie-island',
  'pink-lake-in-gatineau-park',
  'shirleys-bay',
  'greenbelt',
  'aylmer',
  'carp',
  'richmond-manotick',
  'winchester-milk-run',
  'wakefield',
  'pink-aylmer',
  'the-big-loop-around-ottawa',
  'gatineau-meech-lake-champlain-lookout',
  'quyon-ferry-loop',
  'ottawa-to-plaisance',
  'carleton-place-and-smith-falls',
  'epic-buckingham-ride',
  'almonte-roubaix-mixes',
  'gravel-cup-2022-fall-grally',
  'gravel-cup-2023-spring-runoff',
  'veloroute-des-draveurs',
];

const guides = [
  'bikepacking',
  'how-to-start-biking',
  'first-bike',
  'local-communities',
  'bike-crash',
];

// Desktop pages (1280x900)
const desktopPages = [
  { name: 'homepage', path: '/' },
  { name: 'about', path: '/about' },
  { name: 'calendar', path: '/calendar' },
  { name: 'videos', path: '/videos' },
  { name: 'map', path: '/map' },
  { name: 'guides-index', path: '/guides' },
  ...guides.map(g => ({ name: `guides/${g}`, path: `/guides/${g}` })),
  ...routes.map(r => ({ name: `routes/${r}`, path: `/routes/${r}` })),
  ...routes.map(r => ({ name: `routes/${r}-map`, path: `/routes/${r}/map` })),
];

// Mobile pages (390x844 — iPhone 14)
const mobilePagesSubset = [
  { name: 'homepage', path: '/' },
  { name: 'about', path: '/about' },
  { name: 'routes/easy-loop-around-the-canal', path: '/routes/easy-loop-around-the-canal' },
  { name: 'routes/aylmer', path: '/routes/aylmer' },
];

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

test.describe('Capture production screenshots — desktop', () => {
  for (const { name, path: urlPath } of desktopPages) {
    test(`desktop: ${name}`, async ({ page }) => {
      const outPath = path.join(GOLDEN_DIR, 'desktop', `${name}.png`);
      ensureDir(outPath);
      await page.goto(`${PRODUCTION_URL}${urlPath}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: outPath, fullPage: true });
    });
  }
});

test.describe('Capture production screenshots — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

  for (const { name, path: urlPath } of mobilePagesSubset) {
    test(`mobile: ${name}`, async ({ page }) => {
      const outPath = path.join(GOLDEN_DIR, 'mobile', `${name}.png`);
      ensureDir(outPath);
      await page.goto(`${PRODUCTION_URL}${urlPath}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: outPath, fullPage: true });
    });
  }
});
