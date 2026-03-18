/**
 * Club E2E fixture setup — creates a demo club instance fixture.
 * Separate from admin/blog fixtures to avoid CITY conflicts.
 *
 * Creates a randonneuring club with events referencing routes,
 * waypoints, results, and places.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const FIXTURE_DIR = path.resolve(PROJECT_ROOT, '.data', 'club-e2e-content');
export const DB_PATH = path.resolve(PROJECT_ROOT, '.data', 'club-local.db');
export const UPLOADS_DIR = path.resolve(PROJECT_ROOT, '.data', 'club-uploads');

const CITY_DIR = path.join(FIXTURE_DIR, 'demo-club');

export default function setup() {
  const uploadsDir = UPLOADS_DIR;
  if (fs.existsSync(uploadsDir)) {
    fs.rmSync(uploadsDir, { recursive: true });
  }

  if (fs.existsSync(FIXTURE_DIR)) {
    fs.rmSync(FIXTURE_DIR, { recursive: true });
  }

  fs.mkdirSync(CITY_DIR, { recursive: true });

  // --- Club config ---
  fs.writeFileSync(
    path.join(CITY_DIR, 'config.yml'),
    `name: Demo Club
display_name: Demo Brevet Club
instance_type: club
tagline: A demo randonneuring club
description: Club E2E test fixture
url: http://localhost
domain: localhost
cdn_url: http://localhost
videos_cdn_url: http://localhost
timezone: America/Santiago
locale: es-CL
author:
  name: Test Admin
  email: test@example.com
  url: http://localhost/about
plausible_domain: localhost
site_title_html: Demo Brevet Club
center:
  lat: -33.45
  lng: -70.65
bounds:
  north: -33.0
  south: -34.0
  east: -70.0
  west: -71.5
place_categories:
  services: [cafe, restaurant]
results_privacy: full_name
acp_club_code: CL0001
`
  );

  // --- Route: vuelta-rocas-300 ---
  const routeDir = path.join(CITY_DIR, 'routes', 'vuelta-rocas-300');
  fs.mkdirSync(routeDir, { recursive: true });

  fs.writeFileSync(
    path.join(routeDir, 'index.md'),
    `---
name: Vuelta Rocas 300
status: published
distance_km: 302.5
tags:
  - brevet
  - 300km
tagline: Coastal loop through Rocas de Santo Domingo
created_at: '2024-01-15'
updated_at: '2024-06-01'
variants:
  - name: Main Route
    gpx: main.gpx
    distance_km: 302.5
---

A challenging 300km brevet along the Chilean coast, passing through Rocas de Santo Domingo and Valparaíso.
`
  );

  // GPX with enough points for elevation profile rendering
  const gpxPoints = Array.from({ length: 30 }, (_, i) => {
    const lat = (-33.45 + i * 0.05).toFixed(6);
    const lon = (-70.65 + i * 0.03).toFixed(6);
    const ele = Math.round(50 + Math.sin(i * 0.5) * 200 + i * 5);
    return `      <trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele></trkpt>`;
  }).join('\n');

  fs.writeFileSync(
    path.join(routeDir, 'main.gpx'),
    `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk>
    <name>Vuelta Rocas 300</name>
    <trkseg>
${gpxPoints}
    </trkseg>
  </trk>
</gpx>
`
  );

  fs.writeFileSync(
    path.join(routeDir, 'media.yml'),
    `---
- type: photo
  key: vuelta-rocas-cover
  caption: Coastal road near Rocas de Santo Domingo
  width: 1200
  height: 800
  cover: true
  handle: cover
  lat: -33.45
  lng: -71.60
`
  );

  // --- Second route: ruta-del-vino-200 ---
  const routeDir2 = path.join(CITY_DIR, 'routes', 'ruta-del-vino-200');
  fs.mkdirSync(routeDir2, { recursive: true });

  fs.writeFileSync(
    path.join(routeDir2, 'index.md'),
    `---
name: Ruta del Vino 200
status: published
distance_km: 205.8
tags:
  - brevet
  - 200km
tagline: Through the wine country of Casablanca Valley
created_at: '2024-02-10'
updated_at: '2024-06-15'
variants:
  - name: Main Route
    gpx: main.gpx
    distance_km: 205.8
---

A scenic 200km brevet through the vineyards of the Casablanca Valley.
`
  );

  const gpxPoints2 = Array.from({ length: 20 }, (_, i) => {
    const lat = (-33.30 + i * 0.04).toFixed(6);
    const lon = (-71.40 + i * 0.02).toFixed(6);
    const ele = Math.round(100 + Math.cos(i * 0.4) * 150 + i * 3);
    return `      <trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele></trkpt>`;
  }).join('\n');

  fs.writeFileSync(
    path.join(routeDir2, 'main.gpx'),
    `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk>
    <name>Ruta del Vino 200</name>
    <trkseg>
${gpxPoints2}
    </trkseg>
  </trk>
</gpx>
`
  );

  fs.writeFileSync(
    path.join(routeDir2, 'media.yml'),
    `---
- type: photo
  key: ruta-vino-cover
  caption: Vineyards along the route
  width: 1200
  height: 800
  cover: true
  handle: cover
  lat: -33.30
  lng: -71.40
`
  );

  // --- Places (used as waypoints) ---
  const placesDir = path.join(CITY_DIR, 'places');
  fs.mkdirSync(placesDir, { recursive: true });

  fs.writeFileSync(
    path.join(placesDir, 'control-pomaire.md'),
    `---
name: Control Pomaire
category: cafe
lat: -33.64
lng: -71.17
address: Plaza de Armas, Pomaire
description: Traditional pottery village. Good sandwiches at the corner stand.
---
`
  );

  fs.writeFileSync(
    path.join(placesDir, 'control-rapel.md'),
    `---
name: Control Rapel
category: restaurant
lat: -33.95
lng: -71.62
address: Ruta 66 km 120, Rapel
description: Rest stop near the lake.
---
`
  );

  // --- Organizer ---
  const orgDir = path.join(CITY_DIR, 'organizers');
  fs.mkdirSync(orgDir, { recursive: true });

  fs.writeFileSync(
    path.join(orgDir, 'randonneur-chile.md'),
    `---
name: Randonneurs Chile
website: https://example.com/randonneur-chile
---
`
  );

  // --- Events ---

  // Past event with results (2024) — tests results table
  const pastEventDir = path.join(CITY_DIR, 'events', '2024');
  fs.mkdirSync(pastEventDir, { recursive: true });

  fs.writeFileSync(
    path.join(pastEventDir, 'brm-300-vuelta-rocas.md'),
    `---
name: BRM 300 Vuelta Rocas
start_date: "2024-03-15"
start_time: "06:00"
end_date: "2024-03-16"
time_limit_hours: 20
location: Plaza Italia, Santiago
organizer: randonneur-chile
distances: "300 km"
tags:
  - brevet
routes:
  - vuelta-rocas-300
waypoints:
  - place: control-pomaire
    type: checkpoint
    label: CP1 Pomaire
    distance_km: 85
    opening: "08:30"
    closing: "11:40"
    note: "Fill bottles here — next water is 75 km"
  - place: control-rapel
    type: checkpoint
    label: CP2 Rapel
    distance_km: 160
    opening: "11:00"
    closing: "16:40"
registration:
  url: https://example.com/register
  slots: 80
  price: "$15.000 CLP"
  deadline: "2024-03-10"
  departure_groups:
    - "06:00 - Group A"
    - "06:30 - Group B"
results:
  - brevet_no: 101
    last_name: García
    first_name: Carlos
    time: "14h32m"
    homologation: "ACP-2024-001"
  - brevet_no: 102
    last_name: Silva
    first_name: María
    time: "16h45m"
    homologation: "ACP-2024-002"
  - brevet_no: 103
    last_name: López
    first_name: Pedro
    time: "19h10m"
    homologation: "ACP-2024-003"
  - brevet_no: 104
    last_name: Morales
    first_name: Ana
    status: DNF
  - brevet_no: 105
    last_name: Torres
    first_name: Diego
    status: DNS
gpx_include_waypoints: true
---

The annual 300km brevet along the coast. A classic Chilean randonneuring challenge.
`
  );

  // Upcoming event (2099) — tests upcoming event card
  const upcomingEventDir = path.join(CITY_DIR, 'events', '2099');
  fs.mkdirSync(upcomingEventDir, { recursive: true });

  fs.writeFileSync(
    path.join(upcomingEventDir, 'brm-200-ruta-del-vino.md'),
    `---
name: BRM 200 Ruta del Vino
start_date: "2099-04-20"
start_time: "07:00"
time_limit_hours: 13.5
location: Estación Mapocho, Santiago
organizer: randonneur-chile
distances: "200 km"
routes:
  - ruta-del-vino-200
waypoints:
  - place: control-pomaire
    type: checkpoint
    label: CP1 Pomaire
    distance_km: 65
    opening: "09:00"
    closing: "11:20"
registration:
  url: https://example.com/register-200
  slots: 100
  price: "$12.000 CLP"
  deadline: "2099-04-15"
---

A beautiful 200km brevet through wine country.
`
  );

  // --- Pages ---
  const pagesDir = path.join(CITY_DIR, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(
    path.join(pagesDir, 'about.md'),
    `---
title: About
---

About page fixture for club instance.
`
  );

  // Empty directories for collections that must exist
  fs.mkdirSync(path.join(CITY_DIR, 'guides'), { recursive: true });

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
