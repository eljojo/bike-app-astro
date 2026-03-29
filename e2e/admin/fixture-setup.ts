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

  // route-video: owned by video-save.spec.ts (video key annotation)
  createRouteFixture('route-video', {
    name: 'Video Test Route',
    coverKey: 'video-cover-key',
    extraKey: 'video-extra-key',
  });

  // route-cache: owned by cache-conflict.spec.ts (D1 cache + conflict detection)
  createRouteFixture('route-cache', {
    name: 'Cache Test Route',
    coverKey: 'cache-cover-key',
    extraKey: 'cache-extra-key',
  });

  // route-perms: owned by cache-conflict.spec.ts (permission stripping)
  createRouteFixture('route-perms', {
    name: 'Permissions Test Route',
    coverKey: 'perms-cover-key',
    extraKey: 'perms-extra-key',
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

  // event-series-recurring: owned by event-series.spec.ts (recurring series test)
  fs.writeFileSync(
    path.join(eventDir, 'event-series-recurring.md'),
    `---
name: Weekly Ride Series
start_date: "2099-03-04"
end_date: "2099-05-27"
start_time: "18:00"
location: City Hall
organizer: cycling-club
series:
  recurrence: weekly
  recurrence_day: tuesday
  season_start: "2099-03-04"
  season_end: "2099-05-27"
---

A weekly ride through the city.
`
  );

  // event-series-schedule: owned by event-series.spec.ts (specific dates test)
  fs.writeFileSync(
    path.join(eventDir, 'event-series-schedule.md'),
    `---
name: Monthly Social
start_date: "2099-04-10"
end_date: "2099-06-12"
start_time: "19:00"
location: Brew Pub
organizer: cycling-club
series:
  schedule:
    - date: "2099-04-10"
    - date: "2099-05-08"
    - date: "2099-06-12"
---

A monthly social gathering for cyclists.
`
  );

  // --- Event organizer test fixtures (owned by event-organizer.spec.ts) ---

  // event-org-existing: uses slug ref to cycling-club
  fs.writeFileSync(
    path.join(eventDir, 'event-org-existing.md'),
    `---
name: Org Existing Test
start_date: "2099-08-10"
start_time: "08:00"
location: Central Park
organizer: cycling-club
---

Event for testing isExistingRef=true saves.
`
  );

  // event-org-inline: uses inline organizer (only event referencing solo-org)
  fs.writeFileSync(
    path.join(eventDir, 'event-org-inline.md'),
    `---
name: Org Inline Test
start_date: "2099-08-15"
start_time: "09:00"
location: Riverside
organizer:
  name: Solo Organizer
  website: https://solo.example.com
---

Event for testing isExistingRef=false with 0 other refs.
`
  );

  // event-org-shared-a: uses slug ref to shared-org (one of two events using it)
  fs.writeFileSync(
    path.join(eventDir, 'event-org-shared-a.md'),
    `---
name: Org Shared A
start_date: "2099-09-01"
start_time: "07:00"
location: North Trail
organizer: shared-org
---

First event using shared-org.
`
  );

  // event-org-shared-b: uses slug ref to shared-org (second event using it)
  fs.writeFileSync(
    path.join(eventDir, 'event-org-shared-b.md'),
    `---
name: Org Shared B
start_date: "2099-09-10"
start_time: "10:00"
location: South Trail
organizer: shared-org
---

Second event using shared-org.
`
  );

  // Organizer fixtures
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

  // solo-org: separate file that should be deleted when inlined (0 other refs)
  fs.writeFileSync(
    path.join(orgDir, 'solo-organizer.md'),
    `---
name: Solo Organizer
website: https://solo.example.com
---
`
  );

  // community-admin-test: owned by community-admin.spec.ts (rich organizer for edit tests)
  fs.writeFileSync(
    path.join(orgDir, 'community-admin-test.md'),
    `---
name: Community Admin Test Org
tagline: A tagline for testing
tags:
  - gravel
  - touring
featured: true
website: https://community-admin-test.example.com
---

A bio for testing community admin editing.
`
  );

  // shared-org: used by two events, should never be inlined
  fs.writeFileSync(
    path.join(orgDir, 'shared-org.md'),
    `---
name: Shared Org
website: https://shared.example.com
---
`
  );

  // lbs-test-shop: bike shop organizer for LBS feature tests
  fs.writeFileSync(
    path.join(orgDir, 'lbs-test-shop.md'),
    `---
name: LBS Test Shop
tagline: A test bike shop
tags:
  - bike-shop
  - repairs
  - mobile
social_links:
  - platform: website
    url: https://lbs-test.example.com
  - platform: booking
    url: https://lbs-test.example.com/book
  - platform: telephone
    url: "+1-613-555-1234"
  - platform: email
    url: test@lbs-test.example.com
---

A test bike shop for E2E tests.
`
  );

  // lbs-featured-shop: featured bike shop that appears in both communities and LBS sections
  fs.writeFileSync(
    path.join(orgDir, 'lbs-featured-shop.md'),
    `---
name: LBS Featured Shop
tagline: A featured community bike shop
tags:
  - bike-shop
  - workshop
featured: true
---

A featured bike shop for testing isCommunity() override.
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

  // Place fixtures for LBS tests
  fs.writeFileSync(
    path.join(CITY_DIR, 'places', 'lbs-shop-location-a.md'),
    `---
name: LBS Shop Location A
category: bike-shop
organizer: lbs-test-shop
lat: 45.42
lng: -75.69
status: published
address: 123 Test St, Ottawa, ON
phone: (613) 555-1234
google_maps_url: https://maps.example.com/a
social_links:
  - platform: booking
    url: https://lbs-test.example.com/book-a
good_for:
  - supplies
---
`
  );

  fs.writeFileSync(
    path.join(CITY_DIR, 'places', 'lbs-shop-location-b.md'),
    `---
name: LBS Shop Location B
category: bike-shop
organizer: lbs-test-shop
lat: 45.40
lng: -75.72
status: published
address: 456 Other Ave, Ottawa, ON
phone: (613) 555-5678
google_maps_url: https://maps.example.com/b
good_for:
  - supplies
---
`
  );

  // --- Bike path fixtures ---
  fs.writeFileSync(
    path.join(CITY_DIR, 'bikepaths.yml'),
    `bike_paths:
  - name: Canal Pathway
    osm_relations: [12345]
    highway: cycleway
    surface: asphalt
    operator: NCC
    network: rcn
    name_en: Canal Pathway
    name_fr: Sentier du Canal
  - name: River Trail
    highway: cycleway
    surface: gravel
    anchors:
      - [−75.70, 45.42]
      - [−75.68, 45.40]
`
  );

  const bikePathsDir = path.join(CITY_DIR, 'bike-paths');
  fs.mkdirSync(bikePathsDir, { recursive: true });

  // bike-path-edit: owned by bike-path-admin.spec.ts
  fs.writeFileSync(
    path.join(bikePathsDir, 'canal-pathway.md'),
    `---
name: Canal Pathway
includes:
  - canal-pathway
tags:
  - scenic
vibe: A beautiful ride along the canal
---

The canal pathway runs from downtown to the locks.
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
