/**
 * Regression test: OSM way 311604378 ("Trail #1" next to Penguin Picnic Area,
 * fine_gravel, 2m wide, bicycle=designated) is in Gatineau Park at -75.83, 45.50.
 *
 * The deployed name-trail-1-1.geojson was poisoned: it has the correct filename
 * but contains Gatineau Park geometry (ways 218548947 and 311604378) instead of
 * the Kanata/Greenbelt geometry it should have. The cache-path-geometry script
 * is incremental (skip existing files), so the wrong file persists across builds.
 *
 * This caused /bike-paths/ncc-greenbelt/trail-1-1/ to show a 4.3 km trail in
 * Gatineau Park instead of the actual 2.1 km trail in the Greenbelt.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseBikePathsYml } from '../src/lib/bike-paths/bikepaths-yml.server';

const GATINEAU_PARK_WAY_IDS = [218548947, 311604378];
const CACHE_DIR = path.resolve('.cache', 'bikepath-geometry', 'ottawa');

describe('Trail #1 near Penguin Picnic Area belongs to Gatineau Park, not Greenbelt', () => {
  const ymlPath = path.resolve(
    process.env.CONTENT_DIR || path.join(process.env.HOME!, 'code', 'bike-routes'),
    'ottawa', 'bikepaths.yml'
  );

  it('name-trail-1-1.geojson must NOT contain Gatineau Park ways', () => {
    // This is the core bug: the file has the right name but wrong content.
    // The cache-path-geometry script fetched geometry for "Trail 1" and wrote
    // Gatineau Park ways into name-trail-1-1.geojson (which should contain
    // Kanata/Greenbelt ways).
    const geoPath = path.join(CACHE_DIR, 'name-trail-1-1.geojson');
    if (!fs.existsSync(geoPath)) return;

    const data = JSON.parse(fs.readFileSync(geoPath, 'utf-8'));
    const wayIds = (data.features || []).map((f: any) => f.properties?.wayId).filter(Boolean);

    for (const gatiWay of GATINEAU_PARK_WAY_IDS) {
      expect(
        wayIds,
        `name-trail-1-1.geojson must not contain Gatineau Park way ${gatiWay} — the file has wrong content`
      ).not.toContain(gatiWay);
    }
  });

  it('name-trail-1-1.geojson geometry must be near its YML anchors (Kanata, ~45.33)', () => {
    // trail-1-1 anchors are at [-75.87, 45.33] — Kanata/Greenbelt area.
    // If the geojson has coordinates north of 45.45, it's Gatineau Park.
    const geoPath = path.join(CACHE_DIR, 'name-trail-1-1.geojson');
    if (!fs.existsSync(geoPath)) return;

    const content = fs.readFileSync(ymlPath, 'utf-8');
    const { entries } = parseBikePathsYml(content);
    const trail11 = entries.find(e => e.slug === 'trail-1-1');
    expect(trail11).toBeDefined();

    // Get anchor latitude
    const anchors = trail11!.anchors ?? [];
    expect(anchors.length).toBeGreaterThan(0);
    const anchorLat = Array.isArray(anchors[0]) ? (anchors[0] as number[])[1] : (anchors[0] as any).lat;

    // Get geojson coordinate range
    const data = JSON.parse(fs.readFileSync(geoPath, 'utf-8'));
    const allLats: number[] = [];
    for (const feature of data.features || []) {
      for (const coord of feature.geometry?.coordinates ?? []) {
        allLats.push(coord[1]);
      }
    }
    expect(allLats.length).toBeGreaterThan(0);

    const avgLat = allLats.reduce((a, b) => a + b, 0) / allLats.length;

    // Geometry should be within ~10km of the anchor (~0.1 degrees latitude)
    expect(
      Math.abs(avgLat - anchorLat),
      `Geometry center (${avgLat.toFixed(4)}) is too far from anchor (${anchorLat.toFixed(4)}) — wrong trail in the file`
    ).toBeLessThan(0.1);
  });

  it(`way ${GATINEAU_PARK_WAY_IDS[1]} has an entry in parc-de-la-gatineau`, () => {
    const content = fs.readFileSync(ymlPath, 'utf-8');
    const { entries } = parseBikePathsYml(content);

    const owners = entries.filter(e =>
      e.osm_way_ids?.includes(GATINEAU_PARK_WAY_IDS[1])
    );

    expect(owners.length).toBeGreaterThan(0);
    const gatineauOwners = owners.filter(e => e.member_of === 'parc-de-la-gatineau');
    expect(
      gatineauOwners.length,
      `way ${GATINEAU_PARK_WAY_IDS[1]} must be in a parc-de-la-gatineau entry`
    ).toBeGreaterThan(0);
  });

  it('manifest does not list stale name-trail-1.geojson', () => {
    const manifestPath = path.join(CACHE_DIR, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.files).not.toContain('name-trail-1.geojson');
  });
});
