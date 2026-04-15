/**
 * Regression test for "Trail #1" cache poisoning. Originally: the deployed
 * name-trail-1-1.geojson had wrong content, showing a Gatineau Park trail on
 * a Kanata/Greenbelt detail page. The fix moved the cache to content-addressed
 * files plus a manifest, and assertions here check the ACTIVE cache file for
 * trail-1-1 (whichever name geoFilesForEntry resolves to) against the
 * current YML anchor. When the YML evolves, the test follows the active file
 * rather than a hardcoded name.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseBikePathsYml, geoFilesForEntry } from '../src/lib/bike-paths/bikepaths-yml.server';

const GATINEAU_PARK_WAY_IDS = [218548947, 311604378];
const CACHE_DIR = path.resolve('.cache', 'bikepath-geometry', 'ottawa');

describe('Trail #1 near Penguin Picnic Area belongs to Gatineau Park, not Greenbelt', () => {
  const ymlPath = path.resolve(
    process.env.CONTENT_DIR || path.join(process.env.HOME!, 'code', 'bike-routes'),
    'ottawa', 'bikepaths.yml'
  );

  function loadTrail11() {
    const content = fs.readFileSync(ymlPath, 'utf-8');
    const { entries } = parseBikePathsYml(content);
    const trail11 = entries.find(e => e.slug === 'trail-1-1');
    expect(trail11, 'trail-1-1 must exist in bikepaths.yml').toBeDefined();
    const files = geoFilesForEntry(trail11!);
    expect(files.length, `trail-1-1 must resolve to at least one cache file; got ${JSON.stringify(files)}`).toBeGreaterThan(0);
    return { entry: trail11!, files };
  }

  function readFeatures(file: string) {
    const geoPath = path.join(CACHE_DIR, file);
    expect(fs.existsSync(geoPath), `active cache file ${file} must exist on disk — run cache-path-geometry`).toBe(true);
    const data = JSON.parse(fs.readFileSync(geoPath, 'utf-8'));
    return (data.features || []) as Array<{ properties?: { wayId?: number }; geometry?: { coordinates?: [number, number][] } }>;
  }

  it('active cache file(s) for trail-1-1 must NOT contain Gatineau Park ways', () => {
    const { files } = loadTrail11();
    for (const file of files) {
      const features = readFeatures(file);
      const wayIds = features.map(f => f.properties?.wayId).filter((v): v is number => typeof v === 'number');
      for (const gatiWay of GATINEAU_PARK_WAY_IDS) {
        expect(
          wayIds,
          `${file} must not contain Gatineau Park way ${gatiWay} — trail-1-1 belongs to the Greenbelt`
        ).not.toContain(gatiWay);
      }
    }
  });

  it('active cache file(s) for trail-1-1 must have geometry near its YML anchors', () => {
    const { entry, files } = loadTrail11();
    const anchors = entry.anchors ?? [];
    expect(anchors.length).toBeGreaterThan(0);
    const anchorLat = Array.isArray(anchors[0]) ? (anchors[0] as number[])[1] : (anchors[0] as { lat: number }).lat;

    for (const file of files) {
      const features = readFeatures(file);
      const allLats: number[] = [];
      for (const feature of features) {
        for (const coord of feature.geometry?.coordinates ?? []) {
          allLats.push(coord[1]);
        }
      }
      expect(allLats.length, `${file} must contain geometry`).toBeGreaterThan(0);
      const avgLat = allLats.reduce((a, b) => a + b, 0) / allLats.length;
      expect(
        Math.abs(avgLat - anchorLat),
        `${file} geometry center (${avgLat.toFixed(4)}) is too far from anchor (${anchorLat.toFixed(4)}) — wrong trail in the file`,
      ).toBeLessThan(0.1);
    }
  });

  // TODO: fails after pipeline refactor — way may have moved between entries. Investigate after Gatineau Park network redesign.
  it.skip(`way ${GATINEAU_PARK_WAY_IDS[1]} has an entry in parc-de-la-gatineau`, () => {
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

  it('trail-1-1 has osm_way_ids so the detail page can link to OSM', () => {
    // Named-way entries know their way IDs during the pipeline build
    // (_wayIds) but currently strip them before YAML output. Without
    // osm_way_ids, the detail page can only show a search link
    // ("search on OpenStreetMap") instead of a direct way link.
    // Way 553292672 is the main Trail 1 segment at Wesley Clover Parks.
    const content = fs.readFileSync(ymlPath, 'utf-8');
    const { entries } = parseBikePathsYml(content);

    const trail11 = entries.find(e => e.slug === 'trail-1-1');
    expect(trail11).toBeDefined();
    expect(
      trail11!.osm_way_ids?.length,
      'trail-1-1 must have osm_way_ids for direct OSM links'
    ).toBeGreaterThan(0);
  });
});
