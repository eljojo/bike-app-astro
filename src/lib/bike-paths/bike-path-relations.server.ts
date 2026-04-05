/**
 * Spatial computation for bike path relationships.
 *
 * Extracted from build-data-plugin.ts — these functions compute overlapping
 * routes, nearby photos/places/paths, and connected paths for each bike path
 * entry. Called at Vite config time (Node.js) before the build.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { cityDir } from '../config/config.server';
import { haversineM, PLACE_NEAR_ROUTE_M } from '../geo/proximity';
import { isHardExcluded, scoreBikePath, SCORE_THRESHOLD } from './bike-path-scoring.server';
import type { SluggedBikePathYml } from './bikepaths-yml.server';
import type { BikePathPage } from './bike-path-entries.server';

const CITY_DIR = cityDir;

interface RouteCard {
  slug: string;
  name: string;
  distance_km: number;
  coverKey?: string;
  distanceOnPathKm?: number;
}

/** Compute the total distance (km) of track segments where points are near a path.
 *  Exported for testing. */
export function computeOverlapDistanceKm(
  trackPoints: Array<{ lat: number; lng: number }>,
  isNear: (lat: number, lng: number, index: number) => boolean,
): number {
  let totalM = 0;
  let prevNear = false;
  let prevLat = 0;
  let prevLng = 0;
  for (let i = 0; i < trackPoints.length; i++) {
    const tp = trackPoints[i];
    const near = isNear(tp.lat, tp.lng, i);
    if (near && prevNear) {
      totalM += haversineM(prevLat, prevLng, tp.lat, tp.lng);
    }
    prevNear = near;
    prevLat = tp.lat;
    prevLng = tp.lng;
  }
  const km = totalM / 1000;
  return km > 0 ? Math.round(km * 10) / 10 : 0;
}

interface NearbyPhoto {
  key: string;
  lat: number;
  lng: number;
  routeSlug: string;
  caption?: string;
}

interface NearbyPlace {
  name: string;
  category: string;
  lat: number;
  lng: number;
  distance_m: number;
}

export interface PathRelations {
  overlappingRoutes: RouteCard[];
  nearbyPhotos: NearbyPhoto[];
  nearbyPlaces: NearbyPlace[];
  nearbyPaths: Array<{ slug: string; name: string; surface?: string; memberOf?: string }>;
  connectedPaths: Array<{ slug: string; name: string; surface?: string; memberOf?: string }>;
}

/** Bounding box for a set of points, with padding in degrees (~100m ≈ 0.001°). */
function boundingBox(points: Array<{ lat: number; lng: number }>, padDeg = 0.001) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat: minLat - padDeg, maxLat: maxLat + padDeg, minLng: minLng - padDeg, maxLng: maxLng + padDeg };
}

/** Check if two bounding boxes overlap. */
function bboxOverlap(
  a: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  b: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): boolean {
  return a.minLat <= b.maxLat && a.maxLat >= b.minLat && a.minLng <= b.maxLng && a.maxLng >= b.minLng;
}

/**
 * Precompute ALL bike-path relationships at config time.
 * This replaces the heavy computation that was happening in workerd prerendering.
 */
export function computeBikePathRelations(
  bikePaths: SluggedBikePathYml[],
  geoCoords: Record<string, Array<{ lat: number; lng: number }>>,
  routeTracks: Record<string, Array<{ lat: number; lng: number }>>,
  places: Array<{ name: string; category: string; lat: number; lng: number; status?: string }>,
  mediaLocations: Array<{ key: string; lat: number; lng: number; routeSlug: string; caption?: string }>,
): { relations: Record<string, PathRelations>; routeOverlaps: Record<string, { count: number }>; routeToPaths: Record<string, Array<{ slug: string; name: string; surface?: string; memberOf?: string }>> } {
  const publishedPlaces = places.filter(p => !p.status || p.status === 'published');
  const relations: Record<string, PathRelations> = {};
  const routeOverlaps: Record<string, { count: number }> = {};

  // Load route metadata (name, distance_km, cover) from frontmatter
  const routeMeta = new Map<string, { name: string; distance_km: number; coverKey?: string }>();
  const routesDir = path.join(CITY_DIR, 'routes');
  if (fs.existsSync(routesDir)) {
    for (const slug of fs.readdirSync(routesDir)) {
      const indexPath = path.join(routesDir, slug, 'index.md');
      if (!fs.existsSync(indexPath)) continue;
      const { data: fm } = matter(fs.readFileSync(indexPath, 'utf-8'));
      if (fm.status !== 'published') continue;
      // Find cover media key from media.yml
      let coverKey: string | undefined;
      const mediaPath = path.join(routesDir, slug, 'media.yml');
      if (fs.existsSync(mediaPath)) {
        const media = yaml.load(fs.readFileSync(mediaPath, 'utf-8'));
        if (Array.isArray(media)) {
          const cover = media.find((m: { cover?: boolean }) => m.cover);
          if (cover?.key) coverKey = cover.key;
          else if (media[0]?.key) coverKey = media[0].key;
        }
      }
      routeMeta.set(slug, {
        name: fm.name as string || slug,
        distance_km: (fm.distance_km as number) || 0,
        coverKey,
      });
    }
  }

  // Precompute route bounding boxes
  const routeBboxes = new Map<string, ReturnType<typeof boundingBox>>();
  for (const [slug, pts] of Object.entries(routeTracks)) {
    if (pts.length > 0) routeBboxes.set(slug, boundingBox(pts));
  }

  // Build points per entry slug
  const entryPoints = new Map<string, Array<{ lat: number; lng: number }>>();
  for (const entry of bikePaths) {
    let points: Array<{ lat: number; lng: number }> = [];
    // GeoJSON for relations
    for (const relId of entry.osm_relations ?? []) {
      const coords = geoCoords[String(relId)];
      if (coords) points = points.concat(coords);
    }
    // GeoJSON for named ways
    if (points.length === 0 && entry.osm_names?.length) {
      const coords = geoCoords[`name-${entry.slug}`];
      if (coords) points = points.concat(coords);
    }
    // GeoJSON for segments
    if (points.length === 0 && (entry as unknown as { segments?: unknown[] }).segments?.length) {
      const coords = geoCoords[`seg-${entry.slug}`];
      if (coords) points = points.concat(coords);
    }
    // Fall back to YML anchors
    if (points.length === 0) {
      points = (entry.anchors ?? []).map((a: unknown) =>
        Array.isArray(a) ? { lat: (a as number[])[1], lng: (a as number[])[0] } : a as { lat: number; lng: number }
      );
    }
    entryPoints.set(entry.slug, points);
  }

  // Build spatial grid index for fast point-in-radius queries.
  // Cell size ~111m (0.001°) — checking a 3x3 neighborhood covers 100m radius.
  const CELL_SIZE = 0.001;
  function cellKey(lat: number, lng: number): string {
    return `${Math.floor(lat / CELL_SIZE)},${Math.floor(lng / CELL_SIZE)}`;
  }

  // Index: cell → list of { slug, lat, lng }
  const pathGrid = new Map<string, Array<{ slug: string; lat: number; lng: number }>>();
  for (const [slug, pts] of entryPoints) {
    for (const p of pts) {
      const key = cellKey(p.lat, p.lng);
      let cell = pathGrid.get(key);
      if (!cell) { cell = []; pathGrid.set(key, cell); }
      cell.push({ slug, lat: p.lat, lng: p.lng });
    }
  }

  /** Check if a point is within `thresholdM` of any point belonging to `targetSlug` using the grid. */
  function isNearPath(lat: number, lng: number, targetSlug: string, thresholdM: number): boolean {
    const cLat = Math.floor(lat / CELL_SIZE);
    const cLng = Math.floor(lng / CELL_SIZE);
    const rLat = Math.ceil(thresholdM / 111000 / CELL_SIZE);
    // Longitude degrees are shorter at higher latitudes
    const rLng = Math.ceil(thresholdM / (111000 * Math.cos(lat * Math.PI / 180)) / CELL_SIZE);
    for (let dLat = -rLat; dLat <= rLat; dLat++) {
      for (let dLng = -rLng; dLng <= rLng; dLng++) {
        const cell = pathGrid.get(`${cLat + dLat},${cLng + dLng}`);
        if (!cell) continue;
        for (const p of cell) {
          if (p.slug !== targetSlug) continue;
          if (haversineM(lat, lng, p.lat, p.lng) <= thresholdM) return true;
        }
      }
    }
    return false;
  }

  // Only compute expensive relations for entries that will become pages.
  // A path becomes a page if it has markdown OR passes isHardExcluded + scoring.
  // We can't know the final score yet (it depends on route overlap count), so we
  // use a pre-filter: skip entries that are hard-excluded or have no points.
  // This reduces the inner loop from ~600 to ~100-200 candidates.
  const candidateEntries = bikePaths.filter(e => !isHardExcluded(e));
  const candidateBySlug = new Map(candidateEntries.map(e => [e.slug, e]));

  for (const entry of candidateEntries) {
    const points = entryPoints.get(entry.slug) ?? [];
    if (points.length === 0) {
      routeOverlaps[entry.slug] = { count: 0 };
      relations[entry.slug] = { overlappingRoutes: [], nearbyPhotos: [], nearbyPlaces: [], nearbyPaths: [], connectedPaths: [] };
      continue;
    }

    const pathBbox = boundingBox(points);

    // Route overlaps — require at least 5% of route points near the path
    const ROUTE_OVERLAP_MIN_PCT = 5;
    const overlappingRoutes: RouteCard[] = [];
    for (const [routeSlug, trackPoints] of Object.entries(routeTracks)) {
      if (trackPoints.length === 0) continue;
      const trackBbox = routeBboxes.get(routeSlug);
      if (!trackBbox) continue;
      if (!bboxOverlap(trackBbox, pathBbox)) continue;

      let nearCount = 0;
      let overlapM = 0;
      let prevNear = false;
      let prevLat = 0;
      let prevLng = 0;
      for (const tp of trackPoints) {
        if (tp.lat < pathBbox.minLat || tp.lat > pathBbox.maxLat ||
            tp.lng < pathBbox.minLng || tp.lng > pathBbox.maxLng) {
          prevNear = false;
          continue;
        }
        const near = isNearPath(tp.lat, tp.lng, entry.slug, 100);
        if (near) {
          nearCount++;
          if (prevNear) overlapM += haversineM(prevLat, prevLng, tp.lat, tp.lng);
        }
        prevNear = near;
        prevLat = tp.lat;
        prevLng = tp.lng;
      }

      const routePct = nearCount / trackPoints.length * 100;
      if (routePct >= ROUTE_OVERLAP_MIN_PCT) {
        const meta = routeMeta.get(routeSlug);
        if (meta) {
          const distanceOnPathKm = overlapM > 0 ? Math.round(overlapM / 100) / 10 : undefined;
          overlappingRoutes.push({ slug: routeSlug, ...meta, distanceOnPathKm });
        }
      }
    }
    routeOverlaps[entry.slug] = { count: overlappingRoutes.length };

    // Nearby paths (within 2km) — use spatial grid to find candidates
    const NEARBY_THRESHOLD_M = 2000;
    const nearbySlugs = new Set<string>();
    // Sample every 5th point to reduce grid lookups
    for (let i = 0; i < points.length; i += 5) {
      const pt = points[i];
      const cLat = Math.floor(pt.lat / CELL_SIZE);
      const cLng = Math.floor(pt.lng / CELL_SIZE);
      const rLat = Math.ceil(NEARBY_THRESHOLD_M / 111000 / CELL_SIZE);
      const rLng = Math.ceil(NEARBY_THRESHOLD_M / (111000 * Math.cos(pt.lat * Math.PI / 180)) / CELL_SIZE);
      for (let dLat = -rLat; dLat <= rLat; dLat++) {
        for (let dLng = -rLng; dLng <= rLng; dLng++) {
          const cell = pathGrid.get(`${cLat + dLat},${cLng + dLng}`);
          if (!cell) continue;
          for (const p of cell) {
            if (p.slug === entry.slug || nearbySlugs.has(p.slug)) continue;
            if (haversineM(pt.lat, pt.lng, p.lat, p.lng) < NEARBY_THRESHOLD_M) {
              nearbySlugs.add(p.slug);
            }
          }
        }
      }
    }
    const nearbyPaths: Array<{ slug: string; name: string; surface?: string; memberOf?: string }> = [];
    for (const slug of nearbySlugs) {
      const other = candidateBySlug.get(slug);
      if (other) nearbyPaths.push({ slug: other.slug, name: other.name, surface: other.surface, memberOf: other.member_of });
    }

    // Connected paths (endpoints within 200m) — only check candidate entries
    const endpoints = points.length >= 2
      ? [points[0], points[points.length - 1]]
      : points.slice(0, 1);
    const connectedPaths: Array<{ slug: string; name: string; surface?: string; memberOf?: string }> = [];
    for (const other of candidateEntries) {
      if (other.slug === entry.slug) continue;
      const otherPts = entryPoints.get(other.slug) ?? [];
      if (otherPts.length === 0) continue;
      const otherEndpoints = otherPts.length >= 2
        ? [otherPts[0], otherPts[otherPts.length - 1]]
        : otherPts.slice(0, 1);
      let found = false;
      for (const ep of endpoints) {
        if (found) break;
        for (const oep of otherEndpoints) {
          if (haversineM(ep.lat, ep.lng, oep.lat, oep.lng) < 200) { found = true; break; }
        }
      }
      if (found) connectedPaths.push({ slug: other.slug, name: other.name, surface: other.surface, memberOf: other.member_of });
    }

    // Nearby places (within threshold of any path point)
    const PLACE_NEAR_M = PLACE_NEAR_ROUTE_M;
    const nearbyPlaces: NearbyPlace[] = [];
    for (const place of publishedPlaces) {
      let minDist = Infinity;
      for (const pp of points) {
        const d = haversineM(pp.lat, pp.lng, place.lat, place.lng);
        if (d < minDist) minDist = d;
        if (d <= PLACE_NEAR_M) break; // early exit
      }
      if (minDist <= PLACE_NEAR_M) {
        nearbyPlaces.push({ name: place.name, category: place.category, lat: place.lat, lng: place.lng, distance_m: Math.round(minDist) });
      }
    }
    nearbyPlaces.sort((a, b) => a.distance_m - b.distance_m);

    // Photos near the path (within 300m, geolocated from route media)
    const PHOTO_NEAR_M = 300;
    const nearbyPhotos: NearbyPhoto[] = [];
    for (const photo of mediaLocations) {
      if (nearbyPhotos.length >= 20) break; // cap at 20
      for (const pp of points) {
        if (haversineM(photo.lat, photo.lng, pp.lat, pp.lng) <= PHOTO_NEAR_M) {
          nearbyPhotos.push({ key: photo.key, lat: photo.lat, lng: photo.lng, routeSlug: photo.routeSlug, caption: photo.caption });
          break;
        }
      }
    }

    relations[entry.slug] = { overlappingRoutes, nearbyPhotos, nearbyPlaces, nearbyPaths, connectedPaths };
  }

  // Build reverse map: route slug → list of paths that overlap it
  const routeToPaths: Record<string, Array<{ slug: string; name: string; surface?: string; memberOf?: string }>> = {};
  for (const [pathSlug, rel] of Object.entries(relations)) {
    const pathEntry = bikePaths.find(e => e.slug === pathSlug);
    for (const route of rel.overlappingRoutes) {
      if (!routeToPaths[route.slug]) routeToPaths[route.slug] = [];
      routeToPaths[route.slug].push({
        slug: pathSlug,
        name: pathEntry?.name ?? pathSlug,
        surface: pathEntry?.surface,
        memberOf: pathEntry?.member_of,
      });
    }
  }

  return { relations, routeOverlaps, routeToPaths };
}

/**
 * Enrich Tier 1 bike path pages with Tier 2 relation data.
 *
 * For markdown pages with `includes`, relations from all included YML entries
 * are merged and deduplicated. YML-only pages are re-scored with the real
 * routeOverlapCount and filtered below SCORE_THRESHOLD.
 */
export function enrichBikePathPages(
  tier1Pages: BikePathPage[],
  relations: Record<string, PathRelations>,
  routeOverlaps: Record<string, { count: number }>,
  geoElevation: Record<string, { gain_m: number; loss_m: number }>,
): BikePathPage[] {
  // Two-pass enrichment: first enrich all pages into a Map (order-independent),
  // then aggregate network pages from member data in the Map.
  const enrichedBySlug = new Map<string, BikePathPage>();

  // Pass 1: enrich all pages (non-network pages get their own relations,
  // network pages get their own YML entry relations only — member aggregation in pass 2)
  for (const original of tier1Pages) {
    const matchedEntries = original.ymlEntries;
    // Create a shallow copy to avoid mutating the input array's elements
    const page = { ...original };

    // Re-score YML-only pages with real route overlap count and update listed status
    if (!page.hasMarkdown) {
      const entry = matchedEntries[0];
      const overlapCount = routeOverlaps[entry.slug]?.count ?? 0;
      const score = scoreBikePath(entry, overlapCount);
      page.score = score;
      page.listed = score >= SCORE_THRESHOLD;
      page.stub = true; // all YML-only pages are stubs
      page.routeCount = overlapCount;
    } else {
      // For markdown pages, routeCount = max of all included entries
      page.routeCount = Math.max(
        ...matchedEntries.map(e => routeOverlaps[e.slug]?.count ?? 0),
        0,
      );
      // Re-score markdown pages with real overlap counts too
      const bestChildScore = matchedEntries.reduce(
        (max, e) => Math.max(max, scoreBikePath(e, routeOverlaps[e.slug]?.count ?? 0)),
        0,
      );
      page.score = bestChildScore;
    }

    // Merge overlappingRoutes from all included entries (deduplicated by slug)
    const seenRoutes = new Set<string>();
    const overlappingRoutes: PathRelations['overlappingRoutes'] = [];
    for (const e of matchedEntries) {
      for (const r of (relations[e.slug]?.overlappingRoutes ?? [])) {
        if (!seenRoutes.has(r.slug)) { seenRoutes.add(r.slug); overlappingRoutes.push(r); }
      }
    }
    page.overlappingRoutes = overlappingRoutes;

    // Merge nearbyPhotos
    const seenPhotos = new Set<string>();
    const nearbyPhotos: PathRelations['nearbyPhotos'] = [];
    for (const e of matchedEntries) {
      for (const p of (relations[e.slug]?.nearbyPhotos ?? [])) {
        if (!seenPhotos.has(p.key)) { seenPhotos.add(p.key); nearbyPhotos.push(p); }
      }
    }
    page.nearbyPhotos = nearbyPhotos;

    // Merge nearbyPlaces
    const seenPlaces = new Set<string>();
    const nearbyPlaces: PathRelations['nearbyPlaces'] = [];
    for (const e of matchedEntries) {
      for (const p of (relations[e.slug]?.nearbyPlaces ?? [])) {
        const key = p.name + p.lat + p.lng;
        if (!seenPlaces.has(key)) { seenPlaces.add(key); nearbyPlaces.push(p); }
      }
    }
    page.nearbyPlaces = nearbyPlaces.sort((a, b) => a.distance_m - b.distance_m);

    // Merge nearbyPaths (exclude self)
    const seenNearby = new Set<string>();
    const nearbyPaths: PathRelations['nearbyPaths'] = [];
    for (const e of matchedEntries) {
      for (const p of (relations[e.slug]?.nearbyPaths ?? [])) {
        if (!seenNearby.has(p.slug) && p.slug !== page.slug) { seenNearby.add(p.slug); nearbyPaths.push(p); }
      }
    }
    page.nearbyPaths = nearbyPaths;

    // Merge connectedPaths (exclude self)
    const seenConnected = new Set<string>();
    const connectedPaths: PathRelations['connectedPaths'] = [];
    for (const e of matchedEntries) {
      for (const p of (relations[e.slug]?.connectedPaths ?? [])) {
        if (!seenConnected.has(p.slug) && p.slug !== page.slug) { seenConnected.add(p.slug); connectedPaths.push(p); }
      }
    }
    page.connectedPaths = connectedPaths;

    // Compute elevation_gain_m from all matched entries' geo files
    // (relation-based, name-based, or segment-based)
    let totalElevation = 0;
    for (const e of matchedEntries) {
      for (const relId of e.osm_relations ?? []) {
        const ele = geoElevation[String(relId)];
        if (ele) totalElevation += ele.gain_m;
      }
      // Also check name-based and segment-based geo files
      if (totalElevation === 0 && e.osm_names?.length) {
        const ele = geoElevation[`name-${e.slug}`];
        if (ele) totalElevation += ele.gain_m;
      }
      if (totalElevation === 0 && e.segments?.length) {
        const ele = geoElevation[`seg-${e.slug}`];
        if (ele) totalElevation += ele.gain_m;
      }
    }
    page.elevation_gain_m = totalElevation > 0 ? totalElevation : undefined;

    // Resolve thumbnail: path's own photo_key → cover from route with most overlap → undefined (map PNG used at render time)
    if (!page.thumbnail_key && page.photo_key) {
      page.thumbnail_key = page.photo_key;
    }
    if (!page.thumbnail_key && overlappingRoutes.length > 0) {
      // Pick cover from the first overlapping route that has one (routes are already sorted by overlap)
      for (const r of overlappingRoutes) {
        if (r.coverKey) { page.thumbnail_key = r.coverKey; break; }
      }
    }

    enrichedBySlug.set(page.slug, page);
  }

  // Pass 2: aggregate network pages from enriched member data (order-independent)
  for (const page of enrichedBySlug.values()) {
    if (!page.memberRefs || page.memberRefs.length === 0) continue;

    const memberPages = page.memberRefs
      .map(m => enrichedBySlug.get(m.slug))
      .filter((p): p is BikePathPage => !!p);

    // Aggregate overlapping routes from members (deduplicated)
    const seenRoutes = new Set(page.overlappingRoutes.map(r => r.slug));
    for (const mp of memberPages) {
      for (const r of mp.overlappingRoutes) {
        if (!seenRoutes.has(r.slug)) { seenRoutes.add(r.slug); page.overlappingRoutes.push(r); }
      }
    }

    // Aggregate nearby photos from members
    const seenPhotos = new Set(page.nearbyPhotos.map(p => p.key));
    for (const mp of memberPages) {
      for (const p of mp.nearbyPhotos) {
        if (!seenPhotos.has(p.key)) { seenPhotos.add(p.key); page.nearbyPhotos.push(p); }
      }
    }

    // Aggregate nearby places from members
    const seenPlaces = new Set(page.nearbyPlaces.map(p => p.name + p.lat + p.lng));
    for (const mp of memberPages) {
      for (const p of mp.nearbyPlaces) {
        const key = p.name + p.lat + p.lng;
        if (!seenPlaces.has(key)) { seenPlaces.add(key); page.nearbyPlaces.push(p); }
      }
    }
    page.nearbyPlaces.sort((a, b) => a.distance_m - b.distance_m);

    page.routeCount = page.overlappingRoutes.length;

    // Update memberRefs with resolved thumbnails
    for (const ref of page.memberRefs) {
      const mp = enrichedBySlug.get(ref.slug);
      if (mp?.thumbnail_key) ref.thumbnail_key = mp.thumbnail_key;
    }
  }

  // Pass 3: fix nearby/connected path links — only reference paths that have pages.
  // Non-standalone member paths have memberOf set in the raw YML but no page at the
  // nested URL, so linking to them produces 404s. Use the resolved page's memberOf
  // (which is cleared for non-standalone members) instead of the raw YML member_of.
  for (const page of enrichedBySlug.values()) {
    page.nearbyPaths = page.nearbyPaths
      .filter(p => enrichedBySlug.get(p.slug)?.standalone)
      .map(p => {
        const resolved = enrichedBySlug.get(p.slug)!;
        return { ...p, memberOf: resolved.memberOf };
      });
    page.connectedPaths = page.connectedPaths
      .filter(p => enrichedBySlug.get(p.slug)?.standalone)
      .map(p => {
        const resolved = enrichedBySlug.get(p.slug)!;
        return { ...p, memberOf: resolved.memberOf };
      });
  }

  // Preserve original ordering
  return tier1Pages.map(p => enrichedBySlug.get(p.slug)!);
}
