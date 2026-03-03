import { defineConfig } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_DIR = path.resolve(PROJECT_ROOT, '.data', 'e2e-content');
const DB_PATH = path.resolve(PROJECT_ROOT, '.data', 'local.db');
const UPLOADS_DIR = path.resolve(PROJECT_ROOT, '.data', 'uploads');

// Clean slate: remove stale DB so the server creates tables with the current schema.
if (fs.existsSync(DB_PATH)) {
  fs.rmSync(DB_PATH);
  for (const suffix of ['-wal', '-shm']) {
    const p = DB_PATH + suffix;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

// Self-contained fixture — no external repo dependency.
if (fs.existsSync(FIXTURE_DIR)) {
  fs.rmSync(FIXTURE_DIR, { recursive: true });
}

const routeDir = path.join(FIXTURE_DIR, 'ottawa', 'routes', 'carp');
fs.mkdirSync(routeDir, { recursive: true });

fs.writeFileSync(
  path.join(FIXTURE_DIR, 'ottawa', 'config.yml'),
  `name: Ottawa
display_name: Ottawa by Bike
tagline: Cycling routes in Ottawa
description: E2E test fixture
url: http://localhost:4323
domain: localhost
cdn_url: http://localhost:4323
videos_cdn_url: http://localhost:4323
tiles_url: https://tile.openstreetmap.org/{z}/{x}/{y}.png
timezone: America/Toronto
locale: en-CA
locales: [en-CA, fr-CA]
author:
  name: Test Author
  email: test@example.com
  url: http://localhost:4323/about
plausible_domain: localhost
site_title_html: <em>Ottawa</em> by <em>Bike</em>
center:
  lat: 45.42
  lng: -75.69
bounds:
  north: 45.6
  south: 45.2
  east: -75.4
  west: -76.0
place_categories:
  adventure: [park]
  food: [cafe]
  utility: [bike-shop]
`
);

fs.writeFileSync(
  path.join(routeDir, 'index.md'),
  `---
name: Towards Carp
status: published
distance_km: 67.7
tags:
  - road
tagline: Keep going west
created_at: '2022-11-19'
updated_at: '2023-06-26'
variants:
  - name: 2024 Detour
    gpx: main.gpx
    distance_km: 34.3
    strava_url: https://www.strava.com/activities/11458503483
  - name: Normal Route
    gpx: variants/main.gpx
    distance_km: 40.8
    strava_url: https://www.strava.com/activities/7907456752
---

Carp is a rural community west of Ottawa. This route follows the Trans Canada Trail through Stittsville and on to Carp along quiet rural roads.
`
);

fs.writeFileSync(
  path.join(routeDir, 'main.gpx'),
  `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk>
    <name>Towards Carp</name>
    <trkseg>
      <trkpt lat="45.3485" lon="-75.8154"><ele>64</ele></trkpt>
      <trkpt lat="45.3600" lon="-75.8300"><ele>70</ele></trkpt>
      <trkpt lat="45.3700" lon="-75.8500"><ele>75</ele></trkpt>
      <trkpt lat="45.3800" lon="-75.8700"><ele>80</ele></trkpt>
      <trkpt lat="45.3900" lon="-75.9000"><ele>85</ele></trkpt>
    </trkseg>
  </trk>
</gpx>
`
);

const variantsDir = path.join(routeDir, 'variants');
fs.mkdirSync(variantsDir, { recursive: true });
fs.writeFileSync(
  path.join(variantsDir, 'main.gpx'),
  `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk>
    <name>Normal Route</name>
    <trkseg>
      <trkpt lat="45.3485" lon="-75.8154"><ele>64</ele></trkpt>
      <trkpt lat="45.3700" lon="-75.8500"><ele>75</ele></trkpt>
      <trkpt lat="45.3900" lon="-75.9000"><ele>85</ele></trkpt>
    </trkseg>
  </trk>
</gpx>
`
);

fs.writeFileSync(
  path.join(routeDir, 'media.yml'),
  `---
- type: photo
  key: e2e-test-cover-photo-key
  caption: Test cover photo
  width: 1200
  height: 800
  cover: true
  handle: cover
`
);

execSync('git init && git add -A && git commit -m "initial fixture"', {
  cwd: FIXTURE_DIR,
  stdio: 'inherit',
});

export default defineConfig({
  testDir: '.',
  testMatch: 'body.spec.ts',
  fullyParallel: false,
  workers: 1,
  outputDir: '../test-results',
  use: {
    viewport: { width: 1280, height: 900 },
    baseURL: 'http://localhost:4323',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: `RUNTIME=local CONTENT_DIR="${FIXTURE_DIR}" R2_PUBLIC_URL="http://localhost:4323/dev-uploads" npx astro build && RUNTIME=local CONTENT_DIR="${FIXTURE_DIR}" LOCAL_DB_PATH="${DB_PATH}" LOCAL_UPLOADS_DIR="${UPLOADS_DIR}" R2_PUBLIC_URL="http://localhost:4323/dev-uploads" npx astro preview --port 4323`,
    port: 4323,
    cwd: '../..',
    reuseExistingServer: false,
    timeout: 180000,
  },
});
