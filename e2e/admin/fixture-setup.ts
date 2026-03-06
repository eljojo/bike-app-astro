/**
 * Playwright globalSetup — runs exactly once before the web server starts.
 * Cleans the DB and creates the fixture content directory.
 *
 * Also called at config-import time (via prepareFixture) to guarantee the
 * fixture exists before the webServer command evaluates astro.config.mjs.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const FIXTURE_DIR = path.resolve(PROJECT_ROOT, '.data', 'e2e-content');
export const DB_PATH = path.resolve(PROJECT_ROOT, '.data', 'local.db');
export const UPLOADS_DIR = path.resolve(PROJECT_ROOT, '.data', 'uploads');

export default function setup() {
  // Clean slate: remove stale DB so the server creates tables with the current schema.
  if (fs.existsSync(DB_PATH)) {
    fs.rmSync(DB_PATH);
    for (const suffix of ['-wal', '-shm']) {
      const p = DB_PATH + suffix;
      if (fs.existsSync(p)) fs.rmSync(p);
    }
  }

  // Clean uploads from previous test runs
  const uploadsDir = path.resolve(path.dirname(DB_PATH), 'uploads');
  if (fs.existsSync(uploadsDir)) {
    fs.rmSync(uploadsDir, { recursive: true });
  }

  // Recreate the fixture content directory
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
url: http://localhost
domain: localhost
cdn_url: http://localhost
videos_cdn_url: http://localhost
tiles_url: https://tile.openstreetmap.org/{z}/{x}/{y}.png
timezone: America/Toronto
locale: en-CA
locales: [en-CA, fr-CA]
author:
  name: Test Author
  email: test@example.com
  url: http://localhost/about
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

  // Second route for tag autocomplete tests — adds more known tags
  const canalDir = path.join(FIXTURE_DIR, 'ottawa', 'routes', 'canal');
  fs.mkdirSync(canalDir, { recursive: true });

  fs.writeFileSync(
    path.join(canalDir, 'index.md'),
    `---
name: Canal Path
status: published
distance_km: 15.2
tags:
  - scenic
  - bike path
tagline: Along the Rideau Canal
created_at: '2023-01-10'
updated_at: '2023-06-01'
variants:
  - name: Main
    gpx: main.gpx
    distance_km: 15.2
---

A flat ride along the Rideau Canal from downtown to Hog's Back Falls.
`
  );

  fs.writeFileSync(
    path.join(canalDir, 'main.gpx'),
    `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk>
    <name>Canal Path</name>
    <trkseg>
      <trkpt lat="45.4215" lon="-75.6972"><ele>60</ele></trkpt>
      <trkpt lat="45.3950" lon="-75.6800"><ele>65</ele></trkpt>
    </trkseg>
  </trk>
</gpx>
`
  );

  fs.writeFileSync(
    path.join(canalDir, 'media.yml'),
    `---
- type: photo
  key: e2e-canal-photo-key
  caption: Canal view
  width: 800
  height: 600
  cover: true
  handle: cover
`
  );

  // Tag translations for autocomplete tests
  fs.writeFileSync(
    path.join(FIXTURE_DIR, 'ottawa', 'tag-translations.yml'),
    `road:
  fr: route
scenic:
  fr: panoramique
bike path:
  fr: piste cyclable
`
  );

  // Event fixture: ottawa/events/2026/bike-fest.md
  const eventDir = path.join(FIXTURE_DIR, 'ottawa', 'events', '2026');
  fs.mkdirSync(eventDir, { recursive: true });
  fs.writeFileSync(
    path.join(eventDir, 'bike-fest.md'),
    `---
name: Bike Fest
start_date: "2026-06-15"
start_time: "10:00"
location: Parliament Hill
organizer: cycling-club
---

A fun cycling festival for the whole family.
`
  );

  // Organizer fixture: ottawa/organizers/cycling-club.md
  const orgDir = path.join(FIXTURE_DIR, 'ottawa', 'organizers');
  fs.mkdirSync(orgDir, { recursive: true });
  fs.writeFileSync(
    path.join(orgDir, 'cycling-club.md'),
    `---
name: Ottawa Cycling Club
website: https://example.com/cycling
---
`
  );

  // About page is pre-rendered and throws if missing
  const pagesDir = path.join(FIXTURE_DIR, 'ottawa', 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(
    path.join(pagesDir, 'about.md'),
    `---
title: About
---

About page fixture.
`
  );

  // Init git repo with user config so simple-git can commit during saves.
  // Use a fixed date for deterministic commit timestamps in screenshot tests.
  const FIXED_GIT_DATE = '2025-06-15T12:00:00-04:00';
  execSync([
    'git init -b main',
    'git config user.name "test"',
    'git config user.email "test@test"',
    'git add -A',
    'git commit -m "initial fixture"',
  ].join(' && '), {
    cwd: FIXTURE_DIR,
    stdio: 'inherit',
    env: { ...process.env, GIT_AUTHOR_DATE: FIXED_GIT_DATE, GIT_COMMITTER_DATE: FIXED_GIT_DATE },
  });

  // Clean Astro content caches to prevent stale data from previous builds
  const astroCache = path.resolve(path.dirname(DB_PATH), '..', '.astro', 'data-store.json');
  if (fs.existsSync(astroCache)) fs.rmSync(astroCache);
  const nmAstroCache = path.resolve(path.dirname(DB_PATH), '..', 'node_modules', '.astro', 'data-store.json');
  if (fs.existsSync(nmAstroCache)) fs.rmSync(nmAstroCache);
}

/**
 * Guard-wrapped setup — safe to call multiple times (Playwright imports
 * config files twice: once for the test runner, once for the web server).
 */
let prepared = false;
export function prepareFixture() {
  if (prepared) return;
  prepared = true;
  setup();
}
