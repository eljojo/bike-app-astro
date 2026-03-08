/**
 * Playwright fixture setup — creates the fixture content directory.
 *
 * Called at config-import time (via prepareFixture) to guarantee the
 * fixture exists before the webServer command evaluates astro.config.mjs.
 *
 * Each writing spec file gets its own dedicated fixture routes so tests
 * can run in parallel across workers without cross-spec conflicts.
 *
 * NOTE: Does NOT delete the DB. The astro preview server holds a persistent
 * better-sqlite3 connection; deleting the file would orphan it. Instead,
 * seedSession() in helpers.ts handles per-test DB state.
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

const CITY_DIR = path.join(FIXTURE_DIR, 'demo');

interface RouteFixtureOpts {
  name: string;
  coverKey: string;
  extraKey: string;
  extraCaption?: string;
}

/** Create a route fixture directory with index.md, GPX files, and media.yml. */
function createRouteFixture(slug: string, opts: RouteFixtureOpts) {
  const routeDir = path.join(CITY_DIR, 'routes', slug);
  fs.mkdirSync(routeDir, { recursive: true });

  fs.writeFileSync(
    path.join(routeDir, 'index.md'),
    `---
name: ${opts.name}
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

Carp is a rural community west of the city. This route follows the Trans Canada Trail through Stittsville and on to Carp along quiet rural roads.
`
  );

  fs.writeFileSync(
    path.join(routeDir, 'main.gpx'),
    `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk>
    <name>${opts.name}</name>
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
  key: ${opts.coverKey}
  caption: Test cover photo
  width: 1200
  height: 800
  cover: true
  handle: cover
  lat: 45.3485
  lng: -75.8154
- type: photo
  key: ${opts.extraKey}
  caption: ${opts.extraCaption || 'Extra photo'}
  width: 1000
  height: 750
  lat: 45.3600
  lng: -75.8300
`
  );
}

export default function setup() {
  // NOTE: We intentionally do NOT delete the DB here.
  // The astro preview server opens a persistent better-sqlite3 connection at startup.
  // If we delete the DB file while the server is running, the server's connection
  // becomes a dangling reference to a deleted inode — all session validation fails,
  // causing every authenticated page to redirect to /gate.
  // Instead, seedSession() handles schema init and state cleanup per test.

  // Clean uploads from previous test runs
  const uploadsDir = path.resolve(path.dirname(DB_PATH), 'uploads');
  if (fs.existsSync(uploadsDir)) {
    fs.rmSync(uploadsDir, { recursive: true });
  }

  // Recreate the fixture content directory (also clears .ready sentinel)
  if (fs.existsSync(FIXTURE_DIR)) {
    fs.rmSync(FIXTURE_DIR, { recursive: true });
  }

  fs.mkdirSync(CITY_DIR, { recursive: true });

  fs.writeFileSync(
    path.join(CITY_DIR, 'config.yml'),
    `name: Demo
display_name: Demo by Bike
tagline: Cycling routes (demo)
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
site_title_html: <em>Demo</em> by <em>Bike</em>
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

  // --- Route fixtures ---
  // Each writing spec gets its own route to enable parallel execution.

  // carp: read-only — used by tags, body, screenshots, route-create (GPX source)
  createRouteFixture('carp', {
    name: 'Towards Carp',
    coverKey: 'e2e-test-cover-photo-key',
    extraKey: 'e2e-parkable-photo-key',
    extraCaption: 'Parkable photo',
  });

  // route-save: owned by save.spec.ts
  createRouteFixture('route-save', {
    name: 'Save Test Route',
    coverKey: 'save-cover-key',
    extraKey: 'save-extra-key',
  });

  // route-park-a: owned by parking.spec.ts test 1 (park)
  createRouteFixture('route-park-a', {
    name: 'Park Test A',
    coverKey: 'park-a-cover-key',
    extraKey: 'park-a-parkable-key',
    extraCaption: 'Parkable photo A',
  });

  // route-park-b: owned by parking.spec.ts test 2 (un-park)
  createRouteFixture('route-park-b', {
    name: 'Park Test B',
    coverKey: 'park-b-cover-key',
    extraKey: 'park-b-parkable-key',
    extraCaption: 'Parkable photo B',
  });

  // route-community: owned by community-editing.spec.ts (guest save)
  createRouteFixture('route-community', {
    name: 'Community Test Route',
    coverKey: 'community-cover-key',
    extraKey: 'community-extra-key',
  });

  // Second route for tag autocomplete tests — adds more known tags
  const canalDir = path.join(CITY_DIR, 'routes', 'canal');
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
    path.join(CITY_DIR, 'tag-translations.yml'),
    `road:
  fr: route
scenic:
  fr: panoramique
bike path:
  fr: piste cyclable
`
  );

  // --- Event fixtures ---

  const eventDir = path.join(CITY_DIR, 'events', '2099');
  fs.mkdirSync(eventDir, { recursive: true });

  // bike-fest: read-only — used by screenshots
  fs.writeFileSync(
    path.join(eventDir, 'bike-fest.md'),
    `---
name: Bike Fest
start_date: "2099-06-15"
start_time: "10:00"
location: Parliament Hill
organizer: cycling-club
---

A fun cycling festival for the whole family.
`
  );

  // event-edit: owned by events.spec.ts (edit test)
  fs.writeFileSync(
    path.join(eventDir, 'event-edit.md'),
    `---
name: Editable Event
start_date: "2099-07-20"
start_time: "09:00"
location: City Park
organizer: cycling-club
---

An event for testing edits.
`
  );

  // Organizer fixture
  const orgDir = path.join(CITY_DIR, 'organizers');
  fs.mkdirSync(orgDir, { recursive: true });
  fs.writeFileSync(
    path.join(orgDir, 'cycling-club.md'),
    `---
name: Demo Cycling Club
website: https://example.com/cycling
---
`
  );

  // About page is pre-rendered and throws if missing
  const pagesDir = path.join(CITY_DIR, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(
    path.join(pagesDir, 'about.md'),
    `---
title: About
---

About page fixture.
`
  );

  // Empty directories for collections that must exist (glob loader fails otherwise)
  fs.mkdirSync(path.join(CITY_DIR, 'guides'), { recursive: true });
  fs.mkdirSync(path.join(CITY_DIR, 'places'), { recursive: true });

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
    stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_DATE: FIXED_GIT_DATE, GIT_COMMITTER_DATE: FIXED_GIT_DATE },
  });

  // Clean ALL Astro caches to prevent stale data from the main Cloudflare build.
  // In CI, the main build runs first (different adapter, full data) and leaves
  // artifacts in .astro/ that can interfere with the admin E2E build.
  const astroCacheDir = path.resolve(path.dirname(DB_PATH), '..', '.astro');
  if (fs.existsSync(astroCacheDir)) fs.rmSync(astroCacheDir, { recursive: true });
  const nmAstroCacheDir = path.resolve(path.dirname(DB_PATH), '..', 'node_modules', '.astro');
  if (fs.existsSync(nmAstroCacheDir)) fs.rmSync(nmAstroCacheDir, { recursive: true });
}

/**
 * Called at config import time — guarded so it only runs once even though
 * Playwright imports the config file multiple times (main process + workers).
 *
 * DB deletion happens here (once, before the server starts) rather than
 * in setup(), which may re-run while the server holds an open connection.
 */
const READY_SENTINEL = path.join(FIXTURE_DIR, '.ready');

export function prepareFixture() {
  if (fs.existsSync(READY_SENTINEL)) return;

  // Clean DB before the server starts — safe because no connection exists yet.
  if (fs.existsSync(DB_PATH)) {
    fs.rmSync(DB_PATH);
    for (const suffix of ['-wal', '-shm']) {
      const p = DB_PATH + suffix;
      if (fs.existsSync(p)) fs.rmSync(p);
    }
  }

  setup();
  fs.writeFileSync(READY_SENTINEL, new Date().toISOString());
}
