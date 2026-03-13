/**
 * Blog E2E fixture setup — creates a blog instance fixture.
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

const CITY_DIR = path.join(FIXTURE_DIR, 'blog');

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

  // Ride fixture: long ride (60km) in 2025
  const rideDir2025 = path.join(CITY_DIR, 'rides', '2025', '06');
  fs.mkdirSync(rideDir2025, { recursive: true });

  // Build a ~60km GPX by spacing points far apart
  const longRidePoints = Array.from({ length: 20 }, (_, i) => {
    const lat = (45.35 + i * 0.03).toFixed(6);
    const lon = (-75.82 + i * 0.02).toFixed(6);
    return `      <trkpt lat="${lat}" lon="${lon}"><ele>70</ele><time>2025-06-15T${String(10 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00Z</time></trkpt>`;
  }).join('\n');

  fs.writeFileSync(
    path.join(rideDir2025, '15-long-summer-ride.gpx'),
    `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk>
    <name>Long Summer Ride</name>
    <trkseg>
${longRidePoints}
    </trkseg>
  </trk>
</gpx>
`
  );

  fs.writeFileSync(
    path.join(rideDir2025, '15-long-summer-ride.md'),
    `---
name: Long Summer Ride
status: published
ride_date: "2025-06-15"
country: CA
---

A long summer day out.
`
  );

  // Ride fixture: tour ride in 2025
  const tourDir = path.join(CITY_DIR, 'rides', '2025', '08', 'summer-tour');
  fs.mkdirSync(tourDir, { recursive: true });

  fs.writeFileSync(
    path.join(tourDir, '01-tour-day-one.gpx'),
    `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk>
    <name>Tour Day One</name>
    <trkseg>
      <trkpt lat="45.35" lon="-75.82"><ele>64</ele><time>2025-08-01T09:00:00Z</time></trkpt>
      <trkpt lat="45.40" lon="-75.90"><ele>70</ele><time>2025-08-01T10:00:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>
`
  );

  fs.writeFileSync(
    path.join(tourDir, '01-tour-day-one.md'),
    `---
name: Tour Day One
status: published
ride_date: "2025-08-01"
country: CA
---

First day of the summer tour.
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
