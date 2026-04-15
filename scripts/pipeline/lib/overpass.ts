/**
 * Overpass API client — single client for the entire application.
 *
 * Content-addressed per-query cache: each query is hashed (SHA-256),
 * responses are stored in .cache/overpass/{hash}.json. Same query =
 * cache hit, no network request. Processing happens at read time.
 *
 * Built-in concurrency limiting (semaphore), in-flight dedup,
 * and server rotation with retry.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Cache ────────────────────────────────────────────────────────

const CACHE_DIR = join(process.cwd(), '.cache', 'overpass');

function cacheKey(query: string): string {
  return createHash('sha256').update(query).digest('base64url').slice(0, 40);
}

// ── Concurrency ──────────────────────────────────────────────────

const MAX_CONCURRENT = 4;
let permits = MAX_CONCURRENT;
const semQueue: Array<() => void> = [];

async function semAcquire(): Promise<void> {
  if (permits > 0) { permits--; return; }
  return new Promise((resolve) => semQueue.push(resolve));
}

function semRelease(): void {
  permits++;
  if (semQueue.length > 0 && permits > 0) {
    permits--;
    semQueue.shift()!();
  }
}

// ── In-flight dedup ──────────────────────────────────────────────

const inFlight = new Map<string, Promise<any>>();

// ── Server rotation ──────────────────────────────────────────────

const OVERPASS_SERVERS = [
  'https://overpass.whereto.bike/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

// ── Public API ───────────────────────────────────────────────────

export interface OverpassResponse {
  elements: any[];
  [key: string]: any;
}

/**
 * POST a query to Overpass, with:
 * - Content-addressed disk cache (.cache/overpass/)
 * - In-flight dedup (parallel identical queries share one fetch)
 * - Concurrency semaphore (max 4 parallel network requests)
 * - Server rotation with retry
 */
export async function queryOverpass(query: string): Promise<OverpassResponse> {
  mkdirSync(CACHE_DIR, { recursive: true });

  const key = cacheKey(query);
  const cachePath = join(CACHE_DIR, `overpass-${key}.json`);

  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  }

  // Dedup: if this exact query is already in flight, share the result
  if (inFlight.has(key)) {
    return inFlight.get(key)!;
  }

  console.log(`[overpass] fetching from API (key: ${key})`);

  const promise = (async () => {
    await semAcquire();
    try {
      return await fetchWithRetry(query, key, cachePath);
    } finally {
      semRelease();
    }
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

// ── Fetch with server rotation ───────────────────────────────────

async function fetchWithRetry(
  query: string,
  key: string,
  cachePath: string,
): Promise<OverpassResponse> {
  for (let attempt = 0; attempt < OVERPASS_SERVERS.length * 2; attempt++) {
    const serverIdx = Math.floor(attempt / 2) % OVERPASS_SERVERS.length;
    const serverUrl = process.env.OVERPASS_URL || OVERPASS_SERVERS[serverIdx];

    let res: Response;
    try {
      res = await fetch(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err: any) {
      console.log(`[overpass] ${new URL(serverUrl).hostname} network error: ${err.message}, rotating...`);
      continue;
    }

    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('json')) {
        const body = await res.text();
        if (body.includes('duplicate_query')) {
          // Another process is running the same query — wait and retry
          console.log(`[overpass] duplicate_query from ${new URL(serverUrl).hostname}, waiting...`);
          await new Promise((r) => setTimeout(r, 5_000));
          continue;
        }
        console.log(`[overpass] ${new URL(serverUrl).hostname} returned non-JSON, rotating...`);
        continue;
      }
      const data = await res.json();
      if (data.remark?.includes('runtime error')) {
        console.log(`[overpass] runtime error: ${data.remark.slice(0, 80)}, rotating...`);
        continue;
      }
      writeFileSync(cachePath, JSON.stringify(data), 'utf8');
      console.log(`[overpass] cached ${data.elements?.length ?? 0} elements (key: ${key})`);
      return data;
    }

    if ([429, 502, 503, 504].includes(res.status)) {
      const wait = (attempt + 1) * 10;
      console.log(`[overpass] ${new URL(serverUrl).hostname} returned ${res.status}, retrying in ${wait}s...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }

    throw new Error(`Overpass API error ${res.status}: ${await res.text()}`);
  }

  throw new Error('Overpass API: all servers failed after retries');
}

// ── Specialized query functions ──────────────────────────────────

/**
 * Fetch points of interest within a bounding box.
 * @param bounds [south, west, north, east]
 */
export async function fetchPOIs(bounds: [number, number, number, number]) {
  const [s, w, n, e] = bounds;
  const bbox = `${s},${w},${n},${e}`;

  const query = `
[out:json][timeout:180];
(
  way["leisure"="park"](${bbox});
  node["leisure"="park"](${bbox});
  way["leisure"="garden"]["name"](${bbox});
  node["natural"="beach"](${bbox});
  way["natural"="beach"](${bbox});
  node["tourism"="viewpoint"](${bbox});
  node["place"="square"](${bbox});
  way["place"="square"](${bbox});
  node["amenity"="cafe"]["name"](${bbox});
  node["amenity"="ice_cream"]["name"](${bbox});
  node["amenity"="pub"]["name"](${bbox});
  node["amenity"="marketplace"](${bbox});
  way["amenity"="marketplace"](${bbox});
  node["amenity"="bicycle_rental"](${bbox});
  node["shop"="bicycle"](${bbox});
  node["railway"="station"](${bbox});
  node["amenity"="ferry_terminal"](${bbox});
  node["tourism"="camp_site"]["name"](${bbox});
  way["tourism"="camp_site"]["name"](${bbox});
  node["tourism"="museum"]["name"](${bbox});
  way["tourism"="museum"]["name"](${bbox});
  way["natural"="water"]["name"](${bbox});
  way["bridge"="yes"]["name"]["highway"~"cycleway|path|footway|pedestrian"](${bbox});
  way["man_made"="bridge"]["name"](${bbox});
);
out center tags;
`.trim();

  const data = await queryOverpass(query);
  const results = [];
  for (const el of data.elements ?? []) {
    let lat: number | undefined, lng: number | undefined;
    if (el.center) { lat = el.center.lat; lng = el.center.lon; }
    else if (el.lat != null) { lat = el.lat; lng = el.lon; }
    if (lat == null || lng == null) continue;
    const tags = el.tags ?? {};
    if (!tags.name) continue;
    let type: string | null = null;
    if (tags.bridge || tags.man_made === 'bridge') type = 'bridge';
    else if (tags.leisure) type = tags.leisure;
    else if (tags.tourism) type = tags.tourism;
    else if (tags.amenity) type = tags.amenity;
    else if (tags.place) type = tags.place;
    else if (tags.railway) type = tags.railway;
    else if (tags.natural) type = tags.natural;
    if (!type) continue;
    results.push({ name: tags.name, lat, lng, type, osmType: el.type, osmId: el.id, tags });
  }
  return results;
}

/** Fetch cycling infrastructure ways within a bounding box. */
export async function fetchCyclingWays(bounds: [number, number, number, number]) {
  const [s, w, n, e] = bounds;
  const bbox = `${s},${w},${n},${e}`;
  const query = `
[out:json][timeout:60];
(
  way["highway"="cycleway"](${bbox});
  way["cycleway"~"track|lane|shared_lane"](${bbox});
  way["cycleway:left"~"track|lane"](${bbox});
  way["cycleway:right"~"track|lane"](${bbox});
  way["bicycle"="designated"]["highway"~"path|footway"](${bbox});
);
out geom tags;
`.trim();
  const data = await queryOverpass(query);
  return (data.elements ?? []).filter(
    (el: any) => Array.isArray(el.geometry) && el.geometry.length >= 2,
  );
}

/** Fetch metro/light-rail stations within a bounding box. */
export async function fetchMetroStations(bounds: [number, number, number, number]) {
  const [s, w, n, e] = bounds;
  const bbox = `${s},${w},${n},${e}`;
  const query = `
[out:json][timeout:30];
(
  node["railway"="station"]["station"="subway"](${bbox});
  node["railway"="station"]["station"="light_rail"](${bbox});
);
out tags;
`.trim();
  const data = await queryOverpass(query);
  return (data.elements ?? [])
    .filter((el: any) => el.tags?.name)
    .map((el: any) => ({
      name: el.tags.name, lat: el.lat, lng: el.lon,
      type: 'metro', osmType: el.type, osmId: el.id, tags: el.tags,
    }));
}

/** Fetch named rivers and canals within a bounding box. */
export async function fetchWaterways(bounds: [number, number, number, number]) {
  const [s, w, n, e] = bounds;
  const bbox = `${s},${w},${n},${e}`;
  const query = `
[out:json][timeout:30];
(
  way["waterway"="river"]["name"](${bbox});
  way["waterway"="canal"]["name"](${bbox});
);
out geom tags;
`.trim();
  const data = await queryOverpass(query);
  return (data.elements ?? [])
    .filter((el: any) => Array.isArray(el.geometry) && el.geometry.length >= 2)
    .map((el: any) => ({
      name: el.tags.name,
      geometry: el.geometry.map(({ lat, lon }: any) => [lon, lat]),
    }));
}

/** Fetch all rideable roads within a bounding box for gap routing. */
export async function fetchRoadNetwork(bounds: [number, number, number, number]) {
  const [s, w, n, e] = bounds;
  const bbox = `${s},${w},${n},${e}`;
  const query = `
[out:json][timeout:90];
(
  way["highway"~"cycleway|path|footway|residential|tertiary|secondary|living_street|pedestrian|service"](${bbox});
);
out geom;
`.trim();
  const data = await queryOverpass(query);
  return (data.elements ?? [])
    .filter((el: any) => Array.isArray(el.geometry) && el.geometry.length >= 2);
}

/** Fetch motorway/trunk/motorway_link ways within a bounding box. */
export async function fetchMotorways(bounds: [number, number, number, number]) {
  const [s, w, n, e] = bounds;
  const bbox = `${s},${w},${n},${e}`;
  const query = `
[out:json][timeout:30];
(
  way["highway"="motorway"](${bbox});
  way["highway"="trunk"](${bbox});
  way["highway"="motorway_link"](${bbox});
);
out geom;
`.trim();
  const data = await queryOverpass(query);
  return (data.elements ?? [])
    .filter((el: any) => Array.isArray(el.geometry) && el.geometry.length >= 2)
    .map((el: any) => el.geometry.map(({ lat, lon }: any) => [lon, lat]));
}

/** Fetch zone POIs for clustering. */
export async function fetchZonePOIs(bounds: [number, number, number, number]) {
  const [s, w, n, e] = bounds;
  const bbox = `${s},${w},${n},${e}`;
  const query = `
[out:json][timeout:120];
(
  node["amenity"~"cafe|restaurant|bar|pub|fast_food|ice_cream|food_court|marketplace|theatre|cinema|arts_centre|biergarten"](${bbox});
  node["shop"~"bakery|deli|wine|chocolate|books"](${bbox});
  node["tourism"~"museum|gallery|viewpoint|attraction|artwork"](${bbox});
  node["leisure"~"beer_garden|playground|swimming_pool"](${bbox});
  node["historic"~"monument|memorial|castle"](${bbox});
);
out;
`.trim();
  const data = await queryOverpass(query);
  return (data.elements ?? [])
    .filter((el: any) => el.lat != null && el.lon != null)
    .map((el: any) => ({ lat: el.lat, lng: el.lon, tags: el.tags ?? {} }));
}

/** Fetch tree rows for shade/canopy scoring. */
export async function fetchTreeRows(bounds: [number, number, number, number]) {
  const [s, w, n, e] = bounds;
  const bbox = `${s},${w},${n},${e}`;
  const query = `
[out:json][timeout:30];
way["natural"="tree_row"](${bbox});
out geom;
`.trim();
  const data = await queryOverpass(query);
  return (data.elements ?? [])
    .filter((el: any) => Array.isArray(el.geometry) && el.geometry.length >= 2)
    .map((el: any) => el.geometry.map(({ lat, lon }: any) => [lon, lat]));
}

/** Fetch bike parking racks and rental stations. */
export async function fetchBikeParking(bounds: [number, number, number, number]) {
  const [s, w, n, e] = bounds;
  const bbox = `${s},${w},${n},${e}`;
  const query = `
[out:json][timeout:30];
(
  node["amenity"="bicycle_parking"](${bbox});
  node["amenity"="bicycle_rental"](${bbox});
);
out;
`.trim();
  const data = await queryOverpass(query);
  return (data.elements ?? [])
    .filter((el: any) => el.lat != null)
    .map((el: any) => ({ lat: el.lat, lng: el.lon, type: el.tags?.amenity }));
}

/** Fetch park/plaza/garden areas with polygon geometry. */
export async function fetchParkAreas(bounds: [number, number, number, number]) {
  const [s, w, n, e] = bounds;
  const bbox = `${s},${w},${n},${e}`;
  const query = `
[out:json][timeout:90];
(
  way["leisure"~"park|garden"]["name"](${bbox});
  way["place"="square"]["name"](${bbox});
  way["landuse"="recreation_ground"]["name"](${bbox});
  rel["leisure"~"park|garden"]["name"](${bbox});
);
out geom tags;
`.trim();

  const data = await queryOverpass(query);
  const results = [];
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    if (!tags.name) continue;
    let coords: [number, number][] = [];
    if (el.type === 'way' && Array.isArray(el.geometry)) {
      coords = el.geometry.map((p: any) => [p.lon, p.lat]);
    } else if (el.type === 'relation' && Array.isArray(el.members)) {
      for (const member of el.members) {
        if (member.role === 'outer' && Array.isArray(member.geometry)) {
          coords.push(...member.geometry.map((p: any) => [p.lon, p.lat]));
        }
      }
      if (coords.length === 0) {
        for (const member of el.members) {
          if (Array.isArray(member.geometry)) {
            coords.push(...member.geometry.map((p: any) => [p.lon, p.lat]));
          }
        }
      }
    }
    if (coords.length < 3) continue;
    let sumLng = 0, sumLat = 0;
    for (const [lng, lat] of coords) { sumLng += lng; sumLat += lat; }
    const centerLng = sumLng / coords.length;
    const centerLat = sumLat / coords.length;
    const lats = coords.map((c) => c[1]);
    const lngs = coords.map((c) => c[0]);
    const heightM = (Math.max(...lats) - Math.min(...lats)) * 111320;
    const widthM = (Math.max(...lngs) - Math.min(...lngs)) * 111320 * Math.cos(centerLat * Math.PI / 180);
    const extent = Math.max(widthM, heightM);
    results.push({
      name: tags.name,
      type: tags.leisure || tags.place || tags.landuse || 'park',
      lat: centerLat, lng: centerLng,
      geometry: coords, extent: Math.round(extent),
      osmType: el.type, osmId: el.id, tags,
    });
  }
  console.log(`[overpass] ${results.length} park areas (${results.filter((r: any) => r.osmType === 'relation').length} relations)`);
  return results;
}
