/**
 * Blog E2E fixture setup — creates a jose blog instance fixture.
 * Separate from admin fixtures to avoid CITY=demo conflicts.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const FIXTURE_DIR = path.resolve(PROJECT_ROOT, '.data', 'blog-e2e-content');
export const DB_PATH = path.resolve(PROJECT_ROOT, '.data', 'blog-local.db');
export const UPLOADS_DIR = path.resolve(PROJECT_ROOT, '.data', 'blog-uploads');

const CITY_DIR = path.join(FIXTURE_DIR, 'jose');

export default function setup() {
  const uploadsDir = UPLOADS_DIR;
  if (fs.existsSync(uploadsDir)) {
    fs.rmSync(uploadsDir, { recursive: true });
  }

  if (fs.existsSync(FIXTURE_DIR)) {
    fs.rmSync(FIXTURE_DIR, { recursive: true });
  }

  fs.mkdirSync(CITY_DIR, { recursive: true });

  fs.writeFileSync(
    path.join(CITY_DIR, 'config.yml'),
    `name: Jose
display_name: Jose's Rides
instance_type: blog
tagline: Bike adventures
description: Blog E2E test fixture
url: http://localhost
domain: localhost
cdn_url: http://localhost
videos_cdn_url: http://localhost
timezone: America/Toronto
locale: en-CA
author:
  name: Jose
  email: test@example.com
  url: http://localhost/about
plausible_domain: localhost
site_title_html: Jose's Rides
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

  // Ride fixture: winter-ride
  const rideDir = path.join(CITY_DIR, 'rides', '2026', '01');
  fs.mkdirSync(rideDir, { recursive: true });

  fs.writeFileSync(
    path.join(rideDir, '23-winter-ride.gpx'),
    `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk>
    <name>Winter Ride</name>
    <trkseg>
      <trkpt lat="45.3485" lon="-75.8154"><ele>64</ele><time>2026-01-23T14:30:00Z</time></trkpt>
      <trkpt lat="45.3600" lon="-75.8300"><ele>70</ele><time>2026-01-23T14:45:00Z</time></trkpt>
      <trkpt lat="45.3700" lon="-75.8500"><ele>75</ele><time>2026-01-23T15:00:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>
`
  );

  fs.writeFileSync(
    path.join(rideDir, '23-winter-ride.md'),
    `---
name: Winter Ride on the Canal
status: published
ride_date: "2026-01-23"
country: CA
highlight: true
---

A cold but beautiful ride along the frozen canal.
`
  );

  // About page (required for pre-rendered site)
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

  // Init git repo
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

  // Clean Astro caches
  const astroCacheDir = path.resolve(path.dirname(DB_PATH), '..', '.astro');
  if (fs.existsSync(astroCacheDir)) fs.rmSync(astroCacheDir, { recursive: true });
  const nmAstroCacheDir = path.resolve(path.dirname(DB_PATH), '..', 'node_modules', '.astro');
  if (fs.existsSync(nmAstroCacheDir)) fs.rmSync(nmAstroCacheDir, { recursive: true });
}

const READY_SENTINEL = path.join(FIXTURE_DIR, '.ready');

export function prepareFixture() {
  if (fs.existsSync(READY_SENTINEL)) return;

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
