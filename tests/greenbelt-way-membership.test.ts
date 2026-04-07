/**
 * Regression test: OSM way 311604378 ("Trail #1" next to Penguin Picnic Area,
 * fine_gravel, 2m wide, bicycle=designated) is in Gatineau Park at -75.83, 45.50.
 *
 * This trail must belong to parc-de-la-gatineau, not ncc-greenbelt.
 * A name collision between multiple "Trail 1" entries caused the pipeline to
 * associate this trail's geometry with a Greenbelt member page.
 *
 * Ways 218548947 and 311604378 are both in Gatineau Park. They currently exist
 * in the sentier-velo-de-montagne-parc-de-la-gatineau relation, but the name-based
 * geometry cache also picked them up as "Trail 1" — creating a stale file
 * (name-trail-1.geojson) that can leak into tile generation.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseBikePathsYml, geoFilesForEntry } from '../src/lib/bike-paths/bikepaths-yml.server';

const PENGUIN_TRAIL_WAY_ID = 311604378;
const CACHE_DIR = path.resolve('.cache', 'bikepath-geometry', 'ottawa');

describe('Trail #1 near Penguin Picnic Area belongs to Gatineau Park', () => {
  const ymlPath = path.resolve(
    process.env.CONTENT_DIR || path.join(process.env.HOME!, 'code', 'bike-routes'),
    'ottawa', 'bikepaths.yml'
  );

  it(`way ${PENGUIN_TRAIL_WAY_ID} has an entry in parc-de-la-gatineau`, () => {
    const content = fs.readFileSync(ymlPath, 'utf-8');
    const { entries } = parseBikePathsYml(content);

    // Find all entries that contain this way
    const owners = entries.filter(e =>
      e.osm_way_ids?.includes(PENGUIN_TRAIL_WAY_ID)
    );

    expect(owners.length, `way ${PENGUIN_TRAIL_WAY_ID} must be in at least one entry`).toBeGreaterThan(0);

    // At least one owner must be a member of parc-de-la-gatineau
    const gatineauOwners = owners.filter(e => e.member_of === 'parc-de-la-gatineau');
    expect(
      gatineauOwners.length,
      `way ${PENGUIN_TRAIL_WAY_ID} must be in a parc-de-la-gatineau entry, but found in: ${owners.map(e => `${e.slug} (member_of: ${e.member_of || 'none'})`).join(', ')}`
    ).toBeGreaterThan(0);
  });

  it(`way ${PENGUIN_TRAIL_WAY_ID} is NOT in any ncc-greenbelt entry or geometry`, () => {
    const content = fs.readFileSync(ymlPath, 'utf-8');
    const { entries } = parseBikePathsYml(content);

    // Check osm_way_ids
    const greenbeltEntries = entries.filter(e => e.member_of === 'ncc-greenbelt');
    for (const entry of greenbeltEntries) {
      expect(
        entry.osm_way_ids ?? [],
        `Greenbelt entry "${entry.name}" (${entry.slug}) must not contain way ${PENGUIN_TRAIL_WAY_ID}`
      ).not.toContain(PENGUIN_TRAIL_WAY_ID);
    }

    // Check geometry cache files for greenbelt entries
    for (const entry of greenbeltEntries) {
      for (const geoFile of geoFilesForEntry(entry)) {
        const geoPath = path.join(CACHE_DIR, geoFile);
        if (!fs.existsSync(geoPath)) continue;

        const data = JSON.parse(fs.readFileSync(geoPath, 'utf-8'));
        const wayIds = (data.features || []).map((f: any) => f.properties?.wayId).filter(Boolean);

        expect(
          wayIds,
          `${geoFile} (Greenbelt) must not contain Gatineau Park way ${PENGUIN_TRAIL_WAY_ID}`
        ).not.toContain(PENGUIN_TRAIL_WAY_ID);
      }
    }
  });

  it('manifest does not list stale name-trail-1.geojson', () => {
    const manifestPath = path.join(CACHE_DIR, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.files).not.toContain('name-trail-1.geojson');
  });
});
